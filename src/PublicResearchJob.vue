<template>
<section class="public-job" aria-label="新研究狀態">
  <p v-if="!capability && !error" role="status">正在讀取可用研究功能…</p>
  <template v-if="supported">
    <h2>NVDA 公開材料研究</h2>
    <p>以已保存的公開資料快照，在本機執行固定規則分析；本次不使用模型。</p>
    <p class="muted">資料截至 {{ capability.information_as_of || '未標示' }}。執行日期與資料截至日期分開記錄。</p>
    <details><summary>研究範圍與來源紀錄</summary><p>{{ capability.company }} · {{ capability.timeout_seconds }} 秒執行期限。</p><p>來源內容指紋：{{ capability.source_sha256 }}</p><a v-if="safeUrl(capability.source_url)" :href="safeUrl(capability.source_url)" target="_blank" rel="noopener noreferrer">公開來源</a><pre>{{ pretty(capability) }}</pre></details>
    <button class="primary" :disabled="busy || unresolved" @click="start">{{ busy?'研究進行中…':'開始研究' }}</button>
  </template>
  <div v-else-if="capability" class="empty-state"><p>{{ capability.configured?'目前僅支援 '+capability.company+' 的固定公開材料研究。':(capability.reason || '目前未設定新研究功能。') }}</p><p>可返回公司列表閱讀已完成報告。</p></div>
  <p v-if="error" role="alert">{{ error }} <button @click="refresh">重新讀取狀態</button></p>
  <section v-if="job" class="job-progress" aria-live="polite">
    <h2>{{ statusText }}</h2>
    <p v-if="job.status==='accepted'">尚未獨立語義覆核；此狀態只表示固定規則檢查通過。</p>
    <p v-if="job.failure_reason">{{ job.failure_reason }}</p>
    <p>資料截至 {{ job.information_as_of || capability?.information_as_of || '未標示' }} · 執行日期 {{ job.created_at?.slice(0,10) || '等待伺服器確認' }}</p>
    <p v-if="busy">保留此頁或稍後回到同一網址查看。</p>
    <ol v-if="stageRows.length" class="stage-trace" aria-label="十一階段研究進度"><li v-for="(step,index) in stageRows" :key="step.stage || index"><strong>{{ index+1 }}. {{ stageName(step,index) }}</strong><span>{{ stepStatus(step.status) }}</span><p v-if="step.failure_reason || step.reason">{{ step.failure_reason || step.reason }}</p><p v-if="step.output?.consequence">{{ step.output.consequence }}</p><p v-if="step.output?.reason || step.output?.limitation">{{ step.output.reason || step.output.limitation }}</p><ul v-if="step.output?.limitations?.length"><li v-for="limit in step.output.limitations" :key="limit">{{ limit }}</li></ul><p v-if="step.started_at">開始：{{ step.started_at }}<template v-if="step.finished_at"> · 結束：{{ step.finished_at }}</template></p></li></ol>
    <p v-else>尚未收到階段紀錄。</p>
    <details v-if="job.evaluation"><summary>檢查結果與缺口</summary><pre>{{ pretty(job.evaluation) }}</pre></details>
    <details><summary>完整執行紀錄</summary><pre>{{ pretty(job) }}</pre></details>
    <button v-if="reading && job.status==='accepted'" @click="emit('open-report',reading)">閱讀報告</button>
    <button v-if="job.job_id && ['queued','running'].includes(job.status)" :disabled="cancelling" @click="cancel">{{ cancelling?'正在取消…':'取消研究' }}</button>
  </section>
</section>
</template>
<script setup>
import {computed,onUnmounted,ref,watch} from 'vue'
import {localApi} from './api'
import {safeUrl} from './workbench-model'
const props=defineProps({active:Boolean,company:{type:String,default:'NVDA'}})
const emit=defineEmits(['open-report'])
const capability=ref(null),job=ref(null),reading=ref(null),error=ref(''),posting=ref(false),cancelling=ref(false),unresolved=ref(false)
const terminal=new Set(['accepted','needs_revision','blocked','failed','cancelled','timed_out','interrupted','complete_smoke','complete_report'])
const busy=computed(()=>posting.value || Boolean(job.value && !terminal.has(job.value.status) && job.value.status!=='submission_unknown'))
const supported=computed(()=>capability.value?.configured && capability.value?.supported!==false && props.company.trim().toUpperCase()===capability.value.company?.toUpperCase())
const statusText=computed(()=>({submitting:'正在提交研究…',submission_unknown:'提交狀態尚待確認',queued:'等待執行',running:'正在分析公開資料…',accepted:'規則檢查通過',needs_revision:'研究需要修訂',blocked:'研究缺少必要資料',failed:'研究執行失敗',cancelled:'研究已取消',timed_out:'研究超時',interrupted:'研究已中斷',complete_report:'舊版研究已完成',complete_smoke:'舊版來源核對已完成'}[job.value?.status] || '正在讀取研究狀態…'))
const stageNames=['確認研究問題','整理公開來源','分析新聞與產業','分析財務基本面','計算估值情境','檢查籌碼資料','檢查技術資料','檢查財務健康','彙整風險','編寫研究報告','驗收研究結果']
const stageRows=computed(()=>job.value ? stageNames.map((_,index)=>job.value.stage_trace?.[index] || {status:'unreported'}) : [])
const stageName=(step,index)=>step.label_zh || step.name_zh || stageNames[index] || '研究階段'
const stepStatus=status=>({unreported:'尚未回報',checked:'已完成檢查',limits_identified:'已記錄限制',conditional_sensitivity:'條件情境已計算',supported:'研究範圍確認',retrieved:'來源已整理',analyzed:'分析已完成',not_evaluable:'缺少資料，無法評估',out_of_scope:'超出研究範圍',pending:'尚未執行',queued:'等待執行',running:'執行中',completed:'已完成',complete:'已完成',passed:'檢查通過',accepted:'檢查通過',blocked:'缺少資料',failed:'執行失敗',skipped:'未執行',cancelled:'已取消',needs_revision:'需要修訂'}[status] || '狀態未標示')
const pretty=value=>JSON.stringify(value,null,2)
let generation=0,timer,controller
function stop(){generation++;clearTimeout(timer);controller?.abort();posting.value=false;cancelling.value=false}
function current(serial){return serial===generation && props.active}
function setUrl(id,request){if(!props.active)return;const p=new URLSearchParams(location.search);if(id)p.set('job',id);else p.delete('job');if(request)p.set('request',request);else p.delete('request');history.replaceState(history.state,'',location.pathname+'?'+p)}
function validateCompany(data){if(data.company && data.company.toUpperCase()!==props.company.trim().toUpperCase())throw new Error('此研究紀錄屬於其他公司，請返回該公司查看。')}
async function poll(id,serial){
  if(!current(serial))return
  try{const data=await localApi('research-jobs/'+encodeURIComponent(id),undefined,{signal:controller.signal});if(!current(serial))return;validateCompany(data);job.value=data
    if(data.status==='accepted'){const result=await localApi('research-jobs/'+encodeURIComponent(id)+'/reading',undefined,{signal:controller.signal});if(current(serial)){validateCompany(result);reading.value=result}}
    else if(!terminal.has(data.status))timer=setTimeout(()=>poll(id,serial),500)
  }catch(e){if(current(serial) && e.name!=='AbortError')error.value='研究狀態讀取失敗：'+e.message}
}
async function recover(request,serial){
  unresolved.value=true;job.value={status:'submission_unknown',request_id:request}
  try{const result=await localApi('research-jobs/requests/'+encodeURIComponent(request),undefined,{signal:controller.signal});if(!current(serial))return;validateCompany(result);if(!result.job_id)throw new Error('尚未找到伺服器執行編號。');unresolved.value=false;setUrl(result.job_id,request);await poll(result.job_id,serial)}
  catch(e){if(current(serial) && e.name!=='AbortError')error.value='提交狀態仍未知：'+e.message+'。已保留請求編號；重新讀取會查詢同一請求，不會自動重送。'}
}
async function refresh(){stop();const serial=generation;controller=new AbortController();error.value='';reading.value=null;job.value=null;capability.value=null;unresolved.value=false
  try{const data=await localApi('research-jobs/capabilities',undefined,{signal:controller.signal});if(!current(serial))return;capability.value=data
    const p=new URLSearchParams(location.search);if(!supported.value)return;if(p.get('job'))await poll(p.get('job'),serial);else if(p.get('request'))await recover(p.get('request'),serial)
  }catch(e){if(current(serial) && e.name!=='AbortError')error.value='研究功能讀取失敗：'+e.message}
}
async function start(){if(busy.value || unresolved.value || !supported.value)return;stop();const serial=generation;controller=new AbortController();posting.value=true;error.value='';reading.value=null
  const request=crypto.randomUUID();job.value={status:'submitting',request_id:request};unresolved.value=true;setUrl(null,request)
  try{const data=await localApi('research-jobs',{company:capability.value.company,question_id:capability.value.question_id,source_sha256:capability.value.source_sha256,request_id:request},{signal:controller.signal});if(!current(serial))return;validateCompany(data);if(!data.job_id)throw new Error('伺服器未回傳執行編號。');job.value=data;unresolved.value=false;setUrl(data.job_id,request);await poll(data.job_id,serial)}
  catch(e){if(current(serial) && e.name!=='AbortError'){
    if([400,403,409,413,422,429].includes(e.status)){unresolved.value=false;job.value={status:'blocked',failure_reason:e.message};setUrl(null,null);error.value='提交未受理：'+e.message+'。可重新讀取研究範圍後再提交。'}
    else{job.value={status:'submission_unknown',request_id:request};error.value='提交狀態未知：'+e.message+'。請重新讀取同一請求；不會自動重送。'}
  }}finally{if(current(serial))posting.value=false}
}
async function cancel(){if(!job.value?.job_id || cancelling.value)return;const id=job.value.job_id,serial=generation;cancelling.value=true;error.value='';clearTimeout(timer)
  try{await localApi('research-jobs/'+encodeURIComponent(id)+'/cancel',{}, {signal:controller.signal});if(current(serial))await poll(id,serial)}catch(e){if(current(serial) && e.name!=='AbortError')error.value='取消狀態尚待確認：'+e.message}finally{if(current(serial))cancelling.value=false}
}
watch(()=>[props.active,props.company.trim().toUpperCase()],(value,previous)=>{if(previous && value[1]!==previous[1])setUrl(null,null);if(value[0])refresh();else{stop();capability.value=null;job.value=null;reading.value=null;unresolved.value=false}},{immediate:true})
onUnmounted(stop)
</script>
<style scoped>
.public-job{max-width:760px;overflow-wrap:anywhere}.public-job details{margin:16px 0}.public-job summary{min-height:44px;align-content:center;cursor:pointer}.public-job pre{max-width:100%;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.job-progress{margin-top:24px;border-top:1px solid var(--research-border);padding-top:16px}.stage-trace{padding-left:24px}.stage-trace li{padding:10px 0;border-bottom:1px solid var(--research-border)}.stage-trace li>span{display:block;color:var(--research-muted);font-size:14px}.stage-trace p{font-size:13px;margin:6px 0}.public-job button{min-height:44px;margin:8px 8px 8px 0}
</style>
