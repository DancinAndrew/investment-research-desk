export function reviewRows(state,{from='',to='',query='',outcome='all'}={}){
 const latest=new Map();for(const r of state.reviews){const prev=latest.get(r.record_id);if(!prev||r.date>=prev.date)latest.set(r.record_id,r);}
 const q=query.trim().toLocaleLowerCase('zh-TW');
 return state.records.filter(r=>r.status==='active').map(record=>({record,review:latest.get(record.id)||null})).filter(({record:r,review:v})=>(!from||r.date>=from)&&(!to||r.date<=to)&&(outcome==='all'||(v?.outcome||'unreviewed')===outcome)&&(!q||[r.ticker,r.reason,r.risk,r.expectation,r.invalidation,v?.lesson,v?.next_action].join(' ').toLocaleLowerCase('zh-TW').includes(q))).sort((a,b)=>b.record.date.localeCompare(a.record.date)||a.record.id.localeCompare(b.record.id));
}
