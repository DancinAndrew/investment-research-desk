import {validateBackup} from '../src/ledger-core.mjs'
import {validateResearch} from '../src/research-continuity.mjs'
import {validateFinance,splitEvents} from '../src/portfolio-core.mjs'
import {validateImports} from '../src/csv-ledger.mjs'
import {validateJournal,digest,canonical} from '../src/decision-workspace.mjs'
import hosting from '../.openai/hosting.json' with {type:'json'}
import {validateSnapshots,validateFavorites} from '../src/snapshot-core.mjs'
import {validateResearchWorkspace} from '../src/research-workflow.mjs'

const empty = () => ({schema_version:1,records:[],quotes:[],reviews:[]})
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})
export function validateState(input) {
  if(!input || typeof input!=='object' || Object.keys(input).some(k=>!['schema_version','records','quotes','reviews','research','finance','imports','snapshots','company_favorites','journal','research_workspace'].includes(k)))return {ok:false,errors:[{message:'私人資料含未登錄欄位。'}]}
  if(!input || !Array.isArray(input.reviews) || input.reviews.length>10000) return {ok:false,errors:[{message:'回顧格式無效'}]}
  let finance,imports,snapshots,favorites,journal,researchWorkspace

  if(Object.hasOwn(input,'research_workspace')){const checked=validateResearchWorkspace(input.research_workspace);if(!checked.ok)return checked;researchWorkspace=checked.value}
  if(Object.hasOwn(input,'snapshots')){const checked=validateSnapshots(input.snapshots);if(!checked.ok)return checked;snapshots=checked.value}
  if(Object.hasOwn(input,'company_favorites')){const checked=validateFavorites(input.company_favorites);if(!checked.ok)return checked;favorites=checked.value}
  if(Object.hasOwn(input,'finance')){const checked=validateFinance(input.finance);if(!checked.ok)return checked;finance=checked.value}
  if(Object.hasOwn(input,'imports')){const checked=validateImports(input.imports);if(!checked.ok)return checked;imports=checked.value}
  const result=validateBackup({schema_version:input.schema_version,records:input.records,quotes:input.quotes},finance?splitEvents(finance):[])
  if(!result.ok)return result
  if(Object.hasOwn(input,'journal')){const checked=validateJournal(input.journal,input);if(!checked.ok)return checked;journal=checked.value}
  const ids=new Set(),records=new Set(result.value.records.map(r=>r.id)),reviews=[]
  for(const r of input.reviews){
    if(!r || !/^[a-zA-Z0-9_-]{1,100}$/.test(r.id) || ids.has(r.id) || !records.has(r.record_id) || !/^\d{4}-\d{2}-\d{2}$/.test(r.date) || !Number.isFinite(Date.parse(r.date+'T00:00:00Z')) || new Date(r.date+'T00:00:00Z').toISOString().slice(0,10)!==r.date || !['pending','supported','weakened','mixed'].includes(r.outcome) || !['lesson','next_action'].every(k=>typeof r[k]==='string'&&r[k].length<=5000))return {ok:false,errors:[{message:'回顧資料、日期或連結交易無效'}]}
    ids.add(r.id);reviews.push({id:r.id,record_id:r.record_id,date:r.date,outcome:r.outcome,lesson:r.lesson.trim(),next_action:r.next_action.trim()})
  }
  let research
  if(Object.hasOwn(input,'research')){const checked=validateResearch(input.research);if(!checked.ok)return checked;research=checked.value}
  return {ok:true,value:{...result.value,reviews,...(research?{research}:{}),...(finance?{finance}:{}),...(imports?{imports}:{}),...(snapshots?{snapshots}:{}),...(favorites?{company_favorites:favorites}:{}),...(journal?{journal}:{}),...(researchWorkspace?{research_workspace:researchWorkspace}:{})}}
}

export async function ledgerScope(user,env,origin){
  const value=JSON.stringify([hosting.project_id,env.LEDGER_ENV||'site_private_d1',origin,user])
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(v=>v.toString(16).padStart(2,'0')).join('')
}
export async function ledgerFetch(request,env){
  const user=request.headers.get('oai-authenticated-user-id')
  if(!user || user.length>256)return json({error:'請登入後開啟私人帳本。'},401)
  if(!env.DB)return json({error:'私人儲存目前無法使用，請稍後重試。'},503)
  const owner_scope=await ledgerScope(user,env,new URL(request.url).origin), storage=env.LEDGER_ENV==='isolated_local_qa'?'isolated_local_qa':'site_private_d1'
  if(request.method==='GET'){
    const version=new URL(request.url).searchParams.get('revision')
    if(version!==null){
      if(!/^[1-9]\d{0,8}$/.test(version))return json({error:'歷史版本無效。'},400)
      const old=await env.DB.prepare('SELECT revision, payload, updated_at FROM ledger_history WHERE owner_id = ? AND revision = ?').bind(user,Number(version)).first()
      if(!old)return json({error:'找不到這個私人帳本版本。'},404)
      return json({owner_scope,storage,revision:old.revision,state:JSON.parse(old.payload),updated_at:old.updated_at})
    }
    const row=await env.DB.prepare('SELECT revision, payload, updated_at FROM ledger_states WHERE owner_id = ?').bind(user).first()
    const history=await env.DB.prepare('SELECT revision, updated_at FROM ledger_history WHERE owner_id = ? ORDER BY revision DESC LIMIT 100').bind(user).all()
    return json({revision:row?.revision||0,state:row?JSON.parse(row.payload):empty(),updated_at:row?.updated_at||null,history:history.results||[],storage,owner_scope})
  }
  if(request.method!=='PUT')return json({error:'不支援的操作。'},405)
  const origin=request.headers.get('origin'),url=new URL(request.url)
  if(origin!==url.origin || request.headers.get('sec-fetch-site')==='cross-site' || !request.headers.get('content-type')?.startsWith('application/json'))return json({error:'請從本站儲存資料。'},403)
  const declared=Number(request.headers.get('content-length')||0)
  if(declared>2000000)return json({error:'備份或帳本超過 2 MB 限制。'},413)
  const raw=await request.text();if(new TextEncoder().encode(raw).length>2000000)return json({error:'備份或帳本超過 2 MB 限制。'},413)
  let body;try{body=JSON.parse(raw)}catch{return json({error:'資料格式無效。'},400)}
  if(!body || typeof body!=='object' || !Number.isSafeInteger(body.expected_revision)||body.expected_revision<0)return json({error:'儲存版本無效。'},400)
  if(body.expected_owner_scope!==owner_scope)return json({error:'登入身份或儲存環境已改變。請重新載入帳本；這次沒有儲存。',code:'identity_changed'},409)
  const current=await env.DB.prepare('SELECT revision, payload, updated_at FROM ledger_states WHERE owner_id = ?').bind(user).first()
  if((current?.revision||0)!==body.expected_revision)return json({error:'其他分頁已更新資料，請載入最新後重新核對。',code:'conflict'},409)
  const previous=current?JSON.parse(current.payload):empty()
  if(body.intent!==undefined&&body.intent!=='restore')return json({error:'保存動作無效。'},400)
  if(body.intent==='restore'&&body.restore_base_digest!==await digest(previous))return json({error:'還原基準已改變，請重新核對全部資料。',code:'conflict'},409)
  if(previous.journal&&!Object.hasOwn(body.state||{},'journal')&&body.intent!=='restore')return json({error:'此頁版本較舊，請重新整理後保存，決策紀錄仍保留。',code:'client_upgrade_required'},409)
  if(previous.research_workspace&&!Object.hasOwn(body.state||{},'research_workspace')&&body.intent!=='restore')return json({error:'此頁版本較舊，請重新整理後保存，月度研究、情境與人工規則仍保留。',code:'client_upgrade_required'},409)
  const checked=validateState(body.state);if(!checked.ok)return json({error:checked.errors.map(e=>e.message).join('；'),fields:checked.errors},422)
  if(body.intent!=='restore'&&previous.research_workspace){
    for(const domain of ['reviews','scenarios','rules']){
      const candidates=new Map((checked.value.research_workspace?.[domain]||[]).map(row=>[row.id,row]))
      if(previous.research_workspace[domain].some(row=>!candidates.has(row.id)||canonical(candidates.get(row.id))!==canonical(row)))return json({error:'已保存的研究版本不可改寫或刪除。請另存修訂；完整取代須從備份還原重新核對。',code:'research_version_conflict'},409)
    }
  }
  const now=new Date().toISOString(),next=body.expected_revision+1
  const row=await env.DB.prepare('INSERT INTO ledger_states (owner_id, revision, payload, updated_at) SELECT ?, ?, ?, ? WHERE (? = 0 OR EXISTS (SELECT 1 FROM ledger_states WHERE owner_id = ?)) ON CONFLICT(owner_id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at WHERE ledger_states.revision = ? RETURNING revision').bind(user,next,JSON.stringify(checked.value),now,body.expected_revision,user,body.expected_revision).first()
  if(!row)return json({error:'另一頁已更新帳本。請重新載入後再套用修改；這次沒有覆寫。'},409)
  return json({revision:row.revision,state:checked.value,updated_at:now,storage,owner_scope})
}

export default {async fetch(request,env){
  try {
    const url=new URL(request.url)
    if(url.pathname==='/api/ledger')return await ledgerFetch(request,env)
    if(url.pathname==='/api/research-jobs/capabilities'&&request.method==='GET')return json({configured:false,supported:false,execution_mode:'unconfigured',reason:'私人網站尚未配置研究執行器。可在本機工作台執行研究，本站閱讀既有報告。'})
    if(url.pathname==='/api/research-jobs'&&request.method==='GET')return json({jobs:[]})
    if(url.pathname==='/api/research-jobs'&&request.method==='POST')return json({error:'私人網站尚未配置研究執行器。',code:'unavailable'},503)
    if(url.pathname.startsWith('/api/'))return json({error:'找不到此功能。'},404)
    if(env.ASSETS)return env.ASSETS.fetch(request)
    return new Response('研究介面暫時無法載入。',{status:503})
  }catch{return json({error:'儲存服務暫時無法使用，請重試。'},503)}
}}
