import test from 'node:test'
import assert from 'node:assert/strict'
import {runPipeline,STAGES} from '../src/research-pipeline/pipeline.mjs'
import {evaluateReport,renderReport,directInstructions} from '../src/research-pipeline/evaluator.mjs'
import {hash,normalizeInput} from '../src/research-pipeline/input.mjs'
import {syntheticInput} from './helpers/m1-input.mjs'

const run=input=>runPipeline(input,{runId:'synthetic-run',now:()=> '2026-11-10T00:00:00Z'})
const clone=value=>structuredClone(value)

test('M1 clean synthetic case executes eleven meaningful ordered stages with reproducible content',async()=>{
  const input=syntheticInput(),before=clone(input),seen=[],result=await runPipeline(input,{runId:'synthetic-run',now:()=> '2026-11-10T00:00:00Z',onStage:async row=>seen.push(row.stage)})
  assert.equal(result.status,'accepted',JSON.stringify(result.evaluation.failures))
  assert.deepEqual(result.stage_trace.map(row=>row.stage),STAGES)
  assert.deepEqual(seen,STAGES)
  for(const row of result.stage_trace){assert.ok(row.input&&row.output);assert.equal(hash(row.input),row.input_sha256);assert.equal(hash(row.output),row.output_sha256)}
  assert.equal(result.report_markdown,renderReport(result.report))
  assert.equal(result.evaluation.semantic_review,'not_performed')
  assert.equal(result.stage_trace[5].output.status,'not_evaluable')
  assert.equal(result.stage_trace[6].output.status,'not_evaluable')
  assert.deepEqual(input,before)
  assert.deepEqual((await run(input)).report,result.report)
})

test('M1 unsupported or mismatched company terminates after router without a report',async()=>{
  for(const mutate of [input=>input.profile.company='AMZN',input=>input.bundle.company.company_id='8299']){
    const input=syntheticInput();mutate(input);const result=await run(input)
    assert.equal(result.status,'blocked');assert.equal(result.report,null);assert.equal(result.report_markdown,null)
    assert.deepEqual(result.stage_trace.map(row=>row.stage),['intent_router'])
  }
})

test('M1 changing source-bound facts changes fundamental output, calculations and report',async()=>{
  const input=syntheticInput(),first=await run(input),fact=input.bundle.facts.find(row=>row.fact_id==='FY27Q2-revenue')
  fact.numeric_decimal='300'
  const document=input.bundle.documents.find(row=>row.document_version_id===fact.source_document_version)
  document.extracted_text=document.extracted_text.replace('Revenue 240','Revenue 300');document.text_sha256=hash(document.extracted_text);document.raw_sha256=hash('UPDATED '+document.extracted_text)
  const second=await run(input)
  assert.equal(second.status,'accepted',JSON.stringify(second.evaluation.failures))
  assert.equal(second.stage_trace[3].output.rows.at(-1).revenue,300)
  assert.notEqual(first.report_markdown,second.report_markdown)
  assert.notEqual(first.stage_trace[3].output.rows.at(-1).revenue_qoq_percent,second.stage_trace[3].output.rows.at(-1).revenue_qoq_percent)
})

test('M1 clean baseline passes; one unsourced important claim independently blocks acceptance',async()=>{
  const input=syntheticInput(),result=await run(input);assert.equal(result.status,'accepted')
  const report=clone(result.report)
  report.sections[0].claims.push({id:'unsourced-only',kind:'fact',text:'新增重要但無來源的財務主張。',evidence_refs:[],fact_bindings:[]})
  const evaluation=evaluateReport(report,input)
  assert.equal(evaluation.status,'needs_revision');assert.equal(evaluation.checks.sources,false);assert.equal(evaluation.checks.buy_instructions,true)
  assert.ok(evaluation.failures.some(row=>row.code==='unsourced_claim'&&row.claim_id==='unsourced-only'))
})

test('M1 one direct buy instruction independently blocks a fully sourced clean baseline',async()=>{
  const input=syntheticInput(),result=await run(input);assert.equal(result.status,'accepted')
  const report=clone(result.report);report.sections[0].claims[0].text='立刻買進 NVDA'
  const evaluation=evaluateReport(report,input)
  assert.equal(evaluation.status,'needs_revision');assert.equal(evaluation.checks.sources,true);assert.equal(evaluation.checks.buy_instructions,false)
  assert.ok(evaluation.failures.every(row=>row.code==='direct_buy_instruction'))
})
test('M1 common Chinese and English order wording is detected without negation bypass',()=>{
 for(const text of ['建議買 NVDA','Buy 10 NVDA shares now','Recommend buying NVDA','Purchase 5 shares of NVIDIA','不要猶豫，買 NVDA'])assert.ok(directInstructions(text).length,text)
 for(const text of ['不要買 NVDA','Do not recommend buying NVDA','這不是買賣建議'])assert.equal(directInstructions(text).length,0,text)
})

test('M1 existing but wrong version/hash/locator or numeric binding cannot pass',async()=>{
  const input=syntheticInput(),result=await run(input)
  for(const mutate of [
    report=>report.sections[0].claims[0].evidence_refs[0].document_version_id='missing-v99',
    report=>report.sections[0].claims[0].evidence_refs[0].text_sha256='f'.repeat(64),
    report=>report.sections[0].claims[0].evidence_refs[0].locator.page=99,
    report=>report.sections[0].claims[0].fact_bindings[0].value++,
    report=>report.sections[0].claims[0].fact_bindings[0].period_id='wrong',
    report=>report.sections[0].claims[0].fact_bindings[0].unit='shares'
  ]){const report=clone(result.report);mutate(report);assert.equal(evaluateReport(report,input).status,'needs_revision')}
})

test('M1 altered derived value or currency rejects arithmetic acceptance',async()=>{
  const input=syntheticInput(),result=await run(input),report=clone(result.report),claim=report.sections[0].claims.find(row=>row.derivation)
  claim.derivation.value+=1;assert.ok(evaluateReport(report,input).failures.some(row=>row.code==='derivation_mismatch'))
  const changed=syntheticInput();changed.bundle.facts.find(row=>row.fact_id==='FY27Q2-operating_income').currency='TWD'
  const invalid=await run(changed);assert.equal(invalid.status,'needs_revision');assert.ok(invalid.evaluation.failures.some(row=>row.code==='derivation_units_incomparable'))
})

test('M1 disclaimers and independently verified source quotations preserve the distinction from author instructions',async()=>{
  const input=syntheticInput(),result=await run(input),report=clone(result.report),source=input.bundle.documents[0]
  report.limitations.push('這不是買進建議。不要買進 NVDA。Do not buy NVDA.')
  report.sections[0].claims.push({id:'quoted-buy',kind:'quote',text:'合成來源引述，僅供來源核對。',quote:{text:'Buy NVDA now',document_version_id:source.document_version_id},evidence_refs:[{document_version_id:source.document_version_id,text_sha256:source.text_sha256,original_url:source.original_url,locator:{page:1}}],fact_bindings:[]})
  assert.equal(evaluateReport(report,input).status,'accepted',JSON.stringify(evaluateReport(report,input).failures))
  report.sections[0].claims.at(-1).text='立即買進 NVDA'
  assert.equal(evaluateReport(report,input).checks.buy_instructions,false)
  report.sections[0].claims.at(-1).text='來源引述';report.sections[0].claims.at(-1).quote.text='Buy NVIDIA now, this invented statement is not in the source'
  assert.ok(evaluateReport(report,input).failures.some(row=>row.code==='quote_not_verified'))
  assert.equal(directInstructions('不是買進建議，立刻買進 NVDA').length,1)
})

test('M1 all rendered author text, including headings and limitations, is gated',async()=>{
  const input=syntheticInput(),result=await run(input)
  for(const mutate of [report=>report.title='Buy NVDA now',report=>report.sections[1].title='立刻買入',report=>report.limitations.push('請現在加碼 NVDA'),report=>report.assumptions[0].label='立即買進']){
    const report=clone(result.report);mutate(report);assert.equal(evaluateReport(report,input).checks.buy_instructions,false)
  }
})

test('M1 unavailable historical versions are excluded; false witnesses and hash corruption are rejected',async()=>{
  const input=syntheticInput(),doc=input.bundle.documents[0]
  doc.retrieved_at='2026-10-13T00:00:00Z';doc.version_witness={method:'none'}
  let normalized=normalizeInput(input);assert.ok(normalized.excluded_sources.some(row=>row.document_version_id===doc.document_version_id))
  doc.version_witness={method:'internet_archive_capture_identical_sha256',capture_timestamp_utc:'20260901000000',capture_sha256:'f'.repeat(64)}
  normalized=normalizeInput(input);assert.equal(normalized.documents.length,7)
  doc.version_witness.capture_sha256=doc.raw_sha256
  normalized=normalizeInput(input);assert.equal(normalized.documents.length,8)
  doc.extracted_text+=' tampered'
  const result=await run(input);assert.equal(result.status,'blocked');assert.equal(result.stage_trace.length,2);assert.equal(result.report,null)
})

test('M1 duplicate identities, invalid dates and invalid assumptions are input failures',async()=>{
  for(const mutate of [input=>input.bundle.documents.push(clone(input.bundle.documents[0])),input=>input.bundle.facts.push(clone(input.bundle.facts[0])),input=>input.profile.information_as_of='2026-02-31',input=>input.profile.valuation_multiples=[NaN]]){
    const input=syntheticInput();mutate(input);assert.equal((await run(input)).status,'blocked')
  }
})

test('M1 cancellation propagates between stages and never creates a report',async()=>{
  const controller=new AbortController(),stages=[]
  await assert.rejects(runPipeline(syntheticInput(),{signal:controller.signal,onStage:async row=>{stages.push(row.stage);if(row.stage==='fundamental_agent')controller.abort()}}),{name:'AbortError'})
  assert.deepEqual(stages,STAGES.slice(0,4))
})

test('M1 paraphrase must retain registered wording and free limitation blocks cannot bypass provenance',async()=>{
  const input=syntheticInput(),result=await run(input)
  const paraphrase=clone(result.report);paraphrase.sections.find(row=>row.id==='sector').claims[0].text='原來源沒有的全新確定主張。'
  assert.ok(evaluateReport(paraphrase,input).failures.some(row=>row.code==='source_claim_locator_mismatch'))
  for(const mutate of [report=>report.sections[0].claims.push({id:'fake-gap',kind:'limitation',text:'未來收入一定翻倍。',evidence_refs:[]}),report=>report.limitations.push('未來收入一定翻倍。')]){
    const report=clone(result.report);mutate(report);assert.ok(evaluateReport(report,input).failures.some(row=>row.code==='unsourced_claim'))
  }
})

test('M1 strings in numeric assumption values and directives in cited locator labels cannot bypass the gate',async()=>{
  const input=syntheticInput(),result=await run(input),report=clone(result.report)
  report.assumptions.push({id:'injected',kind:'assumption',label:'extra',value:'Buy NVDA now'})
  const evaluation=evaluateReport(report,input)
  assert.equal(evaluation.status,'needs_revision');assert.equal(evaluation.checks.buy_instructions,false)
  const locator=clone(result.report);locator.sections[0].claims[0].evidence_refs[0].locator.section='立刻買進 NVDA'
  assert.equal(evaluateReport(locator,input).checks.buy_instructions,false)
})

test('M1 cash derivation cannot combine distinct periods, and a missing quarter is not labeled QoQ',async()=>{
  const input=syntheticInput(),result=await run(input),report=clone(result.report),claim=report.sections[0].claims.find(row=>row.derivation?.operation==='sum_signed_cash')
  const substitute=input.bundle.facts.find(row=>row.fact_id==='FY25Q4-capex_purchases')
  claim.derivation.inputs[1]=substitute.fact_id
  claim.fact_bindings[1]={...claim.fact_bindings[1],fact_id:substitute.fact_id,period_id:substitute.period_id,source_document_version:substitute.source_document_version,locator:substitute.locator}
  claim.evidence_refs.push({document_version_id:substitute.source_document_version,text_sha256:input.bundle.documents[1].text_sha256,original_url:input.bundle.documents[1].original_url,locator:substitute.locator})
  assert.ok(evaluateReport(report,input).failures.some(row=>row.code==='cash_bridge_basis_invalid'))
  const gap=syntheticInput();gap.bundle.periods.splice(6,1);gap.bundle.facts=gap.bundle.facts.filter(row=>row.period_id!=='FY27Q1')
  const output=await run(gap)
  assert.equal(output.stage_trace[3].output.rows.at(-1).revenue_qoq_percent,null)
  assert.equal(output.stage_trace[4].output.status,'not_evaluable')
})

test('M1 report body uses readable financial names, units and page citations while retaining precise appendix locators',async()=>{
  const result=await run(syntheticInput()),markdown=renderReport(result.report),body=markdown.split('## 來源定位')[0]
  assert.match(body,/FY27Q2 收入 240 百萬美元/)
  assert.match(body,/FY27Q2 毛利率 60 %/)
  assert.match(body,/FY27Q2 營業現金流 65 百萬美元/)
  assert.match(body,/FY27Q2 稀釋每股盈餘 1\.7 美元／股/)
  assert.match(body,/\[來源\d+，第1頁\]\(https:\/\/example\.invalid\//)
  assert.doesNotMatch(body,/"page"\s*:|"row"\s*:|FY27Q2-revenue|currency ×10\^/)
  assert.match(markdown,/版本：synthetic-FY27Q2-v1/)
  assert.match(markdown,/文字 SHA-256：[a-f0-9]{64}/)
  assert.ok(markdown.includes('FY27Q2-revenue → \\{"page":1,"row":"revenue"\\}'))
  assert.equal(evaluateReport(result.report,syntheticInput()).status,'accepted')
})
