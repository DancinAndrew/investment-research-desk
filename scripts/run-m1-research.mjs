import {randomUUID} from 'node:crypto'
import {ResearchJobs,loadRegisteredInput} from '../src/research-pipeline/jobs.mjs'
import {researchCodeIdentity} from './research-dev-plugin.mjs'
const root=process.cwd(),registered=await loadRegisteredInput(root)
if(!registered)throw new Error('Run npm run research:prepare first')
const jobs=await new ResearchJobs({root,registered,...await researchCodeIdentity(root)}).open()
try{
  const capabilities=jobs.capabilities()
  const job=await jobs.start({company:'NVDA',question_id:capabilities.question_id,source_sha256:capabilities.source_sha256,request_id:randomUUID()})
  await jobs.active.get(job.job_id)?.promise
  const result=jobs.get(job.job_id)
  console.log(JSON.stringify({job_id:job.job_id,status:result.status,information_as_of:result.information_as_of,stage_count:result.stage_trace.length,input_sha256:result.input_sha256,report_sha256:result.report_sha256,desk_commit:result.desk_commit,receipt:'.private/research-pipeline/jobs/'+job.job_id+'/run-receipt.json'},null,2))
  if(result.status!=='accepted')process.exitCode=1
}finally{await jobs.close()}
