// Prove the analytical core works with file reads restricted to just its copy
// and its prepared input. No other repository, network, child or write access.
import {mkdtemp,copyFile,writeFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {resolve,join} from 'node:path'
import {execFileSync} from 'node:child_process'
import {randomUUID,createHash} from 'node:crypto'
import {readFile} from 'node:fs/promises'
import {loadRegisteredInput} from '../src/research-pipeline/jobs.mjs'
const root=process.cwd(),registered=await loadRegisteredInput(root)
if(!registered)throw new Error('Prepare real NVDA input first')
const directory=await realpath(await mkdtemp(join(tmpdir(),'desk-m1-isolation-')))
try{
 const hashes={}
 for(const file of ['pipeline.mjs','evaluator.mjs','input.mjs']){const source=resolve(root,'src/research-pipeline',file);await copyFile(source,join(directory,file));hashes[file]=createHash('sha256').update(await readFile(source)).digest('hex')}
 await writeFile(join(directory,'input.json'),registered.bytes)
 await writeFile(join(directory,'verify.mjs'),`import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {runPipeline} from './pipeline.mjs';await assert.rejects(readFile(${JSON.stringify(resolve(root,'package.json'))}),e=>e.code==='ERR_ACCESS_DENIED');const input=JSON.parse(await readFile(new URL('./input.json',import.meta.url)));const r=await runPipeline(input,{runId:'isolated-verification'});assert.equal(r.status,'accepted');assert.equal(r.stage_trace.length,11);console.log(JSON.stringify({status:r.status,stage_count:r.stage_trace.length,outside_file_read_denied:true,information_as_of:r.information_as_of,source_count:r.sources.length}));`)
 const stdout=execFileSync(process.execPath,['--permission','--allow-fs-read='+directory,join(directory,'verify.mjs')],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']})
 const result={...JSON.parse(stdout),input_sha256:registered.sha256,core_sha256:hashes,verified_at:new Date().toISOString(),node_version:process.version}
 const receipt=resolve(root,'.private/research-pipeline/isolation-verification-'+randomUUID()+'.json')
 await writeFile(receipt,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600})
 console.log(JSON.stringify({...result,receipt},null,2))
}finally{await rm(directory,{recursive:true,force:true})}
