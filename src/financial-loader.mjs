import {validateFinancialBundle} from './financial-research.mjs';

const INDEX='/data/financial-research/index.json';
const filePattern=/^\/data\/financial-research\/[A-Za-z0-9_.-]+\.json$/;
const hashPattern=/^[a-f0-9]{64}$/;
const failure=(message,status,code,receipt)=>Object.assign(new Error(message),{status,code,receipt});
const sha256=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');

export function createFinancialLoader({fetcher=globalThis.fetch,timeoutMs=15000,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms)),clock=()=>new Date().toISOString()}={}){
 const lastValid=new Map();
 async function read(file,signal,receipt){
  for(let attempt=0;attempt<3;attempt++){
   if(signal?.aborted)throw failure('已取消載入。',undefined,'cancelled',receipt);
   const controller=new AbortController();let timedOut=false;
   const cancel=()=>controller.abort(signal.reason);
   signal?.addEventListener('abort',cancel,{once:true});
   const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
   try{
    const response=await fetcher(file,{signal:controller.signal,cache:'no-cache'});
    receipt.attempts.push({file,attempt:attempt+1,status:response.status,at:clock()});
    if(response.ok)return await response.text();
    if(response.status>=500&&attempt<2){await delay(150*(attempt+1));continue;}
    const code=response.status===401?'auth_required':response.status===403?'access_denied':response.status===404?'not_available':response.status===429?'rate_limited':'source_error';
    const messages={auth_required:'請登入後閱讀財報與法說。',access_denied:'目前沒有存取此資料的權限。',not_available:'此公司尚無已匯入的財報與法說資料。',rate_limited:'來源暫時限制請求，請稍後再試。',source_error:'財報與法說資料暫時無法載入。'};
    if(response.status===429)receipt.retry_after=response.headers?.get('retry-after')||null;
    throw failure(messages[code],response.status,code,receipt);
   }catch(error){
    if(signal?.aborted)throw failure('已取消載入。',undefined,'cancelled',receipt);
    if(timedOut)throw failure('載入逾時，尚未取得完整資料。',undefined,'timeout',receipt);
    if(error.code)throw error;
    receipt.attempts.push({file,attempt:attempt+1,status:null,error:'network',at:clock()});
    if(attempt===2)throw failure('網路中斷，尚未取得完整資料。',undefined,'network',receipt);
    await delay(150*(attempt+1));
   }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
  }
 }
 async function load(company,{signal}={}){
  const receipt={company_id:company,started_at:clock(),status:'loading',attempts:[]};
  try{
   if(typeof company!=='string'||!company||company.length>128)throw failure('公司身份無效。',400,'invalid_company',receipt);
   let index;try{index=JSON.parse(await read(INDEX,signal,receipt));}catch(error){if(error.code)throw error;throw failure('資料索引格式無效，保留原本有效版本。',409,'invalid_manifest',receipt);}
   if(index.schema_version!=='financial-research-index/1'||!Array.isArray(index.entries||index.companies))throw failure('資料索引版本無效，保留原本有效版本。',409,'invalid_manifest',receipt);
   const entries=(index.entries||index.companies).map(entry=>({...entry,file:entry.file||(typeof entry.path==='string'&&/^[A-Za-z0-9_.-]+\.json$/.test(entry.path)?'/data/financial-research/'+entry.path:null)})).filter(entry=>entry.company_id===company);
   if(!entries.length)throw failure('此公司尚無已匯入的財報與法說資料。',404,'not_available',receipt);
   if(entries.length!==1)throw failure('資料索引有重複公司，保留原本有效版本。',409,'invalid_manifest',receipt);
   const entry=entries[0];
   if(!filePattern.test(entry.file)||!hashPattern.test(entry.sha256))throw failure('資料路徑或版本未登錄。',409,'invalid_manifest',receipt);
   const raw=await read(entry.file,signal,receipt),hash=await sha256(raw);
   if(signal?.aborted)throw failure('已取消載入。',undefined,'cancelled',receipt);
   if(hash!==entry.sha256)throw failure('索引與資料版本不同，保留原本有效版本。',409,'hash_mismatch',receipt);
   let bundle;try{bundle=JSON.parse(raw);}catch{throw failure('財報資料格式無效，保留原本有效版本。',409,'invalid_bundle',receipt);}
   let checked;try{checked=validateFinancialBundle(bundle);}catch{throw failure('財報資料契約無效，保留原本有效版本。',409,'invalid_bundle',receipt);}
   if(!(checked.ok??checked.valid)||bundle.company?.company_id!==company||entry.run_id&&entry.run_id!==bundle.run?.run_id||entry.as_of&&entry.as_of!==bundle.run?.as_of)throw failure('公司或研究版本不一致，保留原本有效版本。',409,'invalid_bundle',receipt);
   receipt.status='loaded';receipt.completed_at=clock();receipt.bundle_sha256=hash;
   const result={...bundle,bundle_sha256:hash,_manifest:{...entry},_load_receipt:receipt};lastValid.set(company,result);return result;
  }catch(error){receipt.status=error.code==='cancelled'?'cancelled':error.status===401||error.status===403?'blocked':'partial';receipt.completed_at=clock();error.receipt=receipt;throw error;}
 }
 return {load,lastValid:company=>lastValid.get(company)||null};
}
