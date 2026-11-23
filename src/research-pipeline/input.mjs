import {createHash} from 'node:crypto'

export function stableJSON(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJSON).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + stableJSON(value[key])).join(',') + '}'
  return JSON.stringify(value)
}
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : stableJSON(value)).digest('hex')
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export const same = (left, right) => stableJSON(left) === stableJSON(right)
export const hasLocator = value => value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).some(item => item !== null && item !== '')
export function httpURL(value) {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password } catch { return false }
}

// A date-only cutoff includes that UTC day. The convention is disclosed in the report.
export function timestamp(value, endOfDay = false, timezone = 'Z') {
  if (typeof value !== 'string') return NaN
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(value + 'T00:00:00Z')
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) return NaN
    const zone = /^(?:Z|[+-]\d{2}:\d{2})$/.test(timezone) ? timezone : 'Z'
    return Date.parse(value + (endOfDay ? 'T23:59:59.999' : 'T00:00:00') + zone)
  }
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN
  const day = value.slice(0, 10)
  if (!Number.isFinite(timestamp(day))) return NaN
  return Date.parse(value)
}

function availableBy(document, cutoff) {
  const witness = document.version_witness || {}
  const retrieved = timestamp(document.retrieved_at)
  const published = timestamp(document.published_at, true, document.published_timezone)
  if (Number.isFinite(published) && published > cutoff) return {eligible: false, reason: 'published_after_cutoff'}
  if (Number.isFinite(retrieved) && retrieved <= cutoff) return {eligible: true, method: 'retrieved_before_cutoff', available_at: document.retrieved_at}
  if (witness.method === 'pre_cutoff_retrieval_receipt') {
    const time = timestamp(witness.witnessed_at)
    if (Number.isFinite(time) && time <= cutoff) return {eligible: true, method: witness.method, available_at: witness.witnessed_at}
  }
  if (witness.method === 'internet_archive_capture_identical_sha256' && /^\d{14}$/.test(witness.capture_timestamp_utc || '') && witness.capture_sha256 === document.raw_sha256) {
    const t = witness.capture_timestamp_utc
    const captured = `${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:${t.slice(12,14)}Z`
    if (Number.isFinite(timestamp(captured)) && timestamp(captured) <= cutoff) return {eligible: true, method: witness.method, available_at: captured}
  }
  return {eligible: false, reason: 'version_not_witnessed_by_cutoff'}
}

export function normalizeInput(input) {
  const bundle = input?.bundle || {}, profile = input?.profile || {}
  const company = String(profile.company || bundle.company?.company_id || '').trim().toUpperCase()
  const information_as_of = profile.information_as_of || bundle.run?.as_of
  const fatal_issues = [], excluded_sources = [], documents = [], source_issues = []
  const cutoff = timestamp(information_as_of, true)
  if (!Number.isFinite(cutoff)) fatal_issues.push({code: 'invalid_cutoff'})
  if (!['real_snapshot', 'synthetic_fixture'].includes(profile.input_kind)) fatal_issues.push({code: 'input_kind_required'})
  if (bundle.company?.company_id !== company) fatal_issues.push({code: 'company_mismatch'})
  const allDocuments = Array.isArray(bundle.documents) ? bundle.documents : []
  if (!allDocuments.length || allDocuments.length > 500) fatal_issues.push({code: 'document_count_invalid'})
  const seen = new Set()
  for (const document of allDocuments) {
    const id = document.document_version_id
    const reasons = []
    if (typeof id !== 'string' || !id || seen.has(id)) reasons.push('duplicate_or_missing_document_id')
    seen.add(id)
    if (document.company_id !== company) reasons.push('document_company_mismatch')
    if (!httpURL(document.original_url)) reasons.push('invalid_source_url')
    if (typeof document.extracted_text !== 'string' || !document.extracted_text.trim() || !isHash(document.text_sha256) || hash(document.extracted_text) !== document.text_sha256) reasons.push('source_text_hash_mismatch')
    if (!isHash(document.raw_sha256)) reasons.push('source_raw_hash_missing')
    if (document.published_at != null && !Number.isFinite(timestamp(document.published_at, true, document.published_timezone))) reasons.push('source_publication_date_invalid')
    if (!Number.isFinite(timestamp(document.retrieved_at))) reasons.push('source_retrieval_date_invalid')
    if (reasons.length) { fatal_issues.push({document_version_id: id, code: 'invalid_source', reasons}); continue }
    const availability = availableBy(document, cutoff)
    const projected = {document_version_id: id, source_id: document.source_id || id, company_id: document.company_id, title: document.title || id, source_type: document.source_type || 'unknown', original_url: document.original_url, text_sha256: document.text_sha256, raw_sha256: document.raw_sha256, published_at: document.published_at ?? null, retrieved_at: document.retrieved_at ?? null, availability, extracted_text: document.extracted_text}
    if (availability.eligible) documents.push(projected)
    else excluded_sources.push({...sourceMetadata(projected), reason: availability.reason})
  }
  const periods = Array.isArray(bundle.periods) ? bundle.periods : []
  const periodIds = new Set()
  for (const period of periods) {
    if (!period.period_id || periodIds.has(period.period_id) || !Number.isInteger(period.fiscal_year) || !Number.isInteger(period.fiscal_quarter) || period.fiscal_quarter < 1 || period.fiscal_quarter > 4 || !Number.isFinite(timestamp(period.start_date)) || !Number.isFinite(timestamp(period.end_date)) || timestamp(period.start_date) > timestamp(period.end_date) || timestamp(period.end_date) > cutoff) fatal_issues.push({code: 'invalid_period', period_id: period.period_id})
    periodIds.add(period.period_id)
  }
  const facts = Array.isArray(bundle.facts) ? bundle.facts : []
  const factIds = new Set(), documentMap = new Map(documents.map(row => [row.document_version_id, row]))
  for (const fact of facts) {
    const reasons = []
    if (!fact.fact_id || factIds.has(fact.fact_id)) reasons.push('duplicate_or_missing_fact_id')
    factIds.add(fact.fact_id)
    if (fact.company_id !== company || !periodIds.has(fact.period_id)) reasons.push('fact_company_or_period_invalid')
    if (typeof fact.numeric_decimal !== 'string' || !/^-?\d+(?:\.\d+)?$/.test(fact.numeric_decimal) || !Number.isFinite(Number(fact.numeric_decimal))) reasons.push('fact_value_invalid')
    if (!Number.isInteger(fact.scale) || Math.abs(fact.scale) > 12 || typeof fact.unit !== 'string' || !hasLocator(fact.locator)) reasons.push('fact_unit_or_locator_invalid')
    if (!documentMap.has(fact.source_document_version)) reasons.push('fact_source_unavailable')
    if (fact.published_at != null && !Number.isFinite(timestamp(fact.published_at, true))) reasons.push('fact_publication_date_invalid')
    if (timestamp(fact.published_at, true) > cutoff) reasons.push('fact_after_cutoff')
    if (reasons.length) source_issues.push({fact_id: fact.fact_id, reasons})
  }
  const validFacts = facts.filter(fact => !source_issues.some(issue => issue.fact_id === fact.fact_id))
  if (source_issues.some(issue => issue.reasons.some(reason => reason !== 'fact_source_unavailable'))) fatal_issues.push({code: 'invalid_facts', issues: source_issues})
  const multiples = profile.valuation_multiples || [20, 30, 40]
  if (!Array.isArray(multiples) || !multiples.length || multiples.length > 8 || multiples.some(value => !Number.isFinite(value) || value <= 0 || value > 200)) fatal_issues.push({code: 'valuation_assumptions_invalid'})
  return {company, information_as_of, input_kind: profile.input_kind, cutoff, bundle, profile: {...profile, valuation_multiples: multiples}, documents, excluded_sources, facts: validFacts, periods: [...periods].sort((a,b) => a.end_date.localeCompare(b.end_date)), claims: Array.isArray(bundle.claims) ? bundle.claims : [], source_issues, fatal_issues, input_sha256: hash(input)}
}

export function sourceMetadata(document) { const {extracted_text, ...metadata} = document; return metadata }
export function reference(document, locator) { return {document_version_id: document.document_version_id, text_sha256: document.text_sha256, locator: structuredClone(locator), original_url: document.original_url} }
export function factBinding(fact) {
  return {fact_id: fact.fact_id, value: Number(fact.numeric_decimal), period_id: fact.period_id, unit: fact.unit, scale: fact.scale, currency: fact.currency ?? null, source_document_version: fact.source_document_version, locator: structuredClone(fact.locator)}
}

// These are versioned framing statements, not a free-form channel for factual
// assertions. New narrative requires a sourced claim or a pipeline version change.
export function limitationPolicy(data) {
  const chipCandidates=data.documents.some(row=>['institutional_holdings','institutional_flow','ownership'].includes(row.source_type))
  const priceCandidates=data.documents.some(row=>['daily_prices','price_history','market_prices'].includes(row.source_type))
  const unsupported='發現候選來源，但本版尚無該來源格式與調整口徑的核對器。'
  const chip=(chipCandidates?unsupported:'本次已登錄資料只有公司披露與法說，沒有可核對的持股／資金流資料。')+' 不推論機構增減持、資金流或買賣力量。'
  const technical=(priceCandidates?unsupported:'本次已登錄資料沒有帶交易日、調整口徑與來源的每日行情。')+' 不計算均線、量價或趨勢訊號。'
  const counter='收入成長與正現金流不能單獨證明未來需求、客戶資金或估值假設會成立；後續需以同口徑原件重新核對。'
  return {claims:new Map([['counter-case',counter],['chip-gap',chip],['technical-gap',technical]]),all:new Set([
    counter,chip,technical,
    '這是固定資料截止的決定式研究重算，沒有即時行情、雲端模型或交易執行。',
    '日期型截止以該日 UTC 結束計；來源版本可得時間另列，取回時間不回填為發布日。',
    '規則核對來源、定位與算式，沒有對所有敘事進行獨立語義覆核，亦未驗證預測獲利。',
    '沿用既有人工整理的管理層說法候選，這次重核來源版本與定位；未重新進行獨立語義覆核。',
    '沒有可於截止前驗明來源的產業／管理層說法。',
    '部分季度或指標缺乏可用來源，保留缺值而非補零。',
    '估值缺少可比較的四季每股盈餘，未提供假價格。',
    '輸入沒有可用的當時股價與股價來源，因此不計算便宜／昂貴、報酬空間或現在交易判斷。',
    '使用原報稀釋 EPS 加總；季度加權平均股數可能不同，這不是用單一全年股數重新計算的全年 EPS。',
    '部分原候選主張未通過本次來源／引述檢查，已排除；詳見階段紀錄。',
    ...data.facts.filter(row=>row.reconciliation_note).map(row=>row.reconciliation_note),
    ...data.excluded_sources.map(row=>`${row.document_version_id} 排除：${row.reason}。`)
  ])}
}
