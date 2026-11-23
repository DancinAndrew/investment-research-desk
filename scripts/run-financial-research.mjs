#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createResearchRun, executeResearchRun, readResearchRun, requestRunCancellation } from '../src/research-run.mjs'

const HELP = 'Usage: node scripts/run-financial-research.mjs --input BUNDLE.json --output-root LOCAL_DIR [--resume RUN_DIR] [--review RECEIPTS.json] [--author ID] [--token-limit N] [--usage USAGE.json] [--resume-cancelled]\n       node scripts/run-financial-research.mjs --cancel RUN_DIR'
function parse(argv) {
  const options = {}, flags = new Set(['--help','--resume-cancelled']), names = new Set(['--input','--output-root','--resume','--review','--author','--token-limit','--usage','--cancel'])
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index]
    if (Object.hasOwn(options,key)) throw new Error('duplicate_argument:' + key)
    if (flags.has(key)) options[key] = true
    else if (names.has(key) && argv[index+1] && !argv[index+1].startsWith('--')) options[key] = argv[++index]
    else throw new Error('invalid_argument:' + key)
  }
  return options
}
export async function main(argv = process.argv.slice(2)) {
  const options = parse(argv)
  if (options['--help']) { console.log(HELP); return 0 }
  if (options['--cancel']) {
    if (Object.keys(options).length !== 1) throw new Error('cancel_requires_only_run_directory')
    console.log(JSON.stringify(await requestRunCancellation(options['--cancel'])))
    return 0
  }
  if (!options['--input'] || !options['--output-root']) throw new Error('explicit_input_and_output_required')
  const inputPath = resolve(options['--input']), outputRoot = resolve(options['--output-root'])
  let config = {}, runDir
  if (options['--resume']) {
    runDir = resolve(options['--resume'])
    // Resuming keeps every original setting unless the caller explicitly asks
    // to change it; changed settings are rejected by the runner's hash check.
    config = (await readResearchRun(runDir)).manifest.config
  }
  if (options['--author']) config.author_id = options['--author']
  if (options['--token-limit']) {
    if (!/^\d+$/.test(options['--token-limit'])) throw new Error('invalid_token_limit')
    config.token_limit = Number(options['--token-limit'])
  }
  if (options['--usage']) config.usage = JSON.parse(await readFile(options['--usage'], 'utf8'))
  if (!runDir) runDir = (await createResearchRun({inputPath,outputRoot,config})).run_dir
  const reviewReceipts = options['--review'] ? JSON.parse(await readFile(options['--review'], 'utf8')) : []
  if (!Array.isArray(reviewReceipts)) throw new Error('review_receipts_array_required')
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.once('SIGINT',interrupt); process.once('SIGTERM',interrupt)
  try {
    const result = await executeResearchRun({runDir,inputPath,config,reviewReceipts,signal:controller.signal,resumeCancelled:Boolean(options['--resume-cancelled'])})
    const reviewPin = result.receipts.filter(row => row.code === 'awaiting_independent_review').at(-1)?.details?.review_pin ?? null
    console.log(JSON.stringify({run_id:result.manifest.run_id,run_dir:result.run_dir,status:result.status,completed_stages:result.completed_stages,usage:result.usage,review_pin:reviewPin}))
    return ['failed','blocked'].includes(result.status) ? 1 : result.status === 'cancelled' ? 130 : 0
  } finally { process.removeListener('SIGINT',interrupt); process.removeListener('SIGTERM',interrupt) }
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) main().then(code => {process.exitCode=code}).catch(cause => {console.error(JSON.stringify({error:cause.code||cause.message}));process.exitCode=1})
