import {copy,plain,keys,text,safeId,date,iso,finite,source,instrument,digest,canonical,emptyJournal,projectPositions,ensurePosition} from './decision-workspace.mjs';
import {validateSnapshots} from './snapshot-core.mjs';
const fail=(path,message)=>{const e=new Error(message);e.path=path;throw e;};
export async function parseCandidatePackage(raw){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>1000000)fail('package','整理結果超過 1 MB，請拆成較小批次。');
 let p;try{p=JSON.parse(raw);}catch{fail('package','整理結果格式錯誤。請回對話取得完整候選檔，或改用手動記錄。');}
 if(p?.format==='investment-ledger-v1')fail('package','這是完整備份，請到資料管理使用還原預覽。');
 if(!keys(p,['format','sources','candidates','warnings'])||p.format!=='investment-capture-candidates-v1'||!Array.isArray(p.sources)||p.sources.length>20||!p.sources.length||!p.sources.every(s=>source(s)&&safeId(s.id))||new Set(p.sources.map(s=>s.id)).size!==p.sources.length||!Array.isArray(p.candidates)||!p.candidates.length||p.candidates.length>100||p.warnings&&(!Array.isArray(p.warnings)||!p.warnings.every(w=>text(w,1000))))fail('package','候選包需要有效來源及 1–100 筆候選。');
 const seen=new Set();for(const [i,c] of p.candidates.entries()){
  if(!keys(c,['id','kind','source_refs','extracted_fields','verbatim_text'])||!safeId(c.id)||c.id.length>64||seen.has(c.id)||!['snapshot','execution_evidence'].includes(c.kind)||!Array.isArray(c.source_refs)||!c.source_refs.length||c.source_refs.some(id=>!p.sources.some(s=>s.id===id))||c.verbatim_text!==undefined&&!text(c.verbatim_text,3000))fail(`candidates[${i}]`,'候選種類、代號或來源參照無效。');seen.add(c.id);
  const f=c.extracted_fields;if(c.kind==='snapshot'){
   if(!keys(f,['symbol','product','direction','exchange','captured_date','screen_time','fields','note','observed_history']))fail(`candidates[${i}].extracted_fields`,'持倉畫面含未登錄欄位。');
   const s={id:'check',...f,imported_at:'2026-01-01T00:00:00Z',sources:p.sources.filter(s=>c.source_refs.includes(s.id)).map(({id,...s})=>s)};
   const check=validateSnapshots([s]);if(!check.ok)fail(`candidates[${i}].extracted_fields`,check.errors[0].message);
  }else{
   if(!keys(f,['instrument','event_date','side','quantity','price','fees','currency','local_datetime','timezone','note'])||!instrument(f.instrument)||!(f.event_date===null||date(f.event_date))||!['BUY','SELL'].includes(f.side)||['quantity','price','fees'].some(k=>!(f[k]===null||finite(f[k])&&(k==='fees'?f[k]>=0:f[k]>0)))||!(f.currency===null||typeof f.currency==='string'&&/^[A-Z]{3,8}$/.test(f.currency))||!(f.local_datetime===null||typeof f.local_datetime==='string'&&/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(f.local_datetime)&&date(f.local_datetime.slice(0,10)))||!(f.timezone===null||text(f.timezone,100))||!text(f.note,3000))fail(`candidates[${i}].extracted_fields`,'成交證據欄位無效；缺資料請保留 null。');
  }
 }
 const package_digest=await digest(p);return {package:p,package_digest,id:'intake:'+package_digest.slice(0,32)};
}
export function candidateChoices(parsed,state){
 return parsed.package.candidates.map(c=>{
  const fields=c.extracted_fields,possible=(state.snapshots||[]).filter(s=>s.symbol===(fields.symbol||fields.instrument?.symbol));
  const exact=possible.find(s=>c.kind==='snapshot'&&canonical(['symbol','product','direction','exchange','captured_date','screen_time','fields','observed_history'].map(k=>s[k]))===canonical(['symbol','product','direction','exchange','captured_date','screen_time','fields','observed_history'].map(k=>fields[k]))&&s.sources.some(s=>s.sha256&&parsed.package.sources.some(p=>c.source_refs.includes(p.id)&&p.sha256===s.sha256)));
  return {...copy(c),selected:!exact,confirmed:false,choice:exact?'skip':'new',target:exact?.id||'',adopt:true,identity_confirmed:false,possible:possible.map(s=>s.id)};
 });
}
function compatible(a,b){return ['symbol','product'].every(k=>a[k]===b[k])&&['direction','exchange'].every(k=>a[k]===null||b[k]===null||a[k]==='unknown'||b[k]==='unknown'||a[k]===b[k]);}
export function savedIntakeReceipt(state,parsed){
 const existing=state.journal?.intakes.find(b=>b.id===parsed.id);
 if(existing&&existing.package_digest!==parsed.package_digest)throw new Error('同一批代號的來源內容不同，這次沒有保存。');
 return existing||null;
}
export async function buildIntakeDelta(state,parsed,choices,{now=new Date().toISOString()}={}){
 const normalized=choices.map(({id,kind,source_refs,extracted_fields,selected,choice,target,adopt,identity_confirmed,confirmed})=>({id,kind,source_refs,extracted_fields,selected,choice,target,adopt,identity_confirmed,confirmed}));
 const content_hash=await digest({package_digest:parsed.package_digest,choices:normalized}),existing=savedIntakeReceipt(state,parsed);
 if(existing?.status==='withdrawn')throw new Error('這批整理結果已撤回。請到資料管理核對原批次，再明確復原；這次沒有新增。');
 if(existing){if(existing.content_hash!==content_hash)throw new Error('同一批整理結果已保存，但核對內容不同。請先查看原批次，再建立新批次。');return {state,receipt:existing,already_applied:true,counts:{new:0,update:0,evidence:0,skip:choices.length}};}
 // Revalidate edited values against the same dedicated contract.
 await parseCandidatePackage(JSON.stringify({...parsed.package,candidates:choices.map(c=>({id:c.id,kind:c.kind,source_refs:c.source_refs,extracted_fields:c.extracted_fields}))}));
 const next=copy(state);next.journal||=emptyJournal();next.snapshots||=[];const receipts=[],counts={new:0,update:0,evidence:0,skip:0};
 for(const c of choices){
  const r={candidate_id:c.id,choice:c.choice,snapshot_id:null,entry_id:null,position_id:null,existing_ref:null,reason:'',digests:{snapshot:null,position:null,entry:null},inverse:{created_position:false,position_before:null,position_after:null,added_sources:[]}};
  if(!c.selected||c.choice==='skip'){r.choice='skip';r.existing_ref=c.target||null;r.reason=c.target?'使用者略過重複觀測':'使用者本次未選取';counts.skip++;receipts.push(r);continue;}
  if(!c.confirmed)fail(c.id,'每笔保存前都需要完成內容核對。');
  const fields=c.extracted_fields,inst=c.kind==='snapshot'?Object.fromEntries(['symbol','product','direction','exchange'].map(k=>[k,fields[k]])):fields.instrument;
  const sources=parsed.package.sources.filter(s=>c.source_refs.includes(s.id)).map(({id,...s})=>s);
  if(c.choice==='merge_source'){
   const s=next.snapshots.find(s=>s.id===c.target);if(c.kind!=='snapshot'||!s||!compatible(s,inst)||!c.identity_confirmed)fail(c.id,'合併來源需要選定同一觀測，並明確核對差異。');
   r.snapshot_id=s.id;r.existing_ref=s.id;r.inverse.added_sources=sources.filter(p=>!s.sources.some(v=>canonical(v)===canonical(p)));s.sources.push(...r.inverse.added_sources);r.reason='核對為同一觀測；保留原數值，追加來源';receipts.push(r);counts.skip++;continue;
  }
  let position;
  if(c.choice==='update'){
   const p=projectPositions(next).find(p=>p.id===c.target);if(!p||p.origin==='ledger'||!compatible(p.instrument,inst)||!c.identity_confirmed)fail(c.id,'更新部位需要核對同一標的、商品、方向與交易所；未知身份請人工確認。');
   ensurePosition(next,p.id,now);position=next.journal.positions.find(p=>p.id===c.target);r.inverse.position_before={snapshot_ids:[...position.snapshot_ids],selected_snapshot_id:position.selected_snapshot_id,visibility:position.visibility};counts.update++;
  }else if(c.choice==='new'){
   position={id:'position:'+parsed.package_digest.slice(0,24)+':'+c.id,snapshot_ids:[],selected_snapshot_id:null,instrument:inst,visibility:c.kind==='snapshot'?'current':'not_current',revision:1,created_at:now,updated_at:now};next.journal.positions.push(position);r.inverse.created_position=true;counts.new++;
  }else fail(c.id,'請選擇新增、更新、合併來源或略過。');
  r.position_id=position.id;
  if(c.kind==='snapshot'){
   const s={id:'capture:'+parsed.package_digest.slice(0,24)+':'+c.id,...fields,imported_at:now,sources};next.snapshots.push(s);position.snapshot_ids.push(s.id);if(c.adopt||!position.selected_snapshot_id)position.selected_snapshot_id=s.id;position.visibility='current';r.snapshot_id=s.id;
  }else{
   const {instrument:_,event_date,...payload}=fields;const e={id:'evidence:'+parsed.package_digest.slice(0,24)+':'+c.id,kind:'execution_evidence',position_id:position.id,event_date,created_at:now,updated_at:now,revision:1,status:'active',source_refs:c.source_refs.map(source_id=>({intake_id:parsed.id,source_id})),payload};next.journal.entries.push(e);r.entry_id=e.id;counts.evidence++;
  }
  position.revision++;position.updated_at=now;receipts.push(r);
 }
 if(!receipts.some(r=>r.snapshot_id||r.entry_id))throw new Error('本次沒有選擇可新增或追加的項目。');
 for(const r of receipts){if(r.position_id){const p=next.journal.positions.find(p=>p.id===r.position_id);r.inverse.position_after={snapshot_ids:[...p.snapshot_ids],selected_snapshot_id:p.selected_snapshot_id,visibility:p.visibility};}if(r.snapshot_id)r.digests.snapshot=await digest(next.snapshots.find(s=>s.id===r.snapshot_id));if(r.position_id)r.digests.position=await digest(next.journal.positions.find(p=>p.id===r.position_id));if(r.entry_id)r.digests.entry=await digest(next.journal.entries.find(e=>e.id===r.entry_id));}
 const base_dependencies={entries:[],intakes:[]};const affected=new Set(receipts.map(r=>r.position_id).filter(Boolean)),observations=new Set(receipts.map(r=>r.snapshot_id).filter(Boolean));for(const e of state.journal?.entries||[])if(affected.has(e.position_id)||e.source_refs.some(ref=>observations.has(ref.snapshot_id)))base_dependencies.entries.push({id:e.id,digest:await digest(e)});base_dependencies.intakes=(state.journal?.intakes||[]).filter(b=>b.candidate_receipts.some(r=>affected.has(r.position_id)||observations.has(r.snapshot_id))).map(b=>b.id);
 const receipt={base_dependencies,id:parsed.id,content_hash,package_digest:parsed.package_digest,source_manifest:copy(parsed.package.sources),candidate_receipts:receipts,created_at:now,status:'applied'};next.journal.intakes.push(receipt);return {state:next,receipt,counts,already_applied:false};
}
export async function undoIntake(state,id,{now=new Date().toISOString()}={}){
 const batch=state.journal?.intakes.find(b=>b.id===id);if(!batch||batch.status!=='applied')throw new Error('這個批次目前不能撤回。');
 const ownEntries=new Set(batch.candidate_receipts.map(r=>r.entry_id).filter(Boolean)),ownSnapshots=new Set(batch.candidate_receipts.filter(r=>r.choice!=='merge_source').map(r=>r.snapshot_id).filter(Boolean)),targets=new Set(batch.candidate_receipts.map(r=>r.position_id).filter(Boolean)),blockers=[];
 for(const r of batch.candidate_receipts){for(const [key,array,idKey] of [['snapshot',state.snapshots,'snapshot_id'],['position',state.journal.positions,'position_id'],['entry',state.journal.entries,'entry_id']])if(r[idKey]&&await digest(array.find(v=>v.id===r[idKey]))!==r.digests[key])blockers.push(r.candidate_id+' 已修改');}
 for(const e of state.journal.entries)if(!ownEntries.has(e.id)&&(targets.has(e.position_id)||ownSnapshots.has(e.payload.review_of))&&!(batch.base_dependencies?.entries.some(v=>v.id===e.id&&v.digest) && await digest(e)===batch.base_dependencies.entries.find(v=>v.id===e.id).digest))blockers.push('已有後續理由或回顧：'+e.id);
 for(const r of batch.candidate_receipts.filter(r=>r.choice==='merge_source'))for(const e of state.journal.entries)if(e.source_refs.some(ref=>ref.snapshot_id===r.snapshot_id&&r.inverse.added_sources.some(s=>canonical(s)===canonical(state.snapshots.find(s=>s.id===r.snapshot_id)?.sources[ref.source_ordinal]))))blockers.push('已有後續來源引用：'+e.id);
 for(const b of state.journal.intakes)if(b.id!==id&&!batch.base_dependencies?.intakes.includes(b.id)&&b.status==='applied'&&b.candidate_receipts.some(r=>ownSnapshots.has(r.existing_ref)||targets.has(r.position_id)))blockers.push('已有後續批次：'+b.id);
 if(blockers.length)throw new Error('無法撤回整批：'+[...new Set(blockers)].join('；'));
 const next=copy(state);for(const r of [...batch.candidate_receipts].reverse()){
  if(r.entry_id){const e=next.journal.entries.find(e=>e.id===r.entry_id);e.status='withdrawn';e.revision++;e.updated_at=now;}
  if(r.position_id){const p=next.journal.positions.find(p=>p.id===r.position_id);if(r.inverse.created_position)p.visibility='not_current';else if(r.inverse.position_before)Object.assign(p,copy(r.inverse.position_before));p.revision++;p.updated_at=now;}
  if(r.inverse.added_sources.length){const s=next.snapshots.find(s=>s.id===r.snapshot_id);s.sources=s.sources.filter(s=>!r.inverse.added_sources.some(p=>canonical(p)===canonical(s)));}
 }
 const saved=next.journal.intakes.find(b=>b.id===id);saved.status='withdrawn';saved.undo_digests=await receiptDigests(next,saved);return next;
}
export const captureGuide=`請在這個對話整理我貼的截圖，輸出 investment-capture-candidates-v1 JSON 候選檔。不要當作寫入授權。每張 sources: id,name,sha256（未知 null，不能猜）,library_file_id（未知 null）。每筆 candidates: id,kind（snapshot 或 execution_evidence）,source_refs（sources ID 陣列）,extracted_fields。同圖多部位分開，跨圖重疊保留來源供核對。snapshot 欄位：symbol,product（perpetual/spot/stock_token/bot/unknown）,direction（long/short/unknown）,exchange（未知 null）,captured_date（YYYY-MM-DD 或 null）,screen_time（HH:MM 或 null）,fields（每個已知數值 {value,unit}；未知省略）,note,observed_history。fields 可用 quantity,leverage,investment,extra_margin,average_price,latest_price,liquidation_price,total_profit,total_profit_percent,take_profit,stop_loss,funding_rate,funding_amount,display_value,unrealized_pnl,unrealized_percent,realized_pnl,realized_percent,cumulative_pnl,cumulative_percent。execution_evidence 欄位：instrument {symbol,product,direction,exchange},event_date,side（BUY/SELL）,quantity,price,fees,currency,local_datetime（YYYY-MM-DD HH:MM:SS）,timezone,note；缺值 null。保留原單位，不推算未知日期、數量、成交價、匯率、理由或名目曝險。頂層 format,sources,candidates,warnings。`;

async function receiptDigests(state,batch){const out={};for(const r of batch.candidate_receipts){const items={snapshot:r.snapshot_id?state.snapshots.find(s=>s.id===r.snapshot_id):null,position:r.position_id?state.journal.positions.find(p=>p.id===r.position_id):null,entry:r.entry_id?state.journal.entries.find(e=>e.id===r.entry_id):null};out[r.candidate_id]=await digest(items);}return out;}
export async function restoreIntake(state,id,{now=new Date().toISOString()}={}){const batch=state.journal?.intakes.find(b=>b.id===id);if(!batch||batch.status!=='withdrawn'||canonical(await receiptDigests(state,batch))!==canonical(batch.undo_digests))throw new Error('撤回後相關紀錄已改變，請先核對，這次沒有復原。');const next=copy(state),saved=next.journal.intakes.find(b=>b.id===id);for(const r of saved.candidate_receipts){if(r.entry_id){const e=next.journal.entries.find(e=>e.id===r.entry_id);e.status='active';e.revision++;e.updated_at=now;}if(r.position_id){const p=next.journal.positions.find(p=>p.id===r.position_id);Object.assign(p,copy(r.inverse.position_after));p.revision++;p.updated_at=now;}if(r.inverse.added_sources.length)next.snapshots.find(s=>s.id===r.snapshot_id).sources.push(...copy(r.inverse.added_sources));}for(const r of saved.candidate_receipts){if(r.snapshot_id)r.digests.snapshot=await digest(next.snapshots.find(s=>s.id===r.snapshot_id));if(r.position_id)r.digests.position=await digest(next.journal.positions.find(p=>p.id===r.position_id));if(r.entry_id)r.digests.entry=await digest(next.journal.entries.find(e=>e.id===r.entry_id));}saved.status='applied';delete saved.undo_digests;return next;}
