const NAME='investment-research-private-v1'
let opened
function database(){if(!opened)opened=new Promise((resolve,reject)=>{const req=indexedDB.open(NAME,1);req.onupgradeneeded=()=>{const db=req.result;db.createObjectStore('runs',{keyPath:'id'});db.createObjectStore('snapshots',{keyPath:'id'});const decisions=db.createObjectStore('decisions',{keyPath:'id'});decisions.createIndex('run_id','run_id')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(new Error('瀏覽器儲存不可用，未能保存研究'))});return opened}
async function operation(store,mode,fn){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let value;tx.oncomplete=()=>resolve(value);tx.onerror=()=>reject(new Error('瀏覽器儲存失敗，資料未能保存'));tx.onabort=()=>reject(new Error('瀏覽器儲存未完成'));const req=fn(tx.objectStore(store));req.onsuccess=()=>{value=req.result}})}
export const getRecord=(store,id)=>operation(store,'readonly',s=>s.get(id))
export const allRecords=store=>operation(store,'readonly',s=>s.getAll())
export const putRecord=(store,value)=>operation(store,'readwrite',s=>s.put(value))
export const addRecord=(store,value)=>operation(store,'readwrite',s=>s.add(value))
export async function saveDecision(runId,body){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction('decisions','readwrite'),store=tx.objectStore('decisions');let saved,conflict=false
 tx.oncomplete=()=>resolve(saved);tx.onerror=()=>reject(new Error('判斷未能保存，請檢查瀏覽器儲存'));tx.onabort=()=>{const e=new Error(conflict?'已有其他判斷版本保存':'判斷未能保存');if(conflict)e.status=409;reject(e)}
 const request=store.index('run_id').getAll(runId);request.onsuccess=()=>{const latest=Math.max(0,...request.result.map(d=>d.revision));if(latest!==body.expected_revision){conflict=true;tx.abort();return}
 saved={id:'decision_'+crypto.randomUUID(),run_id:runId,revision:latest+1,text:body.text.trim(),created_at:new Date().toISOString(),details:structuredClone(body.details)};store.add(saved)}
})}
export async function exportBackup(){return {format:'investment-research-device-backup-v1',exported_at:new Date().toISOString(),runs:await allRecords('runs'),snapshots:await allRecords('snapshots'),decisions:await allRecords('decisions')}}
