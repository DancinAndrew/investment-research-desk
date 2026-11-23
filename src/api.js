import {createFinancialLoader} from './financial-loader.mjs'
import {digest,queryPosts,reviewCases,validateDecision} from './research-core.mjs'
import {getRecord,allRecords,putRecord,addRecord,saveDecision} from './device-store.js'
let indexPromise,loaded
async function readJSON(file,signal){const r=await fetch(file,{signal,cache:'no-cache'});if(!r.ok)throw error('研究快照載入失敗（'+r.status+'）',r.status);return r.json()}
export function siteIndex(){if(!indexPromise)indexPromise=readJSON('/data/site-index.json').catch(e=>{indexPromise=null;throw e});return indexPromise}
let hubsPromise
export function companyHubs(){if(!hubsPromise)hubsPromise=readJSON('/data/company-hubs.json').catch(e=>{hubsPromise=null;throw e});return hubsPromise}
export function companyViewpoints(file){if(!/^\/data\/company-viewpoints\/[a-zA-Z0-9_-]+\.json$/.test(file))throw error('觀點來源未登錄',404);return readJSON(file)}
export function companyRelations(){return readJSON('/data/company-relations.json')}
let tracePromise
export function researchTraceability(){if(!tracePromise)tracePromise=readJSON('/data/company-traceability.json').catch(e=>{tracePromise=null;throw e});return tracePromise}
async function data(){if(!loaded)loaded=(async()=>{const [r,cases]=await Promise.all([fetch('/data/x-posts.json.gz'),readJSON('/data/cases.json')]);if(!r.ok)throw error('X 來源快照載入失敗',r.status);const raw=new Uint8Array(await r.arrayBuffer());let text;if(raw[0]===31&&raw[1]===139){if(typeof DecompressionStream==='undefined')throw error('此瀏覽器不支援來源解壓縮，請使用新版 Chrome、Edge 或 Safari',503);text=await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text()}else{text=new TextDecoder().decode(raw)}const dataset=JSON.parse(text);dataset.dataset_id=await digest(text);const extra=await xSupplement();const rawHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(x=>x.toString(16).padStart(2,'0')).join('');if(rawHash!==extra.metadata.x_payload_sha256)throw error('X 原文與補件版本不同，請重新匯出',409);for(const post of dataset.posts)post.signals=post.signals.map(s=>({...s,...extra.signal_details_by_id[s.id],text:post.text,source:{...post.source,processed_at:s.processed_at,gaps:s.gaps||post.source.gaps}}));return {dataset,cases}})().catch(e=>{loaded=null;throw e});return loaded}


let supplementPromise,pricePromise,classificationPromise
export async function xPriceData(){if(!pricePromise)pricePromise=readBoundGzip('/data/x-prices.json.gz').catch(e=>{pricePromise=null;throw e});return pricePromise}
export async function xClassificationHistory(postId){if(!classificationPromise)classificationPromise=readBoundGzip('/data/x-classification-history.json.gz').catch(e=>{classificationPromise=null;throw e});const d=await classificationPromise;return {metadata:d.metadata,signals:d.signals.filter(s=>s.post_id===postId),classifications:d.classifications.filter(s=>s.post_id===postId)}}
async function readBoundGzip(file){const [d,base]=await Promise.all([readGzip(file),xSupplement()]);if(d.metadata.x_payload_sha256!==base.metadata.x_payload_sha256)throw error('來源補件版本不同，請重新匯出',409);return d}
async function readGzip(file){const r=await fetch(file,{cache:'no-cache'});if(!r.ok)throw error('來源補件載入失敗',r.status);const raw=new Uint8Array(await r.arrayBuffer());const text=raw[0]===31&&raw[1]===139?await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(raw);return JSON.parse(text)}
export async function xSupplement(){if(!supplementPromise)supplementPromise=readGzip('/data/x-supplement.json.gz').catch(e=>{supplementPromise=null;throw e});return supplementPromise}

function error(message,status=400){const e=new Error(message);e.status=status;return e}
export async function localApi(path,body,options={}){
 if(body!==undefined)body=JSON.parse(JSON.stringify(body)) // Same serialization boundary as the local HTTP API; removes Vue proxies before IndexedDB writes.
 if(options.signal?.aborted)throw new DOMException('Cancelled','AbortError')
 const url=new URL(path,'https://site.invalid/'),parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
 if(parts[0]==='canonical'){if(body!==undefined)throw error('網站不執行本機重算',422);const index=await siteIndex();if(parts.length===2&&parts[1]==='bundles')return structuredClone(index.catalog);let file;if(parts[1]==='compare'){file=index.comparisons[url.searchParams.get('left')+'\n'+url.searchParams.get('right')]}else if(parts[1]==='bundles'&&parts.length===3){file=index.bundles[parts[2]]}else if(parts[1]==='bundles'&&parts[3]==='artifacts'&&parts.length===5){file=index.artifacts[parts[2]+'/'+parts[4]]}if(!file)throw error('此研究或檔案未匯入網站',404);return readJSON(file,options.signal)}
 if(parts[0]==='research-jobs'){
  const response=await fetch('/api/'+path,{method:body===undefined?'GET':'POST',credentials:'same-origin',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:options.signal})
  const result=await response.json()
  if(!response.ok){const failure=error(result.error||'研究服務暫時無法使用。',response.status);failure.code=result.code;throw failure}
  return result
 }
 if(body===undefined&&path==='health'){return {status:'ok',mode:'owner_private_snapshot',case_revisions:1,x_configured:true}}
 if(body===undefined&&parts[0]==='posts'){
  const {dataset}=await data();if(url.searchParams.has('dataset_id')&&url.searchParams.get('dataset_id')!==dataset.dataset_id)throw error('來源版本已改變',409)
  const page=queryPosts(dataset,Object.fromEntries(url.searchParams));page.snapshot_id=await digest(JSON.stringify({dataset_id:dataset.dataset_id,...page.query}));await putRecord('snapshots',{id:page.snapshot_id,body:page});return page
 }
 if(body===undefined&&path==='research-runs'){
  const [runs,decisions]=await Promise.all([allRecords('runs'),allRecords('decisions')]);return {runs:runs.sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,50).map(r=>{const latest=decisions.filter(d=>d.run_id===r.id).sort((a,b)=>b.revision-a.revision)[0];return {id:r.id,created_at:r.created_at,mode:'signal_review',query:r.body.query,question:r.body.question,ticker_key:r.body.signal.ticker_key,status:r.body.status,decision_status:latest?.details.status,next_step:latest?.details.next_step}})}
 }
 if(body!==undefined&&path==='signal-reviews'){
  if(typeof body.question!=='string'||!body.question.trim()||body.question.length>1000||!['unspecified','days_weeks','months','long_term'].includes(body.horizon))throw error('問題或期間無效')
  const snap=await getRecord('snapshots',body.snapshot_id),signal=snap?.body.signals.find(s=>s.id===body.signal_id);if(!signal)throw error('來源不在本次快照')
  const {cases}=await data(),now=new Date().toISOString(),result=await reviewCases(signal,cases,body.query,body.as_of||now,snap.body.captured_at)
  Object.assign(result,{snapshot_id:body.snapshot_id,question:body.question.trim(),horizon:body.horizon,coverage:snap.body.coverage,pending_checks:['確認 X 分類、轉引來源及主張是否忠於原文','核對原始資料的日期、期間、條件與上下文','尋找可推翻主張的證據；目前不自動生成反證','本站未包含付費節目原文、即時行情或個人財務資料'],run:{id:'run_'+crypto.randomUUID(),mode:'signal_review',status:result.status,created_at:now}})
  await addRecord('runs',{id:result.run.id,created_at:now,body:result});return result
 }
 if(parts[0]==='research-runs'&&parts[1]){
  const run=await getRecord('runs',decodeURIComponent(parts[1]));if(!run)throw error('此瀏覽器沒有這份研究',404)
  if(parts.length===2&&body===undefined)return run.body
  if(parts[2]==='decisions'&&body===undefined)return {decisions:(await allRecords('decisions')).filter(d=>d.run_id===run.id).sort((a,b)=>a.revision-b.revision)}
  if(parts[2]==='decisions'&&body!==undefined){validateDecision(body,run.body);return saveDecision(run.id,body)}
 }
 throw error('不支援的操作',404)
}

const financialLoader=createFinancialLoader();
export function financialResearch(company,options={}){return financialLoader.load(company,options)}
