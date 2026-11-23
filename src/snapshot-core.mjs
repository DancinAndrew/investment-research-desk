// Screenshot observations are evidence, never inputs to trade replay or returns.
export const snapshotFields = {
 quantity:'持有數量', leverage:'槓桿', investment:'投資額', extra_margin:'額外保證金',
 average_price:'持倉均價／成本價', latest_price:'畫面最新價格', liquidation_price:'預估強平價',
 total_profit:'畫面總利潤', total_profit_percent:'總利潤比例', take_profit:'止盈', stop_loss:'止損',
 funding_rate:'資金費率', funding_amount:'畫面資金費', display_value:'畫面估值',
 unrealized_pnl:'未實現盈虧', unrealized_percent:'未實現比例', realized_pnl:'已實現盈虧（360D）',
 realized_percent:'已實現比例（360D）', cumulative_pnl:'累計盈虧（360D）', cumulative_percent:'累計比例（360D）',
};
const plain = v => v && typeof v==='object' && !Array.isArray(v) && Object.getPrototypeOf(v)===Object.prototype;
const text = (v,n=200) => typeof v==='string' && v.length<=n && !/[\u0000-\u001f]/.test(v);
const keys = (v,allowed) => plain(v) && Object.keys(v).every(k=>allowed.includes(k));
const finite = v => typeof v==='number' && Number.isFinite(v) && Math.abs(v)<=1e12;
const units = ['USDT','TWD','USD','%','x','token','contract','unit'];
const iso = v => text(v,40) && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d\d:\d\d)$/.test(v) && Number.isFinite(Date.parse(v));
const date = v => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v+'T00:00:00Z')) && new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const localTime = v => typeof v==='string' && /^\d{4}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(v) && date(v.slice(0,10));
export function validateSnapshots(input) {
 const errors=[],ids=new Set();
 const fail=i=>errors.push({path:`snapshots[${i}]`,message:'持倉快照的欄位、數字、日期或來源無效。'});
 if(!Array.isArray(input)||input.length>10000)return {ok:false,errors:[{message:'持倉快照需為最多 10000 筆陣列。'}]};
 for(const [i,s] of input.entries()){
  let valid=keys(s,['id','symbol','product','direction','exchange','captured_date','screen_time','imported_at','fields','sources','note','observed_history','exchange_source']);
  valid=valid && text(s.id,128) && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(s.id) && !ids.has(s.id)
   && text(s.symbol,32) && /^[A-Z0-9][A-Z0-9._:/-]*$/.test(s.symbol)
   && ['perpetual','spot','stock_token','bot','unknown'].includes(s.product)
   && ['long','short','unknown'].includes(s.direction) && (s.exchange===null||text(s.exchange,100)&&!!s.exchange.trim())
   && (s.captured_date===null||date(s.captured_date))
   && (s.screen_time===null||typeof s.screen_time==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.screen_time))
   && iso(s.imported_at) && text(s.note,3000) && keys(s.fields,Object.keys(snapshotFields))
   && Array.isArray(s.sources) && s.sources.length>0 && s.sources.length<=20
   && Array.isArray(s.observed_history) && s.observed_history.length<=100;
  if(valid)valid=Object.entries(s.fields).every(([k,f])=>keys(f,['value','unit'])&&finite(f.value)&&units.includes(f.unit)
   && (!['quantity','investment','extra_margin','average_price','latest_price','liquidation_price','take_profit','stop_loss','display_value'].includes(k)||f.value>=0)
   && (k!=='leverage'||f.value>=1&&f.unit==='x'));
  if(valid)valid=s.sources.every(p=>keys(p,['name','sha256','library_file_id'])&&text(p.name,200)&&(p.sha256===null||/^[a-f0-9]{64}$/.test(p.sha256))&&(p.library_file_id===null||text(p.library_file_id,200)));
  if(valid)valid=s.observed_history.every(h=>keys(h,['side','local_datetime','timezone','quantity','price','currency'])&&['BUY','SELL'].includes(h.side)
   && localTime(h.local_datetime)
   && (h.timezone===null||text(h.timezone,100))&&finite(h.quantity)&&h.quantity>0&&(h.price===null||finite(h.price)&&h.price>0)
   && (h.currency===null||['USD','TWD','USDT'].includes(h.currency)));
  if(s.exchange_source!==undefined)valid=valid&&keys(s.exchange_source,['kind','confirmed_at','note'])&&s.exchange_source.kind==='user_confirmed'&&iso(s.exchange_source.confirmed_at)&&text(s.exchange_source.note,1000);
  if(!valid)fail(i);else ids.add(s.id);
 }
 return {ok:!errors.length,errors,value:errors.length?null:input};
}
export function validateFavorites(input) {
 const ok=Array.isArray(input)&&input.length<=2000&&new Set(input).size===input.length
  && input.every(id=>typeof id==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id));
 return {ok,errors:ok?[]:[{message:'公司收藏需為不重複的公司代號陣列。'}],value:ok?input:null};
}
