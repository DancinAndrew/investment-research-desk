<template>
<section class="canonical-desk continuity-page">
 <div class="page-heading"><h1>比較研究</h1></div><p>用同一組問題看不同公司或歷史版本，回查每格的原判斷與依據。</p>
 <PrivateStateStatus :loading="loading" :loaded="loaded" :error="error" :message="message" :storage="storage" :auth-required="authRequired" reload-label="載入最新後重新核對" @reload="recheckDraft"/>
 <form @focusin="beginEdit" @input="beginEdit" @submit.prevent="saveComparison" class="comparison-controls">
  <div class="form-grid"><label v-for="(selected,i) in selectedReports" :key="i">研究 {{ i+1 }}<select v-model="selectedReports[i]" @change="updateUrl(true)"><option v-for="(r,id) in reportRegistry" :key="id" :value="id">{{ r.ticker }} · {{ r.revision }} · {{ r.created_at.slice(0,10) }}</option></select></label></div>
  <div class="button-row"><button type="button" v-if="selectedReports.length<4" @click="selectedReports.push(otherReport());updateUrl(true)">加入比較版本</button><button type="button" v-if="selectedReports.length>2" @click="selectedReports.pop();updateUrl(true)">移除最後一欄</button><button type="button" @click="useLatest">改看各公司最新版</button></div>
  <fieldset><legend>每次都要核對的問題</legend><label v-for="q in researchQuestions" :key="q.id" class="checkbox-label"><input type="checkbox" :value="q.id" v-model="questions" @change="updateUrl(true)"/>{{ q.label }}</label></fieldset>
  <label>保存這組比較的名稱<input v-model="name" maxlength="200" placeholder="例如 AI需求、現金與設備投入"/></label><button class="primary" :disabled="!loaded||busy||!canCompare||!name.trim()">保存版本與問題</button>
 <button type="button" @click="name='';resetBase()">取消未保存名稱</button></form>
 <p v-if="!canCompare" class="canonical-alert" role="alert">請選2至4個不同的已登錄版本，以及至少一個問題。</p>
 <template v-else>
 <p class="muted">版本整理日與財務期分列。同一公司改版可能仍用同一季資料；兩公司的財政季度和現金口徑不同，不直接排名或相加。</p>
 <div class="table-scroll comparison-table"><table><thead><tr><th>固定問題</th><th v-for="id in selectedReports" :key="id"><strong>{{ reportRegistry[id].ticker }} · {{ reportRegistry[id].revision }}</strong><p>整理 {{ reportRegistry[id].created_at.slice(0,10) }}</p><p>{{ reportRegistry[id].financial_period || '財務期未登錄，請讀原版口徑' }}</p><a :href="reportUrl(id)">閱讀這份完整研究</a></th></tr></thead>
 <tbody><tr v-for="row in cells" :key="row.id"><th>{{ row.label }}</th><td v-for="cell in row.cells" :key="cell.report_id"><p v-if="!cell.claims.length" class="muted">這個歷史版本尚未建立此題目的主張對照；請查看原版研究。</p><article v-for="claim in cell.claims" :key="claim.id"><p>{{ claim.text }}</p><p v-if="claim.falsifier" class="muted">限制／反證：{{ claim.falsifier }}</p><ul v-if="claim.conditions.length"><li v-for="condition in distinctConditions(claim)" :key="condition">{{ condition }}</li></ul><details v-if="cell.traces.some(r=>r.claim_id===claim.id)"><summary>這個判斷的依據與正文位置</summary><SourceTrace :rows="cell.traces.filter(r=>r.claim_id===claim.id)"/></details><a v-else-if="claim.origin_ref?.artifact_id" :href="artifactUrl(cell.report_id,claim.origin_ref.artifact_id)">原版來源索引（尚無逐項定位）</a></article></td></tr></tbody></table></div>
 </template>
 <h2>保存的比較</h2><p v-if="loaded&&!saved.length" class="empty-state">尚未保存比較。先選版本和問題，再為這組比較命名。</p>
 <article v-for="c in saved" :key="c.id" class="decision-card"><h3>{{ c.name }}</h3><p>{{ c.reports.map(r=>reportRegistry[r.report_id].ticker+' '+reportRegistry[r.report_id].revision).join(' ／ ') }} · {{ c.questions.length }}個問題</p><div class="button-row"><button @click="openSaved(c)">開啟這組比較</button><button :disabled="busy" @click="removeSaved(c)">移除比較設定</button></div></article>
</section>
</template>
<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue';
import {reportRegistry} from './report-registry.mjs';
import {comparisonCells,emptyResearch,latestReport,reportPin,researchQuestions} from './research-continuity.mjs';
import {usePrivateState} from './private-state.js';
import PrivateStateStatus from './PrivateStateStatus.vue';
import SourceTrace from './SourceTrace.vue';
const {state,loaded,loading,busy,error,message,storage,authRequired,scope,load,save,beginEdit,resetBase,recheckDraft,context}=usePrivateState();
const selectedReports=ref([]),questions=ref([]),name=ref('');
watch(scope,(current,previous)=>{if(previous&&current!==previous)name.value='';});
const research=computed(()=>state.value.research||emptyResearch());
const saved=computed(()=>[...research.value.comparisons].reverse());
const canCompare=computed(()=>selectedReports.value.length>=2&&selectedReports.value.length<=4&&new Set(selectedReports.value).size===selectedReports.value.length&&selectedReports.value.every(id=>Object.hasOwn(reportRegistry,id))&&questions.value.length>0);
const cells=computed(()=>canCompare.value?comparisonCells(selectedReports.value,questions.value):[]);
const reportUrl=id=>'?workspace=company&bundle='+encodeURIComponent(id)+'&researchTab=report';
const artifactUrl=(id,artifact)=>'?workspace=company&bundle='+encodeURIComponent(id)+'&researchTab=artifact&artifact='+encodeURIComponent(artifact);
const distinctConditions=c=>c.conditions.filter(text=>text!==c.falsifier);
function readUrl(){const p=new URLSearchParams(location.search);selectedReports.value=p.has('compareReports')?p.get('compareReports').split(',').slice(0,4):[latestReport('NVDA'),latestReport('AMZN')];questions.value=p.has('questions')?p.get('questions').split(',').filter(id=>researchQuestions.some(q=>q.id===id)):['business','cash','capital'];name.value=p.get('comparisonName')||'';}
function updateUrl(push=false){const p=new URLSearchParams({workspace:'compare',compareReports:selectedReports.value.join(','),questions:questions.value.join(',')});if(name.value)p.set('comparisonName',name.value);history[push?'pushState':'replaceState'](history.state,'','?'+p);}
function otherReport(){return Object.keys(reportRegistry).reverse().find(id=>!selectedReports.value.includes(id))||'';}
function useLatest(){const ids=[...new Set(selectedReports.value.filter(id=>reportRegistry[id]).map(id=>latestReport(reportRegistry[id].ticker)))];if(ids.length<2){message.value='同公司最新版只有一份；要比較前後版本，請保留另一個歷史版本。';return;}selectedReports.value=ids;updateUrl(true);}
async function saveComparison(){if(!canCompare.value)return;const c={id:crypto.randomUUID(),name:name.value.trim(),reports:selectedReports.value.map(reportPin),questions:[...questions.value],created_at:new Date().toISOString()};await save({...state.value,research:{...research.value,comparisons:[...research.value.comparisons,c]}},'比較設定已保存；各格仍綁定所選原版。');}
function openSaved(c){resetBase();beginEdit();selectedReports.value=c.reports.map(r=>r.report_id);questions.value=[...c.questions];name.value=c.name;updateUrl(true);window.scrollTo({top:0,behavior:'instant'});}
async function removeSaved(c){await save({...state.value,research:{...research.value,comparisons:research.value.comparisons.filter(r=>r.id!==c.id)}},'比較設定已移除；原始報告不變，舊設定仍可在私人資料歷史中回查。',context());}
function pop(){if(new URLSearchParams(location.search).get('workspace')==='compare')readUrl();}
readUrl();onMounted(()=>window.addEventListener('popstate',pop));onUnmounted(()=>window.removeEventListener('popstate',pop));
</script>
