<template>
<section class="canonical-desk relations-page">
 <div class="page-heading"><h1>公司關係</h1><span v-if="index" class="muted">關係依據截至 {{ index.research_as_of }}</span></div>
 <p>投資、客戶與供應商如何連在一起？選取節點或關係，查看來源記載與對生意的影響。</p>
 <p v-if="error" role="alert" class="canonical-alert">{{ error }} <button @click="load">重新載入關係</button></p>
 <p v-if="!index && !error" role="status">正在載入關係…</p>
 <template v-if="index">
 <section v-if="graphMode==='choose'" class="graph-center-choice"><h2>從哪家公司開始？</h2><p>選一家公司，先看與它直接相關的客戶、供應商與政策。</p><label>公司<select aria-label="關係圖中心公司" :value="center" @change="changeCenter($event.target.value)"><option value="">選擇公司</option><option v-for="n in centerOptions" :key="n.id" :value="n.id">{{ name(n.id) }}</option></select></label><button @click="showGlobal">查看全部已登錄關係</button></section>
 <template v-else>
 <div class="graph-center-control"><label>中心公司<select aria-label="關係圖中心公司" :value="graphMode==='global'?'__global':center" @change="$event.target.value==='__global'?showGlobal():changeCenter($event.target.value)"><option v-for="n in centerOptions" :key="n.id" :value="n.id">{{ name(n.id) }}</option><option value="__global">全部已登錄關係</option></select></label><a v-if="hasHub(center)" :href="'?workspace=company&company='+encodeURIComponent(center)">返回 {{ name(center) }} 概覽</a><p v-if="graphMode==='global'" class="muted">全局模式 · 目前為 AMZN 研究所登錄的有限範圍</p></div>
 <div class="graph-filters"><label>關係類型<select v-model="category"><option value="cloud">AI 與雲端</option><option value="policy">政策與監管</option><option value="retail">零售與物流</option><option value="all">全部關係</option></select></label><label>搜尋公司或關係<input type="search" v-model="filter" placeholder="公司、供應、關稅…"/></label><button v-if="filter || focusNode" @click="filter='';focusNode=''">清除篩選</button></div>
 <p class="graph-caption">顯示 {{ nodes.length }} 個節點、{{ edges.length }} 個關係；已登錄 {{ index.nodes.length }} 個節點、{{ index.edges.length }} 個關係。{{ focusNode?'目前只看 '+name(focusNode)+' 的關係。':'' }} 圖上連線代表同一筆登錄關係，三方關係共用標籤；選取可見標籤查看依據。</p>
 <div class="graph-layout">
 <div class="graph-main">
 <div class="graph-tools"><div><button @click="zoom(1.25)" aria-label="放大關係圖">＋</button><button @click="zoom(.8)" aria-label="縮小關係圖">−</button><button @click="resetView">重設視圖</button></div><span class="muted">{{ Math.round(view.scale*100) }}% · 拖移空白處／方向鍵</span></div>
 <svg tabindex="0" @keydown.left.prevent="view.x-=40" @keydown.right.prevent="view.x+=40" @keydown.up.prevent="view.y-=40" @keydown.down.prevent="view.y+=40" ref="svg" class="relation-graph" :viewBox="mobile?'250 110 500 500':'0 0 1000 720'" role="group" aria-label="公司、業務與政策證據關係圖" @pointerdown="panStart" @pointermove="panMove" @pointerup="panEnd" @pointercancel="panEnd" @wheel.prevent="zoom($event.deltaY<0?1.1:1/1.1)">
 <defs><pattern id="graph-grid" width="32" height="32" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#dce1df"/></pattern></defs><rect width="1000" height="720" fill="url(#graph-grid)"/>
 <g :transform="`translate(${view.x} ${view.y}) translate(500 360) scale(${view.scale}) translate(-500 -360)`">
 <g v-for="e in geometry" :key="'paths-'+e.id" class="graph-edge-lines" :class="{selected:selected?.id===e.id,dimmed:selectedNode && !e.parties.includes(selectedNode.id)}" aria-hidden="true">
 <path v-for="(path,i) in e.paths" :key="i" :d="path" class="edge-line"/>
 </g>
 <g v-for="e in geometry" :key="e.id" class="graph-edge" :class="{selected:selected?.id===e.id,dimmed:selectedNode && !e.parties.includes(selectedNode.id)}" role="button" tabindex="0" :aria-label="nameParties(e)+' · '+edgeLabel(e.id)" :transform="`translate(${e.label.x} ${e.label.y})`" @click.stop="select(e)" @keydown.enter.prevent="select(e)" @keydown.space.prevent="select(e)">
 <rect :x="-labelSize.labelWidth/2" :y="-labelSize.labelHeight/2" :width="labelSize.labelWidth" :height="labelSize.labelHeight" rx="3"/><text text-anchor="middle" dominant-baseline="middle" pointer-events="none">{{ edgeLabel(e.id) }}</text>
 </g>
 <g v-for="n in nodes" :key="n.id" class="graph-node" :class="{selected:selectedNode?.id===n.id,hub:n.id===center}" role="button" tabindex="0" :aria-label="name(n.id)+' · '+typeLabel(n.type)" :transform="`translate(${positions[n.id].x} ${positions[n.id].y})`" @click.stop="selectNode(n)" @keydown.enter.prevent="selectNode(n)" @keydown.space.prevent="selectNode(n)">
 <rect x="-73" y="-28" width="146" height="56" :rx="n.type==='company'?5:0"/><text text-anchor="middle" y="-3">{{ name(n.id) }}</text><text class="node-kind" text-anchor="middle" y="17">{{ typeLabel(n.type) }}</text>
 </g></g></svg>
 <p v-if="!edges.length" class="empty-state">沒有符合的關係。<button @click="filter='';focusNode='';category='all'">顯示全部關係</button></p>
 <div class="graph-access"><label>選取關係<select :value="selected?.id || ''" @change="select(index.edges.find(e=>e.id===$event.target.value))"><option value="">選擇一個關係查看證據</option><option v-for="e in edges" :key="e.id" :value="e.id">{{ nameParties(e) }} · {{ edgeLabel(e.id) }}</option></select></label><label>選取節點<select :value="selectedNode?.id || ''" @change="selectNode(index.nodes.find(n=>n.id===$event.target.value))"><option value="">選擇公司、業務或政策</option><option v-for="n in nodes" :key="n.id" :value="n.id">{{ name(n.id) }}</option></select></label></div>
 <div class="graph-legend"><span>圓角：公司</span><span>方角：業務群體／政策</span><span>連線標籤：來源支持的關係</span></div>
 </div>
 <aside class="relation-detail" aria-label="關係與證據詳情">
 <template v-if="selected">
 <div class="detail-kind">關係 · {{ edgeLabel(selected.id) }}</div><h2>{{ nameParties(selected) }}</h2><p class="muted">證據日期 {{ selected.evidence_date || '來源未標示' }} · 閱讀 {{ selected.retrieved_at?.slice(0,10) }}</p>
 <h3>來源記載的事實</h3><p>{{ fact(selected) }}</p>
 <h3>對生意的影響 <small>研究推論</small></h3><ol><li v-for="step in selected.economics_transmission?.steps_zh" :key="step">{{ step }}</li></ol><p v-if="selected.economics_transmission?.quantified_amzn_financial_effect===null" class="muted">此關係的獨立財務影響尚未量化。</p>
 <h3>仍需注意</h3><p>{{ selected.uncertainty_zh }}</p><p><strong>追蹤：</strong>{{ selected.update_trigger_zh }}</p>
 <h3>依據與原文</h3><div v-for="s in selected.evidence" :key="s.source_id" class="source-card"><a :href="s.url" target="_blank" rel="noopener noreferrer">{{ s.source_id }} · 原始來源 ↗</a><p class="muted">{{ s.evidence_date || '未標示發布日' }}</p><details><summary>原文位置</summary><p>{{ s.read_locator }}</p></details></div>
 <details><summary>登錄事實摘要</summary><p>{{ selected.fact_zh }}</p></details>
 </template>
 <template v-else-if="selectedNode">
 <div class="detail-kind">{{ typeLabel(selectedNode.type) }}</div><h2>{{ name(selectedNode.id) }}</h2><p class="muted">證據日期 {{ selectedNode.evidence_date || '未標示' }}</p><p>{{ selectedNode.uncertainty }}</p><button @click="focusNode=selectedNode.id;category='all'">只看此節點的關係</button>
 <h3>已登錄關係</h3><button v-for="e in nodeEdges" :key="e.id" class="node-edge-link" @click="category=categoryFor(e);select(e)">{{ edgeLabel(e.id) }} · {{ nameParties(e) }}</button>
 <h3>節點來源</h3><div v-for="s in selectedNode.evidence" :key="s.source_id" class="source-card"><a :href="s.url" target="_blank" rel="noopener noreferrer">{{ s.source_id }} · {{ s.evidence_date || '未標示日期' }} ↗</a><details><summary>原文位置</summary><p>{{ s.read_locator }}</p></details></div>
 </template>
 <template v-else><h2>從一個關係開始</h2><p>選取圖上的公司或連線標籤。這裡會說明誰與誰有什麼關係、來源如何記載，以及可能影響哪一部分生意。</p><p class="muted">目前範圍來自 AMZN 研究，政策、投資承諾與已發生收入各有不同條件。</p></template>
 <a v-if="hasHub(selectedNode?.id || center)" class="detail-report-link" :href="'?workspace=company&company='+encodeURIComponent(selectedNode?.id || center)">查看 {{ name(selectedNode?.id || center) }} 公司概覽 →</a>
 </aside></div></template></template></section>
</template>
<script setup>
import {computed,nextTick,onMounted,onUnmounted,ref,reactive,watch} from 'vue'
import {companyRelations,companyHubs} from './api.js'
import {partyNames,relationFacts} from './relations-copy.js'
import {graphSelection,graphEdges,graphPositions,graphGeometry,relationCategory} from './relation-graph.mjs'
const media=window.matchMedia('(max-width:700px)'),mobile=ref(media.matches)
const index=ref(null),selected=ref(null),selectedNode=ref(null),filter=ref(''),category=ref('all'),center=ref(''),graphMode=ref('choose'),focusNode=ref(''),error=ref(''),svg=ref(null),view=reactive({x:0,y:0,scale:media.matches?1.6:1})
const labels={'amzn-anthropic-investment':'股權與融資','anthropic-aws-compute':'算力客戶','anthropic-aws-model-design':'模型與晶片','nvda-aws-supplier':'GPU 供應','nvda-trainium-coopetition':'晶片競合','aws-azure-competition':'雲端競爭','aws-googlecloud-competition':'雲端競爭','merchant-platform-services':'平台服務','logistics-competition':'物流競爭','de-minimis-retail-exposure':'進口規則','ftc-prime-remedy':'Prime 和解','ftc-seller-antitrust':'反壟斷訴訟','ftc-ad-auction-case':'廣告訴訟','eu-sovereignty-aws-response':'主權雲需求','eu-cada-proposal':'採購政策提案','constellation-aws-power':'電力供應','synopsys-amazon-IP':'晶片 IP 供應','synopsys-aws-cloud':'雲端合作','amzn-openai-investment':'股權投資','openai-aws-compute-model-collaboration':'算力與模型'}
const hubs=ref([]),hasHub=id=>hubs.value.some(c=>c.company_id===id)
const name=id=>partyNames[id]||id,edgeLabel=id=>labels[id]||id,nameParties=e=>e.parties.map(name).join(' ↔ '),fact=e=>relationFacts[e.id]||e.fact_zh
const typeLabel=t=>({company:'公司',business_cohort:'業務群體',policy_actor:'政策機關',regulator:'監管機關',policy:'政策'}[t]||t)
const categoryFor=relationCategory
const centerOptions=computed(()=>index.value?.nodes.filter(n=>n.type==='company')||[])
const edges=computed(()=>index.value?graphEdges(index.value,{mode:graphMode.value,center:center.value,category:category.value,focus:focusNode.value,filter:filter.value},e=>nameParties(e)+' '+fact(e)+' '+edgeLabel(e.id)):[])
const nodes=computed(()=>{const ids=new Set(edges.value.flatMap(e=>e.parties));if(center.value)ids.add(center.value);return index.value?.nodes.filter(n=>ids.has(n.id))||[]})
const nodeEdges=computed(()=>index.value?.edges.filter(e=>e.parties.includes(selectedNode.value?.id)&&(graphMode.value==='global'||e.parties.includes(center.value)))||[])
const positions=computed(()=>graphPositions(nodes.value,graphMode.value==='center'?center.value:''))
const canvasPixels=ref({width:1000,height:720})
const labelSize=computed(()=>{
 const units=mobile.value?{width:500,height:500}:{width:1000,height:720}
 const pixelScale=Math.min(canvasPixels.value.width/units.width,canvasPixels.value.height/units.height)*view.scale
 const minUnits=44.5/Math.max(pixelScale,.01)
 return {labelWidth:Math.max(112,minUnits),labelHeight:Math.max(44,minUnits)}
})
const geometry=computed(()=>graphGeometry(edges.value,positions.value,labelSize.value))
let canvasObserver=null
function measureCanvas(){if(svg.value){const r=svg.value.getBoundingClientRect();canvasPixels.value={width:r.width,height:r.height}}}
watch(svg,element=>{canvasObserver?.disconnect();canvasObserver=null;if(element){measureCanvas();canvasObserver=new ResizeObserver(measureCanvas);canvasObserver.observe(element)}})
function changeCenter(id){center.value=centerOptions.value.some(n=>n.id===id)?id:'';graphMode.value=center.value?'center':'choose';selected.value=null;selectedNode.value=null;filter.value='';focusNode.value='';category.value='all';resetView();history.pushState(null,'',graphUrl())}
function showGlobal(){graphMode.value='global';center.value='';selected.value=null;selectedNode.value=null;focusNode.value='';filter.value='';category.value='all';resetView();history.pushState(null,'',graphUrl())}
function resetView(){Object.assign(view,{x:0,y:0,scale:mobile.value?1.6:1})}function zoom(factor){view.scale=Math.max(.5,Math.min(4,view.scale*factor))}
let drag=null,moved=false
function panStart(e){if(e.target.closest('.graph-node,.graph-edge'))return;const r=svg.value.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,vx:view.x,vy:view.y,factor:(mobile.value?500:1000)/r.width};moved=false;svg.value.setPointerCapture(e.pointerId)}
function panMove(e){if(!drag)return;view.x=drag.vx+(e.clientX-drag.x)*drag.factor;view.y=drag.vy+(e.clientY-drag.y)*drag.factor;moved=true}function panEnd(){drag=null}
function graphUrl(){const p=new URLSearchParams({workspace:'relations',category:category.value});if(graphMode.value==='global')p.set('graphMode','global');else if(center.value)p.set('center',center.value);if(filter.value)p.set('filter',filter.value);if(focusNode.value)p.set('focus',focusNode.value);if(selected.value)p.set('edge',selected.value.id);if(selectedNode.value)p.set('node',selectedNode.value.id);return '?'+p.toString()}
let restoring=false
function pop(){if(!index.value || new URLSearchParams(location.search).get('workspace')!=='relations')return;restoring=true;const state=graphSelection(index.value,location.search);center.value=state.center;graphMode.value=state.mode;selected.value=index.value.edges.find(e=>e.id===state.edge&&(state.mode==='global'||e.parties.includes(state.center)))||null;selectedNode.value=index.value.nodes.find(n=>n.id===state.node)||null;category.value=state.category;filter.value=state.filter;focusNode.value=state.focus;if(selected.value && !edges.value.some(e=>e.id===selected.value.id)){category.value=categoryFor(selected.value);filter.value='';focusNode.value=''}else if(selectedNode.value && !nodes.value.some(n=>n.id===selectedNode.value.id)){selectedNode.value=null}resetView();if(selected.value)locate(geometry.value.find(e=>e.id===selected.value.id)?.label);else if(selectedNode.value)locate(positions.value[selectedNode.value.id]);queueMicrotask(()=>{restoring=false})}

watch([category,filter,focusNode],()=>{if(!index.value || restoring || new URLSearchParams(location.search).get('workspace')!=='relations')return;if(selected.value&&!edges.value.some(e=>e.id===selected.value.id))selected.value=null;if(selectedNode.value&&!nodes.value.some(n=>n.id===selectedNode.value.id))selectedNode.value=null;history.replaceState(null,'',graphUrl())})
function locate(p){if(mobile.value&&p){view.x=(500-p.x)*view.scale;view.y=(360-p.y)*view.scale}}
function select(e){if(!e || (graphMode.value!=='global'&&!e.parties.includes(center.value)))return;if(!edges.value.some(v=>v.id===e.id)){category.value=categoryFor(e);filter.value='';focusNode.value=''}selected.value=e;locate(geometry.value.find(v=>v.id===e.id)?.label);selectedNode.value=null;history.pushState(null,'',graphUrl())}
function selectNode(n){if(!n)return;selectedNode.value=n;locate(positions.value[n.id]);selected.value=null;history.pushState(null,'',graphUrl())}
async function load(){error.value='';try{const [relations,companies]=await Promise.all([companyRelations(),companyHubs()]);index.value=relations;hubs.value=companies.companies;pop()}catch(e){error.value=e.message}}
function resized(){mobile.value=media.matches;resetView();nextTick(measureCanvas)}
onMounted(()=>{load();window.addEventListener('popstate',pop);media.addEventListener('change',resized)});onUnmounted(()=>{canvasObserver?.disconnect();window.removeEventListener('popstate',pop);media.removeEventListener('change',resized)})
</script>
