#!/usr/bin/env node
import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { exportResearchRun } from '../src/research-run.mjs'

export async function main(argv=process.argv.slice(2)) {
  const options={}, names=new Set(['--run-dir','--output-root','--index'])
  if (argv.length===1 && argv[0]==='--help') {console.log('Usage: node scripts/export-financial-research.mjs --run-dir RUN_DIR --output-root SITE_DATA_DIR [--index INDEX.json]');return 0}
  for (let index=0;index<argv.length;index++) {
    const key=argv[index]
    if (!names.has(key)||Object.hasOwn(options,key)||!argv[index+1]||argv[index+1].startsWith('--')) throw new Error('invalid_argument:'+key)
    options[key]=argv[++index]
  }
  if (!options['--run-dir']||!options['--output-root']) throw new Error('explicit_run_and_output_required')
  const result=await exportResearchRun({runDir:options['--run-dir'],outputRoot:options['--output-root'],indexPath:options['--index']})
  console.log(JSON.stringify(result));return 0
}
if (process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(resolve(process.argv[1]))).href) main().then(code=>{process.exitCode=code}).catch(cause=>{console.error(JSON.stringify({error:cause.code||cause.message}));process.exitCode=1})
