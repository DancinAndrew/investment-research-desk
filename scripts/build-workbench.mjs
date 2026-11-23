import {build} from 'vite'
import {mkdir,cp,writeFile,readFile,rm} from 'node:fs/promises'
await import('./build-report-registry.mjs')
await import('./render-markdown.mjs')
await rm('dist',{recursive:true,force:true})
await build({configLoader:'runner',build:{outDir:'dist/client'}})
await build({configFile:false,publicDir:false,build:{ssr:'worker/index.mjs',outDir:'dist/server',emptyOutDir:true,minify:false,rollupOptions:{output:{entryFileNames:'index.js'}}}})
const hosting=JSON.parse(await readFile('.openai/hosting.json','utf8'))
await mkdir('dist/.openai',{recursive:true})
await writeFile('dist/.openai/hosting.json',JSON.stringify(hosting,null,2)+'\n')
await cp('drizzle','dist/.openai/drizzle',{recursive:true})
await writeFile('dist/server/wrangler.json',JSON.stringify({name:'investment-research',main:'index.js',compatibility_date:'2026-10-10',assets:{directory:'../client',binding:'ASSETS',run_worker_first:['/api/*'],not_found_handling:'single-page-application'},d1_databases:[{binding:hosting.d1,database_name:'site-creator-d1',database_id:'00000000-0000-4000-8000-000000000000'}]},null,2)+'\n')
