// Deterministic pins for user-saved research references. Read only registered
// exports; no local-notes discovery, external fetch, or new investment conclusions.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const index=JSON.parse(await readFile('public/data/site-index.json','utf8'));
const trace=JSON.parse(await readFile('public/data/company-traceability.json','utf8'));
const registry={};
for(const item of index.catalog.bundles){
 const path=index.bundles[item.bundle_id];
 if(!/^\/data\/[\w.-]+\.json$/.test(path))throw new Error('Unregistered report export path');
 const bundle=JSON.parse(await readFile('public'+path,'utf8'));
 const report=bundle.entrypoints.report;
 const hash=createHash('sha256').update(report.content).digest('hex');
 if(hash!==report.sha256)throw new Error('Report bytes differ from registered pin');
 const ticker=item.security.ticker||item.security.symbol;
 const period=report.content.match(/截至\s*2026-07-26.*FY27/) ? 'FY2027 Q2 · 截至2026-07-26'
  :ticker==='AMZN'&&report.content.includes('2026 年第二季')?'2026 Q2 · 截至2026-06-30':null;
 registry[item.bundle_id]={ticker,report_sha256:hash,as_of:item.as_of,created_at:bundle.manifest.created_at,
  revision:item.revision_id,financial_period:period,claims:bundle.projection.claims.filter(c=>!c.appendix).map(c=>({
   id:c.id,text:c.text,falsifier:c.falsifier||'',conditions:c.conditions||[],hypotheses:c.hypotheses||[],
   source_refs:c.source_refs||[],origin_ref:c.origin_ref||null,
  })),trace:trace.rows.filter(row=>row.bundle_id===item.bundle_id&&row.report_sha256===hash)};
}
await writeFile('src/report-registry.mjs','// Generated from registered report bytes by scripts/build-report-registry.mjs.\nexport const reportRegistry = '+JSON.stringify(registry,null,2)+';\n');
console.log('Pinned '+Object.keys(registry).length+' existing report versions');
