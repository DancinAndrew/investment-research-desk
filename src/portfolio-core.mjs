import {replayLedger,validateLedger} from './ledger-core.mjs';
const currency=x=>typeof x==='string'&&/^[A-Z]{3}$/.test(x);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!x.startsWith('0000')&&Number.isFinite(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(x);
const ticker=x=>typeof x==='string'&&/^[A-Z0-9][A-Z0-9._:^/\-]{0,31}$/.test(x);
const num=(x,positive=false)=>typeof x==='number'&&Number.isFinite(x)&&(positive?x>0:x>=0)&&x<=1e12;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(o,k));
const empty=()=>({events:[],prices:[],fx:[],valuations:[],benchmark:[],settings:{base_currency:'USD',history_complete:false,benchmark_name:'',benchmark_kind:'total_return'}});
export const emptyFinance=empty;
const error=message=>({ok:false,errors:[{message}],value:null});
export function validateFinance(f){
 if(!exact(f,['events','prices','fx','valuations','benchmark','settings'])||!['events','prices','fx','valuations','benchmark'].every(k=>Array.isArray(f[k])&&f[k].length<=10000))return error('資金與績效資料格式無效，每類最多10000筆。');
 const s=f.settings;
 if(!exact(s,['base_currency','history_complete','benchmark_name','benchmark_kind'])||!currency(s.base_currency)||typeof s.history_complete!=='boolean'||typeof s.benchmark_name!=='string'||s.benchmark_name.length>200||!['total_return','price'].includes(s.benchmark_kind))return error('計算幣別、完整性確認或基準設定無效。');
 const ids=new Set(),orders=new Set();
 for(const e of f.events){
  if(!exact(e,['id','date','type','currency','amount','ticker','ratio','to_currency','to_amount','note','order','created_at'])||!id(e.id)||ids.has(e.id)||!date(e.date)||!currency(e.currency)||!['DEPOSIT','WITHDRAWAL','DIVIDEND','INTEREST','FEE','TAX','SPLIT','FX'].includes(e.type)||!num(e.amount)||!num(e.ratio,true)||!num(e.to_amount)||typeof e.note!=='string'||e.note.length>5000||!Number.isSafeInteger(e.order)||e.order<0||e.order>1000000||typeof e.created_at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(e.created_at)||!date(e.created_at.slice(0,10))||!Number.isFinite(Date.parse(e.created_at)))return error('資金事件 ID、日期、金額、順序或類型無效。');
  if(e.type==='SPLIT'?(e.amount!==0||!ticker(e.ticker)||e.to_currency!==''||e.to_amount!==0):(e.amount<=0||e.ratio!==1||e.type==='DIVIDEND'&&!ticker(e.ticker)))return error('股息需填標的；拆併股需填正數比例與零現金金額。');
  if(e.type==='FX'?!currency(e.to_currency)||e.to_currency===e.currency||e.to_amount<=0||e.ticker!=='':e.to_currency!==''||e.to_amount!==0)return error('換匯需填不同幣別與實際取得金額；其他事件不能填換匯欄位。');
  if(!['DIVIDEND','SPLIT'].includes(e.type)&&e.ticker!=='')return error('此資金事件不使用標的欄位。');
  if(['DEPOSIT','WITHDRAWAL'].includes(e.type)){const k=e.date+'|'+e.order;if(orders.has(k))return error('同日外部入出金的順序不能重複。');orders.add(k);}
  ids.add(e.id);
 }
 for(const [key,keys,valid,unique] of [
  ['prices',['ticker','currency','date','price'],r=>ticker(r.ticker)&&currency(r.currency)&&date(r.date)&&num(r.price,true),r=>r.ticker+'|'+r.currency+'|'+r.date],
  ['fx',['date','currency','base_currency','rate'],r=>date(r.date)&&currency(r.currency)&&currency(r.base_currency)&&r.currency!==r.base_currency&&num(r.rate,true),r=>r.date+'|'+r.currency+'|'+r.base_currency],
  ['benchmark',['date','currency','value'],r=>date(r.date)&&currency(r.currency)&&num(r.value,true),r=>r.date+'|'+r.currency],
  ['valuations',['id','date','currency','value','phase','flow_id'],r=>id(r.id)&&date(r.date)&&currency(r.currency)&&num(r.value)&&['close','before_flow','after_flow'].includes(r.phase)&&(r.phase==='close'?r.flow_id==='':f.events.some(e=>e.id===r.flow_id&&e.date===r.date&&['DEPOSIT','WITHDRAWAL'].includes(e.type))),r=>r.date+'|'+r.currency+'|'+r.phase+'|'+r.flow_id]
 ]){const seen=new Set(),rowIds=new Set();for(const r of f[key]){if(!exact(r,keys)||!valid(r)||seen.has(unique(r))||key==='valuations'&&(rowIds.has(r.id)||ids.has(r.id)))return error('價格、匯率、總資產估值或基準資料無效／重複。');seen.add(unique(r));rowIds.add(r.id);}}
 return {ok:true,errors:[],value:JSON.parse(JSON.stringify(f))};
}
export const splitEvents=f=>f.events.filter(e=>e.type==='SPLIT').map(({id,date,ticker,currency,ratio})=>({id,date,ticker,currency,ratio}));
const sorted=events=>[...events].sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order||a.id.localeCompare(b.id));
const rate=(f,c,d)=>c===f.settings.base_currency?1:f.fx.find(r=>r.date===d&&r.currency===c&&r.base_currency===f.settings.base_currency)?.rate;
export function replayPortfolio(records,finance,asOf){
 const checked=validateFinance(finance);if(!checked.ok)return {...checked,gaps:checked.errors.map(e=>e.message),total_value:null};
 if(!date(asOf))return {...error('估值日期無效。'),gaps:['估值日期無效。'],total_value:null};
 const full=validateLedger(records,[],splitEvents(checked.value));if(!full.ok)return {...full,gaps:full.errors.map(e=>e.message),total_value:null};
 const f=checked.value,events=sorted(f.events.filter(e=>e.date<=asOf)),trades=full.value.records.filter(r=>r.date<=asOf),ledger=replayLedger(trades,[],splitEvents({...f,events}));
 if(!ledger.ok)return {...ledger,gaps:ledger.errors.map(e=>e.message),total_value:null};
 const cash={},gaps=[],add=(c,v)=>cash[c]=(cash[c]||0)+v;
 const daily=new Map(),change=(d,c,v)=>{if(!daily.has(d))daily.set(d,[]);daily.get(d).push([c,v]);};
 for(const r of ledger.ordered_records.filter(r=>r.status==='active'))change(r.date,r.currency,r.side==='BUY'?-(r.quantity*r.price+r.fees):r.quantity*r.price-r.fees);
 for(const e of events){if(e.type==='SPLIT')continue;change(e.date,e.currency,['WITHDRAWAL','FEE','TAX','FX'].includes(e.type)?-e.amount:e.amount);if(e.type==='FX')change(e.date,e.to_currency,e.to_amount);}
 for(const [d,changes] of [...daily].sort(([a],[b])=>a.localeCompare(b))){for(const [c,v] of changes)add(c,v);for(const [c,v] of Object.entries(cash))if(v< -1e-8)gaps.push(d+' '+c+' 現金不足；請補期初入金或核對歷史。');}
 let total=0;
 for(const [c,v] of Object.entries(cash)){if(!Number.isFinite(v)||Math.abs(v)>Number.MAX_SAFE_INTEGER)gaps.push(c+' 現金超過安全計算範圍。');if(v< -1e-8)gaps.push(c+' 現金不足；請補入金或核對完整帳本。');const fx=rate(f,c,asOf);if(fx===undefined&&v!==0)gaps.push(asOf+' 缺 '+c+' 換算匯率。');else total+=v*(fx||1);}
 const positions=ledger.positions.map(p=>{const q=f.prices.find(q=>q.ticker===p.ticker&&q.currency===p.currency&&q.date===asOf);let market_value=null,base_value=null;if(p.quantity>0){if(!q)gaps.push(asOf+' 缺 '+p.ticker+' / '+p.currency+' 價格。');else{market_value=p.quantity*q.price;const fx=rate(f,p.currency,asOf);if(fx===undefined)gaps.push(asOf+' 缺 '+p.currency+' 換算匯率。');else{base_value=market_value*fx;total+=base_value;}}}else market_value=base_value=0;return {...p,market_value,base_value,unrealized:market_value===null?null:market_value-p.cost_basis,quote_price:q?.price??null,quote_date:q?.date??null};});
 if(!Number.isFinite(total)||Math.abs(total)>Number.MAX_SAFE_INTEGER)gaps.push('總資產超過安全計算範圍。');
 return {ok:true,errors:[],cash,positions,gaps:[...new Set(gaps)],total_value:gaps.length?null:total,base_currency:f.settings.base_currency,as_of:asOf,realized_by_currency:ledger.realized_by_currency};
}
export function portfolioReturns(finance,start,end){
 const result={twr:null,mwr:null,benchmark_return:null,excess_return:null,gaps:[],start,end};const valid=validateFinance(finance);if(!valid.ok){result.gaps=valid.errors.map(e=>e.message);return result;}
 const f=valid.value,base=f.settings.base_currency;
 if(!date(start)||!date(end)||end<=start){result.gaps.push('起訖日期需有效，結束需晚於開始。');return result;}
 if(!f.settings.history_complete){result.gaps.push('請先確認交易、入出金、股息與拆併股記錄完整。');return result;}
 const find=(d,phase='close',flow_id='')=>f.valuations.find(v=>v.date===d&&v.currency===base&&v.phase===phase&&v.flow_id===flow_id)?.value;
 const first=find(start),last=find(end);if(!(first>0)||last===undefined){result.gaps.push('缺起點正數與終點總資產估值（含現金、同計算幣別）。');return result;}
 const flows=sorted(f.events.filter(e=>e.date>start&&e.date<=end&&['DEPOSIT','WITHDRAWAL'].includes(e.type))).map(e=>({...e,converted:rate(f,e.currency,e.date)===undefined?null:e.amount*rate(f,e.currency,e.date)*(e.type==='DEPOSIT'?1:-1)}));
 if(flows.some(e=>e.converted===null)){result.gaps.push('外部入出金當日缺換算匯率，無法計算績效。');return result;}
 let current=first,product=1,complete=true;
 for(const e of flows){const before=find(e.date,'before_flow',e.id),after=find(e.date,'after_flow',e.id);if(before===undefined||after===undefined||!(current>0)||!(after>0)||Math.abs(after-before-e.converted)>1e-7*Math.max(1,after,before,Math.abs(e.converted))){complete=false;result.gaps.push(e.date+' / '+e.id+' 缺入出金前後總資產估值，或差額不等於實際入出金。');break;}product*=before/current;current=after;}
 if(complete&&current>0&&Number.isFinite(product*last/current))result.twr=product*last/current-1;
 // XIRR uses actual days / 365, solving in log(1+r). Single sign change
 // gives one economically admissible root; multiple sign changes are withheld.
 const amounts=new Map([[start,-first]]);for(const e of flows)amounts.set(e.date,(amounts.get(e.date)||0)-e.converted);amounts.set(end,(amounts.get(end)||0)+last);
 const terms=[...amounts].sort(([a],[b])=>a.localeCompare(b)).filter(([,v])=>Math.abs(v)>1e-12).map(([d,v])=>({t:(Date.parse(d)-Date.parse(start))/86400000/365,v}));
 const signs=terms.map(x=>Math.sign(x.v));let changes=0;for(let i=1;i<signs.length;i++)if(signs[i]!==signs[i-1])changes++;
 if(changes!==1)result.gaps.push('外部現金流可能產生多個或沒有金額加權報酬解，不顯示單一 MWR。');
 else{const scale=Math.max(...terms.map(x=>Math.abs(x.v))),npv=x=>{const offset=Math.max(...terms.map(a=>-x*a.t));return terms.reduce((sum,a)=>sum+a.v/scale*Math.exp(-x*a.t-offset),0)};let lo=-20,hi=20,l=npv(lo),h=npv(hi);if(Number.isFinite(l)&&Number.isFinite(h)&&l*h<=0){for(let i=0;i<200;i++){const mid=(lo+hi)/2,m=npv(mid);if(Math.sign(m)===Math.sign(l)){lo=mid;l=m}else hi=mid;}const solved=Math.expm1((lo+hi)/2);if(Number.isFinite(solved))result.mwr=solved;}if(result.mwr===null)result.gaps.push('MWR 在可計算範圍內未找到穩定解。');}
 const b=f.benchmark.find(v=>v.date===start&&v.currency===base),z=f.benchmark.find(v=>v.date===end&&v.currency===base);
 if(b&&z){result.benchmark_return=z.value/b.value-1;if(f.settings.benchmark_kind==='total_return'&&result.twr!==null)result.excess_return=result.twr-result.benchmark_return;else if(f.settings.benchmark_kind==='price')result.gaps.push('基準僅價格指數，未含股息，不計同口徑超額報酬。');}else result.gaps.push('缺同起訖日、同幣別基準值。');
 return result;
}
