import {randomUUID} from 'node:crypto'
import {setImmediate} from 'node:timers/promises'
import {hash, normalizeInput, reference, sourceMetadata, factBinding, timestamp} from './input.mjs'
import {calculateDerivation, evaluateReport, renderReport} from './evaluator.mjs'

export const PIPELINE_VERSION = 'desk-deterministic-research/1'
export const STAGES = Object.freeze(['intent_router','source_retrieval','news_sector_agent','fundamental_agent','valuation_agent','chip_agent','technical_agent','health_check_agent','risk_agent','report_generator','evaluation_agent'])

const clone = value => structuredClone(value)
const value = fact => fact ? Number(fact.numeric_decimal) : null
const close = (left, right, tolerance = 1e-6) => Math.abs(left - right) <= tolerance

function factIndex(data) { return new Map(data.facts.map(fact => [fact.fact_id, fact])) }
function select(data, period, concept) { return data.facts.find(fact => fact.period_id === period && fact.concept === concept) }
function refsFor(data, facts) {
  const documents = new Map(data.documents.map(document => [document.document_version_id, document]))
  return facts.map(fact => reference(documents.get(fact.source_document_version), fact.locator)).filter((row, index, rows) => rows.findIndex(other => hash(other) === hash(row)) === index)
}
function numericClaim(data, {id, text, facts, operation, label, unit, assumption_id}) {
  const bindings = facts.map(factBinding), claim = {id, kind: operation ? 'derivation' : 'fact', text, evidence_refs: refsFor(data, facts), fact_bindings: bindings}
  if (operation) {
    claim.derivation = {operation, inputs: facts.map(fact => fact.fact_id), label, unit, ...(assumption_id ? {assumption_id} : {})}
    claim.derivation.value = calculateDerivation(claim.derivation, factIndex(data), data.assumptions || [])
  }
  return claim
}

function sectorAnalysis(data) {
  const documents = new Map(data.documents.map(row => [row.document_version_id, row])), grouped = new Map(), excluded = []
  for (const candidate of data.claims) {
    const refs = candidate.evidence_refs || []
    const reasons = []
    if (candidate.company_id !== data.company || !refs.length || typeof candidate.paraphrase !== 'string') reasons.push('claim_contract_invalid')
    if (!Number.isFinite(timestamp(candidate.statement_at,true))) reasons.push('claim_statement_date_unknown')
    if (timestamp(candidate.statement_at, true) > data.cutoff) reasons.push('claim_after_cutoff')
    for (const ref of refs) {
      const document = documents.get(ref.document_version_id)
      if (!document) reasons.push('source_unavailable_by_cutoff')
      else if (ref.exact_quote && !document.extracted_text.replace(/\s+/g,' ').includes(ref.exact_quote.replace(/\s+/g,' '))) reasons.push('candidate_quote_not_found')
    }
    if (reasons.length) { excluded.push({claim_version_id: candidate.claim_version_id, reasons}); continue }
    const topic = candidate.topic || 'unclassified'
    if (!grouped.has(topic)) grouped.set(topic, [])
    grouped.get(topic).push({claim_version_id: candidate.claim_version_id, period_id: candidate.period_id, statement_at: candidate.statement_at, paraphrase: candidate.paraphrase, evidence_refs: refs.map(ref => reference(documents.get(ref.document_version_id), ref.locator))})
  }
  const topics = [...grouped].map(([topic, entries]) => ({topic, chronology: entries.sort((a,b) => String(a.statement_at).localeCompare(String(b.statement_at))), status: entries.length > 1 ? 'multiple_dated_statements' : 'single_statement'}))
  return {status: topics.length ? 'analyzed' : 'not_evaluable', examined_claim_count: data.claims.length, topics, excluded, limitations: ['沿用既有人工整理的管理層說法候選，這次重核來源版本與定位；未重新進行獨立語義覆核。', ...(topics.length ? [] : ['沒有可於截止前驗明來源的產業／管理層說法。'])]}
}

function fundamentals(data) {
  const rows = [], claims = [], missing = []
  for (let index = 0; index < data.periods.length; index++) {
    const period = data.periods[index], revenue = select(data, period.period_id, 'revenue'), gross = select(data, period.period_id, 'gross_margin'), operating = select(data, period.period_id, 'operating_income'), cash = select(data, period.period_id, 'operating_cash_flow'), capex = select(data, period.period_id, 'capex_purchases'), principal = select(data, period.period_id, 'principal_payments'), fcf = select(data, period.period_id, 'free_cash_flow')
    const row = {period_id: period.period_id, end_date: period.end_date, revenue: value(revenue), gross_margin_percent: value(gross), operating_cash_flow: value(cash), reported_free_cash_flow: value(fcf), revenue_qoq_percent: null, revenue_yoy_percent: null, operating_margin_percent: null, calculated_free_cash_flow: null, free_cash_flow_margin_percent: null}
    if (revenue) claims.push(numericClaim(data, {id: period.period_id + '-revenue', text: '公司原報季度收入。', facts: [revenue]}))
    else missing.push({period_id: period.period_id, concept: 'revenue', reason: 'No eligible source-bound fact.'})
    if (gross) claims.push(numericClaim(data, {id: period.period_id + '-gross-margin', text: '公司原報 GAAP 毛利率；GAAP 是財報使用的會計準則口徑。', facts: [gross]}))
    const previousPeriod = data.periods[index - 1]
    const consecutiveQuarter = previousPeriod && period.fiscal_year*4+period.fiscal_quarter === previousPeriod.fiscal_year*4+previousPeriod.fiscal_quarter+1 && Math.round((timestamp(period.start_date)-timestamp(previousPeriod.end_date))/86400000)===1
    const previous = consecutiveQuarter ? select(data, previousPeriod.period_id, 'revenue') : null
    const yearAgo = data.periods.find(other => other.fiscal_year === period.fiscal_year - 1 && other.fiscal_quarter === period.fiscal_quarter)
    const yearly = yearAgo ? select(data, yearAgo.period_id, 'revenue') : null
    for (const [prior, id, label, property] of [[previous,'qoq','相較前一季度收入成長率','revenue_qoq_percent'],[yearly,'yoy','相較去年同季收入成長率','revenue_yoy_percent']]) {
      if (revenue && prior && value(prior) > 0 && revenue.unit === prior.unit && revenue.scale === prior.scale && revenue.currency === prior.currency) {
        const claim = numericClaim(data,{id: period.period_id + '-' + id, text: label + '，使用同單位原報收入重算。', facts: [revenue, prior], operation:'growth_percent',label,unit:'percent'})
        row[property] = claim.derivation.value; claims.push(claim)
      }
    }
    for (const [numerator, id, label, property] of [[operating,'operating-margin','營業利益佔收入比率','operating_margin_percent'],[fcf,'fcf-margin','公司原報自由現金流佔收入比率','free_cash_flow_margin_percent']]) {
      if (numerator && revenue && value(revenue) !== 0) {
        const claim=numericClaim(data,{id:period.period_id+'-'+id,text:label+'，由該季原報值重算。',facts:[numerator,revenue],operation:'ratio_percent',label,unit:'percent'})
        row[property]=claim.derivation.value;claims.push(claim)
      }
    }
    if (cash && capex && principal) {
      const claim = numericClaim(data,{id:period.period_id+'-fcf',text:'自由現金流重算：營業現金流加上帶負號的資本支出與本金支付；這是公司採用口徑。',facts:[cash,capex,principal],operation:'sum_signed_cash',label:'營業現金流 + 帶符號資本支出 + 帶符號本金支付',unit:'USD million'})
      row.calculated_free_cash_flow=claim.derivation.value;claims.push(claim)
    } else missing.push({period_id:period.period_id,concept:'free_cash_flow',reason:'Required cash bridge inputs are incomplete.'})
    rows.push(row)
  }
  return {status:rows.some(row=>row.revenue!==null)?'analyzed':'not_evaluable',rows,claims,missing,limitations:missing.length?['部分季度或指標缺乏可用來源，保留缺值而非補零。']:[]}
}

function valuation(data) {
  const periods = data.periods.slice(-4), epsFacts = periods.map(period => select(data,period.period_id,'diluted_eps'))
  const consecutive = periods.length === 4 && periods.every((period,index) => !index || Math.round((timestamp(period.start_date)-timestamp(periods[index-1].end_date))/86400000) === 1)
  const comparable = epsFacts.every(fact => fact && fact.unit === 'currency_per_share' && fact.scale === 0 && fact.currency === 'USD' && fact.share_basis === epsFacts[0]?.share_basis)
  if (!consecutive || !comparable || epsFacts.reduce((sum,fact)=>sum+(value(fact)||0),0)<=0) return {status:'not_evaluable',claims:[],assumptions:[],reason:'需要連續四季、同股數口徑且合計為正的每股盈餘。',examined_periods:periods.map(row=>row.period_id),limitations:['估值缺少可比較的四季每股盈餘，未提供假價格。']}
  const assumptions = data.profile.valuation_multiples.map((multiple,index)=>({id:'pe-'+index,kind:'assumption',label:'假設本益比（價格除以每股盈餘的倍數），不是市場共識或預測',value:multiple}))
  data.assumptions = assumptions
  const claims = assumptions.map(assumption=>numericClaim(data,{id:'valuation-'+assumption.id,text:'條件敏感度：最近四季原報稀釋每股盈餘合計 × 假設本益比；不代表合理價或買賣指令。',facts:epsFacts,operation:'ttm_eps_pe',label:'四季每股盈餘 × 假設本益比 '+assumption.value,unit:'USD per share',assumption_id:assumption.id}))
  return {status:'conditional_sensitivity',periods:periods.map(row=>row.period_id),ttm_diluted_eps:epsFacts.reduce((sum,fact)=>sum+value(fact),0),assumptions,claims,current_price:null,limitations:['輸入沒有可用的當時股價與股價來源，因此不計算便宜／昂貴、報酬空間或現在交易判斷。','使用原報稀釋 EPS 加總；季度加權平均股數可能不同，這不是用單一全年股數重新計算的全年 EPS。']}
}

function gapAssessment(data, kind) {
  const types = kind === 'chip' ? ['institutional_holdings','institutional_flow','ownership'] : ['daily_prices','price_history','market_prices']
  const candidates = data.documents.filter(document=>types.includes(document.source_type))
  // These evidence classes are evaluated explicitly. Unsupported source formats
  // never become a zero-position/flat-price assertion.
  return {status:'not_evaluable',examined_document_count:data.documents.length,candidate_source_ids:candidates.map(row=>row.document_version_id),required_source_types:types,reason:candidates.length?'發現候選來源，但本版尚無該來源格式與調整口徑的核對器。':kind==='chip'?'本次已登錄資料只有公司披露與法說，沒有可核對的持股／資金流資料。':'本次已登錄資料沒有帶交易日、調整口徑與來源的每日行情。',consequence:kind==='chip'?'不推論機構增減持、資金流或買賣力量。':'不計算均線、量價或趨勢訊號。'}
}

function healthCheck(data, fundamental) {
  const cashReconciliations = fundamental.rows.filter(row=>row.calculated_free_cash_flow!==null&&row.reported_free_cash_flow!==null).map(row=>({period_id:row.period_id,calculated:row.calculated_free_cash_flow,reported:row.reported_free_cash_flow,difference:row.calculated_free_cash_flow-row.reported_free_cash_flow,balanced:close(row.calculated_free_cash_flow,row.reported_free_cash_flow)}))
  const notes=data.facts.filter(fact=>fact.reconciliation_note).map(fact=>({fact_id:fact.fact_id,note:fact.reconciliation_note,evidence_refs:refsFor(data,[fact]),fact_bindings:[factBinding(fact)]}))
  const invalidMargins=fundamental.rows.filter(row=>row.gross_margin_percent!==null&&(row.gross_margin_percent<0||row.gross_margin_percent>100)).map(row=>row.period_id)
  return {status:cashReconciliations.some(row=>!row.balanced)||invalidMargins.length||notes.length?'limits_identified':'checked',cash_reconciliations:cashReconciliations,source_reconciliation_notes:notes,invalid_margin_periods:invalidMargins,missing:fundamental.missing,limitations:notes.map(row=>row.note)}
}

function riskAnalysis(data, sector, fundamental, health, gaps) {
  const latest=fundamental.rows.at(-1), risks=[]
  if(latest?.operating_cash_flow!==null&&latest?.revenue>0)risks.push({id:'cash-conversion',kind:'derived_observation',period_id:latest.period_id,operating_cash_to_revenue_percent:100*latest.operating_cash_flow/latest.revenue,evidence_fact_ids:[select(data,latest.period_id,'operating_cash_flow').fact_id,select(data,latest.period_id,'revenue').fact_id],interpretation:'營業現金流與收入屬不同口徑；比率只描述現金流轉換，不能單獨判定收款品質。'})
  for(const topic of sector.topics.filter(row=>/supply|demand|cash|financ|margin|commitment|receivable|dso/i.test(row.topic)))risks.push({id:'topic-'+topic.topic,kind:'management_statement_watch',topic:topic.topic,source_claim_version_ids:topic.chronology.map(row=>row.claim_version_id),interpretation:'需與後續實績核對的管理層說法；不是已實現結果或獨立預測。'})
  return {status:'analyzed',risks,limitations:[...health.limitations,...gaps.map(row=>row.reason+' '+row.consequence)],counter_case:'收入成長與正現金流不能單獨證明未來需求、客戶資金或估值假設會成立；後續需以同口徑原件重新核對。'}
}

function makeReport(data, context, {runId,generatedAt}) {
  const sourceClaims=context.sector.topics.flatMap(topic=>topic.chronology.map(row=>({id:'source-'+row.claim_version_id,kind:'source_paraphrase',text:`${row.statement_at} 管理層說法／既有人工整理候選：${row.paraphrase}`,source_claim_version_id:row.claim_version_id,evidence_refs:row.evidence_refs,fact_bindings:[]})))
  const reconciliation=context.health.source_reconciliation_notes.map(row=>({id:'reconciliation-'+row.fact_id,kind:'fact',text:row.note,evidence_refs:row.evidence_refs,fact_bindings:row.fact_bindings}))
  const riskClaims=context.risk.risks.filter(row=>row.kind==='derived_observation').map(row=>numericClaim(data,{id:row.id,text:row.interpretation,facts:row.evidence_fact_ids.map(id=>data.facts.find(fact=>fact.fact_id===id)),operation:'ratio_percent',label:'營業現金流 / 收入',unit:'percent'}))
  const limits=[...new Set(['這是固定資料截止的決定式研究重算，沒有即時行情、雲端模型或交易執行。','日期型截止以該日 UTC 結束計；來源版本可得時間另列，取回時間不回填為發布日。','規則核對來源、定位與算式，沒有對所有敘事進行獨立語義覆核，亦未驗證預測獲利。',...context.sector.limitations,...context.fundamental.limitations,...context.valuation.limitations,...context.risk.limitations,...data.excluded_sources.map(row=>`${row.document_version_id} 排除：${row.reason}。`),...(context.sector.excluded.length?['部分原候選主張未通過本次來源／引述檢查，已排除；詳見階段紀錄。']:[])])]
  return {schema_version:'desk-report/1',company:data.company,run_id:runId,information_as_of:data.information_as_of,generated_at:generatedAt,title:data.company+' 研究：收入、現金與條件估值',sections:[{id:'fundamental',title:'收入與現金如何變化',claims:context.fundamental.claims},{id:'sector',title:'管理層說法與待核對主題',claims:sourceClaims},{id:'valuation',title:'價格需要哪些假設',claims:context.valuation.claims},{id:'risk',title:'現金風險與反方',claims:[...riskClaims,{id:'counter-case',kind:'limitation',text:context.risk.counter_case,evidence_refs:[],fact_bindings:[]},...reconciliation]},{id:'coverage',title:'籌碼與技術資料覆蓋',claims:[{id:'chip-gap',kind:'limitation',text:context.chip.reason+' '+context.chip.consequence,evidence_refs:[],fact_bindings:[]},{id:'technical-gap',kind:'limitation',text:context.technical.reason+' '+context.technical.consequence,evidence_refs:[],fact_bindings:[]}]}],assumptions:context.valuation.assumptions,limitations:limits,metadata:{input_kind:data.input_kind,workflow_version:PIPELINE_VERSION,mechanical_only:true,source_count:data.documents.length,excluded_source_count:data.excluded_sources.length}}
}

export async function runPipeline(input,{runId=randomUUID(),signal,onStage=async()=>{},now=()=>new Date().toISOString()}={}) {
  const trace=[], context={}
  const check=()=>{if(signal?.aborted)throw signal.reason instanceof Error?signal.reason:new DOMException('Research cancelled','AbortError')}
  async function stage(name,stageInput,execute) {
    check();const started_at=now(), output=await execute();check()
    const record={stage:name,index:trace.length+1,started_at,finished_at:now(),status:output?.status || 'completed',input:clone(stageInput),output:clone(output),input_sha256:hash(stageInput),output_sha256:hash(output)}
    trace.push(record);await onStage(clone(record));await setImmediate();check();return output
  }
  const company=String(input?.profile?.company||input?.bundle?.company?.company_id||'').trim().toUpperCase(),information_as_of=input?.profile?.information_as_of||input?.bundle?.run?.as_of
  const route=await stage(STAGES[0],{requested_company:company,input_company:input?.bundle?.company?.company_id},()=>({status:company==='NVDA'&&input?.bundle?.company?.company_id==='NVDA'?'supported':'out_of_scope',company,allowed_companies:['NVDA']}))
  const blocked=(reason,evaluation)=>({status:'blocked',company,information_as_of,run_id:runId,workflow_version:PIPELINE_VERSION,report:null,report_markdown:null,sources:[],stage_trace:trace,evaluation:evaluation||{status:'blocked',passed:false,failures:[{code:reason}]},limitations:[reason]})
  if(route.status!=='supported')return blocked('unsupported_company')
  let data
  const retrieval=await stage(STAGES[1],{input_sha256:hash(input),document_ids:(input.bundle.documents||[]).map(row=>row.document_version_id),fact_ids:(input.bundle.facts||[]).map(row=>row.fact_id),information_as_of},()=>{data=normalizeInput(input);return {status:data.fatal_issues.length?'blocked':'retrieved',eligible_sources:data.documents.map(sourceMetadata),excluded_sources:data.excluded_sources,source_issues:data.source_issues,fatal_issues:data.fatal_issues,eligible_fact_count:data.facts.length}})
  if(retrieval.status==='blocked')return blocked('invalid_research_input',{status:'blocked',passed:false,failures:data.fatal_issues})
  context.sector=await stage(STAGES[2],{source_ids:data.documents.map(row=>row.document_version_id),claim_version_ids:data.claims.map(row=>row.claim_version_id)},()=>sectorAnalysis(data))
  context.fundamental=await stage(STAGES[3],{periods:data.periods.map(row=>({period_id:row.period_id,start_date:row.start_date,end_date:row.end_date})),facts:data.facts.map(factBinding)},()=>fundamentals(data))
  context.valuation=await stage(STAGES[4],{eps_facts:data.facts.filter(row=>row.concept==='diluted_eps').map(factBinding),assumed_multiples:data.profile.valuation_multiples},()=>valuation(data))
  context.chip=await stage(STAGES[5],{source_classes:data.documents.map(row=>({document_version_id:row.document_version_id,source_type:row.source_type}))},()=>gapAssessment(data,'chip'))
  context.technical=await stage(STAGES[6],{source_classes:data.documents.map(row=>({document_version_id:row.document_version_id,source_type:row.source_type}))},()=>gapAssessment(data,'technical'))
  context.health=await stage(STAGES[7],{fundamentals:context.fundamental.rows,reconciliation_notes:data.facts.filter(row=>row.reconciliation_note).map(row=>({fact_id:row.fact_id,note:row.reconciliation_note}))},()=>healthCheck(data,context.fundamental))
  context.risk=await stage(STAGES[8],{fundamentals:context.fundamental.rows,topics:context.sector.topics,health:context.health,gaps:[context.chip,context.technical]},()=>riskAnalysis(data,context.sector,context.fundamental,context.health,[context.chip,context.technical]))
  const report=await stage(STAGES[9],{analysis_hashes:Object.fromEntries(Object.entries(context).map(([key,output])=>[key,hash(output)])),run_id:runId},()=>makeReport(data,context,{runId,generatedAt:now()}))
  const evaluation=await stage(STAGES[10],{report_sha256:hash(report),input_sha256:data.input_sha256,rule_version:PIPELINE_VERSION},()=>evaluateReport(report,input))
  return {status:evaluation.status,company,information_as_of,run_id:runId,workflow_version:PIPELINE_VERSION,report,report_markdown:renderReport(report),sources:data.documents.map(sourceMetadata),stage_trace:trace,evaluation,limitations:report.limitations}
}
