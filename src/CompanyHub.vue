<template>
 <section class="company-overview" aria-label="公司概覽">
  <template v-if="showFinancial"><a :href="overviewUrl" @click.prevent="closeFinancial" class="back-link">返回公司概覽</a><FinancialResearch :company="company" :latest="latest" :active="active" @read="$emit('read',$event)"><template #cycle="{bundle}"><ResearchCycle :company="company" :bundle="bundle" :active="active"/></template></FinancialResearch></template>
  <template v-else>
  <p v-if="loading" role="status">正在載入公司概覽…</p>
  <p v-if="error" role="alert" class="canonical-alert">{{ error }} <button @click="load">重試</button></p>
  <template v-if="hub">
   <a v-if="showViews" :href="overviewUrl" @click.prevent="closeViews" class="back-link">返回公司概覽</a>
   <template v-if="!showViews">
   <div class="company-thesis"><h2>{{ hub.judgment }}</h2><p>{{ hub.business }}</p><p class="company-dates">資料截至 {{ hub.information_as_of || '原稿未提供一致截止日' }} · 整理更新 {{ hub.research_updated_at || '尚未完成' }}</p><a v-if="latest" :href="reportUrl(latest.bundle_id)" @click.prevent="$emit('read',latest.bundle_id)" class="primary reading-action">閱讀完整研究 →</a></div>
   <div class="company-followup"><h2>接下來看什麼</h2><p>{{ hub.watch }}</p><p class="muted">{{ hub.research_status }}</p></div>
   <nav class="company-context-links" aria-label="公司相關資料"><a :href="financialUrl" @click.prevent="openFinancial">財報與法說</a><a v-if="hub.relations_available" :href="'?workspace=relations&center='+encodeURIComponent(company)+'&category=all'">公司關係</a><button v-if="hub.ticker" @click="$emit('open-x',hub.ticker)">X 線索與原文</button><a v-if="hub.viewpoint_file" :href="viewpointUrl" @click.prevent="openViews">第三方觀點</a></nav>
   </template>
   <section v-if="showViews" class="company-viewpoints"><h2>第三方觀點</h2><p class="muted">此處搜尋本公司相關觀點的轉述與來源標題。同段提及多家公司時，各公司扮演的角色不同。作者依據、整理者反證及報告採用情況分別列出；原文數字與技術主張仍需核一手資料。</p><details class="viewpoint-glossary"><summary>常見財務縮寫</summary><p>FCF：營運現金扣除公司定義的設備等支出後留下的自由現金流。CapEx：購置或建設長期資產的投入。EBITDA：利息、稅與折舊等項目前的利潤，仍需負擔設備與融資。RPO：已簽約、尚未認列的收入義務，不保證全部收到現金。SBC：以股票給員工的報酬，仍有經濟成本。DSO：平均收款天數。CFO在財務表常指營業現金流，職稱則指財務長。</p></details><p v-if="viewsLoading" role="status">正在載入觀點…</p><p v-if="viewsError" role="alert">{{ viewsError }} <button @click="loadViews">重試</button></p><label v-if="views.length" class="viewpoint-search">搜尋觀點或來源<input v-model="viewQuery" @input="updateViewQuery" type="search" placeholder="例如：現金、晶片、雲端"/></label><div v-if="views.length" class="viewpoint-role-select"><label>依公司角色篩選<select v-model="roleFilter" @change="updateViewQuery"><option value="">全部角色</option><option v-for="role in roleOptions" :key="role.id" :value="role.id">{{ role.label }}（{{ views.filter(v=>v.company_role?.role===role.id).length }}）</option></select></label></div><p v-if="views.length" class="role-summary">公司角色按觀點文字判讀；分類數不代表已核證或被報告採用的數量。</p><p v-if="views.length" role="status">顯示 {{ filteredViews.length }} / {{ views.length }} 則觀點</p><ViewpointCard v-for="v in filteredViews" :key="v.id" :view="v" :traces="sourceTraces(v.source_id)"/><p v-if="views.length && !filteredViews.length">沒有符合這個搜尋的觀點。</p><p v-if="!viewsLoading && !views.length && !viewsError">尚無已整理的第三方觀點。</p></section>
  </template>
  <template v-else-if="!loading && !error"><p>此公司的概覽尚未整理，可閱讀下方已有研究。</p><a :href="financialUrl" @click.prevent="openFinancial">財報與法說</a></template>
  <CompanyLedgerSummary v-if="hub?.ticker && !showViews" :ticker="hub.ticker" :active="active"/>
  </template>
 </section>
</template>
<script setup>
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue'
import FinancialResearch from './FinancialResearch.vue'
import ResearchCycle from './ResearchCycle.vue'
import CompanyLedgerSummary from './CompanyLedgerSummary.vue'
import {companyHubs,companyViewpoints,researchTraceability} from './api.js'
import {viewpointState,viewpointAnchor} from './company-model.mjs'
import ViewpointCard from './ViewpointCard.vue'
const trace=ref(null)
const props=defineProps({company:String,latest:Object,active:Boolean})
defineEmits(['read','open-x'])
const hubs=ref(null),loading=ref(false),error=ref(''),views=ref([]),viewsLoading=ref(false),viewsError=ref(''),showViews=ref(false),showFinancial=ref(false)
let sequence=0
const hub=computed(()=>hubs.value?.companies.find(c=>c.company_id===props.company))
const viewQuery=ref(''),roleFilter=ref('')
const roleOptions=[{id:'direct_subject',label:'本公司為研究主體'},{id:'supply_chain_context',label:'供應鏈或客戶背景'},{id:'competitor_context',label:'競爭比較背景'},{id:'co_mentioned',label:'同段提及'},{id:'unresolved',label:'關聯待核'}]
const filteredViews=computed(()=>{const q=viewQuery.value.trim().toLocaleLowerCase();return views.value.filter(v=>(!roleFilter.value||v.company_role?.role===roleFilter.value)&&(!q||[v.source_title,v.author_view,v.support,v.falsifier].join(' ').toLocaleLowerCase().includes(q)))})
const viewpointUrl=computed(()=>{const p=new URLSearchParams({workspace:'company',company:props.company,companyTab:'viewpoints'});const list=new URLSearchParams(location.search);for(const key of ['companySearch','companyIndustry','companyMarket','companyFavorites'])if(list.get(key))p.set(key,list.get(key));if(viewQuery.value.trim())p.set('viewpointSearch',viewQuery.value);if(roleFilter.value)p.set('viewpointRole',roleFilter.value);return '?'+p.toString()})
const overviewUrl=computed(()=>{const p=new URLSearchParams({workspace:'company',company:props.company});const list=new URLSearchParams(location.search);for(const key of ['companySearch','companyIndustry','companyMarket','companyFavorites'])if(list.get(key))p.set(key,list.get(key));return '?'+p})
const financialUrl=computed(()=>{const p=new URLSearchParams(overviewUrl.value.slice(1));p.set('companyTab','financials');p.set('financialView','financials');return '?'+p});
function openFinancial(){if(!window.dispatchEvent(new Event('workspace-leave',{cancelable:true})))return;history.pushState(history.state,'',financialUrl.value);showViews.value=false;showFinancial.value=true;}
function closeFinancial(){if(!window.dispatchEvent(new Event('workspace-leave',{cancelable:true})))return;history.pushState(history.state,'',overviewUrl.value);showFinancial.value=false;}
function closeViews(){showViews.value=false;viewQuery.value='';roleFilter.value='';history.pushState(history.state,'',overviewUrl.value)}
function sourceTraces(id){return (trace.value?.rows||[]).filter(r=>r.source_id===id&&r.bundle_id===props.latest?.bundle_id)}
const reportUrl=id=>'?workspace=company&bundle='+encodeURIComponent(id)+'&researchTab=report'
async function load(){loading.value=true;error.value='';try{hubs.value=await companyHubs();sync()}catch(e){error.value=e.message}finally{loading.value=false}}
async function loadViews(){const n=++sequence;views.value=[];viewsError.value='';if(!hub.value?.viewpoint_file)return;viewsLoading.value=true;try{const [d,t]=await Promise.all([companyViewpoints(hub.value.viewpoint_file),researchTraceability()]);if(n===sequence){views.value=d.views||[];trace.value=t;await nextTick();const id=new URLSearchParams(location.search).get('viewpoint');if(id){const card=document.getElementById(viewpointAnchor(id));card?.scrollIntoView({block:'start'});card?.focus({preventScroll:true})}}}catch(e){if(n===sequence)viewsError.value=e.message}finally{if(n===sequence)viewsLoading.value=false}}
function sync(){if(!props.active)return;const p=new URLSearchParams(location.search);showFinancial.value=p.get('company')===props.company&&p.get('companyTab')==='financials';const state=viewpointState(location.search,props.company);showViews.value=state.open;viewQuery.value=state.query;const role=new URLSearchParams(location.search).get('viewpointRole');roleFilter.value=state.open&&roleOptions.some(r=>r.id===role)?role:'';if(showViews.value)loadViews()}
function updateViewQuery(){if(!props.active)return;history.replaceState(history.state,'',location.pathname+viewpointUrl.value)}
function openViews(){history.pushState(history.state,'',viewpointUrl.value);showViews.value=true;loadViews()}
watch([()=>props.company,()=>props.active],()=>{sequence++;views.value=[];viewQuery.value='';roleFilter.value='';viewsLoading.value=false;showViews.value=false;showFinancial.value=false;if(props.active)sync()})
onMounted(()=>{load();window.addEventListener('popstate',sync)})
onUnmounted(()=>{sequence++;window.removeEventListener('popstate',sync)})
</script>
