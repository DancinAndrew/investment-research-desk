import {hash, same, normalizeInput, httpURL, hasLocator, timestamp, limitationPolicy} from './input.mjs'

const escape = value => String(value ?? '').replace(/[\\`*_{}\[\]<>#]/g, char => ({'<':'&lt;','>':'&gt;'}[char] || '\\' + char)).replace(/\r?\n/g, ' ')
const format = value => typeof value === 'number' ? Number(value.toFixed(6)).toLocaleString('en-US',{maximumFractionDigits:6}) : String(value)
const conceptNames = {revenue:'收入',gross_margin:'毛利率',gross_profit:'毛利',operating_expenses:'營業費用',operating_income:'營業利益',net_income:'淨利',operating_cash_flow:'營業現金流',capex_purchases:'資本支出',principal_payments:'本金支付',free_cash_flow:'自由現金流',diluted_eps:'稀釋每股盈餘',diluted_weighted_average_shares:'稀釋加權平均股數',days_sales_outstanding:'應收帳款週轉天數',operating_margin:'營業利益率',free_cash_flow_margin:'自由現金流率'}
const scaleNames = {0:'',3:'千',6:'百萬',9:'十億',12:'兆'}
const currencyNames = {USD:'美元',TWD:'新臺幣',EUR:'歐元'}

function bindingLabel(binding) {
  const concept=Object.keys(conceptNames).find(name=>binding.fact_id===name || binding.fact_id?.endsWith('-'+name))
  return concept ? conceptNames[concept] : '原報指標'
}
function bindingUnit(binding) {
  const scale=scaleNames[binding.scale],currency=currencyNames[binding.currency] || binding.currency || '原幣'
  if (binding.unit==='currency' && scale!==undefined) return scale+currency
  if (binding.unit==='currency_per_share' && scale!==undefined) return scale+currency+'／股'
  if (binding.unit==='percent' && binding.scale===0) return '%'
  if (binding.unit==='shares' && scale!==undefined) return scale+'股'
  if (binding.unit==='days' && binding.scale===0) return '天'
  return `${binding.unit || '原單位'}（每單位代表 ${format(10**binding.scale)} ${binding.currency || '原量'}）`
}
function derivedUnit(unit) { return {percent:'%', 'USD million':'百萬美元', 'USD per share':'美元／股'}[unit] || unit || '' }
function sourceCatalog(report) {
  const refs=(report.sections || []).flatMap(section=>(section.claims || []).flatMap(claim=>(claim.evidence_refs || []).map(ref=>({ref,claim_id:claim.id}))))
  const ids=[...new Set(refs.map(row=>row.ref.document_version_id))].sort()
  return new Map(ids.map((id,index)=>[id,{number:index+1,ref:refs.find(row=>row.ref.document_version_id===id).ref,uses:refs.filter(row=>row.ref.document_version_id===id)}]))
}
function locatorLabel(locator) {
  if (locator?.page != null) return '第'+locator.page+'頁'
  if (locator?.section) return String(locator.section).slice(0,80)
  if (locator?.paragraph != null) return '第'+locator.paragraph+'段'
  return '定位見附錄'
}

function claimLine(claim,catalog) {
  const numbers = (claim.fact_bindings || []).map(binding => `${escape(binding.period_id)} ${escape(bindingLabel(binding))} ${format(binding.value)} ${escape(bindingUnit(binding))}`)
  if (claim.derivation) numbers.push(`${escape(claim.derivation.label || claim.derivation.operation)} = ${format(claim.derivation.value)} ${escape(derivedUnit(claim.derivation.unit))}`)
  const refs = [...new Set((claim.evidence_refs || []).map(ref => {
    const label='來源'+catalog.get(ref.document_version_id).number+'，'+locatorLabel(ref.locator)
    return httpURL(ref.original_url) ? `[${escape(label)}](${ref.original_url})` : escape(label)
  }))]
  const text=claim.text?.replace(/[。；]+$/,'')
  return `${escape(text)}${numbers.length ? '；' + numbers.join('；') : ''}。${refs.join('、')}`
}

export function renderReport(report) {
  if (!report) return ''
  const catalog=sourceCatalog(report)
  const lines = [`# ${escape(report.title)}`, '', `資料截至 ${escape(report.information_as_of)}；本次執行 ${escape(report.generated_at)}。${report.metadata?.input_kind === 'synthetic_fixture' ? '合成測試資料。' : '已保存真實公開資料的固定截止重算。'}`, '', '來源／作者：Desk 決定式程式分析。引用原披露與既有人工整理的來源候選另標；規則通過不等於獨立語義覆核。', '']
  for (const section of report.sections || []) {
    lines.push(`## ${escape(section.title)}`, '')
    for (const claim of section.claims || []) {
      if (claim.kind === 'quote') lines.push(`> 來源引述：${escape(claim.quote?.text || '')}`, `> ${claimLine(claim,catalog)}`, '')
      else lines.push('- ' + claimLine(claim,catalog), '')
    }
  }
  if (report.assumptions?.length) { lines.push('## 明示假設', ''); for (const row of report.assumptions) lines.push(`- ${escape(row.label)}：${escape(row.value)}`, '') }
  lines.push('## 研究限制', '')
  for (const limit of report.limitations || []) lines.push('- ' + escape(limit), '')
  if (catalog.size) {
    lines.push('## 來源定位', '', '以下保留版本、文字 hash 與逐主張定位，方便回查；正文使用同一來源編號。', '')
    for (const {number,ref,uses} of catalog.values()) {
      lines.push(`### 來源${number}`, '', `版本：${escape(ref.document_version_id)}`, '', httpURL(ref.original_url)?`[開啟公開原件](${ref.original_url})`:'未提供可開啟的公開 URL', '', `文字 SHA-256：${escape(ref.text_sha256)}`, '')
      const uniqueUses=[...new Map(uses.map(use=>[use.claim_id+'\n'+JSON.stringify(use.ref.locator),use])).values()]
      for (const use of uniqueUses) lines.push(`- ${escape(use.claim_id)} → ${escape(JSON.stringify(use.ref.locator))}`, '')
    }
  }
  return lines.join('\n') + '\n'
}

export function directInstructions(text) {
  const violations = []
  for (const clause of String(text || '').split(/[。！？!?;；\n，,]/)) {
    const pattern = /(?:買進|買入|賣出|做多|做空|加碼|下單)|買(?=\s*(?:NVDA|NVIDIA|輝達))|\b(?:buy(?:ing)?|sell(?:ing)?|purchas(?:e|ing))\s+(?:(?:\d+(?:\.\d+)?)\s+(?:shares?\s+(?:of\s+)?)?)?(?:NVDA|NVIDIA|now|shares|the stock)\b/gi
    for (const match of clause.matchAll(pattern)) {
      const prefix = clause.slice(0, match.index)
      if (/(?:不建議|不應該?|不要|勿|不構成|不提供|不是|並非|禁止)\s*$/.test(prefix) || /(?:(?:do not|don't|never)(?:\s+(?:recommend|suggest))?|not (?:a|an))\s*$/i.test(prefix)) continue
      violations.push(clause.trim())
    }
  }
  return violations
}

export function calculateDerivation(derivation, factMap, assumptions = []) {
  const values = (derivation.inputs || []).map(id => factMap.get(id)).map(fact => fact ? Number(fact.numeric_decimal) : NaN)
  if (!values.length || values.some(value => !Number.isFinite(value))) return NaN
  switch (derivation.operation) {
    case 'sum': return values.reduce((sum, value) => sum + value, 0)
    case 'sum_signed_cash': return values.length === 3 ? values[0] + values[1] + values[2] : NaN
    case 'ratio_percent': return values.length === 2 && values[1] !== 0 ? 100 * values[0] / values[1] : NaN
    case 'growth_percent': return values.length === 2 && values[1] > 0 ? 100 * (values[0] / values[1] - 1) : NaN
    case 'ttm_eps_pe': {
      const assumption = assumptions.find(row => row.id === derivation.assumption_id)
      if (values.length !== 4 || !assumption || assumption.kind !== 'assumption' || !Number.isFinite(assumption.value) || assumption.value <= 0 || values.reduce((sum, value) => sum + value, 0) <= 0) return NaN
      return values.reduce((sum, value) => sum + value, 0) * assumption.value
    }
    default: return NaN
  }
}

export function evaluateReport(report, input) {
  const data = normalizeInput(input), failures = [], facts = new Map(data.facts.map(row => [row.fact_id, row])), documents = new Map(data.documents.map(row => [row.document_version_id, row]))
  const framing=limitationPolicy(data)
  const push = (code, claim_id, detail) => failures.push({code, claim_id, detail})
  if (data.fatal_issues.length) push('invalid_input', null, data.fatal_issues)
  if (!report || report.schema_version !== 'desk-report/1' || report.company !== data.company || report.information_as_of !== data.information_as_of || !Array.isArray(report.sections) || !report.sections.length || !Number.isFinite(timestamp(report.generated_at)) || typeof report.run_id !== 'string' || !report.run_id) push('report_contract_invalid', null, 'Company, cutoff, schema, run identity, generation time and sections are required.')
  const assumptionIds=new Set()
  for (const assumption of report?.assumptions || []) {
    if (!assumption.id || assumptionIds.has(assumption.id) || assumption.kind !== 'assumption' || typeof assumption.label !== 'string' || !Number.isFinite(assumption.value) || assumption.value <= 0) push('assumption_contract_invalid', null, assumption.id)
    assumptionIds.add(assumption.id)
  }
  const ids = new Set(), allClaims = [], quoteBudgets=new Map()
  for (const section of report?.sections || []) for (const claim of section.claims || []) {
    allClaims.push(claim)
    if (!claim.id || ids.has(claim.id)) push('claim_identity_invalid', claim.id)
    ids.add(claim.id)
    if (!['fact','derivation','source_paraphrase','limitation','assumption','quote'].includes(claim.kind) || typeof claim.text !== 'string' || !claim.text.trim()) push('claim_contract_invalid', claim.id)
    const important = ['fact','derivation','source_paraphrase','quote'].includes(claim.kind)
    if (important && !claim.evidence_refs?.length) push('unsourced_claim', claim.id, 'Important claims require evidence in this input.')
    for (const ref of claim.evidence_refs || []) {
      const document = documents.get(ref.document_version_id)
      if (!document || ref.text_sha256 !== document.text_sha256 || ref.original_url !== document.original_url || !hasLocator(ref.locator)) push('source_reference_invalid', claim.id, ref.document_version_id)
    }
    for (const binding of claim.fact_bindings || []) {
      const fact = facts.get(binding.fact_id)
      if (!fact || binding.value !== Number(fact.numeric_decimal) || binding.period_id !== fact.period_id || binding.unit !== fact.unit || binding.scale !== fact.scale || binding.currency !== (fact.currency ?? null) || binding.source_document_version !== fact.source_document_version || !same(binding.locator, fact.locator)) push('fact_binding_mismatch', claim.id, binding.fact_id)
      if (fact && !(claim.evidence_refs || []).some(ref => ref.document_version_id === fact.source_document_version && same(ref.locator, fact.locator))) push('fact_locator_not_cited', claim.id, binding.fact_id)
    }
    if (claim.kind === 'fact' && !claim.fact_bindings?.length) push('fact_binding_missing', claim.id)
    if (claim.kind === 'derivation') {
      const derivation = claim.derivation
      const calculated = derivation ? calculateDerivation(derivation, facts, report.assumptions) : NaN
      if (!Number.isFinite(calculated) || !Number.isFinite(derivation?.value) || Math.abs(calculated - derivation.value) > 1e-6 * Math.max(1, Math.abs(calculated))) push('derivation_mismatch', claim.id)
      if (derivation?.inputs?.some(id => !(claim.fact_bindings || []).some(binding => binding.fact_id === id))) push('derivation_binding_missing', claim.id)
      const inputFacts = (derivation?.inputs || []).map(id => facts.get(id)).filter(Boolean)
      const [first, ...others] = inputFacts
      if (first && ['growth_percent','sum','sum_signed_cash','ttm_eps_pe'].includes(derivation.operation) && others.some(fact => fact.unit !== first.unit || fact.scale !== first.scale || fact.currency !== first.currency)) push('derivation_units_incomparable', claim.id)
      if (derivation?.operation === 'ratio_percent' && inputFacts.length === 2 && (inputFacts[0].unit !== inputFacts[1].unit || inputFacts[0].scale !== inputFacts[1].scale || inputFacts[0].currency !== inputFacts[1].currency || inputFacts[0].period_id !== inputFacts[1].period_id)) push('derivation_units_incomparable', claim.id)
      if (derivation?.operation === 'ttm_eps_pe' && inputFacts.some(fact => fact.concept !== 'diluted_eps')) push('valuation_basis_invalid', claim.id)
      if (derivation?.operation === 'sum_signed_cash' && (inputFacts.length !== 3 || !same(inputFacts.map(fact=>fact.concept),['operating_cash_flow','capex_purchases','principal_payments']) || inputFacts.some(fact=>fact.period_id!==first.period_id) || inputFacts.slice(1).some(fact=>Number(fact.numeric_decimal)>0))) push('cash_bridge_basis_invalid',claim.id)
      if (derivation?.operation === 'growth_percent' && inputFacts.length === 2) {
        const [current,previous]=inputFacts.map(fact=>data.periods.find(row=>row.period_id===fact.period_id))
        const distance=current&&previous?(current.fiscal_year-previous.fiscal_year)*4+current.fiscal_quarter-previous.fiscal_quarter:NaN
        if (inputFacts[0].concept!==inputFacts[1].concept || ![1,4].includes(distance) || timestamp(current?.end_date)<=timestamp(previous?.end_date) || (distance===1&&Math.round((timestamp(current.start_date)-timestamp(previous.end_date))/86400000)!==1)) push('growth_periods_incomparable',claim.id)
      }
      if (derivation?.operation === 'ttm_eps_pe') {
        const latest=data.periods.slice(-4)
        if (inputFacts.length!==4 || !same(inputFacts.map(fact=>fact.period_id),latest.map(row=>row.period_id)) || inputFacts.some(fact=>fact.share_basis!==first.share_basis) || latest.some((period,index)=>index&&Math.round((timestamp(period.start_date)-timestamp(latest[index-1].end_date))/86400000)!==1)) push('valuation_periods_incomparable',claim.id)
      }
      const expectedUnit = {growth_percent:'percent',ratio_percent:'percent',sum_signed_cash:'USD million',ttm_eps_pe:'USD per share'}[derivation?.operation]
      if (expectedUnit && derivation.unit !== expectedUnit) push('derivation_unit_invalid', claim.id)
    }
    if (claim.kind === 'source_paraphrase') {
      const original = data.claims.find(row => row.claim_version_id === claim.source_claim_version_id)
      if (!original || claim.text!==`${original.statement_at} 管理層說法／既有人工整理候選：${original.paraphrase}` || timestamp(original.statement_at,true)>data.cutoff || claim.evidence_refs?.length!==original.evidence_refs?.length || !(claim.evidence_refs || []).every(ref => original.evidence_refs?.some(old => old.document_version_id === ref.document_version_id && same(old.locator, ref.locator)))) push('source_claim_locator_mismatch', claim.id)
    }
    if (claim.kind === 'limitation' && framing.claims.get(claim.id)!==claim.text) push('unsourced_claim',claim.id,'Unregistered factual/narrative text cannot be relabeled as a limitation.')
    if (claim.kind === 'assumption') push('unsourced_claim',claim.id,'Assumptions belong to the explicit numeric assumption section, not unrestricted narrative claims.')
    if (claim.kind === 'quote') {
      const quote = claim.quote
      const document = documents.get(quote?.document_version_id)
      if (!document || typeof quote.text !== 'string' || !quote.text.trim() || quote.text.length > 180 || quote.text.trim().split(/\s+/).length > 25 || !document.extracted_text.includes(quote.text) || !(claim.evidence_refs || []).some(ref => ref.document_version_id === document.document_version_id)) push('quote_not_verified', claim.id)
      if (typeof quote?.text==='string') {
        const used=(quoteBudgets.get(quote.document_version_id)||0)+quote.text.trim().split(/\s+/).length
        quoteBudgets.set(quote.document_version_id,used)
        if (used>25) push('quote_budget_exceeded',claim.id)
      }
    }
  }
  const isDisclaimer=text=>typeof text==='string'&&text.split(/[。.!?！？\n]/).map(row=>row.trim()).filter(Boolean).every(clause=>/^(?:(?:這|本報告)?(?:不是|不構成|不提供)(?:任何)?(?:買進|買入|賣出|買賣|投資)(?:建議|指令)|不要(?:買進|買入|賣出)\s*NVDA|Do not (?:buy|sell) NVDA)$/i.test(clause))
  for (const text of report?.limitations || []) if (!framing.all.has(text) && !isDisclaimer(text)) push('unsourced_claim',null,'Unregistered text in the limitations section.')
  if (!allClaims.some(claim => ['fact','derivation'].includes(claim.kind))) push('research_evidence_missing', null)
  // Only the exact source-verified quote body is excluded. The author's surrounding
  // text, headings, labels, assumptions and limitations are always scanned.
  const authored = [report?.title, report?.generated_at, ...(report?.sections || []).flatMap(section => [section.title, ...(section.claims || []).flatMap(claim => [claim.text, claim.derivation?.label, claim.derivation?.unit, ...(claim.evidence_refs||[]).flatMap(ref=>[ref.document_version_id,...Object.values(ref.locator||{})])])]), ...(report?.assumptions || []).flatMap(row => [row.label, row.value]), ...(report?.limitations || [])]
  for (const text of authored) for (const instruction of directInstructions(text)) push('direct_buy_instruction', null, instruction)
  const markdown = renderReport(report)
  return {status: failures.length ? 'needs_revision' : 'accepted', passed: failures.length === 0, checks: {sources: !failures.some(row => ['unsourced_claim','source_reference_invalid','fact_binding_mismatch','fact_binding_missing','fact_locator_not_cited','source_claim_locator_mismatch','quote_not_verified','derivation_mismatch','derivation_binding_missing','derivation_units_incomparable','invalid_input'].includes(row.code)), buy_instructions: !failures.some(row => row.code === 'direct_buy_instruction')}, failures, report_sha256: hash(report), report_markdown_sha256: hash(markdown), semantic_review: 'not_performed', limitation: 'Deterministic checks verify references and arithmetic, not every semantic inference or investment outcome.'}
}
