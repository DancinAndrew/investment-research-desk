import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm,readFile,writeFile,mkdir,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {ResearchJobs,researchJobsFetch,loadRegisteredInput} from '../src/research-pipeline/jobs.mjs'
import {runPipeline} from '../src/research-pipeline/pipeline.mjs'
import {renderReport} from '../src/research-pipeline/evaluator.mjs'
import {syntheticInput} from './helpers/m1-input.mjs'

const sha=x=>createHash('sha256').update(x).digest('hex')
const registered=input=>{const bytes=Buffer.from(JSON.stringify(input)+'\n');return {input,bytes,sha256:sha(bytes)}}
const requestBody=(store,id=randomUUID())=>({company:'NVDA',question_id:'nvda-snapshot',source_sha256:store.capabilities().source_sha256,request_id:id})
async function setup(t,options={}){const root=await mkdtemp(join(tmpdir(),'desk-m1-jobs-'));const store=await new ResearchJobs({root,registered:registered(syntheticInput()),...options}).open();t.after(async()=>{if(!store.closed)await store.close();await rm(root,{recursive:true,force:true})});return store}
async function complete(store,body=requestBody(store)){const job=await store.start(body);await store.active.get(job.job_id)?.promise;return store.get(job.job_id)}
const web=(path,body,extra={})=>new Request('http://127.0.0.1:5173/api/research-jobs'+path,{method:body===undefined?'GET':'POST',headers:{origin:'http://127.0.0.1:5173','content-type':'application/json',...extra},body:body===undefined?undefined:JSON.stringify(body)})

test('server owns unique IDs; concurrent retries execute once and accepted reading survives restart',async t=>{
 let executions=0
 const store=await setup(t,{execute:async(...args)=>{executions++;return runPipeline(...args)}})
 const body=requestBody(store),[first,again]=await Promise.all([store.start(body),store.start(body)])
 assert.equal(first.job_id,again.job_id);assert.notEqual(first.job_id,body.request_id)
 await store.active.get(first.job_id)?.promise
 assert.equal(executions,1);assert.equal(store.get(first.job_id).status,'accepted')
 const read=await store.reading(first.job_id)
 assert.equal(read.stage_trace.length,11);assert.equal((await store.latest('NVDA')).job_id,first.job_id)
 await assert.rejects(store.reading('run_'+randomUUID()),e=>e.status===404)
 assert.equal(executions,1)
 await store.close()
 const reopened=await new ResearchJobs({root:store.root,registered:store.registered}).open()
 try{assert.equal((await reopened.reading(first.job_id)).report_markdown,read.report_markdown);assert.equal(reopened.byRequest(body.request_id).job_id,first.job_id);assert.equal(reopened.list().jobs.length,1)}finally{await reopened.close()}
})

for(const violation of ['unsourced','buy'])test(`${violation} alone blocks API/reader and leaves accepted latest unchanged`,async t=>{
 let mutate=false
 const store=await setup(t,{execute:async(input,options)=>{
  const result=await runPipeline(input,options)
  if(mutate){const claim=structuredClone(result.report.sections[0].claims[0]);claim.id='injected';claim.text=violation==='buy'?'立刻買進 NVDA。':'NVIDIA 將確定超越所有競爭者。';if(violation==='unsourced'){claim.evidence_refs=[];claim.fact_bindings=[];delete claim.derivation}result.report.sections[0].claims.push(claim);result.report_markdown=renderReport(result.report);result.status='accepted'}
  return result
 }})
 const clean=await complete(store);assert.equal(clean.status,'accepted');mutate=true
 const rejected=await complete(store);assert.equal(rejected.status,'needs_revision')
 const response=await researchJobsFetch(web('/'+rejected.job_id+'/reading'),store)
 assert.equal(response.status,409);assert.equal((await store.latest('NVDA')).job_id,clean.job_id)
 assert.ok(rejected.evaluation.failures.length>0)
})

test('tampered artifact cannot bypass reader acceptance',async t=>{
 const store=await setup(t);const job=await complete(store)
 await writeFile(join(store.directory,job.job_id,'result.json'),'{}')
 await assert.rejects(store.reading(job.job_id),e=>e.code==='artifact_changed')
})

test('frozen accepted versions remain readable when their historical renderer differs',async t=>{
 const store=await setup(t),job=await complete(store),dir=join(store.directory,job.job_id)
 // Restore a historical release fixture with its own content and accepted pins.
 // Its presentation differs from today's canonical renderer; the analysis is unchanged.
 const historical=JSON.parse(await readFile(join(dir,'result.json'),'utf8'))
 historical.report_markdown='# Historical presentation\n\n'+historical.report_markdown
 historical.evaluation.report_markdown_sha256=sha(historical.report_markdown)
 const bytes=JSON.stringify(historical,null,2)+'\n';await writeFile(join(dir,'result.json'),bytes)
 store.save({...job,desk_commit:'historical-release',result_sha256:sha(bytes),report_sha256:sha(historical.report_markdown),evaluation:historical.evaluation})
 assert.equal((await store.reading(job.job_id)).report_markdown,historical.report_markdown)
})

test('HTTP validates origin, route, schema, input pin and prevents command/path injection',async t=>{
 const store=await setup(t)
 assert.equal((await researchJobsFetch(web('',requestBody(store),{origin:'https://evil.invalid'}),store)).status,403)
 assert.equal((await researchJobsFetch(web('/capabilities',undefined,{'sec-fetch-site':'cross-site'}),store)).status,403)
 assert.equal((await researchJobsFetch(new Request('http://evil.invalid/api/research-jobs'),store)).status,403)
 assert.equal((await researchJobsFetch(web('',{...requestBody(store),path:'/tmp/other',command:'echo bad'}),store)).status,422)
 assert.equal((await researchJobsFetch(web('',{...requestBody(store),source_sha256:'0'.repeat(64)}),store)).status,409)
 assert.equal((await researchJobsFetch(web('/run_'+randomUUID()),store)).status,404)
 assert.equal(store.list().jobs.length,0)
 const unavailable=await new ResearchJobs({root:await mkdtemp(join(tmpdir(),'desk-no-input-')),registered:null}).open()
 try{assert.equal(unavailable.capabilities().supported,false);assert.equal((await researchJobsFetch(web('',requestBody(store)),unavailable)).status,503)}finally{await unavailable.close();await rm(unavailable.root,{recursive:true,force:true})}
})

test('timeout, failure and cancellation never publish and late completion cannot revive a cancelled job',async t=>{
 let release
 const store=await setup(t,{execute:()=>new Promise(resolve=>{release=resolve}),timeoutMs:30})
 const timeout=await complete(store);assert.equal(timeout.status,'timed_out')
 store.timeoutMs=10000
 const job=await store.start(requestBody(store));await new Promise(resolve=>setImmediate(resolve))
 // Wait on the actual executor entry, not a guessed duration.
 while(store.get(job.job_id).status==='queued')await new Promise(resolve=>setImmediate(resolve))
 const computation=store.active.get(job.job_id).promise
 await store.cancel(job.job_id);release(await runPipeline(syntheticInput(),{runId:job.job_id}));await computation
 assert.equal(store.get(job.job_id).status,'cancelled');await assert.rejects(store.latest('NVDA'),e=>e.status===404)
 const receipt=JSON.parse(await readFile(join(store.directory,job.job_id,'run-receipt.json'),'utf8'));assert.equal(receipt.status,'cancelled')
 store.execute=async()=>{throw new Error('private failure detail')}
 assert.equal((await complete(store)).status,'failed')
})

test('second live store cannot interrupt active jobs',async t=>{
 const store=await setup(t)
 await assert.rejects(new ResearchJobs({root:store.root,registered:store.registered}).open(),e=>e.code==='store_busy')
})

test('immediate cancellation while preparing inputs stays cancelled',async t=>{
 const store=await setup(t)
 const job=await store.start(requestBody(store)),running=store.active.get(job.job_id).promise
 await store.cancel(job.job_id);await running
 assert.equal(store.get(job.job_id).status,'cancelled');await assert.rejects(store.reading(job.job_id),e=>e.status===409)
})

test('a killed process is marked interrupted on restart without executing again',async t=>{
 const root=await mkdtemp(join(tmpdir(),'desk-m1-crash-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const input=registered(syntheticInput());await writeFile(join(root,'registered.json'),JSON.stringify({input:input.input,sha256:input.sha256}))
 const moduleURL=new URL('../src/research-pipeline/jobs.mjs',import.meta.url).href
 const child=spawn(process.execPath,['--input-type=module','-e',`import {ResearchJobs} from ${JSON.stringify(moduleURL)};import {readFile} from 'node:fs/promises';const r=JSON.parse(await readFile(${JSON.stringify(join(root,'registered.json'))},'utf8'));r.bytes=Buffer.from(JSON.stringify(r.input)+'\\n');const s=await new ResearchJobs({root:${JSON.stringify(root)},registered:r,execute:()=>new Promise(()=>{})}).open();const j=await s.start({company:'NVDA',question_id:'nvda-snapshot',source_sha256:r.sha256,request_id:'crashed-request-0001'});console.log(j.job_id);setInterval(()=>{},1000)`],{stdio:['ignore','pipe','ignore']})
 let text='';const id=await new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{text+=chunk;if(text.includes('\n'))resolve(text.trim())});child.once('error',reject);child.once('exit',code=>reject(new Error('child exited '+code)))})
 const ended=once(child,'exit');child.kill('SIGKILL');await ended
 let executions=0
 const reopened=await new ResearchJobs({root,registered:input,execute:()=>{executions++}}).open()
 try{assert.equal(reopened.get(id).status,'interrupted');assert.equal(reopened.byRequest('crashed-request-0001').job_id,id);await assert.rejects(reopened.reading(id),e=>e.status===409);assert.equal(executions,0)}finally{await reopened.close()}
})

test('registered input hash and symlink boundaries are enforced',async t=>{
 const root=await mkdtemp(join(tmpdir(),'desk-profile-'));t.after(()=>rm(root,{recursive:true,force:true}))
 assert.equal(await loadRegisteredInput(root),null)
 const bytes=Buffer.from('{}'),digest=sha(bytes),dir=join(root,'.private/research-pipeline/inputs');await mkdir(dir,{recursive:true})
 const rel='.private/research-pipeline/inputs/nvda-'+digest+'.json'
 await writeFile(join(root,'.private/research-pipeline/profile.json'),JSON.stringify({input_path:rel,input_sha256:digest}))
 const outside=join(root,'outside.json');await writeFile(outside,bytes);await symlink(outside,join(root,rel))
 await assert.rejects(loadRegisteredInput(root),e=>e.code==='profile_invalid')
})
