// Local, deterministic runner. No provider, network, scheduler or credentials.
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir, open, unlink, rename, stat } from 'node:fs/promises'
import { resolve, join, relative, isAbsolute } from 'node:path'

export const RUN_SCHEMA = 'financial-research-run/1'
export const RUN_STAGES = Object.freeze(['validate_input', 'normalize_check_formula', 'evidence_review_gate', 'projection_export'])
export const RUN_STATUSES = Object.freeze(['queued', 'running', 'awaiting_review', 'partial', 'blocked', 'failed', 'cancelled', 'accepted'])
const DEFAULTS = Object.freeze({ parser_version: 'local-bundle/1', schema_version: 'financial-research/1', transform_version: 'local-run/1', model_version: 'none', prompt_version: 'none', author_id: 'local-author', token_limit: 261600, paid_budget: '0', max_retries: 2, max_input_bytes: 20_000_000, max_documents: 128, max_facts: 20000, usage: [] })
const hashBytes = value => createHash('sha256').update(value).digest('hex')
const error = (code, details = {}) => Object.assign(new Error(code), { code, ...details })
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, structuredClone(value[key])]))

export function canonicalJSON(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(canonicalJSON).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJSON(value[key])).join(',') + '}'
  throw error('non_json_value')
}
export const contentHash = value => hashBytes(canonicalJSON(value))

export function normalizeRunConfig(config = {}) {
  const result = { ...structuredClone(DEFAULTS), ...structuredClone(config) }
  for (const key of Object.keys(result)) if (!Object.hasOwn(DEFAULTS, key)) throw error('unknown_run_config:' + key)
  for (const key of ['parser_version', 'schema_version', 'transform_version', 'model_version', 'prompt_version', 'author_id']) if (typeof result[key] !== 'string' || !result[key]) throw error('invalid_run_config:' + key)
  if (result.schema_version !== 'financial-research/1' || result.model_version !== 'none' || result.prompt_version !== 'none') throw error('local_only_configuration')
  if (result.paid_budget !== '0') throw error('paid_budget_not_authorized')
  for (const key of ['token_limit', 'max_retries', 'max_input_bytes', 'max_documents', 'max_facts']) if (!Number.isSafeInteger(result[key]) || result[key] < (key === 'max_retries' ? 0 : 1)) throw error('invalid_run_config:' + key)
  if (result.max_retries > 2) throw error('retry_limit_exceeded')
  if (!Array.isArray(result.usage)) throw error('invalid_usage')
  usageSummary(result.usage, result.token_limit)
  return result
}

// Every attempt / worker is a separate receipt. Cached, output, tool and retry
// usage must be included by the caller. Unknown subscription cost stays null.
export function usageSummary(receipts, tokenLimit) {
  let knownTokens = 0, unknownTokens = false, unknownCost = false
  let costMicros = 0n
  const seen = new Set()
  for (const row of receipts) {
    if (!row || typeof row !== 'object' || !row.receipt_id || seen.has(row.receipt_id)) throw error('duplicate_or_missing_usage_receipt')
    seen.add(row.receipt_id)
    const fields = ['uncached_input_tokens', 'cached_input_tokens', 'output_tokens', 'tool_tokens']
    const tokens = Object.hasOwn(row, 'tokens') ? row.tokens : fields.every(key => row[key] != null) ? fields.reduce((sum, key) => sum + row[key], 0) : null
    for (const key of [...fields, 'tokens']) if (row[key] != null && (!Number.isSafeInteger(row[key]) || row[key] < 0)) throw error('invalid_usage_tokens')
    if (tokens != null && fields.every(key => row[key] != null) && fields.reduce((sum,key) => sum + row[key],0) !== tokens) throw error('usage_total_mismatch')
    if (tokens == null) unknownTokens = true
    else knownTokens += tokens
    if (row.cost_usd == null) unknownCost = true
    else {
      if (typeof row.cost_usd !== 'string' || !/^\d+(?:\.\d{1,6})?$/.test(row.cost_usd)) throw error('invalid_usage_cost')
      const [whole, fraction = ''] = row.cost_usd.split('.')
      costMicros += BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'))
    }
  }
  if (!Number.isSafeInteger(knownTokens)) throw error('token_total_overflow')
  const stopped = knownTokens >= tokenLimit || costMicros > 0n
  const warning = !stopped && knownTokens >= tokenLimit * .8
  const exactCost = String(costMicros / 1000000n) + '.' + String(costMicros % 1000000n).padStart(6,'0')
  return { tokens: unknownTokens ? null : knownTokens, known_tokens: knownTokens, cost_usd: unknownCost ? null : exactCost, unknown_tokens: unknownTokens, unknown_cost: unknownCost, status: stopped ? 'stop' : warning ? 'warn' : unknownTokens || unknownCost ? 'unknown' : 'ok', paid_budget: '0', receipt_count: receipts.length, provider_calls: 0 }
}

async function jsonFile(path) { return JSON.parse(await readFile(path, 'utf8')) }
async function immutableJSON(path, value) { await writeFile(path, canonicalJSON(value) + '\n', { flag: 'wx', mode: 0o600 }); return path }
async function exists(path) { try { await stat(path); return true } catch (cause) { if (cause.code === 'ENOENT') return false; throw cause } }
async function loadInput(inputPath, config) {
  const info = await stat(inputPath)
  if (!info.isFile() || info.size > config.max_input_bytes) throw error('input_size_limit')
  const bytes = await readFile(inputPath)
  if (bytes.length > config.max_input_bytes) throw error('input_size_limit')
  let bundle
  try { bundle = JSON.parse(bytes) } catch { throw error('invalid_input_json') }
  if (!Array.isArray(bundle.documents) || bundle.documents.length > config.max_documents || !Array.isArray(bundle.facts) || bundle.facts.length > config.max_facts) throw error('input_entity_limit')
  return { bundle, bytes, sha256: hashBytes(bytes) }
}

export async function createResearchRun({ inputPath, outputRoot, config = {}, now = new Date().toISOString() }) {
  if (!inputPath || !outputRoot) throw error('explicit_input_and_output_required')
  const settings = normalizeRunConfig(config), input = await loadInput(inputPath, settings)
  const runId = 'run-' + randomUUID(), runDir = join(resolve(outputRoot), runId)
  await mkdir(runDir, { recursive: true, mode: 0o700 })
  await mkdir(join(runDir, 'receipts'), { mode: 0o700 })
  await mkdir(join(runDir, 'artifacts'), { mode: 0o700 })
  const manifest = { schema_version: RUN_SCHEMA, run_id: runId, company_id: input.bundle.company?.company_id ?? null, as_of: input.bundle.run?.as_of ?? null, created_at: now, input_manifest_sha256: input.sha256, input_content_sha256: contentHash(input.bundle), config_sha256: contentHash(settings), config: settings, versions: pick(settings, ['parser_version', 'schema_version', 'transform_version', 'model_version', 'prompt_version']), source_manifest: (input.bundle.documents || []).map(row => pick(row, ['document_version_id', 'source_id', 'raw_sha256', 'text_sha256', 'extraction_version'])), external_providers: [] }
  await writeFile(join(runDir, 'input.json'), input.bytes, { flag: 'wx', mode: 0o600 })
  await immutableJSON(join(runDir, 'manifest.json'), manifest)
  await appendReceipt(runDir, { kind: 'status', status: 'queued', created_at: now, input_manifest_sha256: input.sha256, manifest_sha256: contentHash(manifest), config_sha256: manifest.config_sha256 })
  return { run_id: runId, run_dir: runDir, manifest, status: 'queued' }
}

async function appendReceipt(runDir, content) {
  const previous = await receiptChain(runDir)
  const body = { schema_version: RUN_SCHEMA, sequence: previous.length + 1, previous_sha256: previous.at(-1)?.receipt_sha256 ?? null, ...content }
  const receipt = { ...body, receipt_sha256: contentHash(body) }
  const name = String(receipt.sequence).padStart(6, '0') + '-' + receipt.receipt_sha256 + '.json'
  await immutableJSON(join(runDir, 'receipts', name), receipt)
  return receipt
}

async function receiptChain(runDir) {
  const names = (await readdir(join(runDir, 'receipts'))).filter(name => name.endsWith('.json')).sort(), receipts = []
  if (names.length > 10000) throw error('checkpoint_receipt_limit')
  for (const name of names) {
    const receipt = await jsonFile(join(runDir, 'receipts', name)), { receipt_sha256, ...body } = receipt
    if (receipt.sequence !== receipts.length + 1 || receipt.previous_sha256 !== (receipts.at(-1)?.receipt_sha256 ?? null) || contentHash(body) !== receipt_sha256 || name !== String(receipt.sequence).padStart(6, '0') + '-' + receipt_sha256 + '.json') throw error('checkpoint_receipt_integrity_failure')
    receipts.push(receipt)
  }
  return receipts
}

export async function readResearchRun(runDir) {
  runDir = resolve(runDir)
  const manifest = await jsonFile(join(runDir, 'manifest.json')), receipts = await receiptChain(runDir)
  if (manifest.schema_version !== RUN_SCHEMA || contentHash(manifest.config) !== manifest.config_sha256) throw error('checkpoint_manifest_integrity_failure')
  if (receipts[0]?.manifest_sha256 !== contentHash(manifest)) throw error('checkpoint_manifest_integrity_failure')
  const bytes = await readFile(join(runDir, 'input.json'))
  if (hashBytes(bytes) !== manifest.input_manifest_sha256 || contentHash(JSON.parse(bytes)) !== manifest.input_content_sha256) throw error('checkpoint_input_integrity_failure')
  for (const receipt of receipts) if (receipt.artifact) {
    const artifact = receipt.artifact
    if (!/^artifacts\/[a-f0-9]{64}\.json$/.test(artifact.path)) throw error('checkpoint_artifact_path_invalid')
    if (hashBytes(await readFile(join(runDir, artifact.path))) !== artifact.sha256) throw error('checkpoint_artifact_integrity_failure')
  }
  const status = receipts.filter(row => row.kind === 'status').at(-1)?.status ?? 'queued'
  return { run_dir: runDir, manifest, receipts, status, completed_stages: receipts.filter(row => row.kind === 'stage' && row.status === 'complete').map(row => row.stage), usage: usageSummary(manifest.config.usage, manifest.config.token_limit) }
}

async function artifact(runDir, value) {
  const bytes = canonicalJSON(value) + '\n', sha256 = hashBytes(bytes), path = 'artifacts/' + sha256 + '.json'
  try { await writeFile(join(runDir, path), bytes, { flag: 'wx', mode: 0o600 }) } catch (cause) { if (cause.code !== 'EEXIST' || await readFile(join(runDir, path), 'utf8') !== bytes) throw cause }
  return { path, sha256, content_sha256: contentHash(value) }
}

export async function requestRunCancellation(runDir, { reason = 'requested', now = new Date().toISOString() } = {}) {
  const state = await readResearchRun(runDir)
  if (state.status === 'accepted') throw error('accepted_run_is_terminal')
  const request = { run_id: state.manifest.run_id, reason, created_at: now }
  try { await immutableJSON(join(resolve(runDir), 'cancel-request.json'), request) } catch (cause) { if (cause.code !== 'EEXIST') throw cause }
  return request
}

function transient(cause) { return cause?.transient === true && ![401,403].includes(cause.status) && ['ETIMEDOUT', 'ECONNRESET', 'EAGAIN', 'TRANSIENT'].includes(cause.code) || cause?.transient === true && [429,500,502,503,504].includes(cause.status) }

async function operationWithRetries(runDir, stage, operation, settings, context) {
  const prior = (await receiptChain(runDir)).filter(row => row.kind === 'attempt_error' && row.stage === stage)
  let transientFailures = prior.filter(row => row.transient).length
  if (transientFailures > settings.max_retries) throw error('retry_budget_exhausted')
  for (let attempt = prior.length; ; attempt++) {
    if (context.signal?.aborted || await exists(join(runDir, 'cancel-request.json'))) throw error('run_cancelled')
    try { return await operation({ ...context, attempt }) }
    catch (cause) {
      await appendReceipt(runDir, { kind: 'attempt_error', stage, attempt, code: cause.code || cause.message || 'operation_failed', status_code: cause.status ?? null, transient: transient(cause), created_at: new Date().toISOString() })
      if (context.signal?.aborted || await exists(join(runDir, 'cancel-request.json'))) throw error('run_cancelled')
      if (!transient(cause) || ++transientFailures > settings.max_retries) throw cause
    }
  }
}

export function validateReviewReceipts(receipts, { manifest, content_sha256, required_scope, now = new Date().toISOString() }) {
  if (!Array.isArray(receipts) || receipts.length > 128) throw error('invalid_review_receipts')
  const valid = [], rejected = [], scopes = new Set()
  for (const receipt of receipts) {
    if (!receipt || typeof receipt !== 'object') { rejected.push({ receipt_sha256: contentHash(receipt), reasons: ['invalid_review_receipt'] }); continue }
    const reasons = []
    if (!receipt?.reviewer_id || receipt.reviewer_id === manifest.config.author_id || receipt.author_id !== manifest.config.author_id) reasons.push('independent_reviewer_required')
    if (receipt.input_manifest_sha256 !== manifest.input_manifest_sha256 || receipt.content_sha256 !== content_sha256 || !isHash(receipt.content_sha256)) reasons.push('review_pin_mismatch')
    if (!receipt.reviewed_at || !Number.isFinite(Date.parse(receipt.reviewed_at)) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.reviewed_at) || Date.parse(receipt.reviewed_at) < Date.parse(manifest.created_at) || Date.parse(receipt.reviewed_at) > Date.parse(now)) reasons.push('review_time_invalid')
    if (receipt.decision !== 'accepted' || !Array.isArray(receipt.scope) || receipt.scope.some(scope => !required_scope.includes(scope))) reasons.push('review_scope_invalid')
    if (reasons.length) rejected.push({ receipt_sha256: contentHash(receipt), reasons })
    else { valid.push(structuredClone(receipt)); receipt.scope.forEach(scope => scopes.add(scope)) }
  }
  return { valid: required_scope.every(scope => scopes.has(scope)), accepted: valid, rejected, missing_scope: required_scope.filter(scope => !scopes.has(scope)) }
}

// Independent semantic receipts authorize one named assessment/change each. They never
// enter the gate scope and never mutate the pinned input; they are applied to the projection.
const SEMANTIC_ITEM_DECISIONS = ['accepted', 'rejected', 'unresolved']
export function validateSemanticReceipts(receipts, { manifest, content_sha256, bundle, now = new Date().toISOString() }) {
  const accepted = [], rejected = []
  for (const receipt of receipts) {
    const reasons = []
    if (!receipt || typeof receipt !== 'object') { rejected.push({ receipt_sha256: contentHash(receipt ?? null), reasons: ['invalid_semantic_receipt'] }); continue }
    if (!receipt.reviewer_id || receipt.reviewer_id === manifest.config.author_id || receipt.author_id !== manifest.config.author_id) reasons.push('independent_reviewer_required')
    if (receipt.input_manifest_sha256 !== manifest.input_manifest_sha256 || receipt.content_sha256 !== content_sha256) reasons.push('review_pin_mismatch')
    if (!receipt.reviewed_at || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(receipt.reviewed_at) || !Number.isFinite(Date.parse(receipt.reviewed_at)) || Date.parse(receipt.reviewed_at) < Date.parse(manifest.created_at) || Date.parse(receipt.reviewed_at) > Date.parse(now)) reasons.push('review_time_invalid')
    if (receipt.decision !== 'accepted' || !Array.isArray(receipt.scope) || receipt.scope.length !== 1 || receipt.scope[0] !== 'semantic') reasons.push('review_scope_invalid')
    if (receipt.item_decision != null && !SEMANTIC_ITEM_DECISIONS.includes(receipt.item_decision)) reasons.push('item_decision_invalid')
    const kind = receipt.target?.kind, id = receipt.target?.id, refs = Array.isArray(receipt.evidence_refs) ? receipt.evidence_refs : []
    const item = kind === 'assessment' ? (bundle.assessments || []).find(row => row.assessment_id === id) : kind === 'change' ? (bundle.changes || []).find(row => row.change_id === id) : null
    if (!item) reasons.push('review_target_not_found')
    else {
      const required = kind === 'assessment' ? item.accepted_evidence_refs || [] : [item.before_claim_version_id, item.after_claim_version_id].filter(Boolean)
      if (!required.length || required.some(ref => !refs.includes(ref))) reasons.push('review_evidence_scope_incomplete')
    }
    if (reasons.length) rejected.push({ receipt_sha256: contentHash(receipt), target: receipt.target ?? null, reasons })
    else accepted.push(structuredClone(receipt))
  }
  return { accepted, rejected }
}
function applySemanticReceipts(bundle, receipts) {
  const pickReceipt = receipt => pick(receipt, ['reviewer_id', 'decision', 'scope', 'input_manifest_sha256', 'evidence_refs', 'reviewed_at'])
  const forItem = (kind, id) => receipts.find(receipt => receipt.target.kind === kind && receipt.target.id === id)
  return {
    ...bundle,
    assessments: (bundle.assessments || []).map(row => { const receipt = forItem('assessment', row.assessment_id); return receipt ? { ...row, review_receipt: pickReceipt(receipt) } : row }),
    changes: (bundle.changes || []).map(row => { const receipt = forItem('change', row.change_id); return receipt ? { ...row, review_receipt: pickReceipt(receipt), ...(receipt.item_decision ? { decision: receipt.item_decision } : {}) } : row })
  }
}

async function checkEvidence(bundle, domain) {
  const segments = new Map([...(bundle.segments || bundle.document_segments || []),...(bundle.quote_segments || [])].map(row => [row.segment_id, row])), documents = new Map(bundle.documents.map(row => [row.document_version_id, row])), results = []
  for (const claim of bundle.claims || []) {
    if (!claim.evidence_refs?.length) results.push({ claim_version_id: claim.claim_version_id, valid: false, reasons: ['claim_evidence_missing'] })
    for (const ref of claim.evidence_refs || []) {
      const document = documents.get(ref.document_version_id)
      // A paraphrase-only source locator is eligible for semantic review. It is
      // never reported as an exact quote or as independently read by this runner.
      if (ref.exact_quote == null) {
        const reasons=[]
        if (!document || !isHash(document.raw_sha256 || document.text_sha256)) reasons.push('source_identity_hash_missing')
        if (!ref.locator || typeof ref.locator !== 'object' || !Object.values(ref.locator).some(value=>value!=null&&value!=='')) reasons.push('source_locator_missing')
        if (!bundle.coverage.some(cell=>(cell.document_version_ids||[]).includes(ref.document_version_id)&&cell.read_spans>0&&['partial_read','full_text','reviewed'].includes(cell.status))) reasons.push('source_read_receipt_missing')
        if (ref.quote_sha256 != null) reasons.push('quote_hash_without_quote')
        results.push({claim_version_id:claim.claim_version_id,document_version_id:ref.document_version_id,evidence_sha256:contentHash(ref),valid:reasons.length===0,reasons,mechanical_status:reasons.length?'blocked':'source_locator_present',quote_match_status:'not_applicable',semantic_support:'requires_independent_review'})
        continue
      }
      const candidates = (ref.segment_ids || []).map(id => segments.get(id)).filter(Boolean)
      if (!candidates.length) results.push({ claim_version_id: claim.claim_version_id, valid: false, reasons: ['evidence_segment_missing'] })
      else {
        const checks = await Promise.all(candidates.map(async segment => {
          const embeddedText = typeof document?.extracted_text === 'string'
          const sourceCheck = segment.source_check
          const provenanceReasons=[]
          if (!embeddedText && (typeof segment.text!=='string' || !sourceCheck || !isHash(document?.text_sha256) || sourceCheck.document_text_sha256!==document.text_sha256 || sourceCheck.quote_sha256!==hashBytes(segment.text) || sourceCheck.exact_substring_verified!==true || !sourceCheck.validator_version || !sourceCheck.verified_at || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(sourceCheck.verified_at) || !Number.isFinite(Date.parse(sourceCheck.verified_at)))) provenanceReasons.push('bounded_quote_source_check_missing_or_mismatched')
          const checked = await domain.validateEvidenceQuote(ref,segment,{document:embeddedText?document:null})
          return {...checked,valid:checked.valid&&provenanceReasons.length===0,reasons:[...checked.reasons,...provenanceReasons],source_provenance:embeddedText?'embedded_source_text':'caller_supplied_bounded_source_check',full_text_hash_verified:embeddedText}
        }))
        const matched = checks.find(row => row.valid)
        results.push({ claim_version_id: claim.claim_version_id,document_version_id:ref.document_version_id,evidence_sha256:contentHash(ref), valid: Boolean(matched), reasons: matched ? [] : [...new Set(checks.flatMap(row => row.reasons))], quote_match_status: matched ? 'exact' : 'blocked', semantic_support: 'requires_independent_review',source_provenance:matched?.source_provenance??null,full_text_hash_verified:matched?.full_text_hash_verified??false })
      }
    }
  }
  return { valid: results.every(row => row.valid), checks: results, semantic_support: 'requires_independent_review', source_read_verification: 'provided_coverage_only', runner_read_scope: 'local_input_bundle', full_read_document_ids: [...new Set(bundle.coverage.filter(row => ['full_text','reviewed'].includes(row.status) && row.total_spans != null && row.read_spans === row.total_spans).flatMap(row => row.document_version_ids || []))], coverage_gaps: bundle.coverage.filter(row => !['full_text','reviewed'].includes(row.status)).map(row => pick(row, ['period_id','required_material_type','status','gap_impact'])) }
}

async function checkFormulas(bundle, domain) {
  const facts = new Map(bundle.facts.map(row => [row.fact_id, row])), checks = []
  for (const fact of bundle.facts.filter(row => row.derived_from?.length)) {
    const parents = fact.derived_from.map(id => facts.get(id))
    let derived
    if (parents.some(row => !row)) derived = { comparable: false, reasons: ['formula_parent_missing'] }
    else if (fact.formula_version === 'fy-minus-ytd/1' && parents.length === 2) derived = domain.deriveQ4(...parents)
    else if (fact.formula_version === 'four-contiguous-quarters/1') derived = domain.deriveTTM(parents)
    else if (fact.formula_version === 'ratio/1' && parents.length === 2) derived = domain.computeRatio(domain.decimalScale(parents[0].numeric_decimal, parents[0].scale), domain.decimalScale(parents[1].numeric_decimal, parents[1].scale), { percent: fact.unit === 'percent', precision: fact.formula_precision ?? 12 })
    else if (fact.formula_version === 'sum/1' && parents.length > 0) {
      const comparable=fact.unit==='currency'&&fact.period_kind==='duration'&&fact.additive===true&&parents.every(row=>row.additive===true&&row.numeric_decimal!=null&&['company_id','period_id','currency','unit','accounting_basis','consolidation_scope','period_kind'].every(key=>(row[key]??null)===(fact[key]??null)))
      derived=comparable?{numeric_decimal:parents.reduce((sum,row)=>domain.decimalAdd(sum,domain.decimalScale(row.numeric_decimal,row.scale)),'0'),comparable:true}:{comparable:false,reasons:['sum_inputs_not_comparable']}
    }
    else derived = { comparable: false, reasons: ['formula_not_supported'] }
    const matches = derived.comparable !== false && derived.numeric_decimal != null && fact.numeric_decimal != null && domain.decimalCompare(domain.decimalScale(fact.numeric_decimal, fact.scale), derived.numeric_decimal) === 0
    checks.push({ fact_id: fact.fact_id, formula_version: fact.formula_version ?? null, valid: matches, reported: fact.numeric_decimal, computed: derived.numeric_decimal ?? null, reasons: matches ? [] : derived.reasons || ['formula_result_mismatch'] })
  }
  return { valid: checks.every(row => row.valid), checks, deterministic_only: true }
}

async function acquireRunLock(lockPath) {
  try {
    const handle = await open(lockPath, 'wx', 0o600)
    await handle.writeFile(canonicalJSON({ pid: process.pid, created_at: new Date().toISOString() }))
    return handle
  } catch (cause) {
    if (cause.code !== 'EEXIST') throw cause
    const recoveryPath = lockPath + '.reclaim'
    let recovery
    try { recovery = await open(recoveryPath,'wx',0o600) } catch (reclaimError) { if (reclaimError.code === 'EEXIST') throw error('run_recovery_busy'); throw reclaimError }
    try {
      // Serializing recovery prevents two contenders from unlinking a new live
      // owner's lock after both observed the same old dead owner.
      let old
      try { old = await jsonFile(lockPath) } catch { throw error('run_lock_needs_inspection') }
      if (!Number.isSafeInteger(old.pid) || old.pid < 1) throw error('run_lock_needs_inspection')
      try { process.kill(old.pid, 0); throw error('run_already_running') } catch (probe) { if (probe.code !== 'ESRCH') throw probe }
      await unlink(lockPath)
    } finally { await recovery.close(); await unlink(recoveryPath) }
    return acquireRunLock(lockPath)
  }
}

export async function executeResearchRun({ runDir, inputPath, config, reviewReceipts = [], operations = {}, domain, signal, resumeCancelled = false }) {
  runDir = resolve(runDir)
  const lockPath = join(runDir, '.runner.lock')
  let lock
  lock = await acquireRunLock(lockPath)
  try {
    let state = await readResearchRun(runDir)
    const settings = config == null ? state.manifest.config : normalizeRunConfig(config)
    if (contentHash(settings) !== state.manifest.config_sha256) throw error('resume_configuration_changed')
    if (inputPath && (await loadInput(inputPath, settings)).sha256 !== state.manifest.input_manifest_sha256) throw error('resume_input_changed')
    if (state.status === 'accepted' || state.status === 'blocked' || state.status === 'failed') return state
    if (state.status === 'cancelled' && !resumeCancelled) return state
    if (state.status === 'cancelled' && resumeCancelled) { await unlink(join(runDir, 'cancel-request.json')).catch(cause => { if (cause.code !== 'ENOENT') throw cause }); await appendReceipt(runDir, { kind: 'resume', from_status: 'cancelled', created_at: new Date().toISOString() }) }
    if (signal?.aborted || await exists(join(runDir, 'cancel-request.json'))) { await appendReceipt(runDir, { kind: 'status', status: 'cancelled', created_at: new Date().toISOString(), remaining_stages: RUN_STAGES.filter(stage => !state.completed_stages.includes(stage)) }); return readResearchRun(runDir) }
    if (state.usage.status === 'stop' || state.usage.unknown_tokens) { await appendReceipt(runDir, { kind: 'status', status: 'partial', reason: state.usage.status === 'stop' ? 'budget_hard_stop' : 'token_usage_unknown', usage: state.usage, created_at: new Date().toISOString(), remaining_stages: RUN_STAGES.filter(stage => !state.completed_stages.includes(stage)) }); return readResearchRun(runDir) }
    domain ||= await import('./financial-research.mjs')
    const bundle = JSON.parse(await readFile(join(runDir, 'input.json'), 'utf8'))
    await appendReceipt(runDir, { kind: 'status', status: 'running', usage: state.usage, created_at: new Date().toISOString() })
    for (const stage of RUN_STAGES) {
      state = await readResearchRun(runDir)
      if (state.completed_stages.includes(stage)) continue
      const context = { bundle: structuredClone(bundle), manifest: state.manifest, signal, run_dir: runDir }
      let output
      try {
        output = await operationWithRetries(runDir, stage, async args => {
          if (stage === 'validate_input') {
            const validated = domain.validateFinancialBundle(args.bundle, { now: new Date().toISOString() })
            if (!args.bundle.periods.length || !args.bundle.documents.length || !args.bundle.facts.length || !args.bundle.coverage.length) throw error('required_data_missing')
            return validated
          }
          if (stage === 'normalize_check_formula') {
            const sourceChecks = []
            for (const row of args.bundle.documents) {
              const suppliedText = typeof row.extracted_text === 'string'
              const match = suppliedText && row.text_sha256 != null ? hashBytes(row.extracted_text) === row.text_sha256 : null
              sourceChecks.push({ document_version_id: row.document_version_id, text_hash_verified: match, raw_hash_verified: null, raw_verification_reason: 'raw_bytes_not_supplied_to_local_runner' })
              if (match === false) throw error('source_text_hash_validation_failed', {details:sourceChecks})
            }
            const formulas = await checkFormulas(args.bundle, domain)
            if (!formulas.valid) throw error('formula_validation_failed', { details: formulas })
            const cacheKeys = await Promise.all(args.bundle.documents.filter(row => row.raw_sha256 || row.text_sha256).map(async row => ({ document_version_id: row.document_version_id, cache_key: await domain.buildCacheKey({ document_version_id: row.document_version_id, document_hash: row.raw_sha256 || row.text_sha256, parser_version: settings.parser_version, schema_version: settings.schema_version, model_version: settings.model_version, prompt_version: settings.prompt_version, transform_version: settings.transform_version, settings: { schema_version: settings.schema_version } }) })))
            return { normalized_bundle: args.bundle, source_checks: sourceChecks, formula_checks: formulas, cache_keys: cacheKeys, source_deduplication: domain.deduplicateSources(args.bundle.documents) }
          }
          if (stage === 'evidence_review_gate') {
            const evidence = await checkEvidence(args.bundle, domain)
            if (!evidence.valid) throw error('evidence_validation_failed', { details: evidence })
            const normalized = state.receipts.find(row => row.stage === 'normalize_check_formula' && row.status === 'complete').artifact
            const scope = ['evidence', 'formula', 'acceptance']
            const isSemantic = receipt => Array.isArray(receipt?.scope) && receipt.scope.includes('semantic')
            const review = validateReviewReceipts(reviewReceipts.filter(receipt => !isSemantic(receipt)), { manifest: state.manifest, content_sha256: normalized.content_sha256, required_scope: scope })
            if (!review.valid) throw error('awaiting_independent_review', { details: { review, evidence, review_pin: { input_manifest_sha256: state.manifest.input_manifest_sha256, content_sha256: normalized.content_sha256, author_id: settings.author_id, scope } } })
            const semantic_review = validateSemanticReceipts(reviewReceipts.filter(isSemantic), { manifest: state.manifest, content_sha256: normalized.content_sha256, bundle: args.bundle })
            return { evidence, review, semantic_review, semantic_verified: true, semantic_review_provenance: 'caller_supplied_independent_receipts', acceptance_authorized: true, normalized_content_sha256: normalized.content_sha256 }
          }
          const accepted = { ...args.bundle, run: { ...args.bundle.run, run_id: state.manifest.run_id, status: 'accepted', input_manifest_sha256: state.manifest.input_manifest_sha256, ...state.manifest.versions } }
          const gateReceipt=state.receipts.find(row=>row.stage==='evidence_review_gate'&&row.status==='complete')
          const gate=await jsonFile(join(runDir,gateReceipt.artifact.path))
          const evidenceChecks=new Map(gate.evidence.checks.filter(row=>row.valid).map(row=>[row.evidence_sha256,row]))
          // Update only this accepted reading projection using actual mechanical
          // results. The source input and its earlier check labels remain pinned.
          accepted.claims=(args.bundle.claims||[]).map(claim=>({...claim,evidence_refs:(claim.evidence_refs||[]).map(ref=>{
            const checked=evidenceChecks.get(contentHash(ref))
            if(!checked)throw error('accepted_evidence_check_missing')
            return {...ref,quote_match_status:checked.quote_match_status}
          })}))
          return { projection: domain.projectFinancialBundle(applySemanticReceipts(accepted, gate.semantic_review?.accepted || [])) }
        }, settings, context)
        // Injected operations can fail or interrupt a stage; they cannot replace
        // the deterministic validation or independently authorize acceptance.
        if (operations[stage]) await operationWithRetries(runDir, stage, operations[stage], settings, { ...context, output: structuredClone(output) })
        if (signal?.aborted || await exists(join(runDir, 'cancel-request.json'))) throw error('run_cancelled')
        const saved = await artifact(runDir, output)
        await appendReceipt(runDir, { kind: 'stage', stage, status: 'complete', artifact: saved, input_manifest_sha256: state.manifest.input_manifest_sha256, config_sha256: state.manifest.config_sha256, created_at: new Date().toISOString() })
      } catch (cause) {
        const status = cause.code === 'run_cancelled' ? 'cancelled' : cause.code === 'awaiting_independent_review' ? 'awaiting_review' : ['INTERRUPTED','retry_budget_exhausted'].includes(cause.code) ? 'partial' : [401,403].includes(cause.status) || /validation_failed|invalid_|missing_|required|future_|unsupported|mismatch/.test(cause.code || cause.message) ? 'blocked' : transient(cause) ? 'partial' : 'failed'
        await appendReceipt(runDir, { kind: 'status', status, stage, code: cause.code || cause.message, details: cause.details ?? null, status_code: cause.status ?? null, created_at: new Date().toISOString(), remaining_stages: RUN_STAGES.filter(item => !state.completed_stages.includes(item)) })
        return readResearchRun(runDir)
      }
    }
    // Cancellation is checked again after every stage, including the last stage.
    if (signal?.aborted || await exists(join(runDir, 'cancel-request.json'))) await appendReceipt(runDir, { kind: 'status', status: 'cancelled', created_at: new Date().toISOString() })
    else {
      await appendReceipt(runDir, { kind: 'status', status: 'accepted', created_at: new Date().toISOString(), projection_sha256: (await readResearchRun(runDir)).receipts.find(row => row.stage === 'projection_export' && row.status === 'complete').artifact.sha256 })
      if (signal?.aborted || await exists(join(runDir, 'cancel-request.json'))) await appendReceipt(runDir, { kind: 'status', status: 'cancelled', reason: 'cancel_during_acceptance', created_at: new Date().toISOString() })
    }
    return readResearchRun(runDir)
  } finally { await lock.close(); await unlink(lockPath) }
}

export async function exportResearchRun({ runDir, outputRoot, indexPath }) {
  if (!outputRoot) throw error('explicit_output_root_required')
  if (await exists(join(resolve(runDir), '.runner.lock'))) throw error('run_still_running')
  const state = await readResearchRun(runDir)
  if (state.status !== 'accepted') throw error('only_accepted_run_can_export')
  const receipt = state.receipts.find(row => row.stage === 'projection_export' && row.status === 'complete')
  if (!receipt) throw error('accepted_projection_missing')
  const stored = await jsonFile(join(resolve(runDir), receipt.artifact.path)), projection = stored.projection
  assertPublicProjection(projection)
  const bytes = canonicalJSON(projection) + '\n', sha256 = hashBytes(bytes)
  const root = resolve(outputRoot), companyId = state.manifest.company_id
  if (!companyId || projection.company?.company_id !== companyId || projection.run?.run_id !== state.manifest.run_id) throw error('projection_identity_mismatch')
  await mkdir(root, { recursive: true, mode: 0o700 })
  const payloadName = 'financial-' + sha256 + '.json', manifestName = 'financial-' + sha256 + '.manifest.json'
  const payloadPath = join(root, payloadName), manifestPath = join(root, manifestName)
  try { await writeFile(payloadPath, bytes, { flag: 'wx', mode: 0o644 }) } catch (cause) { if (cause.code !== 'EEXIST' || await readFile(payloadPath, 'utf8') !== bytes) throw cause }
  const exportManifest = { schema_version: 'financial-research/1', company_id: companyId, run_id: state.manifest.run_id, as_of: state.manifest.as_of, path: payloadName, payload_sha256: contentHash(projection), file_sha256: sha256, input_manifest_sha256: state.manifest.input_manifest_sha256, documents: projection.documents.map(row => pick(row, ['document_version_id','raw_sha256','text_sha256'])), rights: 'minimal_display_whitelist', source_receipt_sha256: receipt.receipt_sha256 }
  try { await immutableJSON(manifestPath, exportManifest) } catch (cause) { if (cause.code !== 'EEXIST' || canonicalJSON(await jsonFile(manifestPath)) !== canonicalJSON(exportManifest)) throw cause }
  const targetIndex = indexPath ? resolve(indexPath) : join(root, 'index.json'), rel = relative(root, targetIndex)
  if (isAbsolute(rel) || rel.startsWith('..')) throw error('index_outside_output_root')
  await mkdir(resolve(targetIndex, '..'), { recursive: true })
  const lockPath = targetIndex + '.lock'
  let lock
  try { lock = await open(lockPath, 'wx', 0o600) } catch (cause) { if (cause.code === 'EEXIST') throw error('export_index_busy'); throw cause }
  try {
    let index = { schema_version: 'financial-research-index/1', companies: [] }
    if (await exists(targetIndex)) index = await jsonFile(targetIndex)
    if (index.schema_version !== 'financial-research-index/1' || !Array.isArray(index.companies) || index.companies.some(row => !row.company_id) || new Set(index.companies.map(row => row.company_id)).size !== index.companies.length) throw error('invalid_existing_export_index')
    const next = { ...index, companies: [...index.companies.filter(row => row.company_id !== companyId), { company_id: companyId, as_of: state.manifest.as_of, run_id: state.manifest.run_id, path: payloadName, sha256, manifest_path: manifestName, manifest_sha256: hashBytes(await readFile(manifestPath)) }].sort((a,b) => a.company_id.localeCompare(b.company_id)) }
    const temporary = targetIndex + '.' + randomUUID() + '.tmp'
    await immutableJSON(temporary, next)
    await rename(temporary, targetIndex)
    return { run_id: state.manifest.run_id, company_id: companyId, as_of: state.manifest.as_of, path: payloadPath, sha256, payload_sha256: contentHash(projection), manifest_path: manifestPath, index_path: targetIndex }
  } finally { await lock.close(); await unlink(lockPath) }
}

function assertPublicProjection(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    if (/^(?:raw_text|full_text|fulltext|extracted_text|segments|document_segments|asr|asr_audio|audio|audio_bytes|private_ledger|private_state|ledger|private_notes)$/i.test(key)) throw error('forbidden_public_projection_field:' + key)
    assertPublicProjection(child)
  }
}
