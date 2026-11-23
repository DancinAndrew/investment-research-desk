import {DatabaseSync} from 'node:sqlite'
import {createHash, randomUUID} from 'node:crypto'
import {mkdir, readFile, writeFile, rename, realpath} from 'node:fs/promises'
import {resolve, relative, isAbsolute} from 'node:path'
import {execFileSync} from 'node:child_process'
import {runPipeline, PIPELINE_VERSION, STAGES} from './pipeline.mjs'
import {evaluateReport, renderReport} from './evaluator.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')
const encode = value => JSON.stringify(value, null, 2) + '\n'
const terminal = new Set(['accepted','needs_revision','blocked','failed','cancelled','timed_out','interrupted'])
const openedStores=new Set()
export class JobError extends Error {
  constructor(code,message,status=400){super(message);this.code=code;this.status=status}
}
async function atomicJSON(path,value){
  const temporary=path+'.'+randomUUID()+'.tmp'
  await writeFile(temporary,encode(value),{flag:'wx',mode:0o600})
  await rename(temporary,path)
}
// Only the local operator's registered profile can name files. HTTP callers never can.
export async function loadRegisteredInput(root){
  const profilePath=resolve(root,'.private/research-pipeline/profile.json')
  let profile
  try{profile=JSON.parse(await readFile(profilePath,'utf8'))}catch(e){if(e.code==='ENOENT')return null;throw e}
  if(typeof profile.input_path!=='string'||!/^\.private\/research-pipeline\/inputs\/nvda-[a-f0-9]{64}\.json$/.test(profile.input_path)||!/^([a-f0-9]{64})$/.test(profile.input_sha256))throw new JobError('profile_invalid','研究輸入設定無效。',503)
  const privateRoot=await realpath(resolve(root,'.private/research-pipeline/inputs'))
  const path=await realpath(resolve(root,profile.input_path)),inside=relative(privateRoot,path)
  if(!inside||inside.startsWith('..')||isAbsolute(inside))throw new JobError('profile_invalid','研究輸入不在登錄範圍。',503)
  const bytes=await readFile(path)
  if(hash(bytes)!==profile.input_sha256)throw new JobError('input_changed','研究輸入版本已改變，請重新準備。',503)
  const input=JSON.parse(bytes)
  if(input.profile?.company!=='NVDA'||input.bundle?.company?.company_id!=='NVDA')throw new JobError('profile_invalid','目前只登錄 NVDA。',503)
  return {input,bytes,sha256:profile.input_sha256}
}

export class ResearchJobs {
  constructor({root,registered,codeVersion='uncommitted',codeHashes={},execute=runPipeline,timeoutMs=60000,maxActive=2}){
    this.root=resolve(root);this.registered=registered;this.codeVersion=codeVersion;this.codeHashes=codeHashes
    this.execute=execute;this.timeoutMs=timeoutMs;this.maxActive=maxActive;this.active=new Map();this.closed=false
  }
  async open(){
    this.directory=resolve(this.root,'.private/research-pipeline/jobs')
    await mkdir(this.directory,{recursive:true,mode:0o700})
    if(openedStores.has(this.directory))throw new JobError('store_busy','研究任務儲存已由另一個本機執行器使用。',409)
    this.db=new DatabaseSync(resolve(this.directory,'jobs.sqlite'))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs(seq INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT UNIQUE NOT NULL,request_id TEXT UNIQUE NOT NULL,request_sha TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS latest(company TEXT PRIMARY KEY,job_id TEXT NOT NULL,seq INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS runtime(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,instance TEXT NOT NULL);`)
    this.instance=randomUUID()
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const lease=this.db.prepare('SELECT * FROM runtime WHERE id=1').get()
      if(lease&&lease.pid!==process.pid){let alive=true;try{process.kill(lease.pid,0)}catch(e){if(e.code==='ESRCH')alive=false}if(alive)throw new JobError('store_busy','研究任務儲存已由另一個本機執行器使用。',409)}
      this.db.prepare('INSERT INTO runtime(id,pid,instance) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET pid=excluded.pid,instance=excluded.instance').run(process.pid,this.instance)
      this.db.exec('COMMIT');openedStores.add(this.directory)
    }catch(e){this.db.exec('ROLLBACK');this.db.close();throw e}
    // A process never resumes an interrupted computation merely because it was read.
    for(const row of this.db.prepare('SELECT * FROM jobs').all()){
      const job=JSON.parse(row.payload)
      if(!terminal.has(job.status)){const interrupted=this.save({...job,status:'interrupted',finished_at:new Date().toISOString(),failure_reason:'本機程序重啟；本次執行已中斷，請另開新研究。'});await mkdir(resolve(this.directory,job.job_id),{recursive:true,mode:0o700});await atomicJSON(resolve(this.directory,job.job_id,'run-receipt.json'),interrupted)}
    }
    return this
  }
  capabilities(){return this.registered?{configured:true,supported:true,company:'NVDA',question_id:'nvda-snapshot',question:'以已保存的公開資料重新分析 NVDA',mode:'deterministic_snapshot',execution_mode:'local',workflow_version:PIPELINE_VERSION,timeout_seconds:this.timeoutMs/1000,source_sha256:this.registered.sha256,information_as_of:this.registered.input.profile.information_as_of,stages:STAGES,uses_model:false}:{configured:false,supported:false,execution_mode:'local',reason:'尚未準備真實 NVDA 輸入。請先執行 npm run research:prepare。'}}
  save(job){this.db.prepare('UPDATE jobs SET payload=? WHERE job_id=?').run(encode(job),job.job_id);return job}
  get(id){
    if(typeof id!=='string'||!/^run_[a-f0-9-]{36}$/.test(id))throw new JobError('not_found','找不到這次研究。',404)
    const row=this.db.prepare('SELECT payload FROM jobs WHERE job_id=?').get(id)
    if(!row)throw new JobError('not_found','找不到這次研究。',404)
    return JSON.parse(row.payload)
  }
  byRequest(id){const row=this.db.prepare('SELECT payload FROM jobs WHERE request_id=?').get(id);if(!row)throw new JobError('not_found','找不到這次提交紀錄。',404);return JSON.parse(row.payload)}
  list(){return {jobs:this.db.prepare('SELECT payload FROM jobs ORDER BY seq DESC LIMIT 100').all().map(row=>{const job=JSON.parse(row.payload);return Object.fromEntries(['job_id','request_id','company','question_id','status','created_at','finished_at','information_as_of','execution_mode'].map(key=>[key,job[key]]))})}}
  async start(body){
    if(this.closed||!this.registered)throw new JobError('unavailable','本機研究尚未設定。',503)
    if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['company','question_id','source_sha256','request_id'].includes(k))||body.company!=='NVDA'||body.question_id!=='nvda-snapshot'||!/^[-a-zA-Z0-9_]{16,100}$/.test(body.request_id||''))throw new JobError('invalid_request','研究公司或提交格式無效。',422)
    if(body.source_sha256!==this.registered.sha256)throw new JobError('input_changed','研究輸入已改變，請重新讀取研究範圍。',409)
    const requestSHA=hash(encode({company:body.company,question_id:body.question_id,source_sha256:body.source_sha256}))
    const existing=this.db.prepare('SELECT * FROM jobs WHERE request_id=?').get(body.request_id)
    if(existing){if(existing.request_sha!==requestSHA)throw new JobError('request_conflict','同一提交識別碼不能更換研究內容。',409);return JSON.parse(existing.payload)}
    if(this.active.size>=this.maxActive)throw new JobError('busy','已有研究執行中，請稍後再試。',429)
    const job={job_id:'run_'+randomUUID(),request_id:body.request_id,company:'NVDA',question_id:body.question_id,status:'queued',created_at:new Date().toISOString(),information_as_of:this.registered.input.profile.information_as_of,input_sha256:this.registered.sha256,execution_mode:'local',workflow_version:PIPELINE_VERSION,desk_commit:this.codeVersion,code_sha256:this.codeHashes,stage_trace:[]}
    // Unique request key and durable job identity are committed before acknowledgement.
    this.db.prepare('INSERT INTO jobs(job_id,request_id,request_sha,payload) VALUES(?,?,?,?)').run(job.job_id,body.request_id,requestSHA,encode(job))
    const control={controller:new AbortController(),live:true,promise:null}
    this.active.set(job.job_id,control)
    control.promise=this.run(job,control).finally(()=>this.active.delete(job.job_id))
    return job
  }
  async run(job,control){
    let timer
    const directory=resolve(this.directory,job.job_id)
    try{
      await mkdir(directory,{recursive:false,mode:0o700})
      await writeFile(resolve(directory,'input.json'),this.registered.bytes,{flag:'wx',mode:0o600})
      if(!control.live)return
      if(control.controller.signal.aborted)throw control.controller.signal.reason
      this.save({...job,status:'running'})
      const stopped=new Promise((_,reject)=>{
        const abort=()=>reject(control.controller.signal.reason||new Error('cancelled'))
        control.controller.signal.addEventListener('abort',abort,{once:true})
        timer=setTimeout(()=>control.controller.abort(new JobError('timed_out','研究超過執行期限。',408)),this.timeoutMs)
      })
      const computation=this.execute(structuredClone(this.registered.input),{runId:job.job_id,signal:control.controller.signal,onStage:async stage=>{
        if(!control.live||control.controller.signal.aborted)throw control.controller.signal.reason||new Error('cancelled')
        const current=this.get(job.job_id)
        this.save({...current,stage_trace:[...current.stage_trace,stage]})
      }})
      const result=await Promise.race([computation,stopped])
      if(!control.live)return
      if(control.controller.signal.aborted)throw control.controller.signal.reason
      // Recheck at the sole publication boundary; an executor's status is insufficient.
      const checked=result.report?evaluateReport(result.report,this.registered.input):null
      const accepted=result.status==='accepted'&&checked?.status==='accepted'&&result.report_markdown===renderReport(result.report)&&result.stage_trace?.length===11
      const status=accepted?'accepted':result.status==='blocked'?'blocked':'needs_revision'
      const saved={...result,status,evaluation:checked||result.evaluation}
      const bytes=encode(saved)
      await writeFile(resolve(directory,'result.json'),bytes,{flag:'wx',mode:0o600})
      await writeFile(resolve(directory,'report.md'),accepted?result.report_markdown:result.report_markdown||'',{flag:'wx',mode:0o600})
      let astBytes
      if(accepted){const ast=JSON.parse(execFileSync('pandoc',['--from=markdown-raw_html-raw_tex','--to=json'],{input:result.report_markdown,encoding:'utf8',maxBuffer:4_000_000,timeout:10000,stdio:['pipe','pipe','pipe']}));astBytes=encode(ast.blocks);await writeFile(resolve(directory,'report-ast.json'),astBytes,{flag:'wx',mode:0o600})}
      await atomicJSON(resolve(directory,'stage-trace.json'),saved.stage_trace)
      if(!control.live)return
      if(control.controller.signal.aborted)throw control.controller.signal.reason
      const finished={...this.get(job.job_id),status,finished_at:new Date().toISOString(),result_sha256:hash(bytes),report_sha256:hash(saved.report_markdown||''),report_ast_sha256:astBytes?hash(astBytes):null,evaluation:saved.evaluation,limitations:saved.limitations,stage_trace:saved.stage_trace}
      await atomicJSON(resolve(directory,'run-receipt.json'),finished)
      this.db.exec('BEGIN IMMEDIATE')
      try{
        this.save(finished)
        if(accepted){const row=this.db.prepare('SELECT seq FROM jobs WHERE job_id=?').get(job.job_id);this.db.prepare('INSERT INTO latest(company,job_id,seq) VALUES(?,?,?) ON CONFLICT(company) DO UPDATE SET job_id=excluded.job_id,seq=excluded.seq WHERE excluded.seq>latest.seq').run(job.company,job.job_id,row.seq)}
        this.db.exec('COMMIT')
      }catch(e){this.db.exec('ROLLBACK');throw e}
    }catch(e){
      if(control.live){const status=control.controller.signal.aborted?(control.controller.signal.reason?.code==='timed_out'?'timed_out':'cancelled'):'failed';const failed={...this.get(job.job_id),status,finished_at:new Date().toISOString(),failure_reason:status==='failed'?'研究未能完成，請查看本機執行紀錄。':status==='timed_out'?'研究超過執行期限。':'研究已取消。',failure_code:e.code||'execution_failed'};this.save(failed);await atomicJSON(resolve(directory,'run-receipt.json'),failed).catch(()=>{})}
    }finally{clearTimeout(timer);control.live=false}
  }
  async cancel(id){const job=this.get(id);if(terminal.has(job.status))return job;const control=this.active.get(id);if(control){control.controller.abort(new JobError('cancelled','研究已取消。'));control.live=false}const cancelled=this.save({...job,status:'cancelled',finished_at:new Date().toISOString(),failure_reason:'研究已取消。'});await mkdir(resolve(this.directory,id),{recursive:true,mode:0o700});await atomicJSON(resolve(this.directory,id,'run-receipt.json'),cancelled);return cancelled}
  async reading(id){
    const job=this.get(id)
    if(job.status!=='accepted')throw new JobError('not_accepted','這次研究尚未通過接受檢查，不能作為完成報告閱讀。',409)
    const directory=resolve(this.directory,id),bytes=await readFile(resolve(directory,'result.json'))
    if(hash(bytes)!==job.result_sha256)throw new JobError('artifact_changed','研究內容與接受紀錄不符。',409)
    const result=JSON.parse(bytes),inputBytes=await readFile(resolve(directory,'input.json'))
    // Acceptance belongs to the pinned code/input version that produced it.
    // Re-running today's renderer/gate would make old accepted versions unreadable
    // after an update. Publication checked the gate; reading checks its frozen receipt.
    if(hash(inputBytes)!==job.input_sha256||result.status!=='accepted'||result.evaluation?.status!=='accepted'||job.evaluation?.status!=='accepted'||JSON.stringify(result.evaluation)!==JSON.stringify(job.evaluation)||hash(result.report_markdown||'')!==job.report_sha256)throw new JobError('artifact_changed','研究接受狀態無法核實。',409)
    const astBytes=await readFile(resolve(directory,'report-ast.json'))
    if(hash(astBytes)!==job.report_ast_sha256)throw new JobError('artifact_changed','研究閱讀內容與接受紀錄不符。',409)
    return {job_id:id,company:job.company,report_markdown:result.report_markdown,report_ast:JSON.parse(astBytes),sources:result.sources,receipt:job,checks:result.evaluation,quality_status:'mechanically_accepted_semantics_not_independently_reviewed',stage_trace:result.stage_trace,information_as_of:job.information_as_of}
  }
  async latest(company){const row=this.db.prepare('SELECT job_id FROM latest WHERE company=?').get(company);if(!row)throw new JobError('not_found','此公司尚無接受的本機研究。',404);return this.reading(row.job_id)}
  async close(){this.closed=true;await Promise.all([...this.active.keys()].map(id=>this.cancel(id)));await Promise.allSettled([...this.active.values()].map(x=>x.promise));this.db.prepare('DELETE FROM runtime WHERE id=1 AND instance=?').run(this.instance);this.db.close();openedStores.delete(this.directory)}
}

const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
export async function researchJobsFetch(request,jobs){
  try{
    const u=new URL(request.url)
    if(!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||request.headers.get('sec-fetch-site')==='cross-site')throw new JobError('forbidden','請從本機工作台使用研究功能。',403)
    const path=u.pathname.replace(/^\/api\/research-jobs\/?/,'').split('/').filter(Boolean)
    if(request.method==='GET'){
      if(!path.length)return json(jobs.list())
      if(path[0]==='capabilities'&&path.length===1)return json(jobs.capabilities())
      if(path[0]==='requests'&&path.length===2)return json(jobs.byRequest(decodeURIComponent(path[1])))
      if(path[0]==='latest'&&path.length===2)return json(await jobs.latest(decodeURIComponent(path[1])))
      if(path.length===2&&path[1]==='reading')return json(await jobs.reading(path[0]))
      if(path.length===1)return json(jobs.get(path[0]))
    }
    if(request.method==='POST'){
      if(request.headers.get('origin')!==u.origin||!request.headers.get('content-type')?.startsWith('application/json'))throw new JobError('forbidden','請從本機工作台提交研究。',403)
      const raw=await request.text();if(Buffer.byteLength(raw)>8192)throw new JobError('too_large','研究請求過大。',413)
      let body;try{body=JSON.parse(raw)}catch{throw new JobError('invalid_json','研究請求格式無效。')}
      if(!path.length)return json(await jobs.start(body),202)
      if(path.length===2&&path[1]==='cancel'&&body&&Object.keys(body).length===0)return json(await jobs.cancel(path[0]))
    }
    throw new JobError('not_found','找不到研究操作。',404)
  }catch(e){return json({error:e instanceof JobError?e.message:'本機研究服務暫時無法使用。',code:e.code||'unavailable'},e instanceof JobError?e.status:503)}
}
