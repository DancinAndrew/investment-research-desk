import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, readdir, rm, mkdir, copyFile } from 'node:fs/promises'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createResearchRun, executeResearchRun, readResearchRun, requestRunCancellation, exportResearchRun, contentHash, usageSummary } from '../src/research-run.mjs'
const domain = await import('../src/financial-research.mjs').catch(cause => {
  if (cause.code !== 'ERR_MODULE_NOT_FOUND') throw cause
  return import('../../financial-domain/src/financial-research.mjs')
})

async function fixture(t, mutate = () => {}) {
  const root = await mkdtemp(join(tmpdir(),'financial-run-'))
  t.after(() => rm(root,{recursive:true,force:true}))
  const text = 'Revenue increased to 100 million dollars.'
  const bundle = {
    schema_version:'financial-research/1',company:{company_id:'test-co',legal_name:'Test Company'},
    run:{run_id:'source-run',as_of:'2026-01-01',as_of_mode:'public_information',created_at:'2026-01-02T00:00:00Z'},
    periods:[{period_id:'p1',start_date:'2025-10-01',end_date:'2025-12-31',period_kind:'duration',fiscal_year:2025,fiscal_quarter:4}],
    documents:[{source_id:'source-1',document_version_id:'doc-1',company_id:'test-co',published_at:'2025-12-31',text_sha256:await domain.financialDigest(text),raw_sha256:null,extracted_text:text,allowed_display:['facts','paraphrase','short_quote'],rights_policy:{max_quote_chars:80},original_url:'https://example.test/source',upstream_group:'earnings-event'}],
    segments:[{segment_id:'seg-1',document_version_id:'doc-1',text}],
    facts:[{fact_id:'revenue',company_id:'test-co',period_id:'p1',source_document_version:'doc-1',concept:'revenue',numeric_decimal:'100',scale:6,currency:'USD',unit:'currency',period_kind:'duration'}],
    claims:[{claim_id:'claim-1',claim_version_id:'claim-1-v1',claim_kind:'actual',topic:'revenue',paraphrase:'Revenue grew.',evidence_refs:[{document_version_id:'doc-1',segment_ids:['seg-1'],exact_quote:text,quote_sha256:await domain.financialDigest(text),quote_match_status:'exact',locator:{paragraph:1}}]}],
    targets:[],outcomes:[],changes:[],assessments:[],coverage:[{company_id:'test-co',period_id:'p1',required_material_type:'release',status:'full_text',read_status:'full_text',review_status:'unreviewed',read_spans:1,total_spans:1,document_version_ids:['doc-1']}],
    private_ledger:{secret:'never public'},asr:{audio:'never public'}
  }
  mutate(bundle)
  const inputPath=join(root,'bundle.json')
  await writeFile(inputPath,JSON.stringify(bundle))
  return {root,bundle,inputPath,outputRoot:join(root,'runs')}
}
async function run(f, options={}) {
  const created=await createResearchRun({...f,config:{author_id:'author',...options.config}})
  return executeResearchRun({runDir:created.run_dir,inputPath:f.inputPath,domain,...options})
}
function review(state, changes={}) {
  const normalized=state.receipts.find(row=>row.stage==='normalize_check_formula'&&row.status==='complete')
  return {reviewer_id:'reviewer',author_id:'author',reviewed_at:new Date().toISOString(),input_manifest_sha256:state.manifest.input_manifest_sha256,content_sha256:normalized.artifact.content_sha256,scope:['evidence','formula','acceptance'],decision:'accepted',...changes}
}
async function accept(state,f,changes={}) {
  return executeResearchRun({runDir:state.run_dir,inputPath:f.inputPath,domain,reviewReceipts:[review(state,changes)]})
}

test('hash-pinned independent review is required and full-read is separate from semantic review',async t=>{
  const f=await fixture(t), state=await run(f)
  assert.equal(state.status,'awaiting_review')
  assert.deepEqual(state.completed_stages,['validate_input','normalize_check_formula'])
  assert.equal(state.receipts.at(-1).details.evidence.semantic_support,'requires_independent_review')
  assert.deepEqual(state.receipts.at(-1).details.evidence.full_read_document_ids,['doc-1'])
  const sameAuthor=await accept(state,f,{reviewer_id:'author'})
  assert.equal(sameAuthor.status,'awaiting_review')
  const stale=await accept(state,f,{content_sha256:'a'.repeat(64)})
  assert.equal(stale.status,'awaiting_review')
  const old=await accept(state,f,{reviewed_at:'2020-01-01T00:00:00Z'})
  assert.equal(old.status,'awaiting_review')
  const accepted=await accept(state,f)
  assert.equal(accepted.status,'accepted')
  assert.equal(accepted.completed_stages.length,4)
  assert.equal((await executeResearchRun({runDir:state.run_dir,domain})).status,'accepted')
})

test('changed bytes or settings reject resume while prior immutable receipts remain',async t=>{
  const f=await fixture(t), state=await run(f), before=await readdir(join(state.run_dir,'receipts'))
  await writeFile(f.inputPath,JSON.stringify(f.bundle,null,2))
  await assert.rejects(()=>executeResearchRun({runDir:state.run_dir,inputPath:f.inputPath,domain}),/resume_input_changed/)
  assert.deepEqual(await readdir(join(state.run_dir,'receipts')),before)
  await assert.rejects(()=>executeResearchRun({runDir:state.run_dir,config:{...state.manifest.config,parser_version:'changed'},domain}),/resume_configuration_changed/)
  assert.deepEqual(await readdir(join(state.run_dir,'receipts')),before)
  assert.equal((await readResearchRun(state.run_dir)).status,'awaiting_review')
})

test('transient retries are bounded across resumes and completed stages deduplicate',async t=>{
  const f=await fixture(t)
  let calls=0
  const state=await run(f,{operations:{normalize_check_formula:async()=>{if(++calls<3)throw Object.assign(new Error('timeout'),{code:'ETIMEDOUT',transient:true})}}})
  assert.equal(calls,3);assert.equal(state.status,'awaiting_review')
  assert.equal(state.receipts.filter(row=>row.kind==='attempt_error'&&row.stage==='normalize_check_formula').length,2)
  await accept(state,f)
  assert.equal(calls,3)
  assert.equal((await readResearchRun(state.run_dir)).receipts.filter(row=>row.stage==='normalize_check_formula'&&row.kind==='stage').length,1)
  let exhaustedCalls=0
  const exhausted=await run(f,{operations:{validate_input:async()=>{exhaustedCalls++;throw Object.assign(new Error('timeout'),{code:'ETIMEDOUT',transient:true})}}})
  assert.equal(exhaustedCalls,3);assert.equal(exhausted.status,'partial')
  const again=await executeResearchRun({runDir:exhausted.run_dir,domain,operations:{validate_input:async()=>{exhaustedCalls++}}})
  assert.equal(again.status,'partial');assert.equal(exhaustedCalls,3)
  assert.equal(again.receipts.at(-1).code,'retry_budget_exhausted')
})

test('403 is blocked after one attempt without fallback or retry',async t=>{
  const f=await fixture(t);let calls=0
  const result=await run(f,{operations:{validate_input:async()=>{calls++;throw Object.assign(new Error('forbidden'),{status:403,transient:true})}}})
  assert.equal(result.status,'blocked');assert.equal(calls,1)
  assert.equal(result.receipts.find(row=>row.kind==='attempt_error').transient,false)
})

test('cancel during a stage keeps completed checkpoint and requires explicit resume',async t=>{
  const f=await fixture(t)
  const state=await run(f,{operations:{normalize_check_formula:async({run_dir})=>requestRunCancellation(run_dir)}})
  assert.equal(state.status,'cancelled')
  assert.deepEqual(state.completed_stages,['validate_input'])
  assert.equal((await executeResearchRun({runDir:state.run_dir,domain})).status,'cancelled')
  const resumed=await executeResearchRun({runDir:state.run_dir,inputPath:f.inputPath,domain,resumeCancelled:true})
  assert.equal(resumed.status,'awaiting_review')
  const accepted=await accept(resumed,f)
  assert.equal(accepted.status,'accepted')
  assert.equal(accepted.receipts.filter(row=>row.kind==='stage'&&row.stage==='validate_input').length,1)
})

test('interruption preserves partial checkpoint and same-input resume does remaining work',async t=>{
  const f=await fixture(t)
  const state=await run(f,{operations:{normalize_check_formula:async()=>{throw Object.assign(new Error('interrupted'),{code:'INTERRUPTED'})}}})
  assert.equal(state.status,'partial');assert.deepEqual(state.completed_stages,['validate_input'])
  const resumed=await executeResearchRun({runDir:state.run_dir,inputPath:f.inputPath,domain})
  assert.equal(resumed.status,'awaiting_review')
  assert.equal((await accept(resumed,f)).status,'accepted')
})

test('wrong quote and unsupported formula block acceptance before reviewer gate',async t=>{
  const badQuote=await fixture(t,bundle=>{bundle.claims[0].evidence_refs[0].exact_quote='Revenue increased to 101 million dollars.'})
  assert.equal((await run(badQuote)).status,'blocked')
  const badFormula=await fixture(t,bundle=>{bundle.facts.push({...bundle.facts[0],fact_id:'derived',derived_from:['revenue'],formula_version:'unknown/1'})})
  const result=await run(badFormula)
  assert.equal(result.status,'blocked');assert.equal(result.receipts.at(-1).code,'formula_validation_failed')
})

test('usage aggregates all workers/retries, warns at 80%, stops at 100%, unknown never zero',async t=>{
  const rows=[{receipt_id:'worker-1',uncached_input_tokens:20,cached_input_tokens:10,output_tokens:10,tool_tokens:0,cost_usd:null},{receipt_id:'worker-2-retry',tokens:40,cost_usd:'0'}]
  const summary=usageSummary(rows,100)
  assert.equal(summary.known_tokens,80);assert.equal(summary.tokens,80);assert.equal(summary.status,'warn');assert.equal(summary.cost_usd,null)
  assert.equal(usageSummary([...rows,{receipt_id:'third',tokens:20,cost_usd:null}],100).status,'stop')
  assert.equal(usageSummary([{receipt_id:'unknown',tokens:null,cost_usd:null}],100).tokens,null)
  assert.throws(()=>usageSummary([{receipt_id:'duplicate',tokens:0},{receipt_id:'duplicate',tokens:0}],100),/duplicate/)
  const f=await fixture(t)
  const partial=await run(f,{config:{author_id:'author',token_limit:100,usage:[...rows,{receipt_id:'third',tokens:20,cost_usd:null}]}})
  assert.equal(partial.status,'partial');assert.deepEqual(partial.completed_stages,[])
  const unknown=await run(f,{config:{author_id:'author',token_limit:100,usage:[{receipt_id:'unknown',tokens:null,cost_usd:null}]}})
  assert.equal(unknown.status,'partial');assert.equal(unknown.usage.tokens,null)
  await assert.rejects(()=>createResearchRun({...f,config:{paid_budget:'1'}}),/paid_budget_not_authorized/)
})

test('exports are immutable rights projections and company index updates retain others',async t=>{
  const f=await fixture(t), state=await accept(await run(f),f), root=join(f.root,'public')
  const first=await exportResearchRun({runDir:state.run_dir,outputRoot:root})
  const publicBytes=await readFile(first.path,'utf8')
  assert.equal(publicBytes.includes('never public'),false)
  const data=JSON.parse(publicBytes)
  assert.equal(data.segments,undefined);assert.equal(data.documents[0].extracted_text,undefined)
  assert.equal(data.claims[0].evidence_refs[0].exact_quote,f.bundle.segments[0].text)
  assert.equal(first.payload_sha256,contentHash(data))
  assert.equal((await exportResearchRun({runDir:state.run_dir,outputRoot:root})).path,first.path)
  const index=JSON.parse(await readFile(first.index_path,'utf8'))
  index.companies.push({company_id:'other-co',path:'old.json',sha256:'a'.repeat(64),run_id:'old-run',as_of:'2025-01-01',manifest_path:'old.manifest.json'})
  await writeFile(first.index_path,JSON.stringify(index))
  const later=await accept(await run(f),f)
  const second=await exportResearchRun({runDir:later.run_dir,outputRoot:root})
  assert.notEqual(second.path,first.path);assert.equal(await readFile(first.path,'utf8'),publicBytes)
  const updated=JSON.parse(await readFile(first.index_path,'utf8'))
  assert.equal(updated.companies.length,2);assert.equal(updated.companies.find(row=>row.company_id==='other-co').run_id,'old-run')
  assert.equal(updated.companies.find(row=>row.company_id==='test-co').run_id,later.manifest.run_id)
  await assert.rejects(()=>exportResearchRun({runDir:later.run_dir,outputRoot:root,indexPath:join(f.root,'escape.json')}),/index_outside_output_root/)
})

test('rights denied removes facts and quotes, and unaccepted runs cannot export',async t=>{
  const f=await fixture(t,bundle=>{bundle.documents[0].allowed_display=[]}), state=await run(f)
  await assert.rejects(()=>exportResearchRun({runDir:state.run_dir,outputRoot:join(f.root,'public')}),/only_accepted/)
  const accepted=await accept(state,f)
  const exported=await exportResearchRun({runDir:accepted.run_dir,outputRoot:join(f.root,'public')})
  const data=JSON.parse(await readFile(exported.path,'utf8'))
  assert.deepEqual(data.facts,[]);assert.deepEqual(data.claims,[])
})

test('checkpoint artifact tampering and concurrent execution are rejected',async t=>{
  const f=await fixture(t), created=await createResearchRun({...f,config:{author_id:'author'}})
  let release, entered
  const held=new Promise(resolve=>{release=resolve}), ready=new Promise(resolve=>{entered=resolve})
  const running=executeResearchRun({runDir:created.run_dir,domain,operations:{validate_input:async()=>{entered();await held}}})
  await ready
  await assert.rejects(()=>executeResearchRun({runDir:created.run_dir,domain}),/run_already_running/)
  release();const state=await running
  const receipt=state.receipts.find(row=>row.kind==='stage')
  await writeFile(join(state.run_dir,receipt.artifact.path),'{}')
  await assert.rejects(()=>readResearchRun(state.run_dir),/checkpoint_artifact_integrity_failure/)
})

test('actual CLIs run, review-resume and export local fixtures without dependencies',async t=>{
  const f=await fixture(t), app=join(f.root,'app')
  await mkdir(join(app,'src'),{recursive:true});await mkdir(join(app,'scripts'))
  for (const name of ['src/research-run.mjs','scripts/run-financial-research.mjs','scripts/export-financial-research.mjs']) await copyFile(new URL('../'+name,import.meta.url),join(app,name))
  const domainPath = await import.meta.resolve('../src/financial-research.mjs')
  try { await copyFile(new URL(domainPath),join(app,'src/financial-research.mjs')) }
  catch(cause) { if(cause.code!=='ENOENT')throw cause;await copyFile(new URL('../../financial-domain/src/financial-research.mjs',import.meta.url),join(app,'src/financial-research.mjs')) }
  const command=promisify(execFile), runner=join(app,'scripts/run-financial-research.mjs'), exporter=join(app,'scripts/export-financial-research.mjs')
  const first=JSON.parse((await command(process.execPath,[runner,'--input',f.inputPath,'--output-root',f.outputRoot,'--author','author'])).stdout)
  assert.equal(first.status,'awaiting_review');assert.equal(first.review_pin.author_id,'author')
  const state=await readResearchRun(first.run_dir), reviewPath=join(f.root,'review.json')
  await writeFile(reviewPath,JSON.stringify([review(state)]))
  const second=JSON.parse((await command(process.execPath,[runner,'--input',f.inputPath,'--output-root',f.outputRoot,'--resume',first.run_dir,'--review',reviewPath])).stdout)
  assert.equal(second.status,'accepted');assert.equal(second.run_id,first.run_id)
  const exported=JSON.parse((await command(process.execPath,[exporter,'--run-dir',first.run_dir,'--output-root',join(f.root,'site-data')])).stdout)
  assert.equal(JSON.parse(await readFile(exported.path,'utf8')).company.company_id,'test-co')
})

test('dead process lock recovers and empty or changed-source inputs remain blocked',async t=>{
  const f=await fixture(t), state=await run(f)
  const child=spawn(process.execPath,['-e','process.exit(0)'])
  await once(child,'exit')
  await writeFile(join(state.run_dir,'.runner.lock'),JSON.stringify({pid:child.pid,created_at:new Date().toISOString()}))
  assert.equal((await accept(state,f)).status,'accepted')
  const empty=await fixture(t,bundle=>{bundle.documents=[];bundle.facts=[];bundle.claims=[];bundle.coverage=[];bundle.periods=[]})
  assert.equal((await run(empty)).status,'blocked')
  const corrupted=await fixture(t,bundle=>{bundle.documents[0].extracted_text+=' altered'})
  const blocked=await run(corrupted)
  assert.equal(blocked.status,'blocked');assert.equal(blocked.receipts.at(-1).code,'source_text_hash_validation_failed')
})

test('paraphrase-only source locators reach semantic review without becoming exact quotes',async t=>{
  const f=await fixture(t,bundle=>{
    delete bundle.documents[0].extracted_text;delete bundle.segments
    bundle.claims[0].evidence_refs[0]={document_version_id:'doc-1',locator:{page:1,paragraph:2},exact_quote:null,quote_sha256:null}
  })
  const state=await run(f)
  assert.equal(state.status,'awaiting_review')
  const checked=state.receipts.at(-1).details.evidence.checks[0]
  assert.equal(checked.mechanical_status,'source_locator_present');assert.equal(checked.quote_match_status,'not_applicable');assert.equal(checked.semantic_support,'requires_independent_review')
  assert.equal((await accept(state,f)).status,'accepted')
  const bad=await fixture(t,bundle=>{bundle.claims[0].evidence_refs[0]={document_version_id:'doc-1',exact_quote:null}})
  assert.equal((await run(bad)).status,'blocked')
})

test('bounded quotes verify source worker pins without embedded copyrighted full text',async t=>{
  const f=await fixture(t,bundle=>{
    const segment=bundle.segments[0]
    bundle.claims[0].evidence_refs[0].quote_match_status='exact_substring_in_extracted_text'
    segment.source_check={document_text_sha256:bundle.documents[0].text_sha256,quote_sha256:bundle.claims[0].evidence_refs[0].quote_sha256,exact_substring_verified:true,verified_at:new Date().toISOString(),validator_version:'local-source-exact/1'}
    bundle.quote_segments=[segment];delete bundle.segments;delete bundle.documents[0].extracted_text
  })
  const state=await run(f)
  assert.equal(state.status,'awaiting_review')
  const checked=state.receipts.at(-1).details.evidence.checks[0]
  assert.equal(checked.quote_match_status,'exact');assert.equal(checked.full_text_hash_verified,false);assert.equal(checked.source_provenance,'caller_supplied_bounded_source_check')
  const accepted=await accept(state,f)
  assert.equal(accepted.status,'accepted')
  const exported=await exportResearchRun({runDir:accepted.run_dir,outputRoot:join(f.root,'bounded-public')})
  assert.equal(JSON.parse(await readFile(exported.path,'utf8')).claims[0].evidence_refs[0].quote_match_status,'exact')
  assert.equal(f.bundle.claims[0].evidence_refs[0].quote_match_status,'exact_substring_in_extracted_text')
  f.bundle.claims[0].evidence_refs[0].exact_quote='Revenue increased to 101 million dollars.'
  await writeFile(f.inputPath,JSON.stringify(f.bundle))
  assert.equal((await run(f)).status,'blocked')
  f.bundle.claims[0].evidence_refs[0].exact_quote=f.bundle.quote_segments[0].text
  f.bundle.quote_segments[0].source_check.document_text_sha256='b'.repeat(64)
  await writeFile(f.inputPath,JSON.stringify(f.bundle))
  assert.equal((await run(f)).status,'blocked')
})

test('same-basis outflow sums and declared four-place percentage ratios are recomputed',async t=>{
  const f=await fixture(t,bundle=>{
    const base={...bundle.facts[0],scale:6,additive:true,accounting_basis:'GAAP',consolidation_scope:'consolidated'}
    bundle.facts=[{...base,fact_id:'purchase',numeric_decimal:'813'},{...base,fact_id:'principal',numeric_decimal:'29'},{...base,fact_id:'capex',numeric_decimal:'842',derived_from:['purchase','principal'],formula_version:'sum/1'}, {...base,fact_id:'income',numeric_decimal:'21700'},{...base,fact_id:'revenue',numeric_decimal:'34803'}, {...base,fact_id:'margin',numeric_decimal:'62.3509',scale:0,unit:'percent',currency:null,additive:false,derived_from:['income','revenue'],formula_version:'ratio/1',formula_precision:4}]
  })
  // Compute the fixture's reported four-place value independently through the
  // established decimal rule; a one-digit disagreement must then be blocked.
  f.bundle.facts.at(-1).numeric_decimal=domain.computeRatio('21700','34803',{percent:true,precision:4}).numeric_decimal
  await writeFile(f.inputPath,JSON.stringify(f.bundle))
  const state=await run(f)
  assert.equal(state.status,'awaiting_review')
  const normalized=JSON.parse(await readFile(join(state.run_dir,state.receipts.find(row=>row.stage==='normalize_check_formula'&&row.status==='complete').artifact.path),'utf8'))
  assert.equal(normalized.formula_checks.checks.length,2);assert.equal(normalized.formula_checks.checks[0].computed,'842000000')
  f.bundle.facts[2].numeric_decimal='843';await writeFile(f.inputPath,JSON.stringify(f.bundle))
  assert.equal((await run(f)).status,'blocked')
})
function withAssessment(bundle) {
  bundle.claims[0].evidence_refs[0].evidence_id='ev-1'
  bundle.assessments=[{assessment_id:'assessment-1',company_id:'test-co',author_id:'author',information_cutoff:'2026-01-01',accepted_evidence_refs:['ev-1','revenue'],judgment:'Conditional view',strongest_alternative:'Timing',follow_up_questions:['q1?','q2?','q3?'],review_status:'awaiting_independent_review'}]
}
function semantic(state, changes={}) {
  const base=review(state)
  return {reviewer_id:'reviewer',author_id:'author',reviewed_at:new Date().toISOString(),input_manifest_sha256:base.input_manifest_sha256,content_sha256:base.content_sha256,scope:['semantic'],decision:'accepted',target:{kind:'assessment',id:'assessment-1'},evidence_refs:['ev-1','revenue'],...changes}
}
async function exportedAssessment(f, receipts) {
  const before=await readFile(f.inputPath)
  const state=await run(f)
  assert.equal(state.status,'awaiting_review')
  const done=await executeResearchRun({runDir:state.run_dir,inputPath:f.inputPath,domain,reviewReceipts:[review(state),...receipts(state)]})
  assert.equal(done.status,'accepted')
  const exported=await exportResearchRun({runDir:state.run_dir,outputRoot:join(f.root,'site')})
  const payload=JSON.parse(await readFile(exported.path,'utf8'))
  assert.deepEqual(await readFile(f.inputPath),before)
  assert.deepEqual(await readFile(join(state.run_dir,'input.json')),before)
  const gate=done.receipts.find(row=>row.stage==='evidence_review_gate'&&row.status==='complete')
  return {assessment:payload.assessments[0],gate:JSON.parse(await readFile(join(state.run_dir,gate.artifact.path),'utf8'))}
}
test('independent semantic receipt supplied after the gate marks only its assessment reviewed; input stays immutable',async t=>{
  const reviewed=await exportedAssessment(await fixture(t,withAssessment),state=>[semantic(state)])
  assert.equal(reviewed.assessment.review_status,'reviewed')
  assert.equal(reviewed.assessment.review_receipt.reviewer_id,'reviewer')
  assert.deepEqual(reviewed.gate.semantic_review.accepted.map(r=>r.target.id),['assessment-1'])
})
test('unrelated, self-authored, partial-scope or stale semantic receipts never authorize an assessment',async t=>{
  const cases=[{target:{kind:'assessment',id:'other'}},{reviewer_id:'author'},{evidence_refs:['ev-1']},{content_sha256:'b'.repeat(64)},{reviewed_at:'2020-01-01T00:00:00Z'},{scope:['semantic','acceptance']}]
  for(const changes of cases){
    const result=await exportedAssessment(await fixture(t,withAssessment),state=>[semantic(state,changes)])
    assert.equal(result.assessment.review_status,'draft',JSON.stringify(changes))
    assert.equal(result.gate.semantic_review.accepted.length,0)
    assert.equal(result.gate.semantic_review.rejected.length,1)
  }
})
