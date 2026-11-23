<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, toRaw, watch } from 'vue'
import { financialResearch } from './api.js'
import { selectDocumentVersions } from './financial-research.mjs'
import './financial-research.css'

const props = defineProps({ company: String, active: Boolean, latest: Object })
defineEmits(['read'])
const bundle = ref(null), loading = ref(false), error = ref(''), errorStatus = ref(null), notice = ref(''), retries = ref(0)
// Only a real 404 means "no imported data"; auth, rate-limit, server or timeout failures prove nothing about existence.
const showEmpty = computed(() => !error.value || errorStatus.value === 404)
const view = ref('financials'), period = ref(''), asOf = ref(''), section = ref(''), topic = ref('')
const comparePeriod = ref(''), selectedClaim = ref(''), selectedEvidence = ref(null), dialog = ref(null)
let sequence = 0, controller, timeout, returnFocus, mounted = false, savedFilters = {}
const views = [{ id: 'financials', label: '財務' }, { id: 'calls', label: '法說' }, { id: 'changes', label: '變化' }]
const labels = { revenue: '營收', Revenue: '營收', gross_profit: '毛利', gross_margin: '毛利率', operating_expenses: '營業費用', operating_income: '營業利益', operating_margin: '營業利益率', net_income: '淨利', diluted_eps: '稀釋每股盈餘', eps: '每股盈餘', diluted_weighted_average_shares: '稀釋加權平均股數', operating_cash_flow: '營業現金流', capex: '資本支出', capex_purchases: '資本支出（購置設備與無形資產）', principal_payments: '設備與無形資產本金付款', free_cash_flow: '自由現金流', free_cash_flow_margin: '自由現金流率', days_sales_outstanding: '應收帳款天數（DSO）' }
const statuses = { reviewed: '已覆核', accepted: '資料包已接受', manually_accepted: '資料包已接受', draft: '草稿待核', pending: '待核對', not_due: '尚未到期', met: '已達成', partly_met: '部分達成', missed: '未達成', exceeded: '高於原區間上限（不是未達成）', withdrawn: '已撤回', redefined: '已重新定義', not_disclosed: '未揭露，無法判定', not_comparable: '口徑不可比', disputed: '仍有爭議', unresolved: '尚未解決', rejected: '未採用', verified: '已核', review_required: '待人工覆核', unavailable: '無法取得', directory_only: '只有目錄', full_text: '已取得全文', full_read: '已讀全文', read_full: '已讀全文', partial_read: '只讀片段', partial: '只讀片段', fetched: '已取得', retrieved: '已取得', unreviewed: '尚未覆核', unread: '尚未閱讀', directory_seen_in_prior_planning: '只有目錄', not_found_in_checked_IR_archive: '所查官方目錄未列', not_listed_on_official_ir: '官方 IR 未列', directory_seen: '只看到目錄', downloaded: '已下載', catalog_only: '只有目錄', not_found: '未找到', not_published: '尚未發布', inaccessible: '無法取得', cancelled: '已取消', blocked: '受阻', complete: '流程已結束', completed: '流程已結束' }
const text = (value, fallback = '未提供') => value === null || value === undefined || value === '' ? fallback : Array.isArray(value) ? value.map(v=>text(v)).join('；') : typeof value === 'object' ? Object.entries(value).map(([k, v]) => `${k}：${text(v)}`).join('；') : String(value)
const topicNames = { orders_demand: '訂單／需求', capex_capacity: '資本支出／產能', gross_margin_mix: '毛利／產品組合', validation_ramp: '驗證／量產', bottleneck: '供應瓶頸', cash_conversion: '現金轉換', definition: '口徑變更', opex_investment: '費用與投資', revenue_guidance: '收入指引', cash_flow: '現金流', comparability: '可比性', revenue: '收入' }
const topicLabel = value => topicNames[value] || text(value, '主題未提供')
const speakerText = s => !s ? '講者未確認' : typeof s === 'string' ? s : [s.name, s.role && `（${s.role}）`].filter(Boolean).join('') || '講者未確認'
// Ranges keep reported units: USD amounts render in 億美元, percentages with %.
function targetValue(t) {
 const fmt = v => v == null ? '未提供' : t.unit === 'currency' && t.currency === 'USD' && !t.scale && /^\d+$/.test(String(v)) ? `${decimal(String(Number(v) / 1e8))} 億美元` : t.unit === 'percent' ? `${decimal(String(v))}%` : `${decimal(String(v))} ${text(t.unit, '')}`.trim()
 if (t.minimum != null || t.maximum != null) return `${fmt(t.minimum)} 至 ${fmt(t.maximum)}（中點 ${fmt(t.value)}）`
 return fmt(t.value ?? t.range)
}
const materialNames = { cfo_commentary: 'CFO 說明', statement: '10-Q／10-K', release: '新聞稿', transcript: '法說校訂稿' }
const statusLabel = value => statuses[value] || (value ? `待核（${value}）` : '狀態未提供')
const today = () => new Date().toISOString().slice(0, 10)
function validDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value || '') && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value }
const maxDate = computed(() => { const d = bundle.value?.run?.as_of?.slice(0, 10); return validDate(d) && d < today() ? d : today() })
const periods = computed(() => [...(bundle.value?.periods || [])].sort((a, b) => String(a.end_date).localeCompare(String(b.end_date))).slice(-8))
const selectedPeriod = computed(() => periods.value.find(p => p.period_id === period.value))
const documents = computed(() => bundle.value?.documents || [])
const documentMap = computed(() => new Map(documents.value.map(d => [d.document_version_id, d])))
const eligibleDocumentIds = computed(() => {
 if (!validDate(asOf.value)) return new Set()
 let cutoff = Math.min(Date.parse(`${asOf.value}T23:59:59.999Z`), Date.now())
 if (bundle.value?.run?.as_of?.includes('T')) cutoff = Math.min(cutoff, Date.parse(bundle.value.run.as_of))
 try { return new Set(selectDocumentVersions(documents.value.map(d => toRaw(d)), { as_of: new Date(cutoff).toISOString(), mode: 'public_information' }).documents.map(d => d.document_version_id)) }
 catch { return new Set() }
})
function eligibleDocument(d) { return !!d && eligibleDocumentIds.value.has(d.document_version_id) }
function references(item) {
 return (Array.isArray(item?.evidence_refs) ? item.evidence_refs : []).map(ref => typeof ref === 'string' ? (bundle.value?.evidence_links || []).find(e => [e.evidence_link_id, e.evidence_id, e.id].includes(ref)) || { missing_reference: ref } : ref).filter(Boolean)
}
const blockedReference = e => e?.missing_reference || ['mismatch', 'failed', 'unverified', 'not_matched'].includes(e?.quote_match_status) || ['mismatch', 'failed'].includes(e?.hash_status)
function eligibleItem(item) { const refs = references(item); return refs.length > 0 && refs.every(e => !blockedReference(e) && eligibleDocument(documentMap.value.get(e.document_version_id))) }
const facts = computed(() => (bundle.value?.facts || []).filter(f => f.company_id === props.company && eligibleDocument(documentMap.value.get(f.source_document_version))))
const claims = computed(() => (bundle.value?.claims || []).filter(c => eligibleItem(c)))
const claimPeriod = c => c.period_id || c.period_referred_to
const periodClaims = computed(() => claims.value.filter(c => (!claimPeriod(c) || claimPeriod(c) === period.value) && (!section.value || c.section_kind === section.value || section.value === 'qa' && ['qa_question', 'qa_answer'].includes(c.section_kind)) && (!topic.value || c.topic === topic.value)))
const topics = computed(() => [...new Set(claims.value.map(c => c.topic).filter(Boolean))])
const changes = computed(() => (bundle.value?.changes || []).filter(c => (!c.period_id || c.period_id === period.value) && (!topic.value || c.topic === topic.value) && changeEligible(c)).slice(0, 5))
const targets = computed(() => (bundle.value?.targets || []).filter(t => { const claim = claims.value.find(c => c.claim_version_id === t.origin_claim_version_id); return claim && (!claimPeriod(claim) || claimPeriod(claim) === period.value) }))
const assessments = computed(() => (bundle.value?.assessments || []).filter(a => (!a.period_id || a.period_id === period.value) && (!a.information_cutoff || a.information_cutoff.slice(0, 10) <= asOf.value) && eligibleItem({evidence_refs:a.accepted_evidence_refs || a.evidence_refs})))
const metricRows = computed(() => {
 const map = new Map()
 for (const f of facts.value) { const key = [f.concept, f.accounting_basis, f.currency, f.unit, f.scale, f.metric_definition_version, f.consolidation_scope || 'consolidated', JSON.stringify(f.dimensions || {})].join('|'); if (!map.has(key)) map.set(key, { key, concept: f.concept, basis: f.accounting_basis, currency: f.currency, unit: f.unit, scale: f.scale, definition: f.metric_definition_version, scope: f.consolidation_scope, dimensions: f.dimensions, facts: [] }); map.get(key).facts.push(f) }
 return [...map.values()].sort((a, b) => { const order = Object.keys(labels); const ai = order.indexOf(a.concept), bi = order.indexOf(b.concept); return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.key.localeCompare(b.key) })
})
const mobilePeriods = computed(() => [periods.value.find(p => p.period_id === comparePeriod.value), selectedPeriod.value].filter(Boolean))
const coverageRows = computed(() => periods.value.flatMap(p => ['financial_statement', 'call_transcript'].map(type => {
 const aliases = type === 'financial_statement' ? ['financial_statement', 'financials', 'financial_report', 'earnings_release', 'filing', 'release', 'cfo_commentary', 'statement'] : ['call_transcript', 'transcript', 'earnings_call', 'call_text']
 // Cutoff-eligible material first; only then prefer the most completely read one.
 const rank = c => ((c.document_version_ids || []).some(id => eligibleDocument(documentMap.value.get(id))) ? 100 : 0) + (c.review_status === 'reviewed' ? 40 : 0) + ({ reviewed: 30, full_text: 20, partial_read: 10 }[c.status] || 0)
 const c = (bundle.value?.coverage || []).filter(c => c.period_id === p.period_id && aliases.includes(c.required_material_type || c.material_type)).sort((a, b) => rank(b) - rank(a))[0]
 const versions = c?.document_version_ids || []
 const available = versions.some(id => eligibleDocument(documentMap.value.get(id)))
 const receiptVersions = c?.read_document_version_ids || c?.receipt?.document_version_ids || versions
 const receiptAvailable = receiptVersions.length > 0 && receiptVersions.every(id => eligibleDocument(documentMap.value.get(id)))
 return { ...c, period: p, type, available, receiptAvailable, label: !c ? '未建立覆蓋紀錄' : !available ? '截止日前無可核文件' : !receiptAvailable ? '有可用舊版；此閱讀收據尚不能套用' : statusLabel(c.review_status || c.status), gap: c?.excluded_reason || c?.gap_impact || c?.gap || (!available ? '缺文件或發布時間未確認' : !receiptAvailable ? '阅读收據含截止日後版本，需分開核對' : '') }
})))
function coverageCount(type, mode) { return new Set(coverageRows.value.filter(c => c.type === type && c.available && (mode === 'review' ? c.receiptAvailable && c.review_status === 'reviewed' : mode === 'obtained' ? ['downloaded','fetched','retrieved','full_text','reviewed','partial_read'].includes(c.fetch_status || c.status) : c.receiptAvailable && c.total_spans > 0 && Number.isInteger(c.read_spans) && c.read_spans === c.total_spans)).map(c => c.period.period_id)).size }
const heldClaims = computed(() => (bundle.value?.claims || []).length - claims.value.length)
const hasContent = computed(() => bundle.value && periods.value.length)
function rowFacts(row, p) { return row.facts.filter(f => f.period_id === p.period_id) }
function decimal(value) { if (typeof value !== 'string' || !/^[+-]?\d+(?:\.\d+)?$/.test(value)) return '未提供'; const [whole, fraction] = value.split('.'); return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction !== undefined ? `.${fraction}` : '') }
function factValue(f) { return f.numeric_decimal === null ? text(f.null_reason || f.unavailable_reason, '未揭露') : decimal(f.numeric_decimal) }
function metricUnit(row) { const basis={GAAP:'GAAP（一般會計準則）',company_non_GAAP_FCF:'公司定義的自由現金流'}[row.basis]||text(row.basis,'會計口徑未提供');if(row.unit==='percent')return '% · '+basis;if(row.unit==='days')return '天 · 公司揭露';if(row.unit==='shares')return (row.scale===6?'百萬股':'股')+' · '+basis;const currency=text(row.currency,'幣別未提供'),unit=row.unit==='currency_per_share'?currency+'／股':row.unit==='currency'&&row.scale===6?currency+' 百萬':currency+' · '+text(row.unit,'單位未提供')+(row.scale===0?'':` · 倍率 10^${text(row.scale,'未知')}`);return unit+' · '+basis }
const periodLabel = p => p ? text(p.label_as_reported, p.period_id) : '季別未提供'
const claimByVersion = id => claims.value.find(c => c.claim_version_id === id || c.claim_id === id)
// Every claim, fact or document a change's prose relies on must be visible at this cutoff.
function supportEligible(change) { const factIds = new Set(facts.value.map(f => f.fact_id)); return (change.support || []).every(ref => typeof ref !== 'object' || !ref ? true : ref.claim_version_id ? Boolean(claimByVersion(ref.claim_version_id)) : ref.fact_id ? factIds.has(ref.fact_id) : ref.document_version_id ? eligibleDocument(documentMap.value.get(ref.document_version_id)) : true) }
function changeEligible(change) { if (change.observed_at && change.observed_at.slice(0,10)>asOf.value) return false; if (!supportEligible(change)) return false; const ids = ['before','after'].flatMap(side => change[`${side}_claim_version_ids`] || [change[`${side}_claim_version_id`]]).filter(Boolean); const refs = references(change); return ids.length ? ids.every(id=>claimByVersion(id)) && (!refs.length || eligibleItem(change)) : eligibleItem(change) }
function beforeAfter(change, side) { const ids = change[`${side}_claim_version_ids`] || [change[`${side}_claim_version_id`]]; return ids.filter(Boolean).map(claimByVersion).filter(Boolean) }
// A settled outcome needs eligible facts or, for qualitative milestones, eligible claim evidence.
const claimEvidenced = o => (o.evidence_claim_version_ids || []).length > 0 && o.evidence_claim_version_ids.every(id => claimByVersion(id))
function outcome(t) { const ids = new Set(facts.value.map(f=>f.fact_id)); return (bundle.value?.outcomes || []).filter(o => o.target_id === t.target_id && (!o.evaluation_as_of || o.evaluation_as_of.slice(0, 10) <= asOf.value) && (o.eligible_fact_ids || []).every(id=>ids.has(id)) && (o.evidence_claim_version_ids || []).every(id => claimByVersion(id)) && (['pending','not_due','not_disclosed','not_comparable','disputed'].includes(o.status) || o.eligible_fact_ids?.length > 0 || claimEvidenced(o))).sort((a,b)=>String(b.evaluation_as_of).localeCompare(String(a.evaluation_as_of)))[0] }
// Range accuracy and operating direction are shown separately; above-range is not a failure.
function comparisonText(o, t = {}) {
 if (!o?.comparison_result) return ''
 const gap = !o.gap_above_upper ? '' : t.unit === 'percent' ? ` ${decimal(String(Math.round(Number(o.gap_above_upper) * 100) / 100))} 個百分點` : ` ${decimal(o.gap_above_upper)}`
 const position = { within_range: '實績落在原區間內', above_range: `實績高於原區間上限${gap}`, below_range: '實績低於原區間下限' }[o.comparison_result] || `對照結果待核（${o.comparison_result}）`
 const forecast = { not_independent_forecast: '這是管理層指引，不是獨立預測', outside_range_high: '指引作為預測未命中（偏保守）', outside_range_low: '指引作為預測未命中（偏樂觀）', within_range: '指引作為預測命中' }[o.prediction_validation]
 return [position, forecast].filter(Boolean).join('；')
}
function safeUrl(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null } catch { return null } }
function sourceUrl(doc, ref) { const value=safeUrl(doc?.original_url); if (!value) return null; const url=new URL(value), location=ref?.locator; if (location && typeof location==='object') { if (location.page && /\.pdf$/i.test(url.pathname)) url.hash=`page=${encodeURIComponent(location.page)}`; else if (location.anchor) url.hash=String(location.anchor); else if (location.start_ms!==undefined && ['audio','video','asr'].includes(doc.source_type)) url.hash=`t=${location.start_ms/1000}` } return url.href }
function locator(value) { if (!value) return '定位未提供'; if (typeof value === 'string') return value; return [value.page && `第 ${value.page} 頁`, value.paragraph && `第 ${value.paragraph} 段`, value.section, value.line && `第 ${value.line} 行`, value.start_ms !== undefined && `${value.start_ms / 1000} 秒起`, value.end_ms !== undefined && `至 ${value.end_ms / 1000} 秒`].filter(Boolean).join(' · ') || text(value) }
function permittedQuote(doc) { const allowed = doc?.allowed_display; return ['short_quote', 'short_quotes', 'short_excerpt', 'excerpt', 'quotes', 'full_text'].some(v => typeof allowed === 'string' ? allowed === v : Array.isArray(allowed) ? allowed.includes(v) : allowed?.[v] === true) }
const evidenceRows = computed(() => selectedEvidence.value ? [selectedEvidence.value] : references(claims.value.find(c => c.claim_id === selectedClaim.value)))
const evidenceClaim = computed(() => claims.value.find(c => c.claim_id === selectedClaim.value))
function urlWith(patch) { const p = new URLSearchParams(location.search); p.set('workspace', 'company'); p.set('company', props.company || ''); p.set('companyTab', 'financials'); for (const [k, v] of Object.entries({ financialView: view.value, period: period.value, asOf: asOf.value, callSection: section.value, financialTopic: topic.value, comparePeriod: comparePeriod.value, claim: selectedClaim.value, ...patch })) { if (v) p.set(k, v); else p.delete(k) } return `${location.pathname}?${p}${location.hash}` }
function writeUrl(patch = {}, replace = false) { if (!props.active) return; history[replace ? 'replaceState' : 'pushState'](history.state, '', urlWith(patch)) }
function allowLeave(to) { return window.dispatchEvent(new CustomEvent('workspace-leave',{cancelable:true,detail:{from:'financial-research',to,company:props.company}})) }
function rememberFilters() { savedFilters={period:period.value,asOf:asOf.value,section:section.value,topic:topic.value,comparePeriod:comparePeriod.value} }
function navigate(id) { if (id!==view.value && !allowLeave(`financial-${id}`)) return; view.value = id; closeEvidence(false); writeUrl({ claim: '' }) }
function updateFilters() { if (!allowLeave('financial-filter')) { period.value=savedFilters.period;asOf.value=savedFilters.asOf;section.value=savedFilters.section;topic.value=savedFilters.topic;comparePeriod.value=savedFilters.comparePeriod;return } closeEvidence(false); normalizeFilters(); rememberFilters(); writeUrl({ claim: '' }) }
function normalizeFilters() {
 if (!validDate(asOf.value) || asOf.value > maxDate.value) asOf.value = maxDate.value
 if (!periods.value.some(p => p.period_id === period.value)) period.value = periods.value.at(-1)?.period_id || ''
 const alternatives = periods.value.filter(p => p.period_id !== period.value)
 if (!alternatives.some(p => p.period_id === comparePeriod.value)) comparePeriod.value = alternatives.at(-1)?.period_id || ''
 if (section.value && !['prepared_remarks', 'qa', 'qa_question', 'qa_answer', 'other'].includes(section.value)) section.value = ''
 if (topic.value && !topics.value.includes(topic.value)) topic.value = ''
}
async function syncUrl() {
 if (!props.active) return
 const p = new URLSearchParams(location.search)
 if (p.get('workspace') !== 'company' || p.get('companyTab') !== 'financials') return
 if (p.get('company') && p.get('company') !== props.company) return
 view.value = views.some(v => v.id === p.get('financialView')) ? p.get('financialView') : 'financials'
 period.value = p.get('period') || ''; asOf.value = p.get('asOf') || maxDate.value
 section.value = p.get('callSection') || ''; topic.value = p.get('financialTopic') || ''; comparePeriod.value = p.get('comparePeriod') || ''
 normalizeFilters()
 rememberFilters()
 selectedEvidence.value = null
 const id = p.get('claim') || ''
 selectedClaim.value = claims.value.some(c => c.claim_id === id && (!claimPeriod(c) || claimPeriod(c) === period.value)) ? id : ''
 if (id && !selectedClaim.value && bundle.value) notice.value = '這則引用不在目前公司、季別或截止日可用資料中。'
 if (bundle.value) writeUrl({}, true)
 await nextTick(); if (selectedClaim.value) showDialog(); else closeEvidence(false)
}
function showDialog() { if (!dialog.value?.open) { returnFocus = document.activeElement; dialog.value?.showModal(); nextTick(() => dialog.value?.querySelector('button')?.focus()) } }
async function openClaim(claim) { selectedEvidence.value = null; selectedClaim.value = claim.claim_id; writeUrl(); await nextTick(); showDialog() }
async function openFact(fact) { selectedClaim.value = ''; selectedEvidence.value = { document_version_id: fact.source_document_version, locator: fact.locator, fact }; await nextTick(); showDialog() }
async function openReference(e) { selectedClaim.value = ''; selectedEvidence.value = e; await nextTick(); showDialog() }
function closeEvidence(update = true) { const open = dialog.value?.open; dialog.value?.close(); selectedClaim.value = ''; selectedEvidence.value = null; if (update && open) writeUrl({ claim: '' }); if (open && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }) }
function cancelLoad() { if (!loading.value) return; sequence++; controller?.abort(); clearTimeout(timeout); loading.value = false; notice.value = '本次讀取已取消；沒有完成新的資料或覆核收據。' }
function errorMessage(e, timedOut) {
 if (timedOut || e.code === 'timeout') return '讀取逾時，尚未取得新的有效資料。'
 const status = Number(e.status || e.statusCode || e.response?.status || /\b(401|403|404|429|5\d\d)\b/.exec(e.message || '')?.[1])
 if (status === 401) return '登入已失效，請重新登入後讀取。'
 if (status === 403) return '目前沒有讀取這份資料的權限。'
 if (status === 404) return '尚未整理財報與法說。'
 if (status === 429) return '讀取次數已達服務限制，請稍後再試。'
 if (status >= 500) return '資料服務暫時無法回應，這次更新未完成。'
 return '資料未通過讀取或版本驗證，這次更新未完成。'
}
async function load(retry = false) {
 if (retry && retries.value >= 2) return
 if (retry) retries.value++
 controller?.abort(); clearTimeout(timeout); const n = ++sequence
 if (!props.company || !props.active) { loading.value = false; return }
 const company = props.company; controller = new AbortController(); const signal = controller.signal
 loading.value = true; error.value = ''; errorStatus.value = null; notice.value = ''; let timedOut = false
 timeout = setTimeout(() => { timedOut = true; controller?.abort() }, 20000)
 try {
  const next = await financialResearch(company, { signal })
  if (n !== sequence || props.company !== company || signal.aborted) return
  if (next?.schema_version !== 'financial-research/1' || next?.company?.company_id !== company || !Array.isArray(next.periods) || !Array.isArray(next.documents) || !Array.isArray(next.facts) || !Array.isArray(next.claims)) throw new Error('Invalid research bundle')
  bundle.value = next; await syncUrl()
 } catch (e) { if (n === sequence) { error.value = errorMessage(e, timedOut); errorStatus.value = timedOut || e.code === 'timeout' ? 'timeout' : Number(e.status || e.statusCode || e.response?.status) || null; if ([401,403].includes(Number(e.status))) bundle.value = null } }
 finally { if (n === sequence) { clearTimeout(timeout); loading.value = false } }
}
watch([() => props.company, () => props.active], ([company], [oldCompany]) => {
 cancelLoad(); closeEvidence(false); error.value = ''; notice.value = ''
 if (company !== oldCompany) { bundle.value = null; retries.value = 0; period.value = ''; asOf.value = ''; comparePeriod.value = '' }
 if (mounted && props.active) { syncUrl(); load() }
})
onMounted(() => { mounted = true; syncUrl(); load(); window.addEventListener('popstate', syncUrl) })
onUnmounted(() => { sequence++; controller?.abort(); clearTimeout(timeout); window.removeEventListener('popstate', syncUrl) })
</script>

<template>
 <section class="financial-research" aria-label="財報與法說">
  <header class="fr-heading"><div><h2>財報與法說</h2><p>按財季核對數字、管理層說法與後續變化。</p></div><span v-if="bundle" class="fr-state">{{ statusLabel(bundle.run?.status) }}</span></header>
  <nav class="fr-tabs" aria-label="財報與法說分頁"><a v-for="tab in views" :key="tab.id" :href="urlWith({financialView:tab.id,claim:''})" :aria-current="view===tab.id?'page':undefined" @click.prevent="navigate(tab.id)">{{ tab.label }}</a></nav>
  <p v-if="loading" class="fr-message" role="status">正在讀取 {{ company }} 的資料… <button @click="cancelLoad">取消讀取</button></p>
  <div v-if="error" class="fr-error" role="alert"><p>{{ error }}</p><p v-if="bundle">保留 {{ bundle.run?.as_of || '截止日未提供' }} 的最近有效版本。</p><button v-if="retries<2" @click="load(true)">重試（剩 {{ 2-retries }} 次）</button><p v-else>兩次重試已用完；稍後重新進入本頁再讀取。</p></div>
  <p v-if="notice" class="fr-message" role="status">{{ notice }}</p>
  <template v-if="hasContent">
   <div class="fr-filters"><label>查看財季<select v-model="period" @change="updateFilters"><option v-for="p in periods" :key="p.period_id" :value="p.period_id">{{ periodLabel(p) }}</option></select></label><label>公開資訊截至<input v-model="asOf" type="date" :max="maxDate" @change="updateFilters"/></label><p>按發布日篩選；財季結束不代表結果已公布。</p></div>
   <p class="fr-cutoff">{{ periodLabel(selectedPeriod) }}：{{ text(selectedPeriod?.start_date) }} 至 {{ text(selectedPeriod?.end_date) }}。資料包截至 {{ text(bundle.run?.as_of) }}。<span v-if="bundle.run?.as_of_mode!=='public_information'">原資料包模式為 {{ text(bundle.run?.as_of_mode) }}；本頁只顯示可核公開發布的資料。</span></p>
   <details class="fr-coverage"><summary>8 季覆蓋：財報 {{ coverageCount('financial_statement','review') }}/8 已核；法說文字 {{ coverageCount('call_transcript','review') }}/8 已核</summary><p>已取得：財報 {{ coverageCount('financial_statement','obtained') }}/8、法說文字 {{ coverageCount('call_transcript','obtained') }}/8。已讀全文：財報 {{ coverageCount('financial_statement','read') }}/8、法說文字 {{ coverageCount('call_transcript','read') }}/8。已登錄 {{ periods.length }}/8 季；下載、片讀與覆核分開計算。沒有音訊覆核收據時，不代表已核原音。</p><div class="fr-table-scroll" tabindex="0" aria-label="覆蓋表，可橫向捲動"><table><caption>各季來源缺口與閱讀狀態</caption><thead><tr><th scope="col">財季</th><th scope="col">資料</th><th scope="col">取得／閱讀</th><th scope="col">覆核與缺口</th></tr></thead><tbody><tr v-for="c in coverageRows" :key="c.period.period_id+c.type"><th scope="row">{{ periodLabel(c.period) }}</th><td>{{ c.type==='financial_statement'?'財報':'法說文字' }}<span v-if="materialNames[c.required_material_type]" class="fr-cell-note">{{ materialNames[c.required_material_type] }}</span></td><td>{{ statusLabel(c.fetch_status) }}／{{ statusLabel(c.read_status) }}<span class="fr-cell-note">已讀 {{ text(c.read_spans,'未知') }}／{{ text(c.total_spans,'未知') }} 段</span></td><td>{{ c.label }}<span v-if="c.gap" class="fr-cell-note">{{ text(c.gap) }}</span></td></tr></tbody></table></div></details>

   <section v-if="view==='financials'" aria-labelledby="fr-finance-title">
    <h3 id="fr-finance-title">八季財務核對</h3><p>每列保留原報幣別、倍率和會計口徑；不同定義分列。數值為原報值，不自動換匯或推算缺值。</p>
    <p v-if="!metricRows.length" class="fr-empty">截止日前沒有可核的財務數字；未知值不以 0 補齊。</p>
    <template v-else>
     <div class="fr-table-scroll fr-desktop-table" tabindex="0" aria-label="八季財務表，可橫向捲動"><table class="fr-finance-table"><caption>已公布財務事實 · 實際登錄 {{ periods.length }} 季</caption><thead><tr><th scope="col">科目與原報單位</th><th v-for="p in periods" :key="p.period_id" scope="col">{{ periodLabel(p) }}<span class="fr-cell-note">截至 {{ p.end_date }}</span></th></tr></thead><tbody><tr v-for="row in metricRows" :key="row.key"><th scope="row">{{ labels[row.concept] || row.concept }}<span class="fr-cell-note">{{ metricUnit(row) }}</span><span v-if="row.scope || Object.keys(row.dimensions||{}).length" class="fr-cell-note">{{ text(row.scope,'合併範圍未提供') }} · {{ text(row.dimensions,'') }}</span><span class="fr-cell-note">定義 {{ text(row.definition) }}</span></th><td v-for="p in periods" :key="p.period_id"><template v-if="rowFacts(row,p).length"><button v-for="f in rowFacts(row,p)" :key="f.fact_id" class="fr-fact-link" @click="openFact(f)">{{ factValue(f) }}<span class="fr-cell-note">{{ f.derived_from?.length?'推導值':'原報實績' }} · {{ text(documentMap.get(f.source_document_version)?.published_at,'發布日未知').slice(0,10) }}{{ f.reconciliation_note ? ' · 有來源不一致註記' : '' }}</span></button></template><span v-else class="fr-unknown">未揭露／未取得</span></td></tr></tbody></table></div>
     <div class="fr-mobile-compare"><label>對照財季<select v-model="comparePeriod" @change="updateFilters"><option v-for="p in periods.filter(p=>p.period_id!==period)" :key="p.period_id" :value="p.period_id">{{ periodLabel(p) }}</option><option v-if="periods.length<2" value="">沒有另一季</option></select></label><table><caption>兩季比較 · 同口徑分列</caption><thead><tr><th scope="col">科目／單位</th><th v-for="p in mobilePeriods" :key="p.period_id" scope="col">{{ periodLabel(p) }}</th></tr></thead><tbody><tr v-for="row in metricRows" :key="row.key"><th scope="row">{{ labels[row.concept]||row.concept }}<span class="fr-cell-note">{{ metricUnit(row) }}</span><span class="fr-cell-note">定義 {{ text(row.definition) }}</span></th><td v-for="p in mobilePeriods" :key="p.period_id"><button v-for="f in rowFacts(row,p)" :key="f.fact_id" class="fr-fact-link" @click="openFact(f)">{{ factValue(f) }}<span class="fr-cell-note">{{ f.derived_from?.length?'推導值':'原報實績' }}</span></button><span v-if="!rowFacts(row,p).length" class="fr-unknown">未揭露／未取得</span></td></tr></tbody></table></div>
    </template>
   </section>

   <section v-if="view==='calls'" aria-labelledby="fr-calls-title">
    <div class="fr-section-heading"><h3 id="fr-calls-title">本季管理層說法</h3><span>{{ periodClaims.length }} 則可核來源</span></div>
    <div class="fr-filters"><label>發言區段<select v-model="section" @change="updateFilters"><option value="">全部區段</option><option value="prepared_remarks">準備稿</option><option value="qa">全部 Q&amp;A</option><option value="qa_question">分析師問題</option><option value="qa_answer">管理層回答</option><option value="other">其他／未分類</option></select></label><label>主題<select v-model="topic" @change="updateFilters"><option value="">全部主題</option><option v-for="t in topics" :key="t" :value="t">{{ topicLabel(t) }}</option></select></label></div>
    <p v-if="heldClaims" class="fr-message">另 {{ heldClaims }} 則因發布日、定位或來源核對不足，未作為目前可用說法。</p>
    <article v-for="claim in periodClaims" :key="claim.claim_version_id" class="fr-reading-row"><header><h4>{{ topicLabel(claim.topic) }}</h4><span class="fr-state">{{ statusLabel(claim.review_status) }}</span></header><p>{{ text(claim.paraphrase,'尚未提供整理者轉述') }}</p><p class="fr-meta">整理者轉述 · {{ speakerText(claim.speaker) }} · {{ {prepared_remarks:'準備稿',qa_question:'分析師問題（不視為承諾）',qa_answer:'管理層回答'}[claim.section_kind] || '區段未確認' }} · {{ {actual:'實績說法',guidance:'指引',aspiration:'願景',causal_explanation:'管理層解釋'}[claim.claim_kind] || '說法類型待核' }}</p><button @click="openClaim(claim)">核對原句與上下文</button></article>
    <p v-if="!periodClaims.length" class="fr-empty">本季沒有符合篩選且來源可核的法說文字。</p>
    <h3>帶期限的目標與實績</h3><p>狀態採用已保存的人工評估；期限已到、未披露資料，仍不能判為失敗。</p>
    <article v-for="t in targets" :key="t.target_id" class="fr-reading-row"><header><h4>{{ text(t.KPI || t.kpi || t.concept,'目標指標未提供') }}</h4><span class="fr-state">{{ statusLabel(outcome(t)?.status) }}</span></header><p v-if="t.target_kind==='qualitative'">原目標：質性里程碑，沒有數值區間；目標期間 {{ text(t.target_period,'未提供') }}；原期限：{{ text(t.original_deadline,'期限未明確') }}。</p><p v-else>原目標：{{ targetValue(t) }}；原期限：{{ text(t.original_deadline,'期限未明確') }}。</p><p v-if="t.interpretation" class="fr-meta">研究者解讀：{{ text(t.interpretation) }}</p><p>原條件：{{ text(t.conditions,'未提供條件') }}</p><p>實績與理由：{{ text(outcome(t)?.reason,'尚無可比實績及人工評估') }}</p><p v-if="comparisonText(outcome(t), t)" class="fr-meta">{{ comparisonText(outcome(t), t) }}</p><button v-if="claimByVersion(t.origin_claim_version_id)" @click="openClaim(claimByVersion(t.origin_claim_version_id))">查看原始目標來源</button><button v-for="id in (outcome(t)?.evidence_claim_version_ids || []).filter(id=>claimByVersion(id))" :key="id" @click="openClaim(claimByVersion(id))">查看實績來源</button></article>
    <p v-if="!targets.length" class="fr-empty">本季尚無來源可核的期限目標。</p>
   </section>

   <section v-if="view==='changes'" aria-labelledby="fr-changes-title">
    <div class="fr-section-heading"><h3 id="fr-changes-title">重要變化與待核問題</h3><label>主題<select v-model="topic" @change="updateFilters"><option value="">全部主題</option><option v-for="t in topics" :key="t" :value="t">{{ topicLabel(t) }}</option></select></label></div><p>先列最多五項已整理候選。措辭變化與本期未提及，不能直接判成營運惡化或撤回。</p>
    <article v-for="change in changes" :key="change.change_id || change.id" class="fr-reading-row"><header><h4>{{ changeEligible(change) ? text(change.summary || change.reason || change.topic,'變化待核') : '來源待重新核對；暫不呈現此候選結論' }}</h4><span class="fr-state">{{ statusLabel(change.review_status || change.researcher_status || change.status) }}</span></header><details v-if="changeEligible(change)"><summary>前後說法、反方與待查資料</summary><div class="fr-before-after"><section v-for="side in ['before','after']" :key="side"><h4>{{ side==='before'?'當時':'現在' }}</h4><template v-if="beforeAfter(change,side).length"><div v-for="c in beforeAfter(change,side)" :key="c.claim_version_id"><p>{{ text(c.paraphrase) }}</p><p class="fr-meta">{{ text(c.statement_at,'說話日期未提供') }} · {{ speakerText(c.speaker) }}</p><button @click="openClaim(c)">核對這段原句</button></div></template><p v-else>沒有可核的同主題說法；前後比較仍有缺口。</p></section></div><dl class="fr-detail-list"><dt>對齊與實績</dt><dd>{{ text(change.metric_alignment || change.alignment || change.actual_reason,'尚未提供可比核對') }}</dd><dt>管理層理由</dt><dd>{{ text(change.management_explanation,'未取得') }}</dd><dt>研究者推論</dt><dd>{{ text(change.analyst_explanation || change.reason,'尚待核對') }}</dd><dt>最強反方</dt><dd>{{ text(change.counterevidence_summary || change.counterargument,'已查範圍內未取得合格反證') }}<button v-for="(e,i) in references({evidence_refs:change.counterevidence_refs||change.counterevidence||[]})" :key="i" @click="openReference(e)">反方來源 {{ i+1 }}</button></dd><dt>替代解釋</dt><dd>{{ text(change.alternative_hypothesis,'尚未提供替代解釋') }}</dd><dt>資料缺口</dt><dd>{{ text(change.gap,'未記錄缺口，不代表沒有缺口') }}</dd><dt>接下來核對</dt><dd>{{ text(change.follow_up || change.follow_up_questions,'尚未安排具體核對') }}</dd></dl></details><p v-else>缺少截止日前可核的前後來源；不能以其他說法替代。</p></article>
    <p v-if="!changes.length" class="fr-empty">本季尚無已整理的重要變化。沒有候選不表示公司沒有變化。</p>
    <article v-for="a in assessments" :key="a.assessment_id" class="fr-reading-row"><h4>研究者判讀 · {{ statusLabel(a.review_status) }}</h4><p v-if="a.created_at && a.created_at.slice(0,10)>asOf" class="fr-meta">事後整理：{{ a.created_at }}；僅採目前截止日前可核的公開證據，不代表當時已作成判斷。</p><p>{{ text(a.main_judgment || a.judgment,'尚未提供主判斷') }}</p><p>最強替代解釋：{{ text(a.strongest_alternative || a.alternative_explanation,'尚未取得') }}</p><h4>接下來的核對問題</h4><ol v-if="a.follow_up_questions?.length"><li v-for="(q,i) in a.follow_up_questions" :key="i">{{ text(q) }}</li></ol><p v-else>尚未安排核對問題。</p><p class="fr-meta">此判讀不會自動改寫原研究或決策。原報告版本：{{ text(a.report_pin || a.original_report_pin,'未提供固定版本') }}</p></article>
   </section>
   <details class="fr-inspection"><summary>檢查紀錄</summary><dl class="fr-detail-list"><dt>資料包</dt><dd>{{ text(bundle.run?.run_id) }} · {{ text(bundle.schema_version) }}</dd><dt>流程狀態</dt><dd>{{ statusLabel(bundle.run?.status) }}；流程結束不等於所有來源已讀或語義覆核完成。</dd><dt>輸入固定版本</dt><dd>{{ text(bundle.run?.input_manifest_sha256,'未提供雜湊') }}</dd><dt>解析版本</dt><dd>{{ text(bundle.run?.parser_version || bundle.run?.transform_version,'未提供') }}</dd><dt>使用量</dt><dd>{{ text(bundle.run?.usage,'未知，沒有以 0 補齊') }}</dd><dt>本次讀取收據</dt><dd>{{ text(bundle._load_receipt,'未提供；不能宣稱已完成來源閱讀') }}</dd><dt>錯誤／收據</dt><dd>{{ text(bundle.run?.errors,'未提供') }} · {{ text(bundle.run?.review_refs,'未提供覆核收據') }}</dd></dl></details>
  </template>
  <div v-else-if="!loading && showEmpty" class="fr-empty"><p>{{ !company?'請先選擇公司。':bundle?'這份資料包尚未登錄可用財季。':'尚未整理財報與法說。' }}</p><a v-if="latest?.bundle_id" :href="'?workspace=company&bundle='+encodeURIComponent(latest.bundle_id)+'&researchTab=report'" @click.prevent="$emit('read',latest.bundle_id)">閱讀已有完整研究</a></div>
  <slot v-if="view==='changes'" name="cycle" :bundle="bundle" :period="period" :as-of="asOf" />

  <dialog ref="dialog" class="fr-evidence" aria-labelledby="fr-evidence-title" @cancel.prevent="closeEvidence()" @click="e=>{if(e.target===dialog)closeEvidence()}">
   <header class="fr-dialog-header"><h3 id="fr-evidence-title">核對來源</h3><button @click="closeEvidence()">關閉</button></header>
   <template v-if="evidenceClaim"><h4>整理者轉述</h4><p>{{ text(evidenceClaim.paraphrase) }}</p><p class="fr-meta">{{ speakerText(evidenceClaim.speaker) }} · {{ statusLabel(evidenceClaim.review_status) }}</p></template>
   <article v-for="(e,i) in evidenceRows" :key="i" class="fr-evidence-source"><h4>{{ text(documentMap.get(e.document_version_id)?.title,'來源未找到') }}</h4><p class="fr-meta">{{ text(documentMap.get(e.document_version_id)?.source_type,'來源類型未提供') }} · 發布 {{ text(documentMap.get(e.document_version_id)?.published_at,'日期未確認') }} · {{ locator(e.locator) }}</p>
    <p v-if="blockedReference(e) || !eligibleDocument(documentMap.get(e.document_version_id))" class="fr-error">來源待重新核對；此截止日無法使用這段證據。</p>
    <template v-else><template v-if="e.fact"><h4>原報財務事實</h4><p>{{ labels[e.fact.concept]||e.fact.concept }}：{{ factValue(e.fact) }} · {{ text(e.fact.currency,'幣別未知') }} · {{ text(e.fact.unit,'單位未知') }} · 倍率 {{ text(e.fact.scale) }}</p><p>會計口徑 {{ text(e.fact.accounting_basis) }}；定義 {{ text(e.fact.metric_definition_version) }}。期間型態 {{ text(e.fact.period_kind) }}；重列 {{ text(e.fact.restated_as_of,'未記錄') }}；原報精度 {{ text(e.fact.decimals) }}。</p><p v-if="e.fact.formula_version || e.fact.derived_from?.length">推導公式 {{ text(e.fact.formula_version) }}；依據 {{ text(e.fact.derived_from) }}</p><p v-if="e.fact.reconciliation_note" class="fr-error">來源不一致註記：{{ e.fact.reconciliation_note }}</p></template><template v-if="permittedQuote(documentMap.get(e.document_version_id)) && e.exact_quote"><h4>來源原文短引</h4><blockquote>{{ e.exact_quote }}</blockquote><template v-if="e.translation"><h4>中文翻譯（非原文）</h4><p>{{ text(e.translation) }}</p></template></template><p v-else-if="!e.fact">此來源僅提供合法原件連結或尚無获准短引；請到原件核對。</p><p>上下文與限制：{{ text(e.context_summary || e.limitations || e.support_scope,'尚未提供附近上下文摘要') }}</p></template>
    <a v-if="sourceUrl(documentMap.get(e.document_version_id),e)" :href="sourceUrl(documentMap.get(e.document_version_id),e)" target="_blank" rel="noopener noreferrer">開啟合法原件 · {{ locator(e.locator) }}</a>
    <details><summary>權利與版本檢查</summary><dl class="fr-detail-list"><dt>權利／展示</dt><dd>{{ text(documentMap.get(e.document_version_id)?.rights_policy) }} · {{ text(documentMap.get(e.document_version_id)?.allowed_display) }}</dd><dt>文件版本</dt><dd>{{ text(e.document_version_id) }}</dd><dt>原件雜湊</dt><dd>{{ text(documentMap.get(e.document_version_id)?.raw_sha256,'未取得原始位元組') }}</dd><dt>抽取文字雜湊</dt><dd>{{ text(documentMap.get(e.document_version_id)?.text_sha256,'未提供') }}</dd><dt>原句匹配</dt><dd>{{ text(e.quote_match_status,'未提供機械核對狀態') }}</dd></dl></details>
   </article><p v-if="!evidenceRows.length">引用未找到，不能以其他原句替代。</p>
  </dialog>
 </section>
</template>
