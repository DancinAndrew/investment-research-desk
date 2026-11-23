import test from 'node:test'
import assert from 'node:assert/strict'
import * as f from '../src/financial-research.mjs'

const hash='a'.repeat(64),date='2026-06-01T12:00:00Z'
function document(overrides={}) {return {source_id:'release',document_version_id:'doc1',company_id:'co',published_at:date,published_precision:'second',raw_sha256:hash,text_sha256:null,stable_original:true,upstream_group:'event1',allowed_display:['facts','paraphrase','short_quote'],rights_policy:{max_quote_chars:80},...overrides}}
function fact(overrides={}) {return {fact_id:'fact1',company_id:'co',period_id:'p1',concept:'revenue',metric_definition_version:'revenue/1',numeric_decimal:'100',scale:0,currency:'USD',unit:'currency',accounting_basis:'GAAP',consolidation_scope:'consolidated',recast_version:'original',dimensions:{},period_kind:'duration',additive:true,start_date:'2025-01-01',end_date:'2025-12-31',fiscal_year:2025,period_label:'FY',source_document_version:'doc1',published_at:date,...overrides}}
function bundle(overrides={}) {return {schema_version:f.FINANCIAL_SCHEMA,company:{company_id:'co'},run:{as_of:'2026-06-02',as_of_mode:'public_information'},periods:[{period_id:'p1',start_date:'2025-01-01',end_date:'2025-12-31',period_kind:'duration'}],documents:[document()],facts:[fact()],claims:[],targets:[],outcomes:[],changes:[],assessments:[],coverage:[{company_id:'co',period_id:'p1',required_material_type:'filing',status:'partial_read',read_spans:1,total_spans:2,document_version_ids:['doc1']}],...overrides}}
test('contract preserves zero/null and rejects numeric values, foreign companies and negative duration',()=>{
  assert.equal(f.validateFinancialBundle(bundle()).valid,true)
  assert.equal(f.validateFinancialBundle(bundle({facts:[fact({numeric_decimal:'0'})]})).valid,true)
  assert.equal(f.validateFinancialBundle(bundle({facts:[fact({numeric_decimal:null,null_reason:'not_disclosed'})]})).valid,true)
  assert.throws(()=>f.validateFinancialBundle(bundle({facts:[fact({numeric_decimal:0})]})),/decimal_string/)
  assert.throws(()=>f.validateFinancialBundle(bundle({facts:[fact({company_id:'other'})]})),/reference/)
  assert.throws(()=>f.validateFinancialBundle(bundle({periods:[{period_id:'p1',start_date:'2025-12-31',end_date:'2025-01-01',period_kind:'duration'}]})),/negative_duration/)
  assert.throws(()=>f.validateFinancialBundle(bundle(),{now:'2026-06-01'}),/future_as_of/)
})
test('decimal strings scale without binary float loss and retain negatives',()=>{
  assert.equal(f.decimalAdd('0.1','0.2'),'0.3');assert.equal(f.decimalSubtract('12.001','13.002'),'-1.001')
  assert.equal(f.decimalMultiply('-0.1','0.2'),'-0.02');assert.equal(f.decimalScale('-10.5',6),'-10500000')
  assert.equal(f.decimalScale('100',-2),'1');assert.equal(f.decimalDivide('-1','8',2),'-0.13')
  assert.equal(f.decimalDivide('1','0'),null);assert.throws(()=>f.decimalAdd('1e9','1'),/decimal_string/)
  assert.equal(f.decimalAdd('99999999999999999999','1'),'100000000000000000000')
})
test('reported precision gives magnitude-aware rounding, never fixed one percent',()=>{
  assert.equal(f.roundingTolerance({decimals:2,scale:6}),'5000')
  assert.equal(f.roundingTolerance({decimals:-3}),'500')
  assert.equal(f.withinRoundingTolerance('100.005','100',{decimals:2}).matched,true)
  assert.equal(f.withinRoundingTolerance('100.006','100',{decimals:2}).matched,false)
  assert.equal(f.withinRoundingTolerance('100','100',{}).reason,'unknown_rounding')
})
test('PIT rejects future publication and day precision before intraday cutoff',()=>{
  const result=f.selectDocumentVersions([document(),document({source_id:'later',document_version_id:'doc2',published_at:'2026-06-03',published_precision:'day'}),document({source_id:'day',document_version_id:'doc3',published_at:'2026-06-01',published_precision:'day'})],{as_of:date})
  assert.deepEqual(result.documents.map(doc=>doc.document_version_id),['doc1']);assert.equal(result.rejected.length,2)
  assert.equal(result.rejected.find(row=>row.document_version_id==='doc3').reason,'day_precision_after_cutoff')
  assert.equal(f.selectDocumentVersions([document({published_at:'2026-06-01',published_precision:'day'})],{as_of:'2026-06-01'}).documents.length,1)
})
test('PIT separates historical reconstruction from user pins, and excludes mutable old dates',()=>{
  const late=document({retrieved_at:'2026-10-12T00:00:00Z'}),mutable=document({source_id:'mutable',document_version_id:'mutable1',stable_original:false})
  assert.equal(f.selectDocumentVersions([late],{as_of:'2026-06-02'}).documents.length,1)
  assert.equal(f.selectDocumentVersions([late],{as_of:'2026-06-02',mode:'user_research'}).documents.length,0)
  assert.equal(f.selectDocumentVersions([late],{as_of:'2026-06-02',mode:'user_research',pinned_version_ids:['doc1']}).documents.length,1)
  assert.equal(f.selectDocumentVersions([mutable],{as_of:'2026-06-02'}).rejected[0].reason,'historical_content_unverified')
})
test('unknown publication uses only a witnessed availability receipt for current reconstruction',()=>{
  const source=document({published_at:null,published_precision:null,stable_original:false,access_status:'available',first_seen_at:'2026-06-02T10:00:00Z',event_at:'2026-05-01'})
  assert.equal(f.selectDocumentVersions([source],{as_of:'2026-06-01'}).documents.length,0)
  const current=f.selectDocumentVersions([source],{as_of:'2026-06-02'}).documents[0]
  assert.equal(current.eligibility_basis,'first_seen_access_receipt');assert.equal(current.published_at,null)
  assert.equal(f.selectDocumentVersions([{...source,access_status:'unavailable'}],{as_of:'2026-06-03'}).rejected[0].reason,'publication_unknown')
})
test('known publication without historic proof can use only current first-seen access receipt',()=>{
  const source=document({stable_original:false,published_at:'2026-05-01T12:00:00Z',first_seen_at:'2026-06-02T10:00:00Z',access_status:'retrieved'})
  assert.equal(f.selectDocumentVersions([source],{as_of:'2026-06-01'}).documents.length,0)
  const current=f.selectDocumentVersions([source],{as_of:'2026-06-02'}).documents[0]
  assert.equal(current.eligibility_basis,'first_seen_access_receipt');assert.equal(current.published_at,source.published_at);assert.equal(current.stable_original,false)
  assert.equal(f.selectDocumentVersions([{...source,access_status:'unavailable'}],{as_of:'2026-06-02'}).rejected[0].reason,'historical_content_unverified')
  assert.equal(f.selectDocumentVersions([{...source,published_at:'2026-06-03T12:00:00Z'}],{as_of:'2026-06-02'}).documents.length,0)
})
test('PIT picks public versions without touching old pins',()=>{
  const original=document(),revision=document({document_version_id:'doc2',published_at:'2026-07-01T12:00:00Z',supersedes:'doc1'})
  assert.equal(f.selectDocumentVersions([original,revision],{as_of:'2026-06-02'}).documents[0].document_version_id,'doc1')
  assert.equal(f.selectDocumentVersions([original,revision],{as_of:'2026-07-02'}).documents[0].document_version_id,'doc2')
  assert.equal(f.selectDocumentVersions([original,revision],{as_of:'2026-07-02',view:'as_reported'}).documents[0].document_version_id,'doc1')
  assert.equal(original.document_version_id,'doc1')
})
test('immutable versions hash content and reject same-ID edits and broken supersedes',async()=>{
  const versions=await f.appendImmutableVersion([],{version_id:'v1',numeric_decimal:'1'})
  assert.equal(Object.isFrozen(versions[0]),true);assert.equal(versions[0].content_sha256.length,64)
  await assert.rejects(f.appendImmutableVersion(versions,{version_id:'v1',numeric_decimal:'2'}),/immutable_version_conflict/)
  await assert.rejects(f.appendImmutableVersion(versions,{version_id:'v2',supersedes:'unknown'}),/missing_superseded/)
  const next=await f.appendImmutableVersion(versions,{version_id:'v2',numeric_decimal:'2',supersedes:'v1'})
  assert.equal(next.length,2);assert.equal(next[0].numeric_decimal,'1')
})
test('coverage denominator remains eight with six reviewed and two gaps',()=>{
  const ids=Array.from({length:8},(_,i)=>'p'+i),cells=ids.slice(0,6).map(period_id=>({period_id,required_material_type:'transcript',status:'reviewed',read_spans:3,total_spans:3,review_status:'reviewed'}))
  const result=f.summarizeCoverage(ids,['transcript'],cells)
  assert.equal(result.period_count,8);assert.equal(result.required_cell_count,8);assert.equal(result.reviewed_count,6);assert.equal(result.counts.not_found,2);assert.equal(result.complete,false)
  assert.throws(()=>f.summarizeCoverage(['p1'],['filing'],[{period_id:'p1',required_material_type:'filing',status:'reviewed',review_status:'reviewed',read_spans:1,total_spans:2}]),/incomplete/)
})
test('all coverage states have distinct counts; retrieval is not reading',()=>{
  const cells=f.COVERAGE_STATUSES.map((status,i)=>({period_id:'p'+i,required_material_type:'filing',status,read_spans:['full_text','reviewed'].includes(status)?2:status==='partial_read'?1:0,total_spans:2,review_status:status==='reviewed'?'reviewed':'not_reviewed'}))
  const result=f.summarizeCoverage(cells.map(row=>row.period_id),['filing'],cells)
  assert.equal(result.full_read_count,2);for(const status of f.COVERAGE_STATUSES)assert.equal(result.counts[status],1)
  const obtained=f.summarizeCoverage(['p'],['filing'],[{period_id:'p',required_material_type:'filing',status:'full_text',read_spans:0,total_spans:10}])
  assert.equal(obtained.obtained_full_text_count,1);assert.equal(obtained.full_read_count,0)
})
test('hash duplicate and upstream independence are separate; revisions survive',()=>{
  const result=f.deduplicateSources([document(),document({source_id:'sec',document_version_id:'doc2'}),document({document_version_id:'doc3',raw_sha256:'b'.repeat(64),supersedes:'doc1'}),document({source_id:'other',document_version_id:'doc4',raw_sha256:null,upstream_group:'event2'})])
  assert.equal(result.documents.length,3);assert.equal(result.duplicates.length,1);assert.equal(result.independent_source_count,2);assert.equal(result.upstream_groups[0].document_version_ids.length,3)
  assert.equal(f.deduplicateSources([document({upstream_group:null}),document({source_id:'mirror',document_version_id:'mirror',upstream_group:null})]).independent_source_count,1)
})
test('FY minus 9M permits comparable additive flows and preserves formula provenance',()=>{
  const result=f.deriveQ4(fact({numeric_decimal:'90',scale:6}),fact({fact_id:'ytd',period_id:'9m',period_label:'9M',numeric_decimal:'100',scale:6,end_date:'2025-09-30'}))
  assert.equal(result.numeric_decimal,'-10000000');assert.equal(result.start_date,'2025-10-01');assert.deepEqual(result.derived_from,['fact1','ytd']);assert.equal(result.formula_version,'fy-minus-ytd/1')
})
test('FY minus YTD rejects EPS, rates, average shares, instant balances, currency and recast mismatch',()=>{
  for(const concept of ['EPS','gross_margin','tax_rate','average_shares','assets']){const a=fact({concept}),b=fact({concept,period_label:'9M',end_date:'2025-09-30'});assert.equal(f.deriveQ4(a,b).comparable,false,concept)}
  assert.equal(f.deriveQ4(fact(),fact({period_label:'9M',end_date:'2025-09-30',currency:'TWD'})).reasons.includes('mismatch:currency'),true)
  assert.equal(f.deriveQ4(fact(),fact({period_label:'9M',end_date:'2025-09-30',recast_version:'recast2'})).reasons.includes('mismatch:recast_version'),true)
  assert.equal(f.deriveQ4(fact({period_kind:'instant'}),fact({period_label:'9M',end_date:'2025-09-30'})).comparable,false)
})
const quarters=()=>[['01-01','03-31'],['04-01','06-30'],['07-01','09-30'],['10-01','12-31']].map(([start,end],i)=>fact({fact_id:'q'+i,period_id:'q'+i,period_label:'Q'+(i+1),start_date:'2025-'+start,end_date:'2025-'+end,numeric_decimal:i?'10':'-1'}))
test('TTM requires four contiguous nonoverlapping quarters and respects negative flows',()=>{
  assert.equal(f.deriveTTM(quarters()).numeric_decimal,'29')
  const overlap=quarters();overlap[1].start_date='2025-03-31';assert.equal(f.deriveTTM(overlap).reasons.includes('overlap'),true)
  const gap=quarters();gap[1].start_date='2025-04-02';assert.equal(f.deriveTTM(gap).reasons.includes('gap'),true)
  assert.equal(f.deriveTTM(quarters().slice(1)).comparable,false)
})
test('ratio keeps losses and zero actual, returns explicit null for absent or zero denominator',()=>{
  assert.equal(f.computeRatio('-20','100',{percent:true}).numeric_decimal,'-20')
  assert.equal(f.computeRatio('0','100').numeric_decimal,'0');assert.equal(f.computeRatio(null,'100').reason,'missing_value');assert.equal(f.computeRatio('1','0').reason,'zero_denominator')
})
test('split applies once with corporate action provenance, already recast EPS stays unchanged',()=>{
  const action={action_id:'split2',source_document_version:'action-doc',effective_date:'2025-06-01',from_basis:'pre',to_basis:'post',ratio:'2'}
  const eps=f.applySplit(fact({concept:'EPS',metric_kind:'eps',share_basis:'pre',numeric_decimal:'-4'}),action)
  assert.equal(eps.numeric_decimal,'-2');assert.equal(f.applySplit(eps,action).numeric_decimal,'-2')
  assert.equal(f.applySplit(fact({metric_kind:'diluted_weighted_average_shares',share_basis:'pre',numeric_decimal:'100'}),action).numeric_decimal,'200')
  assert.throws(()=>f.applySplit(fact({metric_kind:'eps',share_basis:'pre',applied_action_ids:['split2']}),action),/already_applied/)
  assert.throws(()=>f.applySplit(fact({metric_kind:'ending_shares',share_basis:'pre'}),action),/unsupported/)
})
const target=()=>({...fact({numeric_decimal:undefined}),target_id:'target1',value:'100',comparator:'>=',target_kind:'quantitative',original_deadline:'2026-06-01',target_period:'p1'})
test('target deadline passing without actual stays pending/not disclosed, never zero or missed',()=>{
  assert.equal(f.evaluateTarget(target(),null,{as_of:'2026-06-02'}).status,'pending')
  assert.equal(f.evaluateTarget(target(),null,{as_of:'2026-06-02',not_disclosed:true}).status,'not_disclosed')
  assert.equal(f.evaluateTarget(target(),fact({published_at:'2026-06-03T00:00:00Z'}),{as_of:'2026-06-02'}).status,'pending')
  assert.equal(f.evaluateTarget(target(),null,{as_of:'2026-05-31'}).status,'not_due')
  assert.equal(f.evaluateTarget(target(),fact({currency:'TWD'}),{as_of:'2026-06-02'}).status,'not_comparable')
})
test('target supports met/missed/partial and explicit disputed/redefined/withdrawn',()=>{
  assert.equal(f.evaluateTarget(target(),fact(),{as_of:'2026-06-02'}).status,'met')
  assert.equal(f.evaluateTarget(target(),fact({numeric_decimal:'0'}),{as_of:'2026-06-02'}).status,'missed')
  assert.equal(f.evaluateTarget({...target(),partial_minimum:'80'},fact({numeric_decimal:'90'}),{as_of:'2026-06-02'}).status,'partly_met')
  for(const status of ['disputed','redefined','withdrawn'])assert.equal(f.evaluateTarget(target(),fact(),{as_of:'2026-06-02',[status]:true}).status,status)
  assert.equal(target().original_deadline,'2026-06-01')
})
test('range guidance above the upper bound is exceeded, never mechanically missed',()=>{
  const range={...target(),comparator:'range',value:'100',minimum:'98',maximum:'102'}
  const above=f.evaluateTarget(range,fact({numeric_decimal:'105'}),{as_of:'2026-06-02'})
  assert.equal(above.status,'exceeded');assert.equal(above.comparison_result,'above_range');assert.equal(above.gap_above_upper,'3')
  const inside=f.evaluateTarget(range,fact({numeric_decimal:'101'}),{as_of:'2026-06-02'})
  assert.equal(inside.status,'met');assert.equal(inside.comparison_result,'within_range')
  const below=f.evaluateTarget(range,fact({numeric_decimal:'97'}),{as_of:'2026-06-02'})
  assert.equal(below.status,'missed');assert.equal(below.comparison_result,'below_range')
  assert.ok(f.OUTCOME_STATUSES.includes('exceeded'))
  const outcome={outcome_id:'o1',target_id:'target1',status:'exceeded',eligible_fact_ids:['fact1']}
  const claim={claim_version_id:'c1',evidence_refs:[]}
  assert.equal(f.validateFinancialBundle(bundle({claims:[claim],targets:[{...range,origin_claim_version_id:'c1'}],outcomes:[outcome]})).valid,true)
})
test('whitespace normalization is re-derived from raw text and maps the quote back to raw offsets',async()=>{
  const raw='Header\nRevenue is expected to be $108.0 billion, plus or\n   minus 2%. Next.'
  const start=raw.indexOf('Revenue'),end=raw.indexOf(' Next')
  const text=f.normalizeWhitespace(raw.slice(start,end))
  const quote='plus or minus 2%.'
  const document={document_version_id:'doc1',extracted_text:raw,text_sha256:await f.financialDigest(raw)}
  const segment={segment_id:'seg1',document_version_id:'doc1',text,normalization_applied:true,normalization_map:[{method:'whitespace_collapse/1',raw_start:start,raw_end:end}]}
  const evidence={document_version_id:'doc1',segment_ids:['seg1'],exact_quote:quote,quote_sha256:await f.financialDigest(quote)}
  const checked=await f.validateEvidenceQuote(evidence,segment,{document})
  assert.equal(checked.valid,true)
  assert.equal(f.normalizeWhitespace(raw.slice(checked.raw_span.raw_start,checked.raw_span.raw_end)),quote)
  assert.notEqual(raw.slice(checked.raw_span.raw_start,checked.raw_span.raw_end),quote)
  const shifted={...segment,normalization_map:[{method:'whitespace_collapse/1',raw_start:start+1,raw_end:end}]}
  const blocked=await f.validateEvidenceQuote(evidence,shifted,{document})
  assert.equal(blocked.valid,false);assert.ok(blocked.reasons.includes('normalization_reverse_map_mismatch'))
  const unknown={...segment,normalization_map:[{method:'fuzzy/1',raw_start:start,raw_end:end}]}
  assert.ok((await f.validateEvidenceQuote(evidence,unknown,{document})).reasons.includes('normalization_method_unsupported'))
})
test('exact quote/hash/version gates block modified numbers and translations',async()=>{
  const text='Revenue grew 10% this quarter.',segment={segment_id:'seg1',document_version_id:'doc1',text},evidence={document_version_id:'doc1',segment_ids:['seg1'],exact_quote:text,quote_sha256:await f.financialDigest(text)}
  assert.equal((await f.validateEvidenceQuote(evidence,segment)).valid,true)
  assert.equal((await f.validateEvidenceQuote({...evidence,exact_quote:text.replace('10%','11%')},segment)).valid,false)
  assert.equal((await f.validateEvidenceQuote({...evidence,is_translation:true},segment)).valid,false)
  assert.equal((await f.validateEvidenceQuote(evidence,{...segment,document_version_id:'doc2'})).valid,false)
})
test('quote SHA-256 identifies raw UTF-8 rather than JSON-encoded string',async()=>{
  const expected='ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  assert.equal(await f.financialDigest('abc'),expected)
  assert.notEqual(await f.financialDigest(JSON.stringify('abc')),expected)
  const segment={segment_id:'s',document_version_id:'d',text:'abc'},evidence={document_version_id:'d',segment_ids:['s'],exact_quote:'abc',quote_sha256:expected}
  assert.equal((await f.validateEvidenceQuote(evidence,segment)).valid,true)
})
test('normalization/OCR requires reverse map and original-page correction receipt',async()=>{
  const text='10 million',evidence={document_version_id:'d',segment_ids:['s'],exact_quote:text,quote_sha256:await f.financialDigest(text)},segment={segment_id:'s',document_version_id:'d',text,normalization_applied:true,ocr_corrected:true}
  assert.deepEqual((await f.validateEvidenceQuote(evidence,segment)).reasons,['normalization_reverse_map_missing','ocr_original_page_review_required'])
  // A methodless legacy map is readable history but can never authorize a new exact quote.
  const legacy=await f.validateEvidenceQuote(evidence,{...segment,normalization_map:[{normalized_start:0,raw_start:0}],original_page_reviewed:true})
  assert.equal(legacy.valid,false);assert.equal(legacy.quote_match_status,'blocked');assert.deepEqual(legacy.reasons,['normalization_unverified_legacy_map'])
  // A declared map without the raw document text cannot be re-derived, so it is blocked too.
  const declared=await f.validateEvidenceQuote(evidence,{...segment,normalization_map:[{method:'whitespace_collapse/1',raw_start:0,raw_end:10}],original_page_reviewed:true})
  assert.equal(declared.valid,false);assert.deepEqual(declared.reasons,['normalization_raw_text_missing'])
})
test('witness capture time bounds availability of IR/third-party bytes at earlier cutoffs',()=>{
  const ir=document({source_id:'cfo',document_version_id:'cfo1',published_at:'2026-05-20',published_precision:'day',published_timezone:'-07:00',stable_original:false,historical_content_verified:true,access_status:'retrieved',first_seen_at:'2026-10-13T05:00:00Z',version_witness:{method:'internet_archive_capture_identical_sha256',capture_timestamp_utc:'20260824101500'}})
  const pick=as_of=>f.selectDocumentVersions([ir],{as_of,now:'2026-10-13T07:00:00Z'})
  assert.equal(pick('2026-06-01').documents.length,0)
  assert.equal(pick('2026-08-23').documents.length,0)
  assert.equal(pick('2026-08-24T10:00:00Z').documents.length,0)
  assert.equal(pick('2026-08-24T10:15:00Z').documents.length,1)
  assert.equal(pick('2026-08-24').documents.length,1)
  assert.equal(pick('2026-10-12').documents[0].eligibility_basis,'version_witness')
  // Original publication stays visible as metadata; the user's original-run mode still uses pins only.
  assert.equal(pick('2026-10-12').documents[0].published_at,'2026-05-20')
  assert.equal(f.selectDocumentVersions([ir],{as_of:'2026-06-01',mode:'user_research',pinned_version_ids:['cfo1'],now:'2026-10-13T07:00:00Z'}).documents.length,1)
  const receipt=document({source_id:'old',document_version_id:'old1',published_at:'2026-08-26',published_precision:'day',historical_content_verified:true,version_witness:{method:'pre_cutoff_retrieval_receipt',witnessed_at:'2026-10-09T10:40:55Z'}})
  assert.equal(f.selectDocumentVersions([receipt],{as_of:'2026-10-01',now:'2026-10-13T07:00:00Z'}).documents.length,0)
  assert.equal(f.selectDocumentVersions([receipt],{as_of:'2026-10-09',now:'2026-10-13T07:00:00Z'}).documents.length,1)
})
test('projection whitelists witness proof metadata and drops injected nested content',()=>{
  const witness={method:'internet_archive_capture_identical_sha256',capture_timestamp_utc:'20250605064155',capture_sha256:'c'.repeat(64),receipt:'/home/private/receipts.json',raw_text:'FULL TRANSCRIPT TEXT',html:'<script>x</script>',credentials:{token:'secret'}}
  const projected=f.projectFinancialBundle(bundle({documents:[document({version_witness:witness})]}))
  assert.deepEqual(projected.documents[0].version_witness,{method:'internet_archive_capture_identical_sha256',capture_timestamp_utc:'20250605064155',capture_sha256:'c'.repeat(64)})
  for(const leak of ['FULL TRANSCRIPT','<script>','secret','/home/private'])assert.equal(JSON.stringify(projected).includes(leak),false,leak)
  assert.equal(f.projectFinancialBundle(bundle({documents:[document({version_witness:{method:'x'.repeat(200)}})]})).documents[0].version_witness,undefined)
})
test('projection holds a qualitative outcome whose required evidence claim is not projected',()=>{
  const claim={claim_id:'c1',claim_version_id:'cv1',company_id:'co',paraphrase:'p',evidence_refs:[{evidence_id:'e1',document_version_id:'doc1'}]}
  const target={target_id:'t1',origin_claim_version_id:'cv1',target_kind:'qualitative'}
  const projected=f.projectFinancialBundle(bundle({claims:[claim],targets:[target],outcomes:[{outcome_id:'o1',target_id:'t1',status:'met',eligible_fact_ids:[],evidence_claim_version_ids:['cv1','cv-hidden']}]}))
  assert.deepEqual(projected.outcomes[0].evidence_claim_version_ids,['cv1','cv-hidden'])
  assert.ok(projected.projection_notes.some(note=>note.outcome_id==='o1'&&note.code==='outcome_evidence_not_in_projection'))
})
test('fact reconciliation notes are bounded author prose',()=>{
  const note='Annual minus nine-month gives 36,188; company quarter value 36,190 kept.'
  assert.equal(f.projectFinancialBundle(bundle({facts:[fact({reconciliation_note:note})]})).facts[0].reconciliation_note,note)
  const long=f.projectFinancialBundle(bundle({facts:[fact({reconciliation_note:'x'.repeat(401)})]}))
  assert.equal(long.facts[0].reconciliation_note,undefined);assert.ok(long.projection_notes.some(n=>n.code==='reconciliation_note_too_long'))
})
test('analyst questions and unknown speaker cannot become promises; ASR risks require manual review',()=>{
  const base={speaker_id:'ceo',speaker_role:'ceo',section_kind:'qa_answer'}
  assert.equal(f.managementClaimGate(base).eligible,true)
  assert.equal(f.managementClaimGate({...base,section_kind:'qa_question',speaker_role:'analyst'}).eligible,false)
  assert.equal(f.managementClaimGate({...base,speaker_role:'unknown'}).eligible,false)
  assert.equal(f.managementClaimGate({...base,source_type:'asr',low_confidence:true},{risk_fields_reviewed:true}).eligible,false)
  assert.equal(f.managementClaimGate({...base,source_type:'asr',low_confidence:true,human_relistened:true},{risk_fields_reviewed:true}).eligible,true)
})
test('rights export strips raw text and arbitrary payloads and honors per-document quote limits',()=>{
  const claim={claim_id:'c',claim_version_id:'cv1',paraphrase:'Research summary',evidence_refs:[{document_version_id:'doc1',segment_ids:['s'],exact_quote:'Short quote',quote_sha256:hash,quote_match_status:'exact',html:'<secret>'}]}
  const source=bundle({documents:[document({raw_text:'full paid text',extracted_text:'full text',html:'<script>'})],claims:[claim],private_notes:'private',segments:[{text:'full text'}]})
  const projected=f.projectFinancialBundle(source),json=JSON.stringify(projected)
  assert.equal(projected.claims[0].evidence_refs[0].exact_quote,'Short quote')
  for(const term of ['full paid text','full text','<script>','<secret>','private'])assert.equal(json.includes(term),false,term)
  assert.equal(f.projectFinancialBundle({...source,documents:[document({allowed_display:[]})]}).facts.length,0)
  assert.equal(f.projectFinancialBundle({...source,documents:[document({allowed_display:[]})]}).claims.length,0)
  assert.equal(f.projectFinancialBundle({...source,documents:[document({rights_policy:{max_quote_chars:3}})]}).claims[0].evidence_refs[0].exact_quote,undefined)
})
test('claims 12–20 is display cap, not a contract minimum or maximum',()=>{
  const source=bundle({claims:Array.from({length:25},(_,i)=>({claim_id:'c'+i,claim_version_id:'cv'+i,evidence_refs:[{document_version_id:'doc1'}],paraphrase:'p'+i}))})
  assert.equal(f.validateFinancialBundle(source).counts.claims,25);assert.equal(f.projectFinancialBundle(source).claims.length,25)
})
test('quote budgets aggregate across claims; rights policy cannot inject arbitrary payload fields',()=>{
  const words='one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen',claim=i=>({claim_id:'c'+i,claim_version_id:'cv'+i,paraphrase:'p',evidence_refs:[{document_version_id:'doc1',exact_quote:words,quote_sha256:hash,quote_match_status:'exact'}]})
  const projected=f.projectFinancialBundle(bundle({documents:[document({rights_policy:{max_quote_chars:200,raw_text:'paid full text'}})],claims:[claim(1),claim(2)]}))
  assert.equal(projected.claims[0].evidence_refs[0].exact_quote,words);assert.equal(projected.claims[1].evidence_refs[0].exact_quote,undefined)
  assert.equal(projected.projection_notes[0].code,'quote_word_budget_exceeded');assert.equal(JSON.stringify(projected).includes('paid full text'),false)
})
test('safe projection keeps referenced change candidates and draft assessments without false acceptance',()=>{
  const claim=i=>({claim_id:'c'+i,claim_version_id:'cv'+i,company_id:'co',period_id:'p1',section_kind:'qa_answer',paraphrase:'p',evidence_refs:[{evidence_id:'ev'+i,document_version_id:'doc1'}]})
  const source=bundle({claims:[claim(1),claim(2)],changes:[{change_id:'change1',before_claim_version_id:'cv1',after_claim_version_id:'cv2',change_type:'wording',decision:'accepted',review_status:'reviewed'}],assessments:[{assessment_id:'a',accepted_evidence_refs:['ev1'],judgment:'Conditional research view',review_status:'reviewed'}]})
  const projected=f.projectFinancialBundle(source)
  assert.equal(projected.claims[0].period_id,'p1');assert.equal(projected.claims[0].section_kind,'qa_answer')
  assert.equal(projected.changes.length,1);assert.equal(projected.changes[0].review_status,'draft');assert.equal(projected.changes[0].decision,'unresolved')
  assert.equal(projected.assessments.length,1);assert.equal(projected.assessments[0].review_status,'draft')
})
test('projection keeps version-witness fields so the reader applies the same as-of selection',()=>{
  const witnessed=document({source_id:'cfo',document_version_id:'cfo1',published_at:'2025-05-28',published_precision:'day',published_timezone:'-07:00',first_seen_at:'2026-10-13T05:00:00Z',retrieved_at:'2026-10-13T05:00:00Z',access_status:'retrieved',stable_original:false,historical_content_verified:true,version_witness:{method:'internet_archive_capture_identical_sha256',capture_timestamp_utc:'20250605064155'}})
  const unwitnessed=document({source_id:'tx',document_version_id:'tx1',published_at:null,stated_original_publication_date:'2026-05-20',first_seen_at:'2026-10-13T05:00:00Z',access_status:'retrieved',stable_original:false,historical_content_verified:false})
  const source=bundle({documents:[witnessed,unwitnessed],facts:[fact({source_document_version:'cfo1'})],coverage:[{company_id:'co',period_id:'p1',required_material_type:'filing',status:'partial_read',read_spans:1,total_spans:2,document_version_ids:['cfo1']}],run:{as_of:'2026-10-12',as_of_mode:'public_information'}})
  const projected=f.projectFinancialBundle(source)
  assert.equal(projected.documents[0].historical_content_verified,true);assert.equal(projected.documents[0].version_witness.method,'internet_archive_capture_identical_sha256')
  const pick=docs=>f.selectDocumentVersions(docs,{as_of:'2026-10-12',now:'2026-10-13T07:00:00Z'}).documents.map(d=>d.document_version_id).sort()
  assert.deepEqual(pick(projected.documents),pick(source.documents));assert.deepEqual(pick(projected.documents),['cfo1'])
})
test('paraphrase-only sources report quote_not_allowed, not a word-budget overflow',async()=>{
  const quote='Revenue grew.',claim={claim_id:'c',claim_version_id:'cv',company_id:'co',paraphrase:'p',evidence_refs:[{evidence_id:'e',document_version_id:'doc1',exact_quote:quote,quote_sha256:await f.financialDigest(quote),quote_match_status:'exact'}]}
  const projected=f.projectFinancialBundle(bundle({documents:[document({allowed_display:['paraphrase'],permitted_short_quote_words:0})],claims:[claim]}))
  assert.equal(projected.claims[0].evidence_refs[0].exact_quote,undefined)
  assert.equal(projected.projection_notes[0].code,'quote_not_allowed')
})
test('projection keeps author-written change explanations and claim-evidenced qualitative outcomes',()=>{
  const claim=i=>({claim_id:'c'+i,claim_version_id:'cv'+i,company_id:'co',period_id:'p1',section_kind:'prepared_remarks',paraphrase:'p',evidence_refs:[{evidence_id:'ev'+i,document_version_id:'doc1'}]})
  const change={change_id:'change1',period_id:'p1',topic:'gross_margin_mix',before_claim_version_id:'cv1',after_claim_version_id:'cv2',change_type:'numeric',summary:'Guide revised',management_explanation:'memory prices',analyst_explanation:'cost pass-through lags',counterevidence_summary:'Q2 actual still 75%',alternative_hypothesis:'pricing reset',follow_up:'check Q4',observed_at:'2026-08-26',extracted_text:'must not leak'}
  const target={target_id:'t1',origin_claim_version_id:'cv1',kpi:'GB300 production shipments',target_kind:'qualitative',interpretation:'researcher bound'}
  const outcomes=[{outcome_id:'o1',target_id:'t1',status:'met',eligible_fact_ids:[],evidence_claim_version_ids:['cv2','cv-missing']}]
  const projected=f.projectFinancialBundle(bundle({claims:[claim(1),claim(2)],changes:[change],targets:[target],outcomes}))
  const row=projected.changes[0]
  for(const key of ['summary','management_explanation','analyst_explanation','counterevidence_summary','alternative_hypothesis','follow_up','period_id','topic','observed_at'])assert.equal(row[key],change[key])
  assert.equal(row.extracted_text,undefined)
  assert.equal(projected.targets[0].kpi,'GB300 production shipments');assert.equal(projected.targets[0].interpretation,'researcher bound')
  assert.deepEqual(projected.outcomes[0].evidence_claim_version_ids,['cv2','cv-missing'])
})
test('assessment requires independent semantic receipt, exact evidence scope and honest counter gap',()=>{
  const assessment={author_id:'author',accepted_evidence_refs:['ev1'],follow_up_questions:['why?','when?','how?'],counterevidence_gap:'No qualified counterevidence in reviewed scope.'},receipt={reviewer_id:'reviewer',scope:['semantic'],decision:'accepted',input_manifest_sha256:hash,evidence_refs:['ev1'],reviewed_at:date}
  assert.equal(f.validateAssessmentReview(assessment,receipt,{input_manifest_sha256:hash}).valid,true)
  assert.equal(f.validateAssessmentReview(assessment,{...receipt,reviewer_id:'author'}).valid,false)
  assert.equal(f.validateAssessmentReview(assessment,{...receipt,evidence_refs:['other']}).valid,false)
  assert.equal(f.validateAssessmentReview({...assessment,counterevidence_gap:null},receipt).valid,false)
})
test('manifest verifies company, complete document inventory and exact payload hash',async()=>{
  const source=bundle(),manifest={schema_version:f.FINANCIAL_SCHEMA,company_id:'co',payload_sha256:await f.financialDigest(source),documents:[{document_version_id:'doc1',raw_sha256:hash,text_sha256:null}]}
  assert.equal((await f.verifyManifest(source,manifest,{company_id:'co'})).valid,true)
  assert.equal((await f.verifyManifest({...source,facts:[]},manifest)).valid,false)
  assert.equal((await f.verifyManifest(source,{...manifest,documents:[]})).errors.includes('incomplete_source_manifest'),true)
  assert.equal((await f.verifyManifest(source,manifest,{company_id:'other'})).errors.includes('manifest_company_mismatch'),true)
})
test('cache includes all parser/model/prompt versions; transitive invalidation preserves unrelated nodes',async()=>{
  const input={document_version_id:'doc1',document_hash:hash,parser_version:'1',model_version:'none',prompt_version:'1',transform_version:'1'}
  assert.equal(await f.buildCacheKey(input),await f.buildCacheKey({...input}))
  assert.notEqual(await f.buildCacheKey(input),await f.buildCacheKey({...input,parser_version:'2'}))
  const diff=f.dependencyInvalidations([{id:'fact1',depends_on:['doc1']},{id:'claim1',depends_on:['fact1']},{id:'model1',depends_on:['claim1']},{id:'other',depends_on:['doc2']}],['doc1'])
  assert.deepEqual(diff.invalidated.map(row=>row.id),['fact1','claim1','model1']);assert.deepEqual(diff.preserved,['other'])
})
test('budget sums workers and retries, warns at 80%, stops at 100% and paid usage with zero consent',()=>{
  const receipts=[{worker:'a',attempt:0,tokens:30,cost:'0'},{worker:'a',attempt:1,tokens:30,cost:'0'},{worker:'b',attempt:0,tokens:20,cost:'0'}]
  assert.equal(f.budgetStatus(receipts,{token_limit:100}).status,'warn')
  assert.equal(f.budgetStatus(receipts,{token_limit:100,next_tokens:20}).status,'stop')
  assert.equal(f.budgetStatus([{tokens:1,cost:'0.001'}],{token_limit:100}).status,'stop')
  assert.equal(f.budgetStatus([{tokens:null,cost:null}],{token_limit:100}).status,'unknown')
  assert.equal(f.budgetStatus([{tokens:null,cost:null}],{token_limit:100}).tokens,null)
  assert.equal(f.budgetStatus([{tokens:100,cost:null}],{token_limit:100}).status,'stop')
  assert.equal(f.budgetStatus([{tokens:null,cost:'1'}],{token_limit:100,cost_limit:'1'}).status,'stop')
})
