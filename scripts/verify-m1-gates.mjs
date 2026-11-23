import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {ResearchJobs,loadRegisteredInput,researchJobsFetch} from '../src/research-pipeline/jobs.mjs'
import {runPipeline} from '../src/research-pipeline/pipeline.mjs'
import {renderReport} from '../src/research-pipeline/evaluator.mjs'
import {researchCodeIdentity} from './research-dev-plugin.mjs'

const root=process.cwd(),registered=await loadRegisteredInput(root)
if(!registered||registered.input.profile.input_kind!=='real_snapshot')throw new Error('Registered real NVDA snapshot required')
let mutation=null
const jobs=await new ResearchJobs({root,registered,...await researchCodeIdentity(root),execute:async(input,options)=>{
  const result=await runPipeline(input,options)
  if(mutation==='unsourced')result.report.sections[0].claims.push({id:'negative-unsourced',kind:'source_paraphrase',text:'NVIDIA 未來所有季度都會超越競爭對手。',evidence_refs:[],fact_bindings:[]})
  if(mutation==='buy')result.report.title+='，請立刻買進 NVDA'
  if(mutation){result.report_markdown=renderReport(result.report);result.status='accepted'}
  return result
}}).open()
async function execute(){const job=await jobs.start({company:'NVDA',question_id:'nvda-snapshot',source_sha256:registered.sha256,request_id:randomUUID()});await jobs.active.get(job.job_id)?.promise;return jobs.get(job.job_id)}
try{
  const clean=await execute();assert.equal(clean.status,'accepted');assert.equal(clean.stage_trace.length,11)
  const result={verified_at:new Date().toISOString(),input_kind:'real_snapshot',input_sha256:registered.sha256,desk_commit:clean.desk_commit,code_sha256:clean.code_sha256,clean:{job_id:clean.job_id,status:clean.status,checks:clean.evaluation.checks,report_sha256:clean.report_sha256},negative_cases:[]}
  for(const kind of ['unsourced','buy']){
    mutation=kind;const rejected=await execute()
    assert.equal(rejected.status,'needs_revision')
    assert.equal(rejected.evaluation.checks.sources,kind!=='unsourced')
    assert.equal(rejected.evaluation.checks.buy_instructions,kind!=='buy')
    const response=await researchJobsFetch(new Request('http://127.0.0.1:5173/api/research-jobs/'+rejected.job_id+'/reading'),jobs)
    assert.equal(response.status,409)
    const latest=await jobs.latest('NVDA');assert.equal(latest.job_id,clean.job_id)
    result.negative_cases.push({kind,job_id:rejected.job_id,status:rejected.status,checks:rejected.evaluation.checks,failures:rejected.evaluation.failures,reader_http_status:response.status,latest_job_id:latest.job_id})
  }
  const path=resolve(root,'.private/research-pipeline/gate-verification-'+randomUUID()+'.json')
  await writeFile(path,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600})
  console.log(JSON.stringify({status:'passed',clean_job:clean.job_id,negative_cases:result.negative_cases.map(x=>({kind:x.kind,job_id:x.job_id,checks:x.checks,reader_http_status:x.reader_http_status})),receipt:path},null,2))
}finally{await jobs.close()}
