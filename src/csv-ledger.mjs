import {validateRecord,validateLedger} from './ledger-core.mjs';
import {splitEvents} from './portfolio-core.mjs';
const fail=message=>({ok:false,errors:[{message}],state:null});
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value))))].map(n=>n.toString(16).padStart(2,'0')).join('');
const economic=r=>JSON.stringify([r.date,r.ticker,r.side,r.quantity,r.price,r.currency,r.fees,r.status]);
export const csvFields=['id','date','ticker','side','quantity','price','currency','fees','reason','horizon','expectation','risk','invalidation','report_id','source_links','status','revision','created_at','updated_at'];
const required=['date','ticker','side','quantity','price'];
const timestamp=v=>typeof v==='string'&&v.length<=40&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(Date.parse(v.slice(0,10)+'T00:00:00Z')).toISOString().slice(0,10)===v.slice(0,10);

export function parseCsv(text,delimiter=','){
 if(typeof text!=='string'||new TextEncoder().encode(text).length>2000000)throw new Error('CSV超過2MB限制。');
 if(![',',';','\t'].includes(delimiter))throw new Error('分隔符號無效。');
 const source=text.replace(/^\uFEFF/,''),rows=[];let row=[],cell='',quoted=false,closed=false;
 const endCell=()=>{row.push(cell);cell='';closed=false;};
 const endRow=()=>{endCell();if(row.some(c=>c!==''))rows.push(row);row=[];};
 for(let i=0;i<source.length;i++){
  const ch=source[i];
  if(quoted){if(ch==='"'){if(source[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=ch;continue;}
  if(closed&&ch!==delimiter&&ch!=='\r'&&ch!=='\n')throw new Error('CSV引號結束後有額外文字。');
  if(ch==='"'){if(cell)throw new Error('CSV未加引號欄位中含引號。');quoted=true;}
  else if(ch===delimiter)endCell();
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&source[i+1]==='\n')i++;endRow();}
  else cell+=ch;
 }
 if(quoted)throw new Error('CSV引號尚未結束。');
 if(cell!==''||row.length||closed)endRow();
 if(!rows.length)throw new Error('CSV沒有標題或資料。');
 const headers=rows.shift().map(h=>h.trim());
 if(headers.some(h=>!h)||new Set(headers).size!==headers.length)throw new Error('CSV標題空白或重複，請先修正。');
 if(rows.length>10000)throw new Error('CSV最多10000筆。');
 return {headers,rows:rows.map((cells,i)=>({number:i+2,cells})),delimiter};
}
function numberValue(value,format){
 const text=String(value).trim();
 const pattern=format==='comma'?/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/:/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/;
 if(!pattern.test(text))return NaN;
 return Number(format==='comma'?text.replaceAll('.','').replace(',','.'):text.replaceAll(',',''));
}
function dateValue(value,format){
 const text=value.trim();if(format==='ISO')return text;
 const m=text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)return '';
 return m[3]+'-'+String(format==='DMY'?m[2]:m[1]).padStart(2,'0')+'-'+String(format==='DMY'?m[1]:m[2]).padStart(2,'0');
}
function rowRecord(row,mapping,options,now,id){
 const get=key=>mapping[key]===undefined||mapping[key]===null?'':String(row.cells[mapping[key]]??'');
 const own=value=>options.ownExport&&(/^(?:'')/.test(value)||/^'\s*[=+\-@\t\r]/.test(value))?value.slice(1):value;
 const side=get('side').trim().toUpperCase(),buy=options.buyValue.trim().toUpperCase(),sell=options.sellValue.trim().toUpperCase();
 let links=[];if(get('source_links').trim()){const v=get('source_links').trim();links=v.startsWith('[')?JSON.parse(v):v.split('\n').map(s=>s.trim()).filter(Boolean);}
 const fee=get('fees').trim();
 const r={id:get('id').trim()||id,date:dateValue(get('date'),options.dateFormat),ticker:get('ticker').trim().toUpperCase(),side:side===buy?'BUY':side===sell?'SELL':side,
  quantity:numberValue(get('quantity'),options.numberFormat),price:numberValue(get('price'),options.numberFormat),currency:(get('currency')||options.defaultCurrency||'').trim().toUpperCase(),
  fees:fee?numberValue(fee,options.numberFormat):options.feesMissingZero?0:NaN,reason:own(get('reason'))||options.reasonFallback||'',
  source_links:links,status:get('status').trim()||'active',revision:get('revision').trim()?Number(get('revision')):1,
  created_at:get('created_at').trim()||now,updated_at:get('updated_at').trim()||get('created_at').trim()||now};
 for(const key of ['horizon','expectation','risk','invalidation','report_id'])r[key]=own(get(key));
 return r;
}
export async function prepareCsvImport(parsed,mapping,options,state){
 if(!parsed||!Array.isArray(parsed.headers)||!Array.isArray(parsed.rows)||parsed.rows.length>10000||!mapping||Object.keys(mapping).some(k=>!csvFields.includes(k)))throw new Error('CSV對映無效。');
 if(!required.every(k=>Number.isInteger(mapping[k])&&mapping[k]>=0&&mapping[k]<parsed.headers.length)||!Object.values(mapping).every(v=>v===null||v===undefined||Number.isInteger(v)&&v>=0&&v<parsed.headers.length))throw new Error('請對映日期、標的、買賣、股數與價格。');
 if(!['ISO','DMY','MDY'].includes(options.dateFormat)||!['dot','comma'].includes(options.numberFormat)||!options.buyValue?.trim()||!options.sellValue?.trim()||options.buyValue.trim().toUpperCase()===options.sellValue.trim().toUpperCase())throw new Error('日期、數字或買賣代碼設定無效。');
 const source_hash=await hash(parsed),base_hash=await hash(state),now=new Date().toISOString(),entries=[];
 const byId=new Map((state.records||[]).map(r=>[r.id,r])),byEconomic=new Set((state.records||[]).map(economic)),seenId=new Map();
 for(const row of parsed.rows){
  try{
   if(row.cells.length!==parsed.headers.length)throw new Error('欄位數和標題不同。');
   const raw=rowRecord(row,mapping,options,now,'csv_'+(await hash([source_hash,row.number])).slice(0,40)),checked=validateRecord(raw);
   if(!checked.ok)throw new Error(checked.errors.map(e=>e.message).join('；'));
   const record=checked.value,key=economic(record),existing=byId.get(record.id)||seenId.get(record.id);let status='ready',reason='可新增';
   if(existing){status=economic(existing)===key?'duplicate':'conflict';reason=status==='duplicate'?'相同ID與成交已存在；保留原紀錄':'相同ID有不同成交，不能覆寫原紀錄';}
   else if(byEconomic.has(key)){status='possible_duplicate';reason='同日同價成交可能重複；若是另一筆實際成交需明確保留';}
   seenId.set(record.id,record);byEconomic.add(key);entries.push({number:row.number,status,reason,record});
  }catch(e){entries.push({number:row.number,status:'invalid',reason:e.message,record:null});}
 }
 return {source_hash,base_hash,headers:[...parsed.headers],mapping:{...mapping},entries};
}
export async function applyCsvImport(state,preview,selected,{allowPossibleDuplicates=false}={}){
 if(await hash(state)!==preview.base_hash)return fail('私人資料已變更，請重新預覽再確認匯入。');
 if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length)return fail('請選擇要新增的成交。');
 const entries=selected.map(number=>preview.entries.find(e=>e.number===number));
 if(entries.some(e=>!e||!['ready','possible_duplicate'].includes(e.status)))return fail('選擇含無效、重複ID或衝突資料，未匯入。');
 if(!allowPossibleDuplicates&&entries.some(e=>e.status==='possible_duplicate'))return fail('可能重複的成交需明確確認為不同實際成交。');
 const records=[...state.records,...entries.map(e=>e.record)],check=validateLedger(records,state.quotes,state.finance?splitEvents(state.finance):[]);
 if(!check.ok)return fail(check.errors.map(e=>e.message).join('；'));
 const batch={id:crypto.randomUUID(),created_at:new Date().toISOString(),source_hash:preview.source_hash,record_ids:entries.map(e=>e.record.id),record_hashes:await Promise.all(entries.map(e=>hash(e.record))),status:'applied',undone_at:null};
 return {ok:true,errors:[],batch,state:{...state,records:check.value.records,imports:[...(state.imports||[]),batch]}};
}
export function validateImports(imports){
 if(!Array.isArray(imports)||imports.length>1000)return fail('CSV匯入批次格式無效或超過1000筆。');
 const ids=new Set();
 for(const b of imports){
  if(!b||typeof b!=='object'||Object.keys(b).some(k=>!['id','created_at','source_hash','record_ids','record_hashes','status','undone_at'].includes(k))||typeof b.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(b.id)||ids.has(b.id)||typeof b.source_hash!=='string'||!/^[a-f0-9]{64}$/.test(b.source_hash)||!timestamp(b.created_at)||!['applied','undone'].includes(b.status)||!Array.isArray(b.record_ids)||!b.record_ids.length||b.record_ids.length>10000||new Set(b.record_ids).size!==b.record_ids.length||!b.record_ids.every(id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:\-]{0,127}$/.test(id))||!Array.isArray(b.record_hashes)||b.record_hashes.length!==b.record_ids.length||!b.record_hashes.every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h))||(b.status==='applied'?b.undone_at!==null:!timestamp(b.undone_at)))return fail('CSV批次ID、日期、來源或成交指紋無效。');
  ids.add(b.id);
 }
 return {ok:true,errors:[],value:JSON.parse(JSON.stringify(imports))};
}
export async function undoCsvImport(state,id){
 const b=state.imports?.find(b=>b.id===id);if(!b||b.status!=='applied')return fail('找不到可撤銷的匯入批次。');
 const current=b.record_ids.map(id=>state.records.find(r=>r.id===id));
 if(current.some(r=>!r)||(await Promise.all(current.map(hash))).some((h,i)=>h!==b.record_hashes[i]))return fail('本批成交已修改或移除，請回查歷史；這次沒有刪除。');
 if(state.reviews.some(r=>b.record_ids.includes(r.record_id)))return fail('本批成交已有決策回顧，請保留原紀錄並逐筆處理。');
 const records=state.records.filter(r=>!b.record_ids.includes(r.id)),checked=validateLedger(records,state.quotes,state.finance?splitEvents(state.finance):[]);
 if(!checked.ok)return fail('撤銷會使後續交易無效：'+checked.errors.map(e=>e.message).join('；'));
 return {ok:true,errors:[],state:{...state,records:checked.value.records,imports:state.imports.map(item=>item.id===id?{...item,status:'undone',undone_at:new Date().toISOString()}:item)}};
}
export function exportTradesCsv(records){
 const safe=value=>{const s=String(value??'');return (/^'/.test(s)||/^\s*[=+\-@\t\r]/.test(s))?"'"+s:s;};
 const cell=value=>'"'+safe(value).replaceAll('"','""')+'"';
 return '\uFEFF'+csvFields.map(cell).join(',')+'\r\n'+records.map(r=>csvFields.map(k=>cell(k==='source_links'?JSON.stringify(r[k]):r[k])).join(',')).join('\r\n')+'\r\n';
}
