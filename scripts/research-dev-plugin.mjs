import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {execFileSync} from 'node:child_process'
import {resolve} from 'node:path'
import {ResearchJobs,loadRegisteredInput,researchJobsFetch} from '../src/research-pipeline/jobs.mjs'

export async function researchCodeIdentity(root){
  const paths=['src/research-pipeline/pipeline.mjs','src/research-pipeline/evaluator.mjs','src/research-pipeline/input.mjs','src/research-pipeline/jobs.mjs','scripts/research-dev-plugin.mjs']
  const hashes=Object.fromEntries(await Promise.all(paths.map(async path=>[path,createHash('sha256').update(await readFile(resolve(root,path))).digest('hex')])));
  let commit='uncommitted'
  try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}catch{}
  return {codeVersion:commit,codeHashes:hashes}
}

export function researchDevPlugin(){
  return {name:'desk-local-research',async configureServer(server){
    const root=server.config.root
    const registered=await loadRegisteredInput(root)
    const identity=await researchCodeIdentity(root)
    const jobs=await new ResearchJobs({root,registered,...identity}).open()
    server.httpServer?.once('close',()=>jobs.close())
    server.middlewares.use(async(req,res,next)=>{
      const path=req.url?.split('?',1)[0]
      if(path!=='/api/research-jobs'&&!path?.startsWith('/api/research-jobs/'))return next()
      try{
        if(!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host||'')){res.writeHead(403);return res.end()}
        const chunks=[];let size=0
        for await(const chunk of req){size+=chunk.length;if(size>8192){res.writeHead(413,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'研究請求過大。',code:'too_large'}));return}chunks.push(chunk)}
        const request=new Request(new URL(req.url,'http://'+req.headers.host),{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)})
        const response=await researchJobsFetch(request,jobs)
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()))
      }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'本機研究服務暫時無法使用。',code:'unavailable'}))}
    })
  }}
}
