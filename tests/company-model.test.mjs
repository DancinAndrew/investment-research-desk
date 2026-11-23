import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {companyCards,viewpointState,viewpointSections,claimReading,traceForReport,traceReportUrl} from '../src/company-model.mjs'
test('company identity remains usable without inventing a traded security',()=>{
 const report={bundle_id:'nvda-v1',security:{ticker:'NVDA'},issuer:{name:'NVIDIA'}}
 const cards=companyCards({bundles:[report]},{companies:[{company_id:'spacex',name:'SpaceX',ticker:null,third_party_only:true,viewpoint_count:2},{company_id:'NVDA',name:'NVIDIA',ticker:'NVDA',viewpoint_count:3}]})
 assert.equal(cards.length,2)
 assert.deepEqual(cards[0].reports,[report])
 const spacex=cards.find(c=>c.id==='spacex');assert.equal(spacex.ticker,null);assert.equal(spacex.third_party_only,true);assert.equal(spacex.viewpoint_count,2);assert.deepEqual(spacex.reports,[])
})
test('shared viewpoint search restores on reload/back without leaking to another company',()=>{
 const url=new URL('http://localhost/?workspace=company&company=NVDA&companyTab=viewpoints&companySearch=NVDA&viewpointSearch=CUDA')
 assert.deepEqual(viewpointState(url.search,'NVDA'),{open:true,query:'CUDA'})
 assert.deepEqual(viewpointState(url.search,'AMZN'),{open:false,query:''})
 url.searchParams.delete('viewpointSearch')
 assert.deepEqual(viewpointState(url.search,'NVDA'),{open:true,query:''})
 url.searchParams.delete('companyTab')
 assert.deepEqual(viewpointState(url.search,'NVDA'),{open:false,query:''})
})
test('source sections display ranges while preserving gaps and distinct source identity',()=>{
 assert.equal(viewpointSections(['src-x:s020','src-x:s021','src-x:s022','src-x:s027','src-x:s027']),'第 20–22、27 節')
 assert.equal(viewpointSections([]),'未提供章節')
})
test('reading cards retain distinct evidence and limitations without mutating frozen records',()=>{
 const source={excerpt:'Official financial tables / dated primary disclosures, and explicitly conditional reproducible assumptions.',falsifier:'收入規模不等同現金回報。',hypotheses:[],conditions:['收入規模不等同現金回報。','現金轉換仍待觀察。',' 現金轉換仍待觀察。 ']}
 const before=JSON.stringify(source)
 const card=claimReading(source)
 assert.equal(card.excerpt,'')
 assert.deepEqual(card.conditions,['現金轉換仍待觀察。'])
 assert.equal(card.falsifier,source.falsifier)
 assert.equal(JSON.stringify(source),before)
 const located=claimReading({excerpt:'P-MSFT-OAI-20260427, P-NVDA-AWS-FUSION'})
 assert.equal(located.excerptIsLocator,true)
 assert.equal(located.excerpt,'P-MSFT-OAI-20260427, P-NVDA-AWS-FUSION')
 const substantive=claimReading({excerpt:'已披露的收現速度低於營收成長。'})
 assert.equal(substantive.excerptIsLocator,false)
 assert.equal(substantive.excerpt,'已披露的收現速度低於營收成長。')
})
test('source trace applies only to the exact report revision and every link names a real section',()=>{
 const root=new URL('../public/',import.meta.url),read=path=>JSON.parse(fs.readFileSync(new URL(path,root)))
 const index=read('data/site-index.json'),trace=read('data/company-traceability.json')
 for(const id of ['NVDA-20261011-v6-reader-reviewed','AMZN-20261011-v2-reader-reviewed','AMZN-20261011-v3-reader-reviewed']){
  const bundle=read(index.bundles[id].slice(1)),rows=traceForReport(trace,bundle)
  assert.ok(rows.length>0)
  for(const row of rows){
   assert.ok(bundle.entrypoints.report.content.split('\n').includes('## '+row.report_section))
   assert.equal(new URL(traceReportUrl(row),'https://example.test').searchParams.get('bundle'),id)
   assert.ok(bundle.projection.claims.some(c=>c.id===row.claim_id))
   if(row.role==='researcher_inference'){
    const parameters=new URL(row.artifact_url,'https://example.test').searchParams.get('artifact')
    const results=new URL(row.result_artifact_url,'https://example.test').searchParams.get('artifact')
    assert.equal(bundle.artifacts.find(a=>a.artifact_id===parameters)?.sha256,row.source_sha256)
    assert.equal(bundle.artifacts.find(a=>a.artifact_id===results)?.sha256,row.result_sha256)
   }
  }
  assert.deepEqual(traceForReport(trace,{...bundle,entrypoints:{...bundle.entrypoints,report:{...bundle.entrypoints.report,sha256:'different revision'}}}),[])
 }
})
