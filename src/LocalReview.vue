<template>
  <section class="research-desk" :class="{'is-reading':reading}" aria-label="X 原文與待查紀錄">
    <a class="skip-link" href="#research-content">跳到閱讀區</a>
    <div v-if="error" class="notice error-notice" role="alert"><strong>{{ error }}</strong><button v-if="!snapshot" class="quiet" @click="refresh">重試載入</button></div>
    <p class="sr-only" aria-live="polite">{{ notice }}</p>
    <div class="desk-layout">
      <aside class="queue" aria-label="研究線索與紀錄">
        <nav class="queue-nav" aria-label="研究入口">
          <a :class="{selected:nav.view==='leads'}" :aria-current="nav.view==='leads'?'page':undefined" :href="link({view:'leads',lead:'',run:''})" @click="go($event,{view:'leads',lead:'',run:''})">全庫線索 <span>{{ loading ? '…' : snapshot?.coverage?.matched_posts ?? leads.length }}</span></a>
          <a :class="{selected:nav.view==='history'}" :aria-current="nav.view==='history'?'page':undefined" :href="link({view:'history',lead:'',run:''})" @click="go($event,{view:'history',lead:'',run:''})">已保存研究 <span>{{ history.length }}</span></a>
        </nav>
        <template v-if="nav.view==='leads'">
          <div class="queue-tools">
            <label class="search-label" for="lead-search">搜尋全庫貼文</label>
            <div class="search-box"><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/></svg><input id="lead-search" :value="nav.search" @input="filter({search:$event.target.value})" name="lead-search" type="search" autocomplete="off" placeholder="關鍵字、作者或標的…" /></div>
            <div class="search-options"><label for="search-match">匹配方式</label><select id="search-match" v-model="nav.match" @change="filter({match:nav.match})"><option value="all_terms">所有詞都出現</option><option value="phrase">完整片語</option></select><button type="button" class="quiet" data-testid="search-submit" :disabled="saving || researching" @click="searchPosts(0)">查詢</button></div>
            <div class="source-date-filters"><label>作者（完整帳號）<input v-model="nav.author" @change="filter({author:nav.author})" placeholder="不含 @，留空為全部" /></label><label>發布日期起<input type="date" v-model="nav.from" @change="filter({from:nav.from})"/></label><label>發布日期迄<input type="date" v-model="nav.to" @change="filter({to:nav.to})"/></label></div><p class="field-help">搜尋原文、作者、標的及貼文 ID；逐字查找，沒有語意或同義詞搜尋。</p>
            <div class="topic-filters" aria-label="文字主題索引"><button v-for="topic in topics" :key="topic.id" :aria-pressed="nav.topic===topic.id" :class="{active:nav.topic===topic.id}" @click="filter({topic:topic.id})">{{ topic.label }}</button></div>
            <div class="queue-meta"><span>{{ loading ? '載入線索中…' : `匹配 ${snapshot?.coverage?.matched_posts ?? filtered.length} 則 · 本頁 ${filtered.length} 則` }}</span><button v-if="nav.search || nav.topic!=='all' || nav.author || nav.from || nav.to" class="text-button" @click="filter({search:'',topic:'all',author:'',from:'',to:''})">清除篩選</button><button v-else class="text-button" :disabled="loading || saving || researching" @click="refresh">重新載入</button></div>
          </div>
          <div v-if="loading" class="queue-loading" aria-hidden="true"><div v-for="n in 4" :key="n" class="skeleton-row"><span></span><b></b><b></b></div></div>
          <div v-else-if="!leads.length && !nav.search && nav.topic==='all'" class="queue-empty"><h2>目前沒有線索</h2><p>{{ error ? '資料快照載入失敗，請重試。' : '本次部署的來源快照沒有貼文。' }}</p></div>
          <div v-else-if="!filtered.length" class="queue-empty"><h2>沒有符合的線索</h2><p>換一個關鍵字，或清除主題篩選再看看。</p></div>
          <div v-else ref="queueList" class="queue-list">
            <a v-for="lead in filtered" :key="lead.id" :href="link({lead:lead.id,run:leadRuns.get(lead.id)||'',view:'leads'})" @click="openLead($event,lead)" :class="['lead-row',{active:nav.lead===lead.id || (!reading && lastLead===lead.id)}]" :aria-current="nav.lead===lead.id?'true':undefined" data-testid="lead-row" :data-lead="lead.id">
              <span class="lead-byline">{{ sourceName(lead.source || {}) }}<span aria-hidden="true">↗</span></span>
              <span class="lead-excerpt">{{ lead.text || '原文尚未取得' }}</span>
              <span class="lead-meta"><time>{{ formatDate(lead.source?.published_at) }}</time><span>{{ lead.signals.filter(s=>s.ticker_key).length }} 個標的關聯</span></span>
            </a>
          </div>
          <nav v-if="snapshot?.posts" class="pagination" aria-label="貼文分頁"><button class="quiet" :disabled="loading || nav.offset===0" @click="searchPosts(Math.max(0,nav.offset-30),true)">上一頁</button><span>第 {{ Math.floor(nav.offset/30)+1 }} 頁</span><button class="quiet" :disabled="loading || snapshot.coverage.next_offset===null" @click="searchPosts(snapshot.coverage.next_offset,true)">下一頁</button></nav>
          <p class="queue-footnote">主題依文字索引，未判定訊號重要性。每則貼文合併多個標的關聯。</p>
        </template>
        <template v-else>
          <div class="history-intro"><p>選擇紀錄，查看當時摘錄與判斷版本。</p></div>
          <div v-if="!history.length" class="queue-empty"><h3>還沒有研究紀錄</h3><p>從一則貼文檢查案例後，這裡會保留該次研究。</p><a :href="link({view:'leads'})" @click="go($event,{view:'leads'})">查看研究線索 →</a></div>
          <div v-else class="queue-list">
            <a v-for="run in history" :key="run.id" class="history-row" :class="{active:nav.run===run.id}" :href="link({run:run.id,lead:'',view:'history'})" @click="go($event,{run:run.id,lead:'',view:'history'})" data-testid="history-row">
              <span class="history-title">{{ run.question || run.query || '先前研究' }}</span><span class="history-instrument">{{ run.ticker_key || '原文研究' }} · {{ statusLabel(run.decision_status) || (run.status==='abstained'?'未找到材料':'材料候選') }}</span><span v-if="run.next_step" class="history-next">下一步：{{ run.next_step }}</span><time>{{ formatDate(run.created_at) }}</time><span v-if="drafts[run.id]" class="draft-marker">有未保存草稿</span>
            </a>
          </div>
          <p class="queue-footnote">顯示最近 50 個 run 中的訊號研究。原始記錄與判斷版本持續保留。</p>
        </template>
      </aside>
      <section id="research-content" class="reading-plane" tabindex="-1" aria-label="閱讀與判斷">
        <template v-if="!reading">
          <div class="welcome">
            <h2>{{ nav.view==='history'?'選擇研究紀錄':'選擇貼文' }}</h2>
            <p class="welcome-description">{{ nav.view==='history'?'從紀錄清單開啟一份已保存結果。':'從貼文清單選擇一則，再輸入查找摘錄的關鍵字。' }}</p>
            <p class="loaded-summary">資料庫 {{ snapshot?.coverage?.raw_post_count ?? '…' }} 則原始貼文；本頁 {{ loading?'…':leads.length }} 則。已匯入摘錄 {{ health?.case_revisions || 0 }} 筆版本。</p>
            <p class="coverage-note">全庫可查找，每頁 30 則，保留無標的關聯的原文。資料範圍不代表市場完整或訊號正確。案例版本數不等於節目集數，未連接即時行情。</p>
            <p class="field-help">資料觀察 {{ formatDate(snapshot?.captured_at) }}</p>
            <details class="mobile-overview"><summary>全庫分頁 · 主張尚未評估 <span>查看範圍與限制</span></summary><p>全 raw_posts 可查找；上游標的分類可能缺漏。案例版本數不等於節目集數，未連接即時行情。引用存在不代表主張成立，沒有反證也不表示主張成立。</p></details>
            <p class="truth-note">摘錄比對只檢查詞彙與內容雜湊，沒有驗證主張或投資正確率。</p>
          </div>
        </template>
        <template v-else>
          <div class="reader-toolbar"><a :href="link({lead:'',run:''})" @click="go($event,{lead:'',run:''},true)"><span aria-hidden="true">←</span> {{ nav.view==='history'?'返回紀錄':'返回線索' }}</a><span v-if="result">{{ formatDate(result.run.created_at || result.as_of) }}</span><span v-else>閱讀來源</span></div>
          <div v-if="loadingRun" class="reader-body" aria-busy="true"><h2>載入研究材料中…</h2><div class="skeleton-reading" aria-hidden="true"></div></div>
          <div v-else-if="!readSignal" class="reader-body empty-reader"><h2>這則線索不在目前快照</h2><p>它可能超出本次載入範圍。已保存的研究仍可從紀錄開啟。</p><a :href="link({view:'history',lead:'',run:''})" @click="go($event,{view:'history',lead:'',run:''})">查看已保存研究 →</a></div>
          <div v-else class="reader-body">
            <h2 ref="readerHeading" tabindex="-1" data-testid="reader-heading">{{ result?'摘錄比對紀錄':'貼文' }}</h2>
            <article class="original-source">
              <div class="source-heading"><h3>{{ sourceName(readSignal.source) }}</h3><span class="type-label">X 原文</span></div>
              <p class="source-date">發布 {{ formatDate(readSignal.source.published_at) }}</p>
              <p class="original-text" data-testid="signal-text">{{ readSignal.text || '缺少原文，需回來源查證。' }}</p>
              <div class="instrument-options"><span>本次研究標的</span><button v-for="s in availableSignals" :key="s.id" :aria-pressed="readSignal.id===s.id" :class="{active:readSignal.id===s.id}" :disabled="Boolean(result) || researching || saving" @click="selectedSignalId=s.id">{{ s.ticker_key || '原文研究／未分類' }}</button></div>
              <p class="classification-note">原分類：{{ stanceLabel(readSignal.stance) }} · 分類忠實度尚未重新核對。</p><details :key="readSignal.id" @toggle="$event.target.open && loadVersions()"><summary>保留的分類版本</summary><p v-if="versionsError" role="alert">{{ versionsError }}</p><template v-if="retainedVersions"><p class="field-help">保留 {{ retainedVersions.signals.length }} 個分類項目與 {{ retainedVersions.classifications.length }} 個處理收據。這是DB仍保留的版本，無法還原被同鍵覆寫的分類或歷史原文編輯。</p><article v-for="(v,i) in retainedVersions.signals" :key="v.classifier_version+v.ticker_key+i"><strong>{{ v.ticker_key }} · {{ stanceLabel(v.stance) }}</strong><p>{{ v.reason_zh }}</p><p class="field-help">{{ v.classifier_version }} · {{ formatDate(v.classified_at_utc) }} · 原分類器信心 {{ v.confidence }}</p></article></template></details>
              <details v-if="readSignal.reason_zh"><summary>為什麼被這樣分類</summary><p>{{ readSignal.reason_zh }}</p><blockquote v-if="readSignal.evidence_quote">{{ readSignal.evidence_quote }}</blockquote><p class="field-help">原分類器信心值：{{ readSignal.confidence }}；此值不是校準正確率或報酬機率。分類時間：{{ formatDate(readSignal.classified_at_utc) }}</p></details><div v-if="result && currentLead" class="new-study"><p class="field-help">這份紀錄保留當時的來源快照。要查其他標的或目前來源版本，可另開研究；原判斷與草稿繼續保留。</p><button type="button" class="text-button" :disabled="saving || researching" @click="navigate({lead:currentLead.id,run:'',bucket:'pending',view:'leads'})">用目前貼文開新研究 <span aria-hidden="true">→</span></button></div>
              <a v-if="safeUrl(readSignal.source.url)" :href="safeUrl(readSignal.source.url)" target="_blank" rel="noopener noreferrer" class="source-link">開啟 X 來源 <span aria-hidden="true">↗</span></a>
              <SourceDetails :source="readSignal.source" />
            </article>
            <form class="question-form" @submit.prevent="research">
              <label for="research-question">這次要核對的問題</label><textarea id="research-question" v-model="question" rows="2" maxlength="1000" required :disabled="researching || saving" placeholder="只問一個有來源可確認的問題…"></textarea>
              <label for="research-horizon">觀察期間</label><select id="research-horizon" v-model="horizon" :disabled="researching || saving"><option value="unspecified">尚未決定</option><option value="days_weeks">數天到兩週</option><option value="months">一到三個月</option><option value="long_term">半年以上</option></select><p class="field-help">這是問題的觀察期間；資料截至時間另列，不代表資金持有期限。</p>
              <label for="research-query">查找已匯入一手摘錄的關鍵字</label><p class="field-help" id="query-help">比對已匯入一手摘錄的詞彙；未匹配時可保存待查。完整研究及證據索引請從公司與報告閱讀。</p>
              <textarea id="research-query" v-model="query" name="research-query" autocomplete="off" maxlength="1000" rows="2" required aria-describedby="query-help query-error" data-testid="review-query" :disabled="researching || saving" placeholder="例如：AI 軟體收入能否支撐成本…"></textarea>
              <p v-if="queryError" id="query-error" class="field-error" role="alert">{{ queryError }}</p>
              <details class="time-options"><summary>調整研究截至時間</summary><label for="as-of">含時區的 ISO 日期時間</label><input id="as-of" v-model="asOf" name="as-of" autocomplete="off" placeholder="2026-10-08T12:00:00+08:00…" :disabled="researching || saving" /><p class="field-help">留空使用現在。這只限制可用來源時間，尚未實作歷史行情重播。</p></details>
              <div class="question-actions"><button class="primary" :disabled="researching || saving || !canResearch" data-testid="review-submit">{{ researching?'查找中…':'查找一手摘錄' }} <span v-if="!researching" aria-hidden="true">→</span></button><button v-if="researching" type="button" class="quiet" @click="cancelResearch">取消等待</button><span v-else class="field-help">{{ result?'沿用此紀錄的來源快照':'同時保存這次比對結果' }}</span></div>
            </form>
            <div v-if="researching" class="research-loading" role="status"><h3>正在比對來源與案例…</h3><div class="skeleton-reading" aria-hidden="true"></div></div>
            <section v-if="result" class="review-result">
              <div class="evidence-header"><div><h3>{{ result.status==='abstained'?'未找到詞彙匹配的摘錄':'找到的摘錄' }}</h3><p>{{ result.status==='abstained'?'可修改關鍵字，或保存待查事項。':'詞彙匹配不代表相關或支持；先核對原始來源。' }}</p></div></div>
              <div class="evidence-filters" aria-label="案例分類"><button v-for="bucket in buckets" :key="bucket.key" :aria-pressed="nav.bucket===bucket.key" :class="{active:nav.bucket===bucket.key}" @click="filter({bucket:bucket.key})">{{ bucket.title }}（{{ result[bucket.key].length }}）</button></div>
              <p class="evidence-note">{{ nav.bucket==='pending'?'詞彙相關，不代表支持此訊號；整理摘要仍需核對原話。':'只收錄與此訊號明確關聯且已審閱的原始證據。' }}</p>
              <div v-if="!result[nav.bucket].length" class="empty-evidence"><h4>{{ activeBucket.emptyTitle }}</h4><p>{{ activeBucket.empty }}</p></div>
              <article v-for="c in result[nav.bucket]" :key="c.id+c.revision_id" class="case-card" data-testid="case-card">
                <div class="case-byline"><span class="type-label">{{ c.source.representation==='summary'?'整理摘要':'來源材料' }}</span><span>發布 {{ publicationLabel(c.source) }}</span></div>
                <h4>{{ c.source.title }}</h4><blockquote>{{ c.excerpt }}</blockquote>
                <dl class="claim-conditions"><div><dt>成立條件</dt><dd>{{ c.conditions.length?c.conditions.join('；'):'尚未取得可驗證條件' }}</dd></div><div><dt>反證條件</dt><dd>{{ c.falsifiers.length?c.falsifiers.join('；'):'尚未取得可驗證反證' }}</dd></div></dl>
                <dl class="claim-conditions"><div><dt>方向</dt><dd>{{ directionLabel(c.direction || c.relation) }}</dd></div><div><dt>核實狀態</dt><dd>引用雜湊已核對；來源 {{ c.verification?.source_review==='reviewed'?'人工已審閱':'未審閱' }}；此問題的關係 {{ c.verification?.relation_review==='reviewed'?'人工已審閱':'未審閱' }}；主張真偽未評估。</dd></div></dl>
                <p class="match-note">匹配詞：{{ c.matched_terms.join('、') }} · 詞彙候選，仍需判斷相關性。</p>
                <a v-if="safeUrl(c.source.url)" :href="safeUrl(c.source.url)" target="_blank" rel="noopener noreferrer" class="source-link">開啟原始來源 ↗</a><SourceDetails :source="c.source" />
              </article>
              <section class="checklist"><div class="checklist-heading"><h3>接下來要確認</h3><span>{{ allGaps.length }} 項</span></div><ul><li v-for="gap in allGaps" :key="gap">{{ gap }}</li></ul><details class="technical-details"><summary>快照範圍與排除紀錄</summary><p>截至 {{ formatDate(result.as_of) }} · 引用檢查 {{ result.evaluation.citation_checks==='passed'?'通過':'無匹配案例' }}</p><pre>{{ JSON.stringify({snapshot_id:result.snapshot_id,coverage:result.coverage,rejected:result.rejected},null,2) }}</pre></details></section>
              <form class="decision-form" @submit.prevent="saveDecision">
                <label for="decision-status">目前研究狀態</label><select id="decision-status" v-model="decisionStatus" data-testid="decision-status" :disabled="saving"><option value="researching">繼續研究</option><option value="waiting">資料不足／待查</option><option value="skip">暫不追蹤</option><option value="bounded_judgment">已有有界判斷</option></select>
                <label for="my-decision">我的判斷與待查事項</label><textarea id="my-decision" v-model="decision" name="my-decision" autocomplete="off" maxlength="10000" required rows="5" data-testid="decision-input" :disabled="saving" placeholder="寫下目前看法與仍需查證的地方…"></textarea>
                <fieldset class="reference-options"><legend>這版判斷引用的材料</legend><label v-for="ref in referenceOptions" :key="ref.id"><input type="checkbox" v-model="sourceRefs" :value="ref.id" :disabled="saving" /> {{ ref.label }}</label></fieldset>
                <label for="next-step">下一步或複查觸發條件</label><textarea id="next-step" v-model="nextStep" data-testid="next-step" maxlength="2000" rows="2" :disabled="saving" placeholder="要找哪份資料、核對哪個期間，或出現什麼變化再回來…"></textarea>
                <label for="review-on">複查日期（選填）</label><input id="review-on" v-model="reviewOn" data-testid="review-on" type="date" :disabled="saving" /><p class="field-help">日期只保存於紀錄；不會建立通知或排程。</p>
                <div class="decision-actions"><button class="primary" :disabled="saving || researching" data-testid="decision-save">{{ saving?'保存中…':'保存判斷新版本' }}</button><span class="draft-marker">{{ decision?'草稿留在本頁，尚未保存':savedNotice }}</span></div>
                <p class="field-help">每次保存追加新版本，保留原內容。自動匯入案例不會覆寫你的判斷。</p>
              </form>
              <section v-if="decisions.length" class="decision-history"><h3>已保存的判斷 <span>{{ decisions.length }} 版</span></h3><article v-for="d in [...decisions].reverse()" :key="d.id" data-testid="decision-revision"><div><strong>版本 {{ d.revision }} · {{ statusLabel(d.details?.status) || '舊版文字紀錄' }}</strong><time>{{ formatDate(d.created_at) }}</time></div><p>{{ d.text }}</p><template v-if="d.details"><p>下一步：{{ d.details.next_step || '未指定' }} · 複查 {{ d.details.review_on || '未指定' }}</p><p v-if="d.details.source_refs.length">引用：{{ d.details.source_refs.map(refLabel).join('；') }}</p></template></article></section>
            </section>
          </div>
        </template>
      </section>
    </div>
  </section>
</template>

<script setup>
import {computed,nextTick,onMounted,onUnmounted,reactive,ref,watch} from 'vue'
import {localApi,xClassificationHistory} from './api'
import SourceDetails from './SourceDetails.vue'
import {filterLeads,formatDate,publicationLabel,groupSignals,isSignalReview,readState,safeUrl,sourceName,stanceLabel,stateUrl,topics} from './workbench-model'
defineEmits(['open-demo','open-company'])
const props=defineProps({active:{type:Boolean,default:true}})
const retainedVersions=ref(null),versionsError=ref('')
async function loadVersions(){const id=readSignal.value?.source.origin_id;retainedVersions.value=null;versionsError.value='';try{const versions=await xClassificationHistory(id);if(readSignal.value?.source.origin_id===id)retainedVersions.value=versions}catch(e){if(readSignal.value?.source.origin_id===id)versionsError.value=e.message}}
const nav=reactive(readState(window.location.search))
const snapshot=ref(null),health=ref(null),history=ref([]),result=ref(null),decisions=ref([])
const question=ref(''),horizon=ref('unspecified'),query=ref(''),asOf=ref(''),selectedSignalId=ref(''),error=ref(''),queryError=ref(''),notice=ref(''),savedNotice=ref('')
const loading=ref(false),loadingRun=ref(false),researching=ref(false),saving=ref(false),queueList=ref(null),readerHeading=ref(null),lastLead=ref('')
const drafts=reactive({}),detailDrafts=reactive({}),formDrafts=new Map(),formKey=ref(''),cache=new Map(),leadRuns=new Map(),postCache=new Map()
let controller=null,requestVersion=0,queueScroll=0,listPageScroll=0
let searchController=null,searchVersion=0,searchTimer=null
const previousScrollRestoration=window.history.scrollRestoration
const buckets=[{key:'pending',title:'相關案例／待查',emptyTitle:'沒有待查案例',empty:'試著修改研究關鍵字，或回原節目補上主張與條件。'},
 {key:'support',title:'已審閱支持',emptyTitle:'還沒有合格支持證據',empty:'相關觀點不等於支持。需核對原始來源、日期與此訊號的關聯。'},
 {key:'counter',title:'已審閱反證',emptyTitle:'還沒有合格反證',empty:'缺少反證不表示主張成立。回原始資料檢查哪些條件可能推翻它。'}]
const activeBucket=computed(()=>buckets.find(b=>b.key===nav.bucket))
const leads=computed(()=>snapshot.value?.posts || groupSignals(snapshot.value?.signals || []))
const filtered=computed(()=>snapshot.value?.posts ? leads.value : filterLeads(leads.value,nav.search,nav.topic))
const activeLead=computed(()=>leads.value.find(l=>l.id===nav.lead) || postCache.get(nav.lead))
const currentLead=computed(()=>leads.value.find(l=>l.id===result.value?.signal.source.id) || postCache.get(result.value?.signal.source.id))
const availableSignals=computed(()=>result.value?[result.value.signal]:activeLead.value?.signals || [])
const readSignal=computed(()=>result.value?.signal || availableSignals.value.find(s=>s.id===selectedSignalId.value) || availableSignals.value[0])
watch(()=>readSignal.value?.id,()=>{retainedVersions.value=null;versionsError.value=''})
const reading=computed(()=>Boolean(nav.lead || nav.run))
const canResearch=computed(()=>Boolean(result.value?.snapshot_id || activeLead.value?.snapshot_id || snapshot.value?.signals.some(s=>s.id===readSignal.value?.id)))
const decision=computed({get:()=>drafts[result.value?.run.id] || '',set:value=>{if(result.value)drafts[result.value.run.id]=value}})
const detailDefaults=()=>({status:'researching',next_step:'',review_on:null,source_refs:[]})
function detailField(key,fallback) {return computed({get:()=>detailDrafts[result.value?.run.id]?.[key] ?? fallback,set:value=>{if(result.value)detailDrafts[result.value.run.id]={...(detailDrafts[result.value.run.id] || detailDefaults()),[key]:value}}})}
const decisionStatus=detailField('status','researching'),nextStep=detailField('next_step',''),reviewOn=detailField('review_on',''),sourceRefs=detailField('source_refs',[])
const referenceOptions=computed(()=>result.value?[{id:result.value.signal.source.id+'@'+result.value.signal.source.revision_id,label:'X 原文 · '+sourceName(result.value.signal.source)},...result.value.cases.map(c=>({id:c.id+'@'+c.revision_id,label:c.source.title}))]:[])
function refLabel(id) {return referenceOptions.value.find(r=>r.id===id)?.label || id}
function statusLabel(value) {return {researching:'繼續研究',waiting:'資料不足／待查',skip:'暫不追蹤',bounded_judgment:'已有有界判斷'}[value] || ''}
function directionLabel(value) {return {supports:'支持方向',contradicts:'反對方向',context:'脈絡',unclear:'未判定'}[value] || '未判定'}
watch([question,query,horizon,asOf],()=>{if(formKey.value)formDrafts.set(formKey.value,{question:question.value,query:query.value,horizon:horizon.value,asOf:asOf.value})})
const gapLabels={share_class_unknown:'股別未知',published_at_unknown:'發布時間未知',published_at_invalid:'發布時間格式不明',seen_at_unknown:'首次看見時間未知',processed_at_unknown:'分類時間未知',processed_at_invalid:'分類時間格式不明',revised_at_invalid:'修訂時間格式不明',original_ticker_identity_unknown:'原始標的身分未知',original_ticker_identity_ambiguous:'原始標的身分有歧義',original_text_missing:'缺少 X 原文'}
const allGaps=computed(()=>[...new Set([...(result.value?.pending_checks || []),...(result.value?.signal.source.gaps || []),...(result.value?.cases.flatMap(c=>c.source.gaps || []) || []),...(result.value?.gaps || [])])].map(g=>gapLabels[g] || g))
function link(patch) {const p=new URLSearchParams(stateUrl({...nav,...patch}));p.set('workspace','signals');return window.location.pathname+'?'+p}
function go(event,patch,restore=false) {
  if(event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return
  event.preventDefault();navigate(patch,restore)
}
function remember() {window.history.replaceState({...window.history.state,scroll:window.scrollY},'',window.location.href);if(!reading.value)listPageScroll=window.scrollY;if(queueList.value)queueScroll=queueList.value.scrollTop}
async function navigate(patch,restore=false) {
  if(saving.value){notice.value='正在保存，完成後即可切換研究。';return}
  remember(); cancelResearch(false)
  if(patch.lead)lastLead.value=patch.lead
  else if(nav.lead)lastLead.value=nav.lead
  Object.assign(nav,patch);window.history.pushState({scroll:restore?listPageScroll:0},'',link({}))
  await activate();await focusView(restore)
}
function filter(patch) {Object.assign(nav,patch);window.history.replaceState(window.history.state,'',link({}));if(Object.keys(patch).some(k=>['search','topic','match','author','from','to'].includes(k))){loading.value=true;clearTimeout(searchTimer);searchTimer=setTimeout(()=>searchPosts(0),250)}notice.value='正在查找符合條件的貼文。'}
async function searchPosts(offset=0,paging=false,historyMode=paging?'push':'replace') {
  if(paging)remember()
  clearTimeout(searchTimer);searchController?.abort();searchController=new AbortController();const version=++searchVersion
  loading.value=true;error.value=''
  const params=new URLSearchParams({q:nav.search,match:nav.match || 'all_terms',topic:nav.topic,offset:String(offset),limit:'30',author:nav.author||'',from:nav.from||'',to:nav.to||''})
  if(paging && snapshot.value?.dataset_id)params.set('dataset_id',snapshot.value.dataset_id)
  try {const data=await localApi('posts?'+params,undefined,{signal:searchController.signal})
    if(version!==searchVersion || !props.active)return false
    snapshot.value=data;nav.offset=offset
    if(historyMode==='push')window.history.pushState({scroll:0},'',link({}))
    else window.history.replaceState(window.history.state,'',link({}))
    for(const lead of leads.value)postCache.set(lead.id,{...lead,snapshot_id:data.snapshot_id})
    notice.value=`匹配 ${data.coverage.matched_posts ?? leads.value.length} 則；本頁 ${leads.value.length} 則。`
    return true
  } catch(e){if(version===searchVersion && e.name!=='AbortError')error.value=e.status===409?'來源已有新版本。請重新查詢第一頁。':message(e,'全庫查找失敗。請重試查詢。');return false}
  finally{if(version===searchVersion)loading.value=false}
}
function openLead(event,lead) {go(event,{lead:lead.id,run:leadRuns.get(lead.id)||'',view:'leads'})}
async function focusView(restore=false) {
  await nextTick()
  if(queueList.value)queueList.value.scrollTop=queueScroll
  if(reading.value) {readerHeading.value?.focus({preventScroll:true});window.scrollTo(0,0)}
  else if(restore) {window.scrollTo(0,window.history.state?.scroll || 0);Array.from(document.querySelectorAll('[data-lead]')).find(e=>e.dataset.lead===lastLead.value)?.focus({preventScroll:true})}
}
function assertSignalReview(data) {
  if(!isSignalReview(data)){const e=new Error('Unsupported run type');e.code='unsupported_run';throw e}
}
function applyResult(data,versions) {
  assertSignalReview(data)
  result.value=data;decisions.value=versions;formKey.value=data.run.id
  setForm(formDrafts.get(data.run.id) || {question:data.question || data.query,query:data.query,horizon:data.horizon || 'unspecified',asOf:data.as_of})
  if(!detailDrafts[data.run.id])detailDrafts[data.run.id]={...detailDefaults(),...(versions.at(-1)?.details || {})}
  cache.set(data.run.id,{data,versions});if(data.signal.source.id)leadRuns.set(data.signal.source.id,data.run.id)
}
function setForm(values) {question.value=values.question;query.value=values.query;horizon.value=values.horizon;asOf.value=values.asOf || ''}
async function activate() {
  result.value=null;decisions.value=[];error.value='';savedNotice.value='';queryError.value=''
  if(nav.run) {
    const existing=cache.get(nav.run)
    if(existing){applyResult(existing.data,existing.versions);return}
    const version=++requestVersion,id=nav.run;loadingRun.value=true
    try {const data=await localApi(`research-runs/${encodeURIComponent(id)}`);assertSignalReview(data);const versions=(await localApi(`research-runs/${encodeURIComponent(id)}/decisions`)).decisions;if(version===requestVersion)applyResult(data,versions)}
    catch(e){if(version===requestVersion)error.value=message(e,'研究紀錄未能載入。請從已保存研究重試。')}
    finally {if(version===requestVersion)loadingRun.value=false}
  } else {selectedSignalId.value=activeLead.value?.signals[0]?.id || '';formKey.value=nav.lead;setForm(formDrafts.get(nav.lead) || {question:'',query:'',horizon:'unspecified',asOf:''});loadingRun.value=false}
}
function message(e,fallback) {if(e.code==='unsupported_run')return '此紀錄不是訊號研究。請从資料來源選擇貼文，或返回公司與報告。';if(e.status===409)return '已有其他判斷版本保存。草稿已保留；請讀取最新版本後再保存。';if(e.status===400)return '資料或時間無法用於這次研究。確認研究問題與截至時間，或重新載入來源。';return fallback}
async function runs() {history.value=(await localApi('research-runs')).runs.filter(r=>r.mode==='signal_review')}
async function refresh() {
  if(loading.value || saving.value || researching.value)return
  const initial=snapshot.value===null
  loading.value=true;error.value=''
  try {const [h,r]=await Promise.all([localApi('health'),localApi('research-runs')]);health.value=h;history.value=r.runs.filter(x=>x.mode==='signal_review');const loaded=await searchPosts(nav.offset || 0)
    if(loaded)notice.value=`已載入 ${leads.value.length} 則貼文；目前研究問題與時間保留。`
    if(initial && !result.value && (loaded || nav.run)){const sourceError=error.value;await activate();if(sourceError && !error.value)error.value=sourceError}
  }
  catch(e){error.value=message(e,'來源快照未能載入，請重試載入。')}
  finally{loading.value=false}
}
function cancelResearch(announce=true) {
  requestVersion++;controller?.abort();controller=null;const wasResearching=researching.value;researching.value=false;loadingRun.value=false
  if(announce && wasResearching){notice.value='已取消本頁等待。已送出的研究仍可能保存在紀錄。';error.value='已取消等待；已保存的比對紀錄仍可從「已保存研究」。'}
}
async function research() {
  if(researching.value || saving.value || !canResearch.value)return
  queryError.value='';if(!question.value.trim() || !query.value.trim()){queryError.value='填入一個研究問題及摘錄關鍵字。';document.getElementById(!question.value.trim()?'research-question':'research-query').focus();return}
  researching.value=true;error.value='';const version=++requestVersion;controller=new AbortController()
  try {const data=await localApi('signal-reviews',{snapshot_id:result.value?.snapshot_id || activeLead.value?.snapshot_id || snapshot.value.snapshot_id,signal_id:readSignal.value.id,question:question.value,horizon:horizon.value,query:query.value,as_of:asOf.value || null},{signal:controller.signal});if(version!==requestVersion)return
    applyResult(data,[]);Object.assign(nav,{run:data.run.id,bucket:'pending'});window.history.replaceState(window.history.state,'',link({}));await runs();notice.value=data.cases.length?'材料候選已保存。請核對來源，再留下判斷。':'未找到材料。問題已保存，可記錄待查與下一步。'
  } catch(e){if(version===requestVersion && e.name!=='AbortError')error.value=message(e,'案例未能載入。保留目前問題，稍後可重試。')}
  finally{if(version===requestVersion){researching.value=false;controller=null}}
}
async function saveDecision() {
  if(saving.value || !result.value || !decision.value.trim())return
  if(decisionStatus.value==='waiting' && !nextStep.value.trim()){error.value='待查需要填寫具體下一步或觸發條件。';document.getElementById('next-step').focus();return}
  if(decisionStatus.value==='bounded_judgment' && !sourceRefs.value.length){error.value='有界判斷需要選擇引用材料，並在文字說明能確認到哪裡。';return}
  saving.value=true;error.value='';const id=result.value.run.id,text=decision.value
  try {const saved=await localApi(`research-runs/${encodeURIComponent(id)}/decisions`,{text,expected_revision:decisions.value.at(-1)?.revision || 0,details:{status:decisionStatus.value,next_step:nextStep.value,review_on:reviewOn.value || null,source_refs:sourceRefs.value}});decisions.value.push(saved);drafts[id]='';cache.set(id,{data:result.value,versions:decisions.value});savedNotice.value=`已保存版本 ${saved.revision}`;notice.value=savedNotice.value;await runs()}
  catch(e){error.value=message(e,'判斷未能保存。草稿已保留，重新載入紀錄後重試。');if(e.status===409){try{decisions.value=(await localApi(`research-runs/${encodeURIComponent(id)}/decisions`)).decisions;cache.set(id,{data:result.value,versions:decisions.value})}catch{error.value+=' 最新版本未能載入，請先重試載入紀錄。'}}}
  finally{saving.value=false}
}
function beforeUnload(event) {if(saving.value || Object.values(drafts).some(v=>v.trim()) || (!result.value && (question.value.trim() || query.value.trim()))){event.preventDefault();event.returnValue=''}}
async function popState() {
  const p=new URLSearchParams(window.location.search),w=p.get('workspace');if(w!=='signals' && (w || !['run','lead','q','view','offset','topic','match','bucket'].some(k=>p.has(k))))return
  if(saving.value){window.history.pushState(window.history.state,'',link({}));notice.value='正在保存，完成後即可切換。';return}
  cancelResearch(false);Object.assign(nav,readState(window.location.search))
  const loaded=snapshot.value?.query
  if(snapshot.value?.posts && (!loaded || loaded.q!==nav.search.trim() || loaded.match!==nav.match || loaded.topic!==nav.topic || loaded.offset!==nav.offset)) {
    const loadedPage=await searchPosts(nav.offset || 0,true,'replace');if(!loadedPage)return
  }
  await activate();await focusView(!reading.value);window.scrollTo(0,window.history.state?.scroll || 0)
}
watch(()=>props.active,active=>{if(!active){clearTimeout(searchTimer);searchVersion++;searchController?.abort();loading.value=false;cancelResearch(false)}else if(!snapshot.value)refresh();else popState()})
onMounted(()=>{window.history.scrollRestoration='manual';window.addEventListener('popstate',popState);window.addEventListener('beforeunload',beforeUnload);if(props.active)refresh()})
onUnmounted(()=>{clearTimeout(searchTimer);searchController?.abort();window.history.scrollRestoration=previousScrollRestoration;cancelResearch(false);window.removeEventListener('popstate',popState);window.removeEventListener('beforeunload',beforeUnload)})
</script>

<style scoped src="./workbench.css"></style>
