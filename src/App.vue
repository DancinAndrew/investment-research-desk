<template>
<main class="app-shell">
<a class="skip-link" href="#app-content">跳到內容</a>
<aside class="workspace-sidebar"><a href="?workspace=company" @click.prevent="navigate('company')" class="product-name">投資工作台</a><nav v-for="group in groups" :key="group.id" :aria-label="group.label+'功能'"><h2>{{ group.label }}</h2><a v-for="id in group.items" :key="id" :href="'?workspace='+id" :aria-current="workspace===id?'page':undefined" @click.prevent="navigate(id)">{{ navigation.find(i=>i.id===id).label }}</a></nav><a class="management-link" href="?workspace=management" @click.prevent="navigate('management')" :aria-current="workspace==='management'?'page':undefined">資料管理</a></aside>
<header class="mobile-header"><a href="?workspace=company" @click.prevent="navigate('company')">投資工作台</a><details><summary>更多</summary><a href="?workspace=management" @click.prevent="navigate('management')">資料管理</a></details></header>
<nav class="mobile-section-navigation" :aria-label="currentGroup.label+'功能'"><a v-for="id in currentGroup.items" :key="id" :href="'?workspace='+id" :aria-current="workspace===id?'page':undefined" @click.prevent="navigate(id)">{{ navigation.find(i=>i.id===id).label }}</a></nav>
<nav class="mobile-primary-navigation" aria-label="主要導覽"><a v-for="group in groups" :key="group.id" :href="'?workspace='+group.items[0]" :aria-current="currentGroup.id===group.id?'true':undefined" @click.prevent="navigate(group.items[0])">{{ group.label }}</a></nav>
<div id="app-content" tabindex="-1">
<CanonicalResearch v-if="companyVisited" v-show="showCompany" :active="showCompany" @return="returnSignal" @open-x="openCompanySignals" @record-decision="recordFromReport" />
<section v-if="signalVisited" v-show="workspace==='signals'" aria-label="X Tracker 資料來源"><div class="source-heading"><h1>資料來源</h1><p>X Tracker · 原文與標的關聯；分類不等於已核實的研究。</p></div><XOverview @change="sourceTab=$event" /><LocalReview v-show="sourceTab==='posts'" :active="workspace==='signals' && sourceTab==='posts'" @open-company="openCompany" /></section>
<LedgerWorkspace v-if="ledgerVisited" v-show="['ledger','review'].includes(workspace)" :active="['ledger','review'].includes(workspace)" :mode="workspace==='review'?'review':'ledger'" @navigate="navigate" />
<ResearchMethod v-if="workspace==='method'" />
<RelationsWorkspace v-if="workspace==='relations'" />
<ResearchCompare v-if="workspace==='compare'" />
<ResearchDecisions v-if="workspace==='observations'" />
<DataManagement v-if="workspace==='management'" />
<PortfolioWorkspace v-if="workspace==='portfolio'" />
</div>

</main>
</template>
<script setup>
import {computed,onMounted,onUnmounted,ref} from 'vue'
import CanonicalResearch from './CanonicalResearch.vue'
import LocalReview from './LocalReview.vue'
import XOverview from './XOverview.vue'
import LedgerWorkspace from './LedgerWorkspace.vue'
import ResearchMethod from './ResearchMethod.vue'
import RelationsWorkspace from './RelationsWorkspace.vue'
import ResearchCompare from './ResearchCompare.vue'
import ResearchDecisions from './ResearchDecisions.vue'
import DataManagement from './DataManagement.vue'
import PortfolioWorkspace from './PortfolioWorkspace.vue'
import {siteIndex} from './api.js'
import {exportBackup} from './device-store.js'
const navigation=[{id:'company',label:'公司報告'},{id:'signals',label:'資料來源'},{id:'relations',label:'公司關係'},{id:'compare',label:'比較研究'},{id:'observations',label:'觀察與更新'},{id:'ledger',label:'目前持倉'},{id:'review',label:'決策回顧'},{id:'portfolio',label:'資金與績效'},{id:'management',label:'資料管理'},{id:'csv',label:'CSV匯入'},{id:'method',label:'研究方法'}]
const groups=[{id:'research',label:'研究',items:['company','relations','compare','observations']},{id:'trade',label:'買賣決策',items:['ledger','review','portfolio']},{id:'data',label:'資料',items:['signals','method']}]
const currentGroup=computed(()=>groups.find(g=>g.items.includes(workspace.value))||groups[2])
const currentWorkspace=()=>{const p=new URLSearchParams(location.search),w=p.get('workspace');return navigation.some(i=>i.id===w)?w:w?'company':['run','lead','q','view','offset','topic','match','bucket'].some(k=>p.has(k))?'signals':'company'}
const workspace=ref(currentWorkspace()),showCompany=computed(()=>workspace.value==='company'),companyVisited=ref(showCompany.value),signalVisited=ref(workspace.value==='signals'),ledgerVisited=ref(['ledger','review'].includes(workspace.value)),index=ref(null),message=ref('')
const sourceTab=ref(new URLSearchParams(location.search).get('sourceTab')||'posts')
const urls={}
function navigate(id,record,destination){if(!window.dispatchEvent(new Event('workspace-leave',{cancelable:true})))return;urls[workspace.value]=location.pathname+location.search;const dest=destination||(((id==='ledger'||id==='review')&&!record)?location.pathname+'?workspace='+id:urls[id]||location.pathname+'?workspace='+id);history.pushState(history.state,'',record?location.pathname+'?workspace='+id+'&record='+encodeURIComponent(record):dest);window.dispatchEvent(new PopStateEvent('popstate'));window.scrollTo({top:0,behavior:'instant'});requestAnimationFrame(()=>document.querySelector('#app-content h1')?.focus())}
function openCompany(){navigate('company')}
function returnSignal(){navigate('signals')}
function openCompanySignals(ticker){urls.signals=location.pathname+'?workspace=signals&q='+encodeURIComponent(ticker);navigate('signals')}
function recordFromReport({ticker,report}){navigate('ledger',null,location.pathname+'?workspace=ledger&view=add&ticker='+encodeURIComponent(ticker)+'&report='+encodeURIComponent(report))}
function pop(){if(new URLSearchParams(location.search).get('workspace')==='csv'){history.replaceState(history.state,'','?workspace=ledger&view=add&method=csv');}workspace.value=currentWorkspace();if(showCompany.value)companyVisited.value=true;if(workspace.value==='signals')signalVisited.value=true;if(['ledger','review'].includes(workspace.value))ledgerVisited.value=true}
async function backup(){try{const data=await exportBackup(),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='investment-research-browser-records.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);message.value='紀錄已下載到此裝置。'}catch{message.value='未能下載紀錄；請檢查瀏覽器儲存權限。'}}
onMounted(()=>{pop();window.addEventListener('popstate',pop);siteIndex().then(v=>index.value=v).catch(()=>message.value='資料更新資訊暫時無法讀取。')})
onUnmounted(()=>window.removeEventListener('popstate',pop))
</script>
<style>.source-heading,.snapshot-footer{max-width:1280px;margin:auto;padding:1rem 1.5rem}.source-heading h1{font-size:1.5rem;margin:.25rem 0}.source-heading p,.snapshot-footer{color:var(--research-muted);font-size:.875rem}.snapshot-footer{border-top:1px solid var(--research-border)}.snapshot-footer summary{min-height:44px;display:flex;align-items:center;cursor:pointer}.snapshot-footer button{min-height:44px;padding:.5rem .75rem;background:var(--research-paper);border:1px solid var(--research-border);border-radius:6px;color:var(--research-ink);font:inherit}.snapshot-footer :focus-visible{outline:3px solid var(--research-accent);outline-offset:3px}@media(max-width:600px){.source-heading,.snapshot-footer{padding:1rem}}</style>
