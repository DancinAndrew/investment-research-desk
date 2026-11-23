import {onMounted,onUnmounted,ref} from 'vue';
import {loadLedger,saveLedger} from './ledger-store.js';
import {validateState} from '../worker/index.mjs';
import {digest,copy,confirmsSavedChange} from './decision-workspace.mjs';
const empty=()=>({schema_version:1,records:[],quotes:[],reviews:[]});
export function usePrivateState(){
 const state=ref(empty()),loaded=ref(false),loading=ref(false),busy=ref(false),error=ref(''),message=ref(''),revision=ref(0),scope=ref(''),storage=ref(''),history=ref([]),authRequired=ref(false),saveStatus=ref('idle'),fields=ref([]);
 let sequence=0,pending=false,alive=true,draftBase=null;
 const context=()=>({expectedRevision:revision.value,expectedScope:scope.value});
 const beginEdit=()=>{draftBase||=context();return draftBase;};
 const resetBase=()=>{draftBase=null;};
 const discard=()=>{sequence++;loading.value=false;state.value=empty();loaded.value=false;scope.value='';revision.value=0;history.value=[];message.value='';draftBase=null;fields.value=[];};
 const fail=e=>{if(e.status===401||e.code==='identity_changed'){discard();saveStatus.value='auth_lost';}else saveStatus.value=e.status===409?'conflict':e.status?'failed':'result_unknown';error.value=e.message;fields.value=e.fields||[];authRequired.value=e.status===401;};
 async function load(){
  if(busy.value){pending=true;return;}
  const current=++sequence,previous=scope.value;loading.value=true;error.value='';authRequired.value=false;
  try{const data=await loadLedger();if(!alive||current!==sequence)return;if(previous&&previous!==data.owner_scope)discard();state.value=data.state;scope.value=data.owner_scope;storage.value=data.storage;revision.value=data.revision;history.value=data.history||[];loaded.value=true;return true;}
  catch(e){if(alive&&current===sequence){if(e.status===401||e.code==='identity_changed')discard();fail(e);}return false;}
  finally{if(alive&&current===sequence)loading.value=false;}
 }
 async function recheckDraft(){const expected=scope.value;if(await load()&&loaded.value&&scope.value===expected){draftBase=context();message.value='已載入最新資料。原草稿保留，請核對後再次明確保存。';return true;}return false;}
 async function save(candidate,success,base=draftBase||context(),options={}){
  if(busy.value||!loaded.value||!scope.value)return false;
  if(base.expectedRevision!==revision.value||base.expectedScope!==scope.value){error.value='其他分頁已更新資料。請載入最新後重新核對；草稿仍留在此分頁。';saveStatus.value='conflict';return false;}
  const checked=validateState(JSON.parse(JSON.stringify(candidate)));
  if(!checked.ok){fields.value=checked.errors;error.value=checked.errors.map(e=>e.message).join('；');saveStatus.value='invalid';return false;}
  busy.value=true;error.value='';message.value='';saveStatus.value='saving';const expected=scope.value,current=sequence,before=copy(state.value);
  const accept=async result=>{if(!alive||current!==sequence||scope.value!==expected)return false;if(result.owner_scope!==expected){discard();error.value='登入身份已改變，請重新載入。';saveStatus.value='auth_lost';return false;}state.value=result.state;revision.value=result.revision;history.value=result.history||history.value;message.value=success;error.value='';fields.value=[];saveStatus.value='saved';draftBase=null;window.dispatchEvent(new Event('private-state-saved'));return true;};
  try{const result=await saveLedger(base.expectedRevision,checked.value,base.expectedScope,options);return await accept(result);}
  catch(e){if(!alive||current!==sequence||scope.value!==expected)return false;
   if(!e.status||e.status===409&&e.code!=='identity_changed'){saveStatus.value='result_unknown';error.value='保存結果待確認，正在讀回核對。';try{const latest=await loadLedger();if(!alive||current!==sequence||scope.value!==expected)return false;if(latest.owner_scope!==expected){discard();return false;}if(confirmsSavedChange(before,checked.value,latest.state))return await accept(latest);state.value=latest.state;revision.value=latest.revision;history.value=latest.history||[];saveStatus.value=e.status===409?'conflict':'result_unknown';error.value=e.status===409?'其他分頁已更新資料。請載入最新後重新核對；草稿仍留在此分頁。':'尚未確認保存。請載入最新後重新核對，再保存原草稿。';}catch(readError){if(!alive||current!==sequence||scope.value!==expected)return false;if(readError.status===401||readError.code==='identity_changed')fail(readError);else error.value='保存結果待確認，請先重新載入並核對，避免重複新增。';}return false;}
   fail(e);return false;
  }finally{busy.value=false;if(pending&&alive){pending=false;load();}}
 }
 onMounted(()=>{window.addEventListener('focus',load);window.addEventListener('private-state-saved',load);load();});
 onUnmounted(()=>{alive=false;sequence++;discard();window.removeEventListener('focus',load);window.removeEventListener('private-state-saved',load);});
 return {state,loaded,loading,busy,error,message,revision,scope,storage,history,authRequired,load,save,context,beginEdit,resetBase,recheckDraft,saveStatus,fields};
}
