<template>
<section class="company-holding" aria-label="此公司的私人帳本">
 <h2>我的紀錄</h2>
 <p v-if="loading" role="status">正在讀取私人帳本…</p>
 <p v-else-if="error" role="alert">{{ error }} <button @click="load">重試</button></p>
 <template v-else-if="loaded">
  <p v-if="!positions.length">帳本尚無 {{ ticker }} 持倉。</p>
  <div v-for="p in positions" :key="p.id"><p>{{ p.origin==='ledger'?'已記錄成交':'持倉畫面' }} · {{ p.instrument.exchange||'交易所未填' }}</p><p v-if="p.calculation">{{ number(p.calculation.quantity) }} 股 · {{ p.calculation.currency }} 平均成本 {{ number(p.calculation.average_cost) }}</p><p v-else>{{ p.snapshot.captured_date||'日期未確認' }}</p><a :href="'?workspace=ledger&position='+encodeURIComponent(p.id)">查看持倉、理由與回顧</a></div>
 </template>
</section>
</template>
<script setup>
import {computed,onMounted,onUnmounted,ref,watch} from 'vue'
import {loadLedger} from './ledger-store.js'
import {projectPositions} from './decision-workspace.mjs'
const props=defineProps({ticker:String,active:Boolean})
const loaded=ref(false),loading=ref(false),error=ref(''),calculation=ref(null)
let sequence=0
const positions=computed(()=>calculation.value?.filter(p=>p.instrument.symbol===props.ticker&&p.instrument.product==='spot'&&p.visibility==='current')||[])
const number=v=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:4}).format(v)
function invalidate(){sequence++;loaded.value=false;loading.value=false;calculation.value=null;error.value=''}
async function load(){const n=++sequence;loaded.value=false;calculation.value=null;loading.value=true;error.value='';try{const d=await loadLedger();if(n!==sequence || !props.active)return;calculation.value=projectPositions(d.state);loaded.value=true}catch(e){if(n===sequence)error.value=e.status===401?'請登入以查看私人帳本。':e.message}finally{if(n===sequence)loading.value=false}}
function focus(){if(props.active)load()}
watch([()=>props.ticker,()=>props.active],()=>{invalidate();if(props.active&&props.ticker)load()})
onMounted(()=>{window.addEventListener('focus',focus);if(props.active&&props.ticker)load()})
onUnmounted(()=>{invalidate();window.removeEventListener('focus',focus)})
</script>
