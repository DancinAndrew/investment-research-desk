import {validateState} from '../worker/index.mjs';
export function serializeBackup(state,exported_at=new Date().toISOString()) {
 return JSON.stringify({format:'investment-ledger-v1',exported_at,state},null,2);
}
export function parseBackup(text) {
 if(typeof text!=='string'||new TextEncoder().encode(text).length>2000000)throw new Error('備份超過 2 MB 限制。');
 let body;try{body=JSON.parse(text)}catch{throw new Error('JSON 格式錯誤。請貼上完整備份內容，檢查引號、逗號與括號後再試。')}
 if(body?.format!=='investment-ledger-v1')throw new Error('這不是私人帳本備份。');
 const check=validateState(body.state);if(!check.ok)throw new Error(check.errors.map(e=>e.message).join('；'));
 return check.value;
}

export function ledgerClearDependencies(state){
 return [...new Set((state.journal?.entries||[]).map(e=>e.position_id).filter(id=>id.startsWith('ledger:')))];
}
export function journalRestoreImpact(current,candidate){
 const counts=state=>({positions:state.journal?.positions.length||0,entries:state.journal?.entries.length||0,intakes:state.journal?.intakes.length||0});
 const before=counts(current),after=counts(candidate);
 return {before,after,missing_journal:!candidate.journal&&Object.values(before).some(n=>n>0)};
}

export function researchRestoreImpact(current,candidate){const domains=['reviews','scenarios','rules'],count=s=>Object.fromEntries(domains.map(k=>[k,s.research_workspace?.[k]?.length||0]));const before=count(current),after=count(candidate);return {before,after,missing_workspace:!!current.research_workspace&&!candidate.research_workspace,removes_versions:domains.some(k=>{const ids=new Set((candidate.research_workspace?.[k]||[]).map(row=>row.id));return (current.research_workspace?.[k]||[]).some(row=>!ids.has(row.id));})};}
