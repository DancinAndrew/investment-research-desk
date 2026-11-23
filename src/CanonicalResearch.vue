<template>
<section class="canonical-desk" aria-label="公司研究">
  <div v-if="error" role="alert" class="canonical-alert">{{ error }} <button @click="refresh">重試載入</button><a href="?workspace=company" @click.prevent="showList">返回公司列表</a></div>
  <div v-if="loading" class="reading-loading" role="status" aria-live="polite">正在載入研究…<div class="loading-line"/><div class="loading-line"/></div>
  <template v-if="catalog && view==='list'">
    <div class="page-heading"><h1>公司</h1></div>
    <label class="company-search">搜尋公司<input name="company-search" type="search" v-model="filter" @input="updateUrl()" placeholder="公司名稱或代號…" autocomplete="off"/></label>
    <div class="company-filters">
      <label>產業<select v-model="industry" @change="updateUrl()"><option value="">全部產業</option><option v-for="value in industries" :key="value" :value="value">{{ value }}</option><option value="unclassified">未分類</option></select></label>
      <label>上市市場<select v-model="market" @change="updateUrl()"><option value="">全部市場</option><option v-for="(label,id) in marketLabels" :key="id" :value="id">{{ label }}</option></select></label>
      <label class="check-label"><input type="checkbox" v-model="favoritesOnly" @change="updateUrl()"/>只看收藏</label>
      <button @click="resetFilters">重設篩選</button>
    </div>
    <p v-if="privateError" role="alert">{{ privateError }} <button @click="loadPrivate">重試收藏</button></p><p v-if="privateMessage" role="status">{{ privateMessage }}</p>
    <p class="company-results" role="status">{{ companies.length }} / {{ allCompanies.length }} 家公司</p>
    <section class="company-list" aria-label="公司列表">
      <div v-for="item in companies" :key="item.id" class="company-list-item">
       <a :href="'?workspace=company&company='+encodeURIComponent(item.id)" @click.prevent="openCompany(item.id)" class="company-row"><div><strong>{{ item.name }}</strong><span><template v-if="item.ticker">{{ item.ticker }} · </template>{{ item.industry || '產業未分類' }} · {{ item.markets.length?item.markets.map(m=>marketLabels[m]||m).join('、'):'市場未分類' }}</span></div><span>{{ item.reports.length?'完整研究':'第三方觀點' }}<template v-if="item.viewpoint_count"> · {{ item.viewpoint_count }} 則觀點</template></span></a>
       <button class="company-star" :aria-label="(favorites.includes(item.id)?'取消收藏 ':'收藏 ')+item.name" :aria-pressed="favorites.includes(item.id)" :disabled="!privateLoaded || privateBusy" @click="toggleFavorite(item.id)"><svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2L12 17.3l-5.7 2.9 1.1-6.2L2.9 9.6l6.3-.9Z" :fill="favorites.includes(item.id)?'currentColor':'none'" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg></button>
      </div>
      <p v-if="!companies.length" class="empty-state">沒有符合的公司。<button @click="resetFilters">重設篩選</button></p>
    </section>

  </template>
  <template v-if="catalog && view==='company' && !loading">
    <a href="?workspace=company" @click.prevent="showList" class="back-link">返回公司列表</a>
    <div class="page-heading"><h1>{{ currentCompany?.name || company }} <span v-if="currentCompany?.ticker">{{ currentCompany.ticker }}</span></h1></div>
    <p v-if="company.trim().toUpperCase()==='NVDA'"><a :href="'?workspace=company&company=NVDA&researchView=new'" @click.prevent="showNew">開始新的公開材料研究</a></p>
    <CompanyHub :company="company" :latest="companyBundles.at(-1)" :active="active && view==='company'" @read="loadBundle($event,true)" @open-x="$emit('open-x',$event)"/>
    <details v-if="companyBundles.length || companyJobs.length" class="company-archive"><summary>歷史版本與研究紀錄</summary>
    <section class="report-list"><a v-for="item in [...companyBundles].reverse()" :key="item.bundle_id" :href="reportUrl(item.bundle_id)" @click.prevent="loadBundle(item.bundle_id,true)" class="report-row"><div><strong>{{ titleFor(item) }}</strong><span>{{ versionLabel(item) }}<template v-if="item.bundle_id===companyBundles.at(-1)?.bundle_id">　最新閱讀版</template></span></div><time>{{ item.as_of.slice(0,10) }}</time></a></section>
    <section class="report-list" aria-label="研究執行紀錄"><a v-for="item in companyJobs" :key="item.job_id" :href="jobUrl(item)" @click.prevent="openJob(item)" class="report-row"><div><strong>{{ jobTitle(item) }}</strong><span>{{ item.question_id }}</span></div><time>{{ item.created_at?.slice(0,10) }}</time></a></section>
    </details>
    <div v-if="!currentCompany && !companyBundles.length && !companyJobs.length" class="empty-state"><p>此公司尚未登錄。</p><a href="?workspace=company" @click.prevent="showList">查看已有公司</a></div>
  </template>
  <template v-if="view==='new'">
    <a href="?workspace=company" @click.prevent="showList" class="back-link">返回公司列表</a><h1>新研究</h1>
    <label class="company-search">公司<input name="new-company" v-model="newCompany" @change="updateUrl()" placeholder="公司代號，例如 NVDA…" autocomplete="off" /></label>
    <PublicResearchJob :active="active && view==='new'" :company="newCompany" @open-report="loadJobReport"/>
  </template>
  <template v-if="bundle && view==='detail' && !loading">
    <header class="report-header">
    <a :href="'?workspace=company&company='+encodeURIComponent(company)" @click.prevent="openCompany(company)" class="back-link">返回 {{ company }} 概覽</a>
    <p class="report-context">{{ bundle.manifest.issuer.name }} · 研究更新 {{ bundle.manifest.created_at.slice(0,10) }}</p>
    <ResearchNavigation :primary="primaryTabs" :secondary="secondaryTabs" :tab="tab" :href-for="tabUrl" :versions="versionOptions" :selected-id="selectedId" :loading="loading" :relations-href="'?workspace=relations&center='+encodeURIComponent(company)+'&category=all'" @navigate="setTab" @version="loadBundle($event,true)" @record-decision="$emit('record-decision',{ticker:bundle.manifest.security.ticker || bundle.manifest.security.symbol,report:selectedId})"/>
    </header>
    <a :href="'?workspace=observations&new=1&report='+encodeURIComponent(selectedId)" class="observation-link">用這份研究記錄觀察決定</a>
    <div class="canonical-layout"><main id="report-content" class="canonical-reading">
          <article v-if="tab==='report'" data-testid="canonical-report" class="canonical-markdown" @click="reportClick" v-html="reportHtml"/>
          <section v-else-if="tab==='claims'"><h2>研究主張與反證</h2><article v-for="claim in mainClaims" :key="claim.id" class="claim-card"><h3>{{ claim.text }}</h3><details v-if="claim.excerpt"><summary>{{ claim.excerptIsLocator ? '來源定位' : '證據摘要' }}</summary><p class="verbatim">{{ claim.excerpt }}</p></details><ul v-if="claim.hypotheses.length"><li v-for="h in claim.hypotheses" :key="h">{{ h }}</li></ul><p v-if="claim.falsifier"><strong>反證與限制：</strong>{{ claim.falsifier }}</p><ul v-if="claim.conditions.length"><li v-for="condition in claim.conditions" :key="condition">{{ condition }}</li></ul><p v-if="claim.evidence_plan">證據計畫：{{ claim.evidence_plan }}</p><details v-if="claimTraces(claim.id).length"><summary>逐項依據與來源處理</summary><SourceTrace :rows="claimTraces(claim.id)"/></details><button v-else @click="openArtifact(claim.origin_ref.artifact_id)">查看依據與原始來源</button></article><details v-if="appendixClaims.length"><summary>日期、模型口徑與來源範圍</summary><article v-for="claim in appendixClaims" :key="claim.id"><h3>{{ claim.text }}</h3><p>{{ claim.falsifier }}</p><ul v-if="claim.conditions.length"><li v-for="condition in claim.conditions" :key="condition">{{ condition }}</li></ul></article></details></section>
          <section v-else-if="tab==='sources'"><h2>來源與閱讀範圍</h2><template v-if="reportTraces.length"><p>以下對應這一版報告的具體主張，區分直接依據、背景、反方與未採用說法。逐項對照範圍不等於全文每個說法已核證。</p><SourceTrace :rows="reportTraces"/></template><button v-if="relationArtifact" @click="openArtifact(relationArtifact.artifact_id)">公司關係與政策</button><button v-if="catalog.x_source_configured" @click="$emit('open-x',bundle.manifest.security.ticker || bundle.manifest.security.symbol)">查看此公司的既有 X 線索</button><p>X 原文與研究原始證據分開；轉引同公告不增加獨立來源數。</p><div v-if="projection.sources.markdown" class="canonical-markdown" @click="reportClick" v-html="renderEntry(bundle.entrypoints.source_index)"/><article v-for="source in projection.sources.items" :key="source.id" class="source-card"><h3>{{ source.id }} · {{ source.original_publisher || source.title || '來源紀錄' }}</h3><p>{{ sourceStatus(source) }}</p><p>表示形式：{{ source.representation || '見原始索引' }} · 上游：{{ source.origin_cluster || '未標示' }}</p><p>發布日期：{{ displayValue(source.published_date || source.published_at) }}；可用時間：{{ displayValue(source.conservative_available_at_for_this_run || source.available_at) }}</p><p>閱讀範圍：{{ source.read_scope || '未標示' }}</p><details><summary>來源檔案資訊</summary><p>{{ displayValue(source.original_bytes_sha256) }}</p></details><a v-if="safeUrl(source.exact_url || source.original_url || source.url)" :href="safeUrl(source.exact_url || source.original_url || source.url)" target="_blank" rel="noopener noreferrer">官方來源 ↗</a></article><p v-if="projection.sources.independent_origins!==null">已登錄獨立上游數：{{ projection.sources.independent_origins }}（不是證據正確率）</p><p v-else>來源群組計數未登錄；請查看正文來源映射。</p></section>
          <section v-else-if="tab==='models'"><h2>計算附錄</h2><button v-if="manualArtifact" @click="openArtifact(manualArtifact.artifact_id)">閱讀完整操作手冊</button><button v-if="formulaArtifact" @click="openArtifact(formulaArtifact.artifact_id)">閱讀算式與假設</button><p>情境是條件假設，沒有概率或預期報酬。來源程式只可讀；網站不執行程式。</p><p v-if="!projection.models.inputs">本版保留計算程式、固定輸入與結果；可依操作手冊在本機重算。</p><p>網站只閱讀保存的算式；請依操作手冊在 Mac 重算。</p><div v-if="replayResult" data-testid="replay-result" class="replay-result"><strong>{{ replayResult.recalculation.status==='matched'?'重算與保存結果一致':'重算有差異' }}</strong><p>{{ replayResult.recalculation.comparisons.length }} 項數值；最大差 {{ maxError }}；{{ replayResult.receipt.calculator_version }}</p><p>{{ replayResult.receipt.scope }}</p><p>保存紀錄：{{ replayResult.run.id }}</p></div><h3>情境輸入</h3><details><summary>來源與假設</summary><pre>{{ pretty(projection.models.inputs) }}</pre></details><h3>保存的模型結果</h3><details><summary>完整結果</summary><pre>{{ pretty(projection.models.results) }}</pre></details><details v-if="projection.models.cash_results"><summary>收現與現金流分解</summary><pre>{{ pretty(projection.models.cash_results) }}</pre></details><details v-if="replayResult"><summary>逐項重算差異</summary><pre>{{ pretty(replayResult.recalculation.comparisons) }}</pre></details></section>
          <section v-else-if="tab==='validation'"><h2>驗證與尚未到期的結果</h2><p v-if="!projection.validation.scorecard.cards">本版未登錄成熟預測評分資料；缺資料不代表已通過投資驗證。</p><p v-else>沿用 {{ projection.validation.origin_bundle_id }} 的凍結驗證；{{ projection.validation.pending_outcomes }} 個 outcome 尚未知。</p><p>投資優勢：尚未建立。預測誤差：{{ displayValue(projection.validation.scorecard.forecast_error) }}；AI 相對基準能力：{{ displayValue(projection.validation.scorecard.AI_vs_baseline_skill) }}</p><article v-for="card in projection.validation.scorecard.cards || []" :key="card.id" data-testid="forecast-card" class="forecast-card"><h3>{{ card.id }}</h3><p>{{ card.status }} · outcome：{{ displayValue(card.outcome) }}</p></article><details><summary>驗證原始紀錄</summary><pre>{{ pretty(projection.validation.scorecard) }}</pre></details></section>
          <section v-else-if="tab==='versions'"><h2>版本比較</h2><p>歷史版本保持凍結，模型原始輸出與agent審修成品各自保留。比較依據研究紀錄與原文，不使用情緒評分。</p><div v-if="comparison" data-testid="support-change" class="support-change"><h3>{{ comparison.support_change.prior_valuation_support_weakened===true?'原估值論點的支持力下降':comparison.support_change.prior_valuation_support_weakened===false?'研究紀錄未標示支持力下降':'支持力變化未記錄' }}</h3><p>依據：{{ comparison.support_change.basis }} · {{ comparison.support_change.source_ref?.artifact_id }}</p><dl><template v-for="(value,key) in comparison.support_change.outcome" :key="key"><dt>{{ key }}</dt><dd>{{ displayValue(value) }}</dd></template></dl><details><summary>所選兩版報告逐行差異</summary><pre>{{ comparison.report_diff.join('\n') }}</pre><p v-if="comparison.diff_truncated">超出顯示上限，請查看兩版完整報告。</p></details></div><p v-else>目前沒有可比較的另一個已登錄版本。</p></section>
          <section v-else-if="tab==='artifact' && selectedArtifact"><a :href="tabUrl('sources')" @click.prevent="setTab('sources')">返回來源與依據</a><h2>{{ artifactTitle(selectedArtifact.path) }}</h2><details><summary>文件資訊</summary><p>{{ selectedArtifact.kind }} · {{ selectedArtifact.revision_id }}</p></details><div v-if="selectedArtifact.format==='markdown'" class="canonical-markdown" @click="reportClick" v-html="renderArtifact(selectedArtifact)"/><pre v-else-if="selectedArtifact.format!=='binary'">{{ selectedArtifact.format==='json'?pretty(selectedArtifact.content):selectedArtifact.content }}</pre><p v-else>此 PDF 已核對 hash；此介面提供檔案定位與來源文字摘錄，未將二進位內容轉成 HTML。</p></section>

        <section v-else-if="tab==='system'" class="canonical-evidence"><h2>來源覆蓋與研究紀錄</h2><button v-if="coverageArtifact" @click="openArtifact(coverageArtifact.artifact_id)">查看完整來源覆蓋清單</button><p>尚未到期的預測：{{ projection.validation.pending_outcomes }} 筆；投資優勢尚未建立。</p><details><summary>前瞻卡與歷史驗證</summary><pre>{{ pretty(projection.validation.scorecard) }}</pre></details>      <section class="assessment-layers" data-testid="assessment-layers" aria-label="研究判定"><dl><template v-for="row in assessmentRows(projection.assessment)" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></template></dl><p v-if="projection.assessment?.research.scope_id">審查範圍：{{ projection.assessment.research.scope_id }}；{{ projection.assessment.research.reviewed_at }}</p><ul><li v-for="limit in projection.assessment?.research.limitations || []" :key="limit">{{ limit }}</li></ul><p>狀態對應本版本截至時間與釘定回執；不表示今日資料仍新鮮。檔案 hash 綁內容，審查者身分由本機核准登錄流程確認。</p></section><ul><li v-for="gap in bundle.manifest.gaps" :key="gap">{{ gap }}</li></ul><details><summary>Manifest 與依賴</summary><p>{{ bundle.manifest_sha256 }}</p><pre>{{ pretty(bundle.manifest.dependencies) }}</pre></details><details><summary>白名單檔案（{{ bundle.artifacts.length }}）</summary><button v-for="item in bundle.artifacts" :key="item.artifact_id" class="artifact-button" @click="openArtifact(item.artifact_id)">{{ item.path }}</button></details><details v-if="projection.rejected_methods.length"><summary>拒絕或受限的方法</summary><pre>{{ pretty(projection.rejected_methods) }}</pre></details><details v-if="projection.source_reproducibility"><summary>可重現的範圍</summary><pre>{{ pretty(projection.source_reproducibility) }}</pre></details><p>舊研究用量／費用：{{ displayValue(projection.usage?.cost) }}。本輪未啟動額外 CLI 研究。</p></section>
    </main></div>
  </template>
  <template v-if="jobReading && view==='job'">
    <a href="?workspace=company" @click.prevent="showList">返回公司列表</a><h1>研究報告</h1><p v-if="jobReading.quality_status==='mechanically_accepted_semantics_not_independently_reviewed'">規則檢查通過 · 尚未獨立語義覆核</p><p>資料截至 {{ jobReading.information_as_of || '未標示' }} · 執行日期 {{ (jobReading.receipt?.created_at || jobReading.receipt?.finished_at || '').slice(0,10) || '未標示' }}</p><nav class="research-tabs" aria-label="研究內容"><a v-for="item in [{id:'report',label:'報告'},{id:'sources',label:'來源與依據'},{id:'system',label:'系統紀錄'}]" :key="item.id" :href="'?workspace=company&researchView=job&job='+jobReading.job_id+'&researchTab='+item.id" :aria-current="tab===item.id?'page':undefined" @click.prevent="setTab(item.id)">{{ item.label }}</a></nav><main class="canonical-reading"><article v-if="tab==='report'" class="canonical-markdown" v-html="safeMarkdown(jobReading.report_markdown)"/><section v-else-if="tab==='sources'"><h2>公開來源</h2><article v-for="(source,index) in jobReading.sources || []" :key="source.document_version_id || source.id || index" class="source-card"><h3>{{ source.title || source.original_publisher || source.document_version_id || '公開來源' }}</h3><p>發布日期：{{ displayValue(source.published_at || source.published_date) }} · 取回時間：{{ displayValue(source.retrieved_at || source.first_seen_at) }}</p><p>閱讀範圍：{{ source.read_scope || '見來源紀錄' }}</p><a v-if="safeUrl(source.exact_url || source.original_url || source.url)" :href="safeUrl(source.exact_url || source.original_url || source.url)" target="_blank" rel="noopener noreferrer">閱讀公開來源</a></article></section><section v-else><h2>研究紀錄</h2><p v-if="jobReading.quality_status==='mechanically_accepted_semantics_not_independently_reviewed'">規則檢查通過；尚未獨立語義覆核。</p><ol><li v-for="(step,index) in jobReading.stage_trace || []" :key="step.stage || index">{{ jobStageNames[index] || step.stage }} · {{ jobStepStatus(step.status) }}<p v-if="step.output?.reason">{{ step.output.reason }}</p></li></ol><details><summary>完整檢查與執行紀錄</summary><pre>{{ pretty({receipt:jobReading.receipt,checks:jobReading.checks,quality:jobReading.quality_status,stage_trace:jobReading.stage_trace}) }}</pre></details></section></main>
  </template>
</section>
</template>

<script setup>
import {computed,nextTick,onMounted,onUnmounted,ref,watch} from 'vue'
import PublicResearchJob from './PublicResearchJob.vue'
import CompanyHub from './CompanyHub.vue'
import ResearchNavigation from './ResearchNavigation.vue'
import SourceTrace from './SourceTrace.vue'
import {localApi,companyHubs,researchTraceability} from './api'
import {companyCards,claimReading,traceForReport} from './company-model.mjs'
import {filterCompanies,marketLabels} from './company-metadata.mjs'
import {usePrivateState} from './private-state.js'
import {safeUrl} from './workbench-model'
import {artifactLink,assessmentRows,displayValue,revisionStatus,safeMarkdown,sourceStatus,prepareMarkdown,registerMarkdown} from './canonical-view'
const props=defineProps({active:Boolean})
const emit=defineEmits(['return','open-x','open-demo','record-decision'])
const jobs=ref([]),jobReading=ref(null),hubs=ref(null)
const jobStageNames=['確認研究問題','整理公開來源','分析新聞與產業','分析財務基本面','計算估值情境','檢查籌碼資料','檢查技術資料','檢查財務健康','彙整風險','編寫研究報告','驗收研究結果']
const jobStepStatus=status=>({completed:'已完成',checked:'已完成檢查',limits_identified:'已記錄限制',conditional_sensitivity:'條件情境已計算',supported:'範圍已確認',retrieved:'來源已整理',analyzed:'分析已完成',accepted:'規則檢查通過',not_evaluable:'缺少資料，無法評估',needs_revision:'需要修訂',blocked:'缺少必要資料',failed:'執行失敗'}[status] || '見完整紀錄')
function loadJobReport(reading){if(Array.isArray(reading.report_ast))registerMarkdown(reading.report_markdown,reading.report_ast);invalidate();company.value=reading.company || newCompany.value;jobReading.value=reading;view.value='job';tab.value='report';const p=new URLSearchParams({workspace:'company',researchView:'job',job:reading.job_id,company:company.value});history.pushState(history.state,'',location.pathname+'?'+p)}
const view=ref('list'),filter=ref(''),newCompany=ref('NVDA')
const industry=ref(''),market=ref(''),favoritesOnly=ref(false)
const {state:privateState,loaded:privateLoaded,busy:privateBusy,error:privateError,message:privateMessage,load:loadPrivate,save:savePrivate}=usePrivateState()
const favorites=computed(()=>privateLoaded.value?privateState.value.company_favorites||[]:[])
const industries=computed(()=>[...new Set(allCompanies.value.map(c=>c.industry).filter(Boolean))].sort())
async function toggleFavorite(id){const current=favorites.value,candidate={...privateState.value,company_favorites:current.includes(id)?current.filter(x=>x!==id):[...current,id]};await savePrivate(candidate,current.includes(id)?'已取消收藏。':'已加入收藏。')}
function resetFilters(){filter.value='';industry.value='';market.value='';favoritesOnly.value=false;updateUrl()}
const catalog=ref(null),bundle=ref(null),selectedId=ref(''),company=ref(''),tab=ref('report'),loading=ref(false),error=ref(''),replaying=ref(false),replayResult=ref(null),comparison=ref(null),selectedArtifact=ref(null)
const primaryTabs=[{id:'report',label:'報告'},{id:'claims',label:'重點與反證'},{id:'sources',label:'來源與依據'}]
const secondaryTabs=[{id:'models',label:'計算附錄'},{id:'versions',label:'版本比較'},{id:'system',label:'來源覆蓋與紀錄'}]
const tabs=[{id:'report',label:'報告'},{id:'claims',label:'重點與反證'},{id:'sources',label:'來源與依據'},{id:'models',label:'計算附錄'},{id:'versions',label:'版本'},{id:'system',label:'系統紀錄'}]
let version=0,refreshSequence=0,controller
function invalidate(){refreshSequence++;version++;controller?.abort();loading.value=false;return refreshSequence}
const trace=ref(null),reportSection=ref('')
const reportTraces=computed(()=>traceForReport(trace.value,bundle.value))
const claimTraces=id=>reportTraces.value.filter(row=>row.claim_id===id)
async function revealReportSection(){await nextTick();if(tab.value!=='report'||!reportSection.value)return;const heading=document.getElementById(reportSection.value);if(heading){heading.setAttribute('tabindex','-1');heading.scrollIntoView({block:'start'});heading.focus({preventScroll:true})}}
const projection=computed(()=>bundle.value?.projection)
const companyBundles=computed(()=>catalog.value?.bundles.filter(item=>(item.security.ticker || item.security.symbol || '').toUpperCase()===company.value.trim().toUpperCase()) || [])
const versionOptions=computed(()=>companyBundles.value.map(item=>({...item,label:versionLabel(item)})))
const pretty=value=>JSON.stringify(value,null,2)
const maxError=computed(()=>Math.max(0,...(replayResult.value?.recalculation.comparisons || []).map(row=>row.absolute_error)))
const allCompanies=computed(()=>companyCards(catalog.value,hubs.value))
const companies=computed(()=>filterCompanies(allCompanies.value,{query:filter.value,industry:industry.value,market:market.value,favoritesOnly:favoritesOnly.value,favorites:favorites.value}))
const companyJobs=computed(()=>jobs.value.filter(j=>j.company===company.value))
function jobTitle(item){if(item.status==='accepted')return '公開材料研究 · 規則檢查通過（尚未獨立語義覆核）';return ['complete_report','complete_smoke'].includes(item.status)?'公開材料研究（模型原稿）':({needs_revision:'研究需要修訂',cancelled:'研究已取消',failed:'研究失敗',blocked:'研究無法執行',interrupted:'研究已中斷',timed_out:'研究超時'}[item.status] || '研究進行中')}
function jobUrl(item){return '?workspace=company&company='+encodeURIComponent(item.company)+'&researchView='+(['accepted','complete_report','complete_smoke'].includes(item.status)?'job':'new')+'&job='+item.job_id}
function openJob(item){if(!window.dispatchEvent(new Event('workspace-leave',{cancelable:true})))return;history.pushState(history.state,'',jobUrl(item));refresh()}
const currentCompany=computed(()=>allCompanies.value.find(item=>item.id===company.value))
const mainClaims=computed(()=>projection.value.claims.filter(c=>!c.appendix).map(claimReading))
const appendixClaims=computed(()=>projection.value.claims.filter(c=>c.appendix).map(claimReading))
const manualArtifact=computed(()=>bundle.value?.artifacts.find(a=>a.path.endsWith('06-公司研究操作手冊-v4.md')) || bundle.value?.artifacts.find(a=>a.artifact_id==='hosted-manual-v2' || a.path.includes('操作手冊')))
const formulaArtifact=computed(()=>bundle.value?.artifacts.find(a=>a.path.endsWith('/02-算式與限制.md')))
const coverageArtifact=computed(()=>bundle.value?.artifacts.find(a=>a.path.endsWith('/公司研究-20261011/來源覆蓋.md')) || bundle.value?.artifacts.find(a=>a.path.endsWith('來源覆蓋清單.md')))
const relationArtifact=computed(()=>bundle.value?.artifacts.find(a=>a.path.endsWith('/07-公司關係與政策.md')))
const reportHtml=computed(()=>renderEntry(bundle.value?.entrypoints.report))
function renderEntry(entry){return safeMarkdown(entry?.content,target=>{
  const id=artifactLink(target,entry.path,bundle.value.artifacts);return id?'#artifact:'+encodeURIComponent(id):null
})}
function renderArtifact(item){return renderEntry(item)}
function artifactTitle(path){return path?.split('/').at(-1)?.replace(/\.(md|json|txt|py)$/,'') || '原始資料'}
function versionLabel(item){const n=item.revision_id.match(/^v(\d+)/)?.[1] || item.revision_id;return '第 '+n+' 版 · '+(item.revision_id.includes('reader')?'白話研究':item.revision_id.includes('model')?'模型原稿':item.revision_id.includes('agent')?'審修研究':item.revision_id.includes('v4')?'條件研究':item.revision_id.includes('v2')?'修訂研究':'初稿')}
function titleFor(item){return item.revision_id.includes('reader')?'如何賺錢、風險與估值':item.revision_id.includes('v4')?'獲利、估值與承諾情境':item.revision_id.includes('model')?'模型原始研究':item.revision_id.includes('v3')?'商業與現金流研究':item.revision_id+' 研究'}
function reportUrl(id){return '?workspace=company&bundle='+encodeURIComponent(id)}
function tabUrl(id){return reportUrl(selectedId.value)+'&researchTab='+encodeURIComponent(id)}
function updateUrl(push=false) {
  if(!props.active)return
  const p=new URLSearchParams();p.set('workspace','company')
  if(view.value==='detail' && selectedId.value){p.set('bundle',selectedId.value);p.set('researchTab',tab.value);if(tab.value==='report'&&reportSection.value)p.set('reportSection',reportSection.value);if(selectedArtifact.value && tab.value==='artifact')p.set('artifact',selectedArtifact.value.artifact_id)}
  if(view.value==='job' && jobReading.value){p.set('company',jobReading.value.company || company.value);p.set('job',jobReading.value.job_id);p.set('researchView','job');p.set('researchTab',tab.value)}
  if(view.value==='new') {p.set('researchView','new');p.set('company',newCompany.value)}
  if(view.value==='company'){
    p.set('company',company.value)
    const current=new URLSearchParams(window.location.search)
    if(current.get('company')===company.value && current.get('companyTab')==='financials'){for(const key of ['companyTab','financialView','period','asOf','claim','callSection','financialTopic','comparePeriod','researchCycle'])if(current.get(key))p.set(key,current.get(key))}
    if(current.get('company')===company.value && current.get('companyTab')==='viewpoints'){
      p.set('companyTab','viewpoints')
      if(current.get('viewpointSearch'))p.set('viewpointSearch',current.get('viewpointSearch'));if(current.get('viewpointRole'))p.set('viewpointRole',current.get('viewpointRole'));if(current.get('viewpoint'))p.set('viewpoint',current.get('viewpoint'))
    }
  }
  if(filter.value)p.set('companySearch',filter.value)
  if(industry.value)p.set('companyIndustry',industry.value)
  if(market.value)p.set('companyMarket',market.value)
  if(favoritesOnly.value)p.set('companyFavorites','1')
  if(replayResult.value)p.set('replay',replayResult.value.run.id)
  window.history[push?'pushState':'replaceState'](window.history.state,'',window.location.pathname+'?'+p)
}
async function refresh() {
  const serial=invalidate(),p=new URLSearchParams(window.location.search)
  error.value='';loading.value=true
  try {
    const loaded=await Promise.all([localApi('canonical/bundles'),localApi('research-jobs'),companyHubs(),researchTraceability()]);if(serial!==refreshSequence || !props.active)return;catalog.value=loaded[0];jobs.value=loaded[1].jobs || [];hubs.value=loaded[2];trace.value=loaded[3]
    filter.value=p.get('companySearch') || '';industry.value=p.get('companyIndustry')||'';market.value=p.get('companyMarket')||'';favoritesOnly.value=p.get('companyFavorites')==='1';company.value=p.get('company') || '';newCompany.value=p.get('company') || 'NVDA'
    if(p.get('researchView')==='job' && p.get('job')) {const reading=await localApi('research-jobs/'+encodeURIComponent(p.get('job'))+'/reading');if(serial!==refreshSequence || !props.active)return;if(Array.isArray(reading.report_ast))registerMarkdown(reading.report_markdown,reading.report_ast);jobReading.value=reading;view.value='job';tab.value=p.get('researchTab') || 'report'}
    else if(p.get('bundle')) {await loadBundle(p.get('bundle'),false,p.get('replay'),serial);if(serial!==refreshSequence || !props.active)return;const requested=p.get('researchTab');if(tabs.some(item=>item.id===requested))tab.value=requested;if(tab.value==='versions')await loadComparison();if(p.get('artifact'))await openArtifact(p.get('artifact'),false);if(serial!==refreshSequence || !props.active)return;reportSection.value=p.get('reportSection')||'';updateUrl();await revealReportSection()}
    else {view.value=p.get('researchView')==='new'?'new':company.value?'company':'list';bundle.value=null;selectedId.value='';tab.value='report'}
  }catch(e){if(serial===refreshSequence && props.active)error.value=e.message || '研究未能載入。'}finally{if(serial===refreshSequence)loading.value=false}
}
function openCompany(ticker){if(!window.dispatchEvent(new Event('workspace-leave',{cancelable:true})))return;invalidate();company.value=ticker;view.value='company';bundle.value=null;selectedId.value='';error.value='';updateUrl(true)}
function showList(){if(!window.dispatchEvent(new Event('workspace-leave',{cancelable:true})))return;invalidate();view.value='list';bundle.value=null;selectedId.value='';tab.value='report';selectedArtifact.value=null;replayResult.value=null;error.value='';updateUrl(true)}
function showNew(){if(!window.dispatchEvent(new Event('workspace-leave',{cancelable:true})))return;invalidate();newCompany.value=company.value || 'NVDA';view.value='new';error.value='';updateUrl(true)}
async function loadBundle(id,push=false,replayId=null,refreshSerial=null) {
  if(push && !window.dispatchEvent(new Event('workspace-leave',{cancelable:true})))return
  if(refreshSerial===null)refreshSequence++
  reportSection.value='';const serial=++version;controller?.abort();controller=new AbortController();loading.value=true;error.value='';selectedArtifact.value=null
  try {const data=await localApi('canonical/bundles/'+encodeURIComponent(id),undefined,{signal:controller.signal});if(serial!==version)return
    await Promise.all(Object.values(data.entrypoints).filter(e=>e?.format==='markdown').map(e=>prepareMarkdown(e.content,controller.signal)));if(serial!==version)return
    view.value='detail';tab.value='report';bundle.value=data;selectedId.value=id;company.value=data.manifest.security.ticker || data.manifest.security.symbol;replayResult.value=null;comparison.value=null
    if(replayId){const saved=await localApi('research-runs/'+encodeURIComponent(replayId));if(serial!==version)return;if(saved.run.mode==='canonical_recalculation' && saved.receipt.manifest_sha256===data.manifest_sha256 && saved.run.bundle_id===id)replayResult.value=saved;else throw new Error('重算紀錄與目前版本不一致。')}
    updateUrl(push)
  }catch(e){if(e.name!=='AbortError' && serial===version){error.value=e.message;bundle.value=null}}finally{if(serial===version)loading.value=false}
}
async function loadComparison(){const serial=version,other=catalog.value?.bundles.find(item=>item.bundle_id!==selectedId.value && (item.issuer.id || item.issuer.issuer_id)===(bundle.value?.manifest.issuer.id || bundle.value?.manifest.issuer.issuer_id));if(!other)return;try{const ids=[other.bundle_id,selectedId.value].sort((a,b)=>a.localeCompare(b));const result=await localApi('canonical/compare?left='+encodeURIComponent(ids[0])+'&right='+encodeURIComponent(ids[1]));if(serial===version)comparison.value=result}catch(e){if(serial===version)error.value=e.message}}
function setTab(id){reportSection.value='';invalidate();selectedArtifact.value=null;tab.value=id;updateUrl(true);if(id==='versions')loadComparison()}
async function openArtifact(id,push=true){const serial=version;error.value='';try{const result=await localApi('canonical/bundles/'+encodeURIComponent(selectedId.value)+'/artifacts/'+encodeURIComponent(id));if(result.format==='markdown')await prepareMarkdown(result.content);if(serial!==version || !props.active)return;selectedArtifact.value=result;tab.value='artifact';updateUrl(push)}catch(e){if(serial===version && props.active)error.value=e.message}}
function reportClick(event){const a=event.target.closest('a[href^="#artifact:"]');if(a){event.preventDefault();openArtifact(decodeURIComponent(a.getAttribute('href').slice(10)))}}
async function replay(){if(replaying.value)return;const serial=version;replaying.value=true;error.value='';try{const result=await localApi('canonical/bundles/'+encodeURIComponent(selectedId.value)+'/recalculate',{manifest_sha256:bundle.value.manifest_sha256});if(serial!==version || !props.active)return;replayResult.value=result;updateUrl()}catch(e){if(serial===version && props.active)error.value=e.message}finally{replaying.value=false}}
function pop(){const p=new URLSearchParams(window.location.search),w=p.get('workspace');if(!props.active)return;if(w==='company' && view.value==='company' && p.get('company')===company.value && !p.has('bundle') && !p.has('researchView'))return;if(w==='company' || (!w && !['run','lead','q','view','offset','topic','match','bucket'].some(k=>p.has(k))))refresh()}
watch(()=>props.active,value=>{if(!value)invalidate();else{loadPrivate();refresh()}})
onMounted(()=>{window.addEventListener('popstate',pop);if(props.active)refresh()})
onUnmounted(()=>{invalidate();window.removeEventListener('popstate',pop)})
</script>
