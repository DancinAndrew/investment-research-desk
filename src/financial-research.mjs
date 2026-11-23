// Pure browser-compatible financial-research/1 rules. No network or persistence.
export const FINANCIAL_SCHEMA = 'financial-research/1'
export const COVERAGE_STATUSES = Object.freeze(['not_published','not_found','unavailable','directory_only','partial_read','full_text','reviewed'])
// `exceeded` = actual above the upper bound of a range target: neither met nor a failure.
export const OUTCOME_STATUSES = Object.freeze(['pending','not_due','met','partly_met','missed','exceeded','withdrawn','redefined','not_disclosed','not_comparable','disputed'])
const fail = message => { throw new Error(message) }
const clone = value => structuredClone(value)
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const has = (object,key) => Object.prototype.hasOwnProperty.call(object,key)
function day(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value+'T00:00:00Z'))||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) fail('invalid_date')
  return value
}
function timestamp(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T/.test(value)||!/(Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value))) fail('timestamp_requires_timezone')
  day(value.slice(0,10));return Date.parse(value)
}
function cutoffTime(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value||'') ? Date.parse(day(value)+'T23:59:59.999Z') : timestamp(value) }
function futureCutoff(as_of,now) {
  if(/^\d{4}-\d{2}-\d{2}$/.test(as_of||''))return day(as_of)>new Date(cutoffTime(now)).toISOString().slice(0,10)
  return cutoffTime(as_of)>cutoffTime(now)
}
function freeze(value) { if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value }
export function canonicalJSON(value) {
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value)
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value)
  if(Array.isArray(value))return '['+value.map(canonicalJSON).join(',')+']'
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalJSON(value[key])).join(',')+'}'
  fail('non_json_value')
}
export async function financialDigest(value) {
  // Strings are raw UTF-8 bytes (including exact quotes); only structured
  // objects use canonical JSON. Never wrap a quote in JSON quotation marks.
  const bytes=new TextEncoder().encode(typeof value==='string'?value:canonicalJSON(value))
  return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('')
}

// Decimal arithmetic uses integer coefficients, never binary floats. Division
// rounds half away from zero; precision means decimal places in the result.
function decimal(value) {
  if(typeof value!=='string'||!/^[-+]?\d+(?:\.\d+)?$/.test(value)||value.length>1000)fail('decimal_string_required')
  const negative=value[0]==='-',unsigned=value.replace(/^[-+]/,''),[whole,fraction='']=unsigned.split('.')
  return {n:BigInt(whole+fraction)*(negative?-1n:1n),s:fraction.length}
}
const power = n => {if(!Number.isInteger(n)||n<0||n>1000)fail('invalid_decimal_scale');return 10n**BigInt(n)}
function render(n,s) {
  const sign=n<0n?'-':'',digits=(n<0n?-n:n).toString().padStart(s+1,'0')
  let result=s?digits.slice(0,-s)+'.'+digits.slice(-s):digits
  if(s)result=result.replace(/0+$/,'').replace(/\.$/,'')
  return n===0n?'0':sign+result
}
function aligned(a,b) {a=decimal(a);b=decimal(b);const s=Math.max(a.s,b.s);return {a:a.n*power(s-a.s),b:b.n*power(s-b.s),s}}
export function decimalAdd(a,b) {const row=aligned(a,b);return render(row.a+row.b,row.s)}
export function decimalSubtract(a,b) {const row=aligned(a,b);return render(row.a-row.b,row.s)}
export function decimalMultiply(a,b) {a=decimal(a);b=decimal(b);return render(a.n*b.n,a.s+b.s)}
export function decimalCompare(a,b) {const row=aligned(a,b);return row.a<row.b?-1:row.a>row.b?1:0}
export function decimalScale(value,scale=0) {const row=decimal(value);if(!Number.isInteger(scale)||Math.abs(scale)>1000)fail('invalid_decimal_scale');return scale>=row.s?render(row.n*power(scale-row.s),0):render(row.n,row.s-scale)}
export function decimalDivide(a,b,precision=12) {
  a=decimal(a);b=decimal(b);if(!b.n)return null
  power(precision);const numerator=a.n*power(b.s+precision),denominator=b.n*power(a.s)
  let quotient=numerator/denominator;const remainder=numerator%denominator
  if((remainder<0n?-remainder:remainder)*2n>=(denominator<0n?-denominator:denominator))quotient+=(numerator<0n)!==(denominator<0n)?-1n:1n
  return render(quotient,precision)
}
export function roundingTolerance({decimals,scale=0}) {
  if(decimals==='INF')return '0'
  if(!Number.isInteger(decimals))return null
  return decimalScale('0.5',scale-decimals)
}
export function withinRoundingTolerance(actual,reported,format) {
  if(actual==null||reported==null)return {matched:false,reason:'missing_value',tolerance:null}
  const tolerance=roundingTolerance(format);if(tolerance===null)return {matched:false,reason:'unknown_rounding',tolerance}
  let residual=decimalSubtract(actual,reported);if(residual.startsWith('-'))residual=residual.slice(1)
  return {matched:decimalCompare(residual,tolerance)<=0,residual,tolerance}
}

export function validateFinancialBundle(bundle,{now=new Date().toISOString()}={}) {
  if(!bundle||bundle.schema_version!==FINANCIAL_SCHEMA||!bundle.company?.company_id||!bundle.run?.as_of)fail('invalid_financial_bundle')
  const company=bundle.company.company_id,cutoff=cutoffTime(bundle.run.as_of)
  if(now&&futureCutoff(bundle.run.as_of,now))fail('future_as_of')
  if(!['public_information','user_research'].includes(bundle.run.as_of_mode))fail('invalid_as_of_mode')
  const arrays=['periods','documents','facts','claims','targets','outcomes','changes','assessments','coverage']
  for(const key of arrays)if(bundle[key]!=null&&!Array.isArray(bundle[key]))fail('invalid_array:'+key)
  for(const key of ['periods','documents','facts','coverage'])if(!Array.isArray(bundle[key]))fail('required_array:'+key)
  const unique=(items,key)=>{const ids=new Set();for(const row of items){if(!row?.[key]||ids.has(row[key]))fail('invalid_or_duplicate_id:'+key);ids.add(row[key])}return ids}
  const periods=unique(bundle.periods,'period_id'),documents=unique(bundle.documents,'document_version_id'),facts=unique(bundle.facts,'fact_id')
  for(const period of bundle.periods){day(period.start_date);day(period.end_date);if(period.start_date>period.end_date)fail('negative_duration');if(period.days!=null&&(!Number.isInteger(period.days)||period.days<0))fail('invalid_period_days');if(!['duration','instant'].includes(period.period_kind||period.kind))fail('invalid_period_kind')}
  for(const document of bundle.documents){if(!document.source_id)fail('missing_source_id');if(document.company_id&&document.company_id!==company)fail('company_mismatch');publicationBoundary(document);for(const key of ['raw_sha256','text_sha256'])if(document[key]!=null&&!isHash(document[key]))fail('invalid_hash:'+key);if(document.allowed_display!=null&&!Array.isArray(document.allowed_display))fail('invalid_allowed_display')}
  for(const fact of bundle.facts){if(fact.company_id!==company||!periods.has(fact.period_id)||!documents.has(fact.source_document_version))fail('invalid_fact_reference');if(fact.numeric_decimal!=null)decimal(fact.numeric_decimal);else if(!fact.null_reason)fail('missing_null_reason');if(!Number.isInteger(fact.scale)||Math.abs(fact.scale)>1000)fail('invalid_fact_scale');if(fact.published_at!=null)publicationBoundary(fact)}
  for(const [key,id] of [['claims','claim_version_id'],['targets','target_id'],['outcomes','outcome_id'],['changes','change_id'],['assessments','assessment_id']])if(bundle[key]?.length)unique(bundle[key],id)
  const claimIds=new Set((bundle.claims||[]).map(row=>row.claim_version_id)),targetIds=new Set((bundle.targets||[]).map(row=>row.target_id))
  for(const key of ['claims','targets','outcomes','changes','assessments'])for(const row of bundle[key]||[])if(row.company_id&&row.company_id!==company)fail('company_mismatch:'+key)
  for(const target of bundle.targets||[])if(!claimIds.has(target.origin_claim_version_id))fail('missing_target_claim')
  for(const outcome of bundle.outcomes||[]){if(!OUTCOME_STATUSES.includes(outcome.status))fail('invalid_outcome_status');if(!targetIds.has(outcome.target_id)||(outcome.eligible_fact_ids||[]).some(id=>!facts.has(id)))fail('invalid_outcome_reference')}
  const coverageKeys=new Set()
  for(const cell of bundle.coverage){const key=[cell.company_id,cell.period_id,cell.required_material_type].join('|');if(cell.company_id!==company||!periods.has(cell.period_id)||!cell.required_material_type||coverageKeys.has(key))fail('invalid_coverage_reference');coverageKeys.add(key);validateCoverageCell(cell);if((cell.document_version_ids||[]).some(id=>!documents.has(id)))fail('missing_coverage_document')}
  for(const claim of bundle.claims||[])for(const ref of claim.evidence_refs||[])if(ref.document_version_id&&!documents.has(ref.document_version_id))fail('missing_claim_document')
  return {valid:true,ok:true,schema_version:FINANCIAL_SCHEMA,company_id:company,counts:Object.fromEntries(arrays.map(key=>[key,(bundle[key]||[]).length]))}
}
function publicationBoundary(document) {
  if(document.published_at==null)return null
  const precision=document.published_precision||document.published_at_precision||document.precision||(/^\d{4}-\d{2}-\d{2}$/.test(document.published_at)?'day':'second')
  if(precision==='day'){
    const date=day(document.published_at.slice(0,10)),zone=document.published_timezone||document.timezone||'UTC'
    if(zone!=='UTC'&&zone!=='Z'&&!/^[+-]\d{2}:\d{2}$/.test(zone))return {time:null,date,precision,reason:'day_timezone_uncertain'}
    const time=timestamp(date+'T23:59:59.999'+(zone==='UTC'?'Z':zone))
    return {time:document.revised_at?Math.max(time,timestamp(document.revised_at)):time,date,precision}
  }
  if(!['second','minute','millisecond'].includes(precision))fail('invalid_publication_precision')
  const time=timestamp(document.published_at)
  return {time:document.revised_at?Math.max(time,timestamp(document.revised_at)):time,precision}
}
// Time from which a byte version is independently proven to exist (archive capture or
// pre-cutoff retrieval receipt). Not proof that the same bytes existed at publication.
function witnessTime(document) {
  const w=document.version_witness
  if(!w||typeof w!=='object')return null
  if(typeof w.capture_timestamp_utc==='string'&&/^\d{14}$/.test(w.capture_timestamp_utc)){const s=w.capture_timestamp_utc;return timestamp(`${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}T${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}Z`)}
  if(typeof w.witnessed_at==='string')return timestamp(w.witnessed_at)
  return null
}
export function selectDocumentVersions(documents,{as_of,mode='public_information',pinned_version_ids=[],now=new Date().toISOString(),view='latest'}={}) {
  const cutoff=cutoffTime(as_of);if(now&&futureCutoff(as_of,now))fail('future_as_of')
  if(!['public_information','user_research'].includes(mode)||!['latest','as_reported'].includes(view))fail('invalid_selection_mode')
  const eligible=[],rejected=[],pins=new Set(pinned_version_ids)
  for(const document of documents){let boundary=publicationBoundary(document),eligibility_basis='published_at';let reason=null
    // A witnessed successful read proves availability from first_seen_at onward,
    // never publication on an earlier event date or historical content.
    const historicalUnproven=document.historical_content_verified!==true&&document.stable_original!==true
    const witnessedCurrentContent=mode==='public_information'&&historicalUnproven&&boundary?.time!=null&&boundary.time<=cutoff
    if((!boundary||witnessedCurrentContent)&&document.first_seen_at&&['available','full_text','retrieved'].includes(document.access_status)){
      boundary={time:timestamp(document.first_seen_at),precision:'second'};eligibility_basis='first_seen_access_receipt'
    }
    // Witnessed content is available only from the witness time, never earlier.
    const witnessed=mode==='public_information'&&boundary?.time!=null?witnessTime(document):null
    if(witnessed!=null&&witnessed>boundary.time){boundary={time:witnessed,precision:'second'};eligibility_basis='version_witness'}
    if(!boundary)reason='publication_unknown'
    else if(boundary.time==null)reason=boundary.reason
    else if(boundary.time>cutoff)reason=boundary.precision==='day'?'day_precision_after_cutoff':'after_as_of'
    else if(mode==='user_research'&&!pins.has(document.document_version_id))reason='not_in_original_run'
    else if(mode==='public_information'&&eligibility_basis==='published_at'&&document.historical_content_verified!==true&&document.stable_original!==true)reason='historical_content_unverified'
    if(reason){rejected.push({document_version_id:document.document_version_id,reason});continue}
    eligible.push({document:{...clone(document),eligibility_basis},boundary})
  }
  if(mode==='user_research')return {documents:eligible.map(row=>row.document),rejected,as_of,mode,view}
  const selected=new Map()
  for(const row of eligible){const key=row.document.source_id,prior=selected.get(key),difference=row.boundary.time-(prior?.boundary.time??0),supersedesTie=prior&&difference===0&&(view==='latest'?row.document.supersedes===prior.document.document_version_id:prior.document.supersedes===row.document.document_version_id);if(!prior||(view==='latest'?difference>0:difference<0)||supersedesTie)selected.set(key,row)}
  return {documents:[...selected.values()].map(row=>clone(row.document)),rejected,as_of,mode,view}
}
export async function appendImmutableVersion(versions,next,{id_key='version_id',hash_key='content_sha256'}={}) {
  if(!next?.[id_key])fail('missing_version_id')
  const content=clone(next);delete content[hash_key];const hash=await financialDigest(content)
  if(next[hash_key]!=null&&next[hash_key]!==hash)fail('version_hash_mismatch')
  const prior=versions.find(row=>row[id_key]===next[id_key])
  if(prior){if(canonicalJSON(prior)!==canonicalJSON({...content,[hash_key]:hash}))fail('immutable_version_conflict');return freeze(clone(versions))}
  if(next.supersedes!=null&&!versions.some(row=>row[id_key]===next.supersedes))fail('missing_superseded_version')
  return freeze([...clone(versions),{...content,[hash_key]:hash}])
}
function validateCoverageCell(cell) {
  if(!COVERAGE_STATUSES.includes(cell.status))fail('invalid_coverage_status')
  const read=cell.read_spans??0,total=cell.total_spans??null
  if(!Number.isInteger(read)||read<0||(total!==null&&(!Number.isInteger(total)||total<read)))fail('invalid_read_spans')
  if(cell.status==='reviewed'&&(total===null||total===0||read!==total))fail('incomplete_full_read')
  if(['directory_only','not_published','not_found','unavailable'].includes(cell.status)&&read!==0)fail('unexpected_read_spans')
  if(cell.status==='reviewed'&&cell.review_status!=='reviewed')fail('missing_semantic_review')
}
export function summarizeCoverage(period_ids,material_types,cells) {
  if(new Set(period_ids).size!==period_ids.length||new Set(material_types).size!==material_types.length)fail('duplicate_coverage_dimension')
  const rows=[],counts=Object.fromEntries(COVERAGE_STATUSES.map(status=>[status,0]))
  for(const period_id of period_ids)for(const required_material_type of material_types){const found=cells.filter(cell=>cell.period_id===period_id&&cell.required_material_type===required_material_type);if(found.length>1)fail('duplicate_coverage_cell');const cell=found[0]||{period_id,required_material_type,status:'not_found',read_spans:0,total_spans:null,gap_impact:'coverage_cell_missing'};validateCoverageCell(cell);rows.push(clone(cell));counts[cell.status]++}
  return {period_count:period_ids.length,required_cell_count:rows.length,counts,obtained_full_text_count:counts.full_text+counts.reviewed,full_read_count:rows.filter(row=>row.total_spans>0&&row.read_spans===row.total_spans).length,reviewed_count:counts.reviewed,complete:rows.length>0&&rows.every(row=>row.status==='reviewed'),rows}
}
export function deduplicateSources(documents) {
  const groups=new Map(),versions=[],duplicates=[]
  for(const document of documents){const hash=document.raw_sha256||document.text_sha256,key=document.supersedes?document.document_version_id:hash?`${document.company_id||''}:${hash}`:document.document_version_id
    const existing=groups.get(key);if(existing)duplicates.push({document_version_id:document.document_version_id,duplicate_of:existing.document_version_id,upstream_group:document.upstream_group||null});else{groups.set(key,document);versions.push(clone(document))}}
  const upstream=new Map();for(const document of documents){const key=document.upstream_group||document.source_id||document.document_version_id;if(!upstream.has(key))upstream.set(key,[]);upstream.get(key).push(document.document_version_id)}
  const parents=new Map([...upstream.keys()].map(key=>[key,key])),root=key=>{while(parents.get(key)!==key)key=parents.get(key);return key},byVersion=new Map(documents.map(document=>[document.document_version_id,document])),groupOf=document=>document.upstream_group||document.source_id||document.document_version_id
  for(const duplicate of duplicates){const a=root(groupOf(byVersion.get(duplicate.document_version_id))),b=root(groupOf(byVersion.get(duplicate.duplicate_of)));if(a!==b)parents.set(a,b)}
  return {documents:versions,duplicates,upstream_groups:[...upstream].map(([upstream_group,document_version_ids])=>({upstream_group,document_version_ids,independence_group:root(upstream_group)})),independent_source_count:new Set([...upstream.keys()].map(root)).size}
}

const comparisonKeys=['company_id','concept','metric_definition_version','currency','unit','accounting_basis','consolidation_scope','share_basis','recast_version']
export function compareFacts(a,b,{ignore_period=false}={}) {
  const reasons=[];for(const key of comparisonKeys)if(canonicalJSON(a[key]??null)!==canonicalJSON(b[key]??null))reasons.push('mismatch:'+key)
  if(canonicalJSON(a.dimensions??{})!==canonicalJSON(b.dimensions??{}))reasons.push('mismatch:dimensions')
  if(!ignore_period&&a.period_id!==b.period_id)reasons.push('mismatch:period_id')
  if(a.numeric_decimal==null||b.numeric_decimal==null)reasons.push('missing_value')
  return {comparable:reasons.length===0,reasons}
}
const factValue = fact => fact.numeric_decimal==null?null:decimalScale(fact.numeric_decimal,fact.scale??0)
const disallowedAdditive = fact => /(?:eps|earnings.?per.?share|margin|rate|ratio|average|weighted|balance|assets|liabilit|equity|shares)/i.test([fact.concept,fact.unit,fact.metric_kind].join(' '))||fact.period_kind==='instant'||fact.kind==='instant'||fact.additive!==true
export function deriveQ4(fy,ytd) {
  const comparison=compareFacts(fy,ytd,{ignore_period:true}),reasons=[...comparison.reasons]
  if(disallowedAdditive(fy)||disallowedAdditive(ytd))reasons.push('non_additive_metric')
  if(fy.start_date!==ytd.start_date||!fy.end_date||!ytd.end_date||fy.end_date<=ytd.end_date||fy.fiscal_year!==ytd.fiscal_year||fy.period_label!=='FY'||!['9M','YTD_3Q'].includes(ytd.period_label))reasons.push('invalid_fy_ytd_periods')
  if(fy.end_date&&ytd.end_date){const duration=(Date.parse(day(fy.end_date))-Date.parse(day(ytd.end_date)))/86400000;if(duration<70||duration>105)reasons.push('invalid_q4_duration')}
  if(reasons.length)return {numeric_decimal:null,comparable:false,reasons,derived_from:[fy.fact_id,ytd.fact_id]}
  const start=new Date(day(ytd.end_date)+'T00:00:00Z');start.setUTCDate(start.getUTCDate()+1)
  return {...clone(fy),fact_id:fy.fact_id+'-minus-'+ytd.fact_id,period_id:fy.period_id+'-Q4-derived',period_label:'Q4',fiscal_quarter:4,days:(Date.parse(fy.end_date)-start.getTime())/86400000+1,start_date:start.toISOString().slice(0,10),numeric_decimal:decimalSubtract(factValue(fy),factValue(ytd)),scale:0,raw_value:null,derived_from:[fy.fact_id,ytd.fact_id],formula_version:'fy-minus-ytd/1',comparable:true,reasons:[]}
}
export function deriveTTM(facts) {
  if(facts.length!==4)return {numeric_decimal:null,comparable:false,reasons:['four_quarters_required']}
  const sorted=[...facts].sort((a,b)=>a.start_date.localeCompare(b.start_date)),reasons=[]
  for(let i=0;i<sorted.length;i++){const fact=sorted[i];reasons.push(...compareFacts(sorted[0],fact,{ignore_period:true}).reasons);if(disallowedAdditive(fact)||!['Q1','Q2','Q3','Q4'].includes(fact.period_label))reasons.push('non_additive_or_non_quarter');day(fact.start_date);day(fact.end_date);const duration=(Date.parse(fact.end_date)-Date.parse(fact.start_date))/86400000+1;if(duration<0)reasons.push('negative_duration');if(duration<70||duration>105)reasons.push('invalid_quarter_duration');if(i&&Date.parse(fact.start_date+'T00:00:00Z')!==Date.parse(sorted[i-1].end_date+'T00:00:00Z')+86400000)reasons.push(fact.start_date<=sorted[i-1].end_date?'overlap':'gap');if(i&&Number(fact.period_label.slice(1))!==Number(sorted[i-1].period_label.slice(1))%4+1)reasons.push('nonconsecutive_fiscal_quarters')}
  if(reasons.length)return {numeric_decimal:null,comparable:false,reasons:[...new Set(reasons)],derived_from:sorted.map(fact=>fact.fact_id)}
  return {...clone(sorted[0]),fact_id:'ttm:'+sorted.map(fact=>fact.fact_id).join('+'),period_id:'ttm:'+sorted.at(-1).period_id,period_label:'TTM',fiscal_quarter:null,days:(Date.parse(sorted.at(-1).end_date)-Date.parse(sorted[0].start_date))/86400000+1,start_date:sorted[0].start_date,end_date:sorted.at(-1).end_date,numeric_decimal:sorted.reduce((sum,fact)=>decimalAdd(sum,factValue(fact)),'0'),scale:0,derived_from:sorted.map(fact=>fact.fact_id),formula_version:'four-contiguous-quarters/1',comparable:true,reasons:[]}
}
export function computeRatio(numerator,denominator,{precision=12,percent=false}={}) {
  if(numerator==null||denominator==null)return {numeric_decimal:null,reason:'missing_value',formula_version:'ratio/1'}
  if(decimalCompare(denominator,'0')===0)return {numeric_decimal:null,reason:'zero_denominator',formula_version:'ratio/1'}
  return {numeric_decimal:decimalDivide(percent?decimalMultiply(numerator,'100'):numerator,denominator,precision),reason:null,formula_version:'ratio/1'}
}
export function applySplit(fact,action,{target_basis=action.to_basis}={}) {
  if(!action.action_id||!action.source_document_version||!action.effective_date||!action.from_basis||!action.to_basis)fail('incomplete_split_evidence')
  day(action.effective_date);if(decimalCompare(action.ratio,'0')<=0)fail('invalid_split_ratio')
  if(fact.share_basis===target_basis)return {...clone(fact),split_status:'already_on_target_basis'}
  if((fact.applied_action_ids||[]).includes(action.action_id))fail('split_already_applied')
  if(fact.share_basis!==action.from_basis||target_basis!==action.to_basis)fail('incompatible_share_basis')
  if(!['eps','diluted_weighted_average_shares','basic_weighted_average_shares'].includes(fact.metric_kind))fail('unsupported_split_metric')
  const value=factValue(fact)
  return {...clone(fact),numeric_decimal:value===null?null:fact.metric_kind==='eps'?decimalDivide(value,action.ratio):decimalMultiply(value,action.ratio),scale:0,share_basis:target_basis,applied_action_ids:[...(fact.applied_action_ids||[]),action.action_id],derived_from:[fact.fact_id],corporate_action_refs:[action.source_document_version],formula_version:'split-basis/1',split_status:'adjusted'}
}

export function evaluateTarget(target,actual,{as_of,result_publication_pending=false,not_disclosed=false,disputed=false,withdrawn=false,redefined=false}={}) {
  const base={target_id:target.target_id,evaluation_as_of:as_of,original_deadline:target.original_deadline??null,eligible_fact_ids:[],numeric_decimal:null,comparable:false}
  const result=(status,reason,extra={})=>({...base,status,reason,...extra})
  const cutoff=cutoffTime(as_of)
  if(withdrawn)return result('withdrawn','explicit_withdrawal')
  if(redefined)return result('redefined','explicit_definition_revision')
  if(disputed)return result('disputed','requires_researcher_resolution')
  if(target.original_deadline&&cutoff<cutoffTime(target.original_deadline))return result('not_due','original_deadline_not_reached')
  if(!actual)return result(not_disclosed?'not_disclosed':'pending',not_disclosed?'no_disclosed_actual':'actual_not_available')
  const publication=publicationBoundary(actual)
  if(result_publication_pending||!publication||publication.time==null||publication.time>cutoff)return result('pending','actual_not_public_as_of')
  const comparison=compareFacts(target,actual,{ignore_period:true})
  if(target.target_period&&target.target_period!==actual.period_id)comparison.reasons.push('mismatch:target_period')
  if(comparison.reasons.some(reason=>reason!=='missing_value'))return result('not_comparable',comparison.reasons.join(','))
  const value=factValue(actual);if(value===null)return result(not_disclosed?'not_disclosed':'pending','missing_actual_value')
  if(target.target_kind==='qualitative'||target.conditions_satisfied===false)return result('disputed','qualitative_or_unresolved_conditions')
  const minimum=target.minimum??target.value,maximum=target.maximum??target.value,tolerance=target.tolerance??'0',extra={eligible_fact_ids:[actual.fact_id],numeric_decimal:value,comparable:true,tolerance,comparison_formula:target.comparator||'>='}
  if(minimum==null)return result('disputed','target_value_unknown',extra)
  const low=decimalSubtract(minimum,tolerance),high=maximum==null?null:decimalAdd(maximum,tolerance)
  if(target.comparator==='range'){
    // Above-range is recorded separately: beating guidance is not an operating failure,
    // and the forecast-accuracy miss stays visible through comparison_result.
    if(decimalCompare(value,low)<0)return result('missed','range_comparison',{...extra,comparison_result:'below_range'})
    if(high!==null&&decimalCompare(value,high)>0)return result('exceeded','range_comparison',{...extra,comparison_result:'above_range',gap_above_upper:decimalSubtract(value,high)})
    return result('met','range_comparison',{...extra,comparison_result:'within_range'})
  }
  if(target.comparator==='<=')return result(decimalCompare(value,decimalAdd(minimum,tolerance))<=0?'met':'missed','numeric_comparison',extra)
  if(target.comparator==='=')return result(decimalCompare(value,low)>=0&&decimalCompare(value,decimalAdd(minimum,tolerance))<=0?'met':'missed','numeric_comparison',extra)
  if(target.comparator!=null&&target.comparator!=='>=')return result('disputed','unsupported_comparator',extra)
  if(decimalCompare(value,low)>=0)return result('met','numeric_comparison',extra)
  if(target.partial_minimum!=null&&decimalCompare(value,target.partial_minimum)>=0)return result('partly_met','explicit_partial_threshold',extra)
  return result('missed','numeric_comparison',extra)
}

// Collapses every whitespace run (spaces, line breaks, form feeds) to one space.
export function normalizeWhitespace(text) { return String(text).replace(/\s+/g,' ').trim() }
// Raw offset of each normalized character in `raw`, so a normalized quote maps back.
function normalizedPositions(raw) {
  const positions=[];let pendingSpace=-1
  for(let index=0;index<raw.length;index++){
    if(/\s/.test(raw[index])){if(positions.length&&pendingSpace<0)pendingSpace=index;continue}
    if(pendingSpace>=0){positions.push(pendingSpace);pendingSpace=-1}
    positions.push(index)
  }
  return positions
}
function checkNormalization(segment,document,quote) {
  const maps=segment.normalization_map
  if(!Array.isArray(maps)||!maps.length)return {reasons:['normalization_reverse_map_missing']}
  const [map]=maps
  // Methodless legacy anchors cannot be re-derived, so they never authorize a new exact quote.
  if(maps.every(row=>row&&row.method===undefined))return {reasons:['normalization_unverified_legacy_map'],verification:'unverified_legacy_map'}
  if(maps.length!==1||map?.method!=='whitespace_collapse/1')return {reasons:['normalization_method_unsupported']}
  if(typeof document?.extracted_text!=='string')return {reasons:['normalization_raw_text_missing']}
  const raw=document.extracted_text,{raw_start:start,raw_end:end}=map
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>raw.length||start>=end)return {reasons:['normalization_reverse_map_mismatch']}
  const slice=raw.slice(start,end)
  if(normalizeWhitespace(slice)!==segment.text)return {reasons:['normalization_reverse_map_mismatch']}
  const at=typeof quote==='string'?segment.text.indexOf(quote):-1
  if(at<0)return {reasons:[]}
  const positions=normalizedPositions(slice)
  return {reasons:[],raw_span:{raw_start:start+positions[at],raw_end:start+positions[at+quote.length-1]+1}}
}
export async function validateEvidenceQuote(evidence,segment,{document=null}={}) {
  const reasons=[]
  if(evidence.document_version_id!==segment.document_version_id||(document&&document.document_version_id!==segment.document_version_id))reasons.push('document_version_mismatch')
  if(!(evidence.segment_ids||[]).includes(segment.segment_id))reasons.push('segment_reference_mismatch')
  const quote=evidence.exact_quote
  if(typeof quote!=='string'||!quote||typeof segment.text!=='string'||!segment.text.includes(quote))reasons.push('quote_not_exact_substring')
  if(evidence.is_translation===true||evidence.quote_kind==='translation')reasons.push('translation_not_exact_quote')
  if(typeof quote==='string'&&await financialDigest(quote)!==evidence.quote_sha256)reasons.push('quote_hash_mismatch')
  const normalization=segment.normalization_applied===true?checkNormalization(segment,document,quote):{reasons:[]}
  reasons.push(...normalization.reasons)
  if(segment.ocr_corrected===true&&segment.original_page_reviewed!==true)reasons.push('ocr_original_page_review_required')
  if(document?.text_sha256&&await financialDigest(document.extracted_text??'')!==document.text_sha256)reasons.push('document_text_hash_mismatch')
  return {valid:reasons.length===0,quote_match_status:reasons.length?'blocked':'exact',reasons,semantic_support:'not_evaluated',...(normalization.verification?{normalization_verification:normalization.verification}:{}),...(normalization.raw_span&&!reasons.length?{raw_span:normalization.raw_span,normalization_verification:'rederived_from_raw_text'}:{})}
}
export function managementClaimGate(segment,{risk_fields_reviewed=false}={}) {
  const reasons=[]
  if(!segment.speaker_id||!['management','ceo','cfo','executive'].includes(segment.speaker_role))reasons.push('management_speaker_unverified')
  if(!['prepared_remarks','qa_answer'].includes(segment.section_kind))reasons.push('not_management_statement')
  if(segment.source_type==='asr'&&(!risk_fields_reviewed||segment.low_confidence===true&&segment.human_relistened!==true))reasons.push('asr_manual_risk_review_required')
  return {eligible:reasons.length===0,reasons}
}
export function validateAssessmentReview(assessment,receipt,{input_manifest_sha256=null}={}) {
  const reasons=[]
  if(!assessment.author_id||!receipt?.reviewer_id||receipt.reviewer_id===assessment.author_id)reasons.push('independent_reviewer_required')
  if(receipt?.decision!=='accepted'||!receipt?.scope?.includes('semantic'))reasons.push('semantic_review_not_accepted')
  if(!isHash(receipt?.input_manifest_sha256)||(input_manifest_sha256&&receipt.input_manifest_sha256!==input_manifest_sha256))reasons.push('review_manifest_pin_mismatch')
  if(!Array.isArray(receipt?.evidence_refs)||!receipt.evidence_refs.length)reasons.push('review_evidence_scope_missing')
  if((assessment.accepted_evidence_refs||[]).some(ref=>!receipt?.evidence_refs?.includes(ref)))reasons.push('unreviewed_assessment_evidence')
  if(!Array.isArray(assessment.follow_up_questions)||assessment.follow_up_questions.length!==3||assessment.follow_up_questions.some(question=>typeof question!=='string'||!question.trim()))reasons.push('three_follow_up_questions_required')
  if(!assessment.strongest_alternative&&!assessment.counterevidence_gap)reasons.push('strongest_alternative_or_explicit_gap_required')
  if(!receipt?.reviewed_at)reasons.push('review_time_missing');else timestamp(receipt.reviewed_at)
  return {valid:reasons.length===0,reasons,semantic_support:reasons.length?'not_accepted':'reviewed'}
}

const pick=(row,keys)=>Object.fromEntries(keys.filter(key=>has(row,key)).map(key=>[key,clone(row[key])]))
const sourceFields=['source_id','document_version_id','company_id','publisher','rightsholder','title','source_type','language','original_url','upstream_group','accession','document_date','published_at','published_precision','published_timezone','first_seen_at','retrieved_at','revised_at','supersedes','raw_sha256','text_sha256','extraction_version','access_status','rights_checked_at','allowed_display','license_url','permitted_short_quote_words','eligibility_basis','event_at','associated_release_at','historical_content_verified','stable_original','stated_original_publication_date']
// Only small, typed proof fields leave the private bundle; anything else nested is dropped.
const WITNESS_FIELDS={method:/^[a-z0-9_]{1,64}$/,capture_timestamp_utc:/^\d{14}$/,capture_sha256:/^[a-f0-9]{64}$/,witnessed_at:/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/}
function pickWitness(witness) {
  if(!witness||typeof witness!=='object'||Array.isArray(witness))return undefined
  const out=Object.fromEntries(Object.entries(WITNESS_FIELDS).filter(([key,pattern])=>typeof witness[key]==='string'&&pattern.test(witness[key])).map(([key])=>[key,witness[key]]))
  return out.method?out:undefined
}
const MAX_NOTE_CHARS=400
export function projectFinancialBundle(bundle) {
  validateFinancialBundle(bundle)
  const documents=new Map(bundle.documents.map(document=>[document.document_version_id,document]))
  const allows=(id,field)=>documents.get(id)?.allowed_display?.includes(field)===true
  const projected={schema_version:FINANCIAL_SCHEMA,company:pick(bundle.company,['company_id','legal_name','identifiers','securities']),run:pick(bundle.run,['run_id','as_of','as_of_mode','created_at','status','input_manifest_sha256','transform_version','model_version','prompt_version']),periods:bundle.periods.map(row=>pick(row,['period_id','fiscal_year','fiscal_quarter','label_as_reported','start_date','end_date','days','week_basis','period_kind','consolidation_scope'])),documents:bundle.documents.map(row=>({...pick(row,sourceFields),...(pickWitness(row.version_witness)?{version_witness:pickWitness(row.version_witness)}:{}),rights_policy:typeof row.rights_policy==='object'&&row.rights_policy!==null?pick(row.rights_policy,['status','policy_id','max_quote_chars','permitted_short_quote_words','license_url']):row.rights_policy??null})),facts:bundle.facts.filter(row=>allows(row.source_document_version,'facts')).map(row=>pick(row,['fact_id','company_id','period_id','concept','metric_definition_version','raw_value','numeric_decimal','null_reason','currency','scale','unit','accounting_basis','consolidation_scope','dimensions','period_kind','context_id','decimals','source_document_version','locator','published_at','published_precision','restated_as_of','revision_reason','derived_from','formula_version','formula_precision','share_basis','recast_version','reconciliation_note'])),claims:[],targets:[],outcomes:[],changes:[],assessments:[],coverage:bundle.coverage.map(row=>pick(row,['company_id','period_id','required_material_type','status','fetch_status','read_status','review_status','read_spans','total_spans','excluded_reason','gap_impact','document_version_ids'])),projection_notes:[]}
  for(const row of projected.facts)if(has(row,'reconciliation_note')&&(typeof row.reconciliation_note!=='string'||row.reconciliation_note.length>MAX_NOTE_CHARS)){delete row.reconciliation_note;projected.projection_notes.push({fact_id:row.fact_id,code:'reconciliation_note_too_long'})}
  const quoteUsage=new Map()
  for(const claim of bundle.claims||[]){const refs=claim.evidence_refs||[];if(!refs.length||!refs.every(ref=>allows(ref.document_version_id,'paraphrase')))continue
    const row=pick(claim,['claim_id','claim_version_id','company_id','period_id','section_kind','topic','claim_kind','statement_at','period_referred_to','speaker','scope','paraphrase','conditions','modality','review_status'])
    row.evidence_refs=refs.map(ref=>{const out=pick(ref,['evidence_id','document_version_id','segment_ids','locator','role','support_scope','limitations','quote_match_status']);const doc=documents.get(ref.document_version_id),charLimit=doc.rights_policy?.max_quote_chars,wordLimit=doc.permitted_short_quote_words??doc.rights_policy?.permitted_short_quote_words??25,quote=ref.exact_quote,words=typeof quote==='string'?(quote.match(/[\u3400-\u9fff]|[^\s\u3400-\u9fff]+/gu)||[]).length:0,used=quoteUsage.get(ref.document_version_id)||0
      const allowed=allows(ref.document_version_id,'short_quote')&&ref.quote_match_status==='exact'&&typeof quote==='string'&&isHash(ref.quote_sha256)&&Number.isInteger(wordLimit)&&wordLimit>=0&&used+words<=wordLimit&&(charLimit==null||Number.isInteger(charLimit)&&charLimit>=0&&quote.length<=charLimit)
      if(allowed){Object.assign(out,pick(ref,['exact_quote','quote_sha256']));quoteUsage.set(ref.document_version_id,used+words)}else if(quote!=null)projected.projection_notes.push({document_version_id:ref.document_version_id,code:allows(ref.document_version_id,'short_quote')&&used+words>wordLimit?'quote_word_budget_exceeded':'quote_not_allowed'})
      return out});projected.claims.push(row)}
  const claims=new Set(projected.claims.map(row=>row.claim_version_id));projected.targets=(bundle.targets||[]).filter(row=>claims.has(row.origin_claim_version_id)).map(row=>pick(row,['target_id','origin_claim_version_id','kpi','concept','metric_definition_version','comparator','value','minimum','maximum','unit','currency','target_period','original_deadline','deadline_precision','conditions','target_kind','uncertainty','interpretation','superseding_target_id']))
  const targets=new Set(projected.targets.map(row=>row.target_id)),facts=new Set(projected.facts.map(row=>row.fact_id));projected.outcomes=(bundle.outcomes||[]).filter(row=>targets.has(row.target_id)&&(row.eligible_fact_ids||[]).every(id=>facts.has(id))).map(row=>pick(row,['outcome_id','target_id','evaluation_as_of','eligible_fact_ids','comparison_formula','comparable','status','reason','comparison_result','actual_decimal','difference_from_midpoint','gap_above_upper','prediction_validation','gap','tolerance','reviewer','version','supersedes','evidence_claim_version_ids']))
  // Keep every required evidence ID: a hidden claim must hold the outcome, not be silently dropped.
  for(const row of projected.outcomes)if((row.evidence_claim_version_ids||[]).some(id=>!claims.has(id)))projected.projection_notes.push({outcome_id:row.outcome_id,code:'outcome_evidence_not_in_projection'})
  for(const change of bundle.changes||[]){const before=change.before_claim_version_id??change.before_claim_version_ids?.[0],after=change.after_claim_version_id??change.after_claim_version_ids?.[0];if(change.company_id&&change.company_id!==bundle.company.company_id||!claims.has(before)||!claims.has(after))continue
    // Author-written explanation fields are bounded prose, never raw source text.
    const row=pick(change,['change_id','company_id','period_id','topic','observed_at','before_claim_version_id','after_claim_version_id','before_claim_version_ids','after_claim_version_ids','change_type','metric_alignment','potential_contradiction','summary','management_explanation','analyst_explanation','counterevidence_summary','alternative_hypothesis','follow_up','gap','reason','review_status'])
    const safeRefs=refs=>(refs||[]).flatMap(ref=>typeof ref==='string'?claims.has(ref)||facts.has(ref)||documents.has(ref)?[ref]:[]:ref&&typeof ref==='object'&&((ref.claim_version_id&&claims.has(ref.claim_version_id))||(ref.fact_id&&facts.has(ref.fact_id))||(ref.document_version_id&&documents.has(ref.document_version_id)))?[pick(ref,['claim_version_id','fact_id','document_version_id','segment_ids','locator'])]:[])
    row.support=safeRefs(change.support);row.counterevidence=safeRefs(change.counterevidence)
    // Mechanical alignment creates a candidate. A reviewed decision must remain
    // pinned to an independent, scoped semantic receipt.
    const receipt=change.review_receipt,accepted=change.author_id&&receipt?.decision==='accepted'&&receipt.scope?.includes('semantic')&&receipt.reviewer_id&&receipt.reviewer_id!==change.author_id&&receipt.reviewed_at&&receipt.input_manifest_sha256===bundle.run.input_manifest_sha256&&isHash(receipt.input_manifest_sha256)
    row.review_status=accepted?'reviewed':'draft';row.decision=accepted?(change.decision||'unresolved'):'unresolved';if(accepted)row.review_receipt=pick(receipt,['reviewer_id','decision','scope','input_manifest_sha256','evidence_refs','reviewed_at']);projected.changes.push(row)}
  const evidenceIDs=new Set(projected.claims.flatMap(row=>row.evidence_refs.map(ref=>ref.evidence_id).filter(Boolean))),visibleDocs=new Set(bundle.documents.filter(row=>allows(row.document_version_id,'facts')||allows(row.document_version_id,'paraphrase')).map(row=>row.document_version_id))
  for(const assessment of bundle.assessments||[]){if(assessment.company_id&&assessment.company_id!==bundle.company.company_id)continue
    const refs=assessment.accepted_evidence_refs||[],safeRef=ref=>typeof ref==='string'&&(evidenceIDs.has(ref)||visibleDocs.has(ref)||facts.has(ref)||claims.has(ref))
    if(!refs.length||!refs.every(safeRef)){projected.projection_notes.push({assessment_id:assessment.assessment_id,code:'assessment_evidence_not_in_projection'});continue}
    const row=pick(assessment,['assessment_id','version','company_id','author_id','analyst','created_at','information_cutoff','report_pin','run_pin','accepted_evidence_refs','judgment','causal_explanation','strongest_alternative','counterevidence_gap','unidentified_items','follow_up_questions','judgment_change','reason','review_status','supersedes'])
    const review=validateAssessmentReview(assessment,assessment.review_receipt,{input_manifest_sha256:bundle.run.input_manifest_sha256});row.review_status=review.valid?'reviewed':'draft';if(review.valid)row.review_receipt=pick(assessment.review_receipt,['reviewer_id','decision','scope','input_manifest_sha256','evidence_refs','reviewed_at']);projected.assessments.push(row)}
  // Raw text, segments, ASR audio, arbitrary HTML and private notes are never
  // serialized, even if a caller labels them allowed. Display caps are UI rules.
  return projected
}
export async function verifyManifest(payload,manifest,{company_id=null}={}) {
  const errors=[]
  if(manifest.schema_version!==FINANCIAL_SCHEMA)errors.push('manifest_schema_mismatch')
  if(company_id&&manifest.company_id!==company_id||payload.company?.company_id!==manifest.company_id)errors.push('manifest_company_mismatch')
  if(!isHash(manifest.payload_sha256)||await financialDigest(payload)!==manifest.payload_sha256)errors.push('payload_hash_mismatch')
  const versions=new Map((payload.documents||[]).map(document=>[document.document_version_id,document]))
  const seen=new Set();if(!Array.isArray(manifest.documents))errors.push('manifest_documents_required');for(const entry of Array.isArray(manifest.documents)?manifest.documents:[]){const document=versions.get(entry.document_version_id);if(seen.has(entry.document_version_id))errors.push('duplicate_manifest_document');seen.add(entry.document_version_id);if(!document)errors.push('manifest_document_missing');else if(entry.raw_sha256!==document.raw_sha256||entry.text_sha256!==document.text_sha256)errors.push('source_hash_mismatch')}
  if(seen.size!==versions.size)errors.push('incomplete_source_manifest')
  return {valid:errors.length===0,ok:errors.length===0,errors}
}
export async function buildCacheKey({document_version_id,document_hash,parser_version,model_version,prompt_version,transform_version,settings={}}) {
  if(!document_version_id||!isHash(document_hash)||![parser_version,model_version,prompt_version,transform_version].every(value=>typeof value==='string'&&value))fail('incomplete_cache_identity')
  return financialDigest({document_version_id,document_hash,parser_version,model_version,prompt_version,transform_version,settings})
}
export function dependencyInvalidations(nodes,changed_ids) {
  const ids=new Set(nodes.map(node=>node.id));if(ids.size!==nodes.length)fail('duplicate_dependency_id')
  const invalid=new Set(changed_ids),reasons=new Map(changed_ids.map(id=>[id,['changed_input']]))
  let changed=true;while(changed){changed=false;for(const node of nodes){const parents=(node.depends_on||[]).filter(id=>invalid.has(id));if(parents.length&&!invalid.has(node.id)){invalid.add(node.id);reasons.set(node.id,parents);changed=true}}}
  return {invalidated:nodes.filter(node=>invalid.has(node.id)).map(node=>({id:node.id,reasons:reasons.get(node.id)})),preserved:nodes.filter(node=>!invalid.has(node.id)).map(node=>node.id),changed_ids:[...changed_ids]}
}
export function budgetStatus(receipts,{token_limit,cost_limit='0',next_tokens=0,next_cost='0'}={}) {
  if(!Number.isSafeInteger(token_limit)||token_limit<0||!Number.isSafeInteger(next_tokens)||next_tokens<0||decimalCompare(cost_limit,'0')<0||decimalCompare(next_cost,'0')<0)fail('invalid_budget')
  let tokens=0,cost='0',unknown=false
  for(const receipt of receipts){if(receipt.tokens==null)unknown=true;else{if(!Number.isSafeInteger(receipt.tokens)||receipt.tokens<0)fail('invalid_usage');tokens+=receipt.tokens}if(receipt.cost==null)unknown=true;else{if(decimalCompare(receipt.cost,'0')<0)fail('invalid_usage');cost=decimalAdd(cost,receipt.cost)}}
  if(!Number.isSafeInteger(tokens))fail('token_total_overflow')
  const projected_tokens=tokens+next_tokens,projected_cost=decimalAdd(cost,next_cost),stop=projected_tokens>=token_limit||decimalCompare(projected_cost,cost_limit)>=0&&(decimalCompare(projected_cost,'0')>0||decimalCompare(cost_limit,'0')>0)
  const warn=!stop&&(token_limit>0&&tokens*5>=token_limit*4||decimalCompare(cost_limit,'0')>0&&decimalCompare(cost,decimalMultiply(cost_limit,'0.8'))>=0)
  return {status:stop?'stop':unknown?'unknown':warn?'warn':'ok',tokens:unknown?null:tokens,cost:unknown?null:cost,known_tokens:tokens,known_cost:cost,projected_tokens,projected_cost,unknown_usage:unknown,receipt_count:receipts.length,preserve_partial:stop||unknown,may_continue:!stop&&!unknown}
}
