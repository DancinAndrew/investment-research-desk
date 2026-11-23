// Read-only projections and the optional journal contract. Observations never enter trade replay.
import {replayLedger} from './ledger-core.mjs';
import {splitEvents} from './portfolio-core.mjs';
import {reportRegistry} from './report-registry.mjs';
export const emptyJournal=()=>({version:1,positions:[],entries:[],intakes:[]});
export const copy=v=>JSON.parse(JSON.stringify(v));
export const safeId=v=>typeof v==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(v);
export const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export const keys=(v,allowed)=>plain(v)&&Object.keys(v).every(k=>allowed.includes(k));
export const text=(v,n=5000)=>typeof v==='string'&&v.length<=n&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
export const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export const iso=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)&&date(v.slice(0,10))&&Number.isFinite(Date.parse(v));
export const finite=v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e12;
export const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const instrument=v=>keys(v,['symbol','product','direction','exchange'])&&typeof v.symbol==='string'&&/^[A-Z0-9][A-Z0-9._:/-]{0,31}$/.test(v.symbol)&&['perpetual','spot','stock_token','bot','unknown'].includes(v.product)&&['long','short','unknown'].includes(v.direction)&&(v.exchange===null||text(v.exchange,100)&&!!v.exchange.trim());
export const source=v=>keys(v,['id','name','sha256','library_file_id'])&&(!Object.hasOwn(v,'id')||safeId(v.id))&&text(v.name,200)&&!!v.name&&(v.sha256===null||sha(v.sha256))&&(v.library_file_id===null||text(v.library_file_id,200));
export function canonical(v){if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(plain(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);}
export async function digest(v){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function ledgerId(ticker,currency){return `ledger:${ticker}:${currency}`;}
export function projectPositions(state){
 const journal=state.journal||emptyJournal(),snapshots=state.snapshots||[],linked=new Set(journal.positions.flatMap(p=>p.snapshot_ids));
 const tombstones=new Set(journal.intakes.filter(b=>b.status==='withdrawn').flatMap(b=>b.candidate_receipts.filter(r=>r.choice!=='merge_source').map(r=>r.snapshot_id).filter(Boolean)));
 const positions=journal.positions.map(p=>({...p,snapshot:snapshots.find(s=>s.id===p.selected_snapshot_id)||null,origin:'snapshot'}));
 for(const s of snapshots)if(!linked.has(s.id)&&!tombstones.has(s.id))positions.push({id:'legacy-snapshot:'+s.id,snapshot_ids:[s.id],selected_snapshot_id:s.id,snapshot:s,visibility:'current',revision:0,created_at:s.imported_at,updated_at:s.imported_at,origin:'snapshot'});
 const calc=replayLedger(state.records,state.quotes,state.finance?splitEvents(state.finance):[]);
 if(calc.ok)for(const p of calc.positions)positions.push({id:ledgerId(p.ticker,p.currency),snapshot_ids:[],selected_snapshot_id:null,instrument:{symbol:p.ticker,product:'spot',direction:'long',exchange:null},visibility:p.quantity>0?'current':'not_current',origin:'ledger',calculation:p,revision:0});
 return positions.map(p=>({...p,...(p.snapshot?{instrument:Object.fromEntries(['symbol','product','direction','exchange'].map(k=>[k,p.snapshot[k]]))}:{} )})).sort((a,b)=>a.instrument.symbol.localeCompare(b.instrument.symbol)||a.id.localeCompare(b.id));
}
export function ensurePosition(state,id,now=new Date().toISOString()){
 const p=projectPositions(state).find(p=>p.id===id);if(!p)throw new Error('找不到這個部位，請返回持倉重新選擇。');
 if(p.origin==='ledger')return id;
 state.journal||=emptyJournal();if(!state.journal.positions.some(x=>x.id===id)){const {snapshot,origin,calculation,...saved}=p;state.journal.positions.push({...saved,revision:1,created_at:now,updated_at:now});}return id;
}
export function timeline(state,position){
 const events=[],snapshots=(state.snapshots||[]).filter(s=>position.snapshot_ids.includes(s.id));
 for(const s of snapshots){events.push({id:s.id,kind:'snapshot',date:s.captured_date,title:'持倉畫面',snapshot:s,created_at:s.imported_at,status:'active'});s.observed_history.forEach((h,i)=>events.push({id:s.id+':evidence:'+i,kind:'execution_evidence',date:h.local_datetime.slice(0,10),title:(h.side==='BUY'?'買入':'賣出')+'紀錄 · 待補成交資料',payload:h,created_at:s.imported_at,status:'active'}));}
 if(position.origin==='ledger')for(const r of state.records.filter(r=>ledgerId(r.ticker,r.currency)===position.id)){events.push({...r,kind:'record',title:(r.side==='BUY'?'買入':'賣出')+' · '+r.quantity+' × '+r.price+' '+r.currency,payload:r});for(const v of state.reviews.filter(v=>v.record_id===r.id))events.push({...v,kind:'legacy_review',title:'後續回顧',payload:v,status:'active'});}
 for(const e of state.journal?.entries||[])if(e.position_id===position.id)events.push({...e,date:e.event_date,title:{decision:e.payload.authorship==='retrospective'?'事後補記理由':'記錄決定',review:'後續回顧',execution_evidence:'成交證據 · 僅留存'}[e.kind]});
 return events.sort((a,b)=>a.date&&b.date?b.date.localeCompare(a.date)||a.id.localeCompare(b.id):a.date?-1:b.date?1:a.id.localeCompare(b.id));
}
export function validateJournal(input,state){
 const errors=[],fail=(path,message)=>errors.push({path:'journal.'+path,message});
 if(!keys(input,['version','positions','entries','intakes'])||input.version!==1||!Array.isArray(input.positions)||input.positions.length>10000||!Array.isArray(input.entries)||input.entries.length>10000||!Array.isArray(input.intakes)||input.intakes.length>1000)return {ok:false,errors:[{path:'journal',message:'決策紀錄格式或筆數無效。'}]};
 const snapshots=new Map((state.snapshots||[]).map(s=>[s.id,s])),pos=new Map(),entry=new Map(),batches=new Map(),linked=new Set();
 const meta=v=>Number.isSafeInteger(v.revision)&&v.revision>0&&iso(v.created_at)&&iso(v.updated_at);
 for(const [i,p] of input.positions.entries()){
  if(!keys(p,['id','snapshot_ids','selected_snapshot_id','instrument','visibility','revision','created_at','updated_at'])||!safeId(p.id)||p.id.startsWith('ledger:')||p.id.startsWith('legacy-snapshot:')&&!p.snapshot_ids?.includes(p.id.slice(16))||pos.has(p.id)||!meta(p)||!['current','not_current'].includes(p.visibility)||!Array.isArray(p.snapshot_ids)||p.snapshot_ids.length>10000||new Set(p.snapshot_ids).size!==p.snapshot_ids.length||p.snapshot_ids.some(id=>!snapshots.has(id)||linked.has(id))||p.selected_snapshot_id!==null&&!p.snapshot_ids.includes(p.selected_snapshot_id)||(!p.snapshot_ids.length&&(!instrument(p.instrument)||p.visibility==='current')))fail(`positions[${i}]`,'部位身份、畫面關聯或日期無效。');
  else{pos.set(p.id,p);p.snapshot_ids.forEach(id=>linked.add(id));if(p.snapshot_ids.length&&p.selected_snapshot_id===null)fail(`positions[${i}].selected_snapshot_id`,'請明確選擇摘要採用的畫面。');if(p.snapshot_ids.length){const base=snapshots.get(p.selected_snapshot_id);if(base&&p.snapshot_ids.some(id=>{const s=snapshots.get(id);return ['symbol','product'].some(k=>s[k]!==base[k])||['direction','exchange'].some(k=>s[k]!==null&&base[k]!==null&&s[k]!=='unknown'&&base[k]!=='unknown'&&s[k]!==base[k]);}))fail(`positions[${i}].snapshot_ids`,'不同標的、商品、方向或已知交易所不能合併部位。');}if(p.instrument&&!instrument(p.instrument))fail(`positions[${i}].instrument`,'商品資料無效。');}
 }
 const ledgerGroups=new Set(state.records.map(r=>ledgerId(r.ticker,r.currency)));
 for(const [i,e] of input.entries.entries()){
  if(!keys(e,['id','kind','position_id','event_date','created_at','updated_at','revision','status','source_refs','payload'])||!safeId(e.id)||entry.has(e.id)||!meta(e)||!['active','withdrawn'].includes(e.status)||!['decision','review','execution_evidence'].includes(e.kind)||!(pos.has(e.position_id)||ledgerGroups.has(e.position_id))||!(e.event_date===null||date(e.event_date))||!Array.isArray(e.source_refs)||e.source_refs.length>20){fail(`entries[${i}]`,'決策紀錄的身份、日期或部位無效。');continue;}
  entry.set(e.id,e);const p=e.payload;let ok=false;
  if(e.kind==='decision')ok=keys(p,['action','reason','expectation','risk','invalidation','horizon','authorship','report_id'])&&['observe','hold','increase','reduce','exit','unspecified'].includes(p.action)&&text(p.reason)&&!!p.reason.trim()&&['expectation','risk','invalidation'].every(k=>text(p[k]))&&text(p.horizon,200)&&['new_decision','retrospective','contemporaneous_source'].includes(p.authorship)&&(!p.report_id||Object.hasOwn(reportRegistry,p.report_id))&&(p.authorship!=='contemporaneous_source'||e.source_refs.length>0&&e.event_date!==null);
  if(e.kind==='review')ok=keys(p,['review_of','outcome','lesson','next_action'])&&safeId(p.review_of)&&['pending','supported','weakened','mixed'].includes(p.outcome)&&text(p.lesson)&&text(p.next_action)&&date(e.event_date);
  if(e.kind==='execution_evidence')ok=keys(p,['side','quantity','price','fees','currency','local_datetime','timezone','note'])&&['BUY','SELL'].includes(p.side)&&['quantity','price','fees'].every(k=>p[k]===null||finite(p[k])&&(k==='fees'?p[k]>=0:p[k]>0))&&(p.currency===null||typeof p.currency==='string'&&/^[A-Z]{3,8}$/.test(p.currency))&&(p.local_datetime===null||typeof p.local_datetime==='string'&&/^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(p.local_datetime)&&date(p.local_datetime.slice(0,10)))&&(p.timezone===null||text(p.timezone,100))&&text(p.note,3000);
  if(!ok)fail(`entries[${i}].payload`,'理由、回顧或成交證據欄位無效，請核對缺項。');
 }
 for(const [i,b] of input.intakes.entries()){
  if(!keys(b,['id','content_hash','package_digest','source_manifest','candidate_receipts','created_at','status','undo_digests','base_dependencies'])||!safeId(b.id)||batches.has(b.id)||!sha(b.content_hash)||!sha(b.package_digest)||!iso(b.created_at)||!['applied','withdrawn'].includes(b.status)||!Array.isArray(b.source_manifest)||b.source_manifest.length>20||!b.source_manifest.every(source)||!Array.isArray(b.candidate_receipts)||b.candidate_receipts.length>100){fail(`intakes[${i}]`,'新增批次收據或來源無效。');continue;}batches.set(b.id,b);if(b.base_dependencies!==undefined&&(!keys(b.base_dependencies,['entries','intakes'])||!Array.isArray(b.base_dependencies.entries)||!b.base_dependencies.entries.every(e=>keys(e,['id','digest'])&&safeId(e.id)&&sha(e.digest))||!Array.isArray(b.base_dependencies.intakes)||!b.base_dependencies.intakes.every(safeId)))fail(`intakes[${i}].base_dependencies`,'批次依賴基準無效。');if(b.undo_digests!==undefined&&(!plain(b.undo_digests)||!Object.values(b.undo_digests).every(sha)))fail(`intakes[${i}].undo_digests`,'復原基準無效。');
  const inversePosition=v=>v===null||keys(v,['snapshot_ids','selected_snapshot_id','visibility'])&&Array.isArray(v.snapshot_ids)&&v.snapshot_ids.every(id=>snapshots.has(id))&&new Set(v.snapshot_ids).size===v.snapshot_ids.length&&(v.selected_snapshot_id===null||v.snapshot_ids.includes(v.selected_snapshot_id))&&['current','not_current'].includes(v.visibility);
  const ids=new Set();for(const r of b.candidate_receipts){if(!plain(r)){fail(`intakes[${i}].candidate_receipts`,'批次項目格式無效。');continue;}const inv=r.inverse;
   if(!keys(r,['candidate_id','choice','snapshot_id','entry_id','position_id','existing_ref','reason','digests','inverse'])||!safeId(r.candidate_id)||ids.has(r.candidate_id)||!['new','update','skip','merge_source'].includes(r.choice)||![r.snapshot_id,r.entry_id,r.position_id,r.existing_ref].every(v=>v===null||safeId(v))||r.snapshot_id&&!snapshots.has(r.snapshot_id)||r.entry_id&&!entry.has(r.entry_id)||r.position_id&&!pos.has(r.position_id)||!text(r.reason,3000)||!keys(r.digests,['snapshot','position','entry'])||!['snapshot','position','entry'].every(k=>Object.hasOwn(r.digests,k)&&(r[k+'_id']?sha(r.digests[k]):r.digests[k]===null))||!keys(inv,['created_position','position_before','position_after','added_sources'])||typeof inv.created_position!=='boolean'||!inversePosition(inv.position_before)||!inversePosition(inv.position_after)||!Array.isArray(inv.added_sources)||!inv.added_sources.every(source))fail(`intakes[${i}].candidate_receipts`,'批次項目參照或復原資料無效。');ids.add(r.candidate_id);
  }
 }
 for(const [i,e] of input.entries.entries()){
  if(!e||entry.get(e.id)!==e)continue;
  if(e.kind==='review'){const target=entry.get(e.payload?.review_of),snapshot=snapshots.get(e.payload?.review_of),p=pos.get(e.position_id);if(!(target&&target.position_id===e.position_id&&target.kind!=='review'||snapshot&&p?.snapshot_ids.includes(snapshot.id)))fail(`entries[${i}].payload.review_of`,'回顧必須連到同一部位的原決定或畫面。');}
  for(const r of e.source_refs||[]){const p=pos.get(e.position_id);if(keys(r,['snapshot_id','source_ordinal'])){if(!p?.snapshot_ids.includes(r.snapshot_id)||!Number.isInteger(r.source_ordinal)||!snapshots.get(r.snapshot_id)?.sources[r.source_ordinal])fail(`entries[${i}].source_refs`,'畫面來源不屬於這個部位。');}else if(keys(r,['intake_id','source_id'])){const b=batches.get(r.intake_id);if(!b?.source_manifest.some(s=>s.id===r.source_id)||!b.candidate_receipts.some(c=>c.position_id===e.position_id))fail(`entries[${i}].source_refs`,'批次來源不屬於這個部位。');}else fail(`entries[${i}].source_refs`,'來源參照格式無效。');}
 }
 return {ok:!errors.length,errors,value:errors.length?null:input};
}
export function editJournalEntry(state,positionId,payload,{kind='decision',id=null,event_date=null,now=new Date().toISOString()}={}){
 const next=copy(state);ensurePosition(next,positionId,now);next.journal||=emptyJournal();const old=next.journal.entries.find(e=>e.id===id);
 if(old&&old.position_id!==positionId)throw new Error('紀錄與部位不一致。');
 const e={id:id||crypto.randomUUID(),kind,position_id:positionId,event_date,created_at:old?.created_at||now,updated_at:now,revision:(old?.revision||0)+1,status:old?.status||'active',source_refs:old?.source_refs||[],payload};next.journal.entries=next.journal.entries.filter(e=>e.id!==id);next.journal.entries.push(e);return next;
}

// Confirm only this operation's delta after a lost response; unrelated newer data remains intact.
export function confirmsSavedChange(before,candidate,latest){
 const newIntakes=(candidate.journal?.intakes||[]).filter(b=>!before.journal?.intakes.some(v=>v.id===b.id));
 if(newIntakes.length)return newIntakes.every(b=>latest.journal?.intakes.some(v=>v.id===b.id&&v.content_hash===b.content_hash&&v.status===b.status));
 function check(a,b,c){if(canonical(a)===canonical(b))return true;if(Array.isArray(b)){if(b.every(v=>plain(v)&&safeId(v.id))&&(!a||a.every(v=>plain(v)&&safeId(v.id)))){const old=new Map((a||[]).map(v=>[v.id,v])),current=new Map((c||[]).map(v=>[v.id,v]));return b.every(v=>check(old.get(v.id),v,current.get(v.id)))&&[...old.keys()].filter(id=>!b.some(v=>v.id===id)).every(id=>!current.has(id));}return canonical(b)===canonical(c);}if(plain(b)){return Object.keys(b).every(k=>check(a?.[k],b[k],c?.[k]))&&Object.keys(a||{}).filter(k=>!Object.hasOwn(b,k)).every(k=>!c||!Object.hasOwn(c,k));}return canonical(b)===canonical(c);}
 return check(before,candidate,latest);
}

// One event shape is used both in the timeline and its associated review list.
export function reviewsForEvent(state,event){
 if(event.kind==='record')return (state.reviews||[]).filter(r=>r.record_id===event.id).map(r=>({...r,kind:'legacy_review',title:'後續回顧',payload:r,status:'active'}));
 return (state.journal?.entries||[]).filter(r=>r.kind==='review'&&r.status==='active'&&r.payload.review_of===event.id);
}
