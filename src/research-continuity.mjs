import {reportRegistry} from './report-registry.mjs';

import {researchQuestions} from './local-research-config.mjs';
export {researchQuestions};
export const emptyResearch=()=>({observations:[],comparisons:[],checks:[]});
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const text=(v,max=5000,required=false)=>typeof v==='string'&&v.length<=max&&(!required||v.trim().length>0);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!v.startsWith('0000')&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const stamp=v=>text(v,40)&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)&&date(v.slice(0,10))&&Number.isFinite(Date.parse(v));
const exactKeys=(v,keys)=>object(v)&&Object.keys(v).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(v,k));
const error=message=>({ok:false,errors:[{message}],value:null});
export function reportPin(report_id){const r=Object.hasOwn(reportRegistry,report_id)?reportRegistry[report_id]:null;return r?{report_id,report_sha256:r.report_sha256}:null;}
const validPin=r=>object(r)&&typeof r.report_id==='string'&&Object.hasOwn(reportRegistry,r.report_id)&&typeof r.report_sha256==='string'&&/^[a-f0-9]{64}$/.test(r.report_sha256)&&reportRegistry[r.report_id].report_sha256===r.report_sha256;
const pinKeys=['report_id','report_sha256'];
const observationKeys=['id','date','action','reason','invalidation',...pinKeys,'claim_ids','status','created_at','updated_at'];
const checkKeys=['id','observation_id','date',...pinKeys,'outcome','note','created_at'];

export function validateResearch(input){
 if(!exactKeys(input,['observations','comparisons','checks'])||!['observations','comparisons','checks'].every(k=>Array.isArray(input[k])&&input[k].length<=3000))return error('研究記錄格式無效或超過3000筆。');
 const allIds=new Set();
 const unique=r=>{if(!id(r.id)||allIds.has(r.id))return false;allIds.add(r.id);return true;};
 for(const r of input.observations){
  if(!exactKeys(r,observationKeys)||!unique(r)||!date(r.date)||!validPin(r)||!['watch','no_action','reconsider'].includes(r.action)||!['active','archived'].includes(r.status)||!text(r.reason,5000,true)||!text(r.invalidation)||!stamp(r.created_at)||!stamp(r.updated_at)||Date.parse(r.updated_at)<Date.parse(r.created_at))return error('觀察決定的日期、理由或報告版本無效。');
  if(!Array.isArray(r.claim_ids)||r.claim_ids.length>100||new Set(r.claim_ids).size!==r.claim_ids.length||!r.claim_ids.every(cid=>reportRegistry[r.report_id].claims.some(c=>c.id===cid)))return error('所選研究主張不屬於這份報告。');
 }
 for(const c of input.comparisons){
  if(!exactKeys(c,['id','name','reports','questions','created_at'])||!unique(c)||!text(c.name,200,true)||!stamp(c.created_at)||!Array.isArray(c.reports)||c.reports.length<2||c.reports.length>4||!c.reports.every(r=>exactKeys(r,pinKeys)&&validPin(r))||new Set(c.reports.map(r=>r.report_id)).size!==c.reports.length)return error('比較需包含2至4個不同的已登錄報告版本。');
  if(!Array.isArray(c.questions)||!c.questions.length||c.questions.length>researchQuestions.length||new Set(c.questions).size!==c.questions.length||!c.questions.every(q=>researchQuestions.some(question=>question.id===q)))return error('比較問題無效。');
 }
 for(const c of input.checks){
  const original=input.observations.find(r=>r.id===c?.observation_id);
  if(!exactKeys(c,checkKeys)||!unique(c)||!original||!date(c.date)||c.date<original.date||!validPin(c)||!stamp(c.created_at)||!['pending','supported','weakened','mixed'].includes(c.outcome)||!text(c.note,5000,true))return error('重新核對需連結原決定、有效日期及具體理由。');
  if(reportRegistry[c.report_id].ticker!==reportRegistry[original.report_id].ticker||Date.parse(reportRegistry[c.report_id].as_of)<Date.parse(reportRegistry[original.report_id].as_of))return error('核對的目標需為同公司、相同或較後的研究版本。');
 }
 return {ok:true,errors:[],value:JSON.parse(JSON.stringify(input))};
}

export function comparisonCells(ids,questionIds){
 return researchQuestions.filter(q=>questionIds.includes(q.id)).map(q=>({...q,cells:ids.map(report_id=>{
  const report=reportRegistry[report_id];if(!report)return {report_id,claims:[],traces:[]};
  const claims=report.claims.filter(c=>(q[report.ticker]||[]).includes(c.id));
  return {report_id,...report,claims,traces:report.trace.filter(row=>claims.some(c=>c.id===row.claim_id))};
 })}));
}
function claimBody(c){return c?JSON.stringify({text:c.text,conditions:c.conditions||[],hypotheses:c.hypotheses||[],falsifier:c.falsifier||'',source_refs:c.source_refs||[]}):null;}
export function compareClaims(before,after,selected){
 const ids=selected?.length?selected:[...new Set([...before,...after].map(c=>c.id))];
 return ids.map(id=>{const a=before.find(c=>c.id===id),b=after.find(c=>c.id===id);return {id,before:a||null,after:b||null,status:!a?'added':!b?'removed':claimBody(a)===claimBody(b)?'unchanged':'changed'};});
}
export function reportChanges(beforeId,afterId,selected){
 const before=reportRegistry[beforeId],after=reportRegistry[afterId];
 if(!before||!after||before.ticker!==after.ticker)return null;
 const changes=compareClaims(before.claims,after.claims,selected).map(change=>{
  const a=before.trace.filter(row=>row.claim_id===change.id),b=after.trace.filter(row=>row.claim_id===change.id);
  const fingerprint=rows=>JSON.stringify(rows.map(r=>[r.subclaim_id,r.source_id,r.source_sha256,r.source_locator,r.role,r.support_limit,r.report_anchor]).sort());
  return {...change,sources_before:a,sources_after:b,evidence_changed:fingerprint(a)!==fingerprint(b)};
 });
 return {before,after,body_changed:before.report_sha256!==after.report_sha256,changes};
}
export function latestReport(ticker){return Object.entries(reportRegistry).filter(([,r])=>r.ticker===ticker).sort(([,a],[,b])=>Date.parse(a.as_of)-Date.parse(b.as_of)).at(-1)?.[0]||null;}
