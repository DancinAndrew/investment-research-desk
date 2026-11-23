export async function loadLedger(){return request()}
export async function loadLedgerVersion(revision){return request(undefined,'?revision='+revision)}
export async function saveLedger(revision,state,scope,options={}){return request({expected_revision:revision,expected_owner_scope:scope,state,...options})}
async function request(body,query=''){const response=await fetch('/api/ledger'+query,{method:body?'PUT':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined,cache:'no-store'});let data;try{data=await response.json()}catch{throw new Error('私人儲存暫時無法使用。請重試。')}if(!response.ok){const error=new Error(data.error||'帳本未能儲存');error.status=response.status;error.code=data.code;error.fields=data.fields;throw error}return data}
