// Copies a pinned, real source bundle into a distinct Desk-owned input. No network.
import {readFile,mkdir,writeFile,realpath,readdir,rename} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve,relative,isAbsolute} from 'node:path'
import {pathToFileURL} from 'node:url'
const sha=bytes=>createHash('sha256').update(bytes).digest('hex')
export async function prepareM1Input(root,source='.private/claudecode-p0b-p0c-20261013/candidate/candidate-v4.json'){
  const actualRoot=await realpath(root),actual=await realpath(resolve(root,source)),inside=relative(actualRoot,actual)
  if(inside.startsWith('..')||isAbsolute(inside))throw new Error('Input must already exist inside Investment Research Desk')
  const bytes=await readFile(actual),bundle=JSON.parse(bytes)
  if(bundle.schema_version!=='financial-research/1'||bundle.company?.company_id!=='NVDA'||!bundle.documents?.length||!bundle.facts?.length)throw new Error('A real NVDA financial-research/1 input is required')
  const originals=new Map()
  async function inventory(folder){
    for(const entry of await readdir(folder,{withFileTypes:true})){const path=resolve(folder,entry.name);if(entry.isDirectory())await inventory(path);else if(entry.isFile()){const original=await readFile(path);originals.set(sha(original),relative(actualRoot,path))}}
  }
  for(const folder of ['.private/claudecode-p0b-p0c-20261013/sources','.private/recovery-20261013/nvda/sources'])await inventory(resolve(root,folder))
  const sourceManifest=bundle.documents.map(document=>{
    const path=originals.get(document.raw_sha256)
    if(!path||sha(document.extracted_text)!==document.text_sha256)throw new Error('Original source bytes or extracted-text pin unavailable: '+document.document_version_id)
    return {document_version_id:document.document_version_id,original_url:document.original_url,original_path:path,raw_sha256:document.raw_sha256,text_sha256:document.text_sha256,published_at:document.published_at,retrieved_at:document.retrieved_at,version_witness:document.version_witness,verified_original_bytes:true}
  })
  const input={profile:{company:'NVDA',information_as_of:bundle.run.as_of,input_kind:'real_snapshot',valuation_multiples:[20,30,40]},provenance:{source_path:inside,source_sha256:sha(bytes),prepared_at:new Date().toISOString(),source_manifest:sourceManifest,note:'Saved real public-source material, replayed at the stated cutoff; not a current-market update. M2 report and acceptance are not reused as M1 execution.'},bundle}
  const prepared=JSON.stringify(input,null,2)+'\n',digest=sha(prepared),inputPath='.private/research-pipeline/inputs/nvda-'+digest+'.json'
  await mkdir(resolve(root,'.private/research-pipeline/inputs'),{recursive:true,mode:0o700})
  await writeFile(resolve(root,inputPath),prepared,{flag:'wx',mode:0o600})
  const profilePath=resolve(root,'.private/research-pipeline/profile.json'),temporary=profilePath+'.'+digest+'.tmp'
  await writeFile(temporary,JSON.stringify({input_path:inputPath,input_sha256:digest},null,2)+'\n',{flag:'wx',mode:0o600})
  await rename(temporary,profilePath)
  return {input_path:inputPath,input_sha256:digest,source_sha256:sha(bytes),information_as_of:bundle.run.as_of,documents:bundle.documents.length,facts:bundle.facts.length}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)console.log(JSON.stringify(await prepareM1Input(process.cwd(),process.argv[2]),null,2))
