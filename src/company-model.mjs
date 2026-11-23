import {companyMetadata} from './company-metadata.mjs'
export function companyCards(catalog,hubs){
 const map=new Map((hubs?.companies||[]).map(c=>[c.company_id,{id:c.company_id,ticker:c.ticker||null,name:c.name,reports:[],viewpoint_count:c.viewpoint_count||0,third_party_only:c.third_party_only===true,industry:c.industry||null,markets:Array.isArray(c.markets)?c.markets:[],headquarters:c.headquarters||null}]))
 for(const report of catalog?.bundles||[]){
  const ticker=report.security?.ticker||report.security?.symbol
  if(!ticker)continue
  if(!map.has(ticker))map.set(ticker,{id:ticker,ticker,name:report.issuer?.name||ticker,reports:[],viewpoint_count:0,third_party_only:false})
  map.get(ticker).reports.push(report)
 }
 return [...map.values()].map(c=>({...c,industry:c.industry||companyMetadata[c.id]?.industry||null,markets:c.markets?.length?c.markets:companyMetadata[c.id]?.markets||[],headquarters:c.headquarters||null})).sort((a,b)=>Number(b.reports.length>0)-Number(a.reports.length>0)||a.name.localeCompare(b.name))
}

export function viewpointState(search,company){
 const p=search instanceof URLSearchParams?search:new URLSearchParams(search)
 const open=p.get('workspace')==='company' && p.get('company')===company && p.get('companyTab')==='viewpoints'
 return {open,query:open?p.get('viewpointSearch')||'':''}
}

export function viewpointSections(sections){
 const numbers=[...new Set((Array.isArray(sections)?sections:[sections]).map(s=>String(s).match(/:s(\d+)$/)?.[1]).filter(Boolean).map(Number))].sort((a,b)=>a-b)
 const ranges=[]
 for(let i=0;i<numbers.length;i++){
  const start=numbers[i];let end=start
  while(numbers[i+1]===end+1)end=numbers[++i]
  ranges.push(start===end?String(start):start+'–'+end)
 }
 return ranges.length?'第 '+ranges.join('、')+' 節':'未提供章節'
}

export const traceRole=role=>({citation:'報告直接依據',background:'問題與機制背景',not_adopted:'未採用此說法',counterevidence:'反方與待核矛盾',researcher_inference:'條件推論'}[role]||'尚未確認用途')
export const viewpointRole=role=>({direct_subject:'本公司為研究主體',competitor_context:'競爭比較背景',supply_chain_context:'供應鏈或客戶背景',co_mentioned:'同段提及',unresolved:'關聯待核'}[role]||'關聯待核')
export const viewpointAnchor=id=>'viewpoint-'+String(id).replace(/[^a-zA-Z0-9_-]/g,'-')
export const traceReportUrl=row=>'?workspace=company&bundle='+encodeURIComponent(row.bundle_id)+'&researchTab=report&reportSection='+encodeURIComponent(row.report_anchor)
export function traceForReport(trace,bundle){return (trace?.rows||[]).filter(row=>row.bundle_id===bundle?.manifest?.bundle_id&&row.report_sha256===bundle?.entrypoints?.report?.sha256)}

// The frozen evidence remains intact; reading cards omit generic metadata and
// repeat each substantive limitation once.
export function claimReading(claim){
 const boilerplate='Official financial tables / dated primary disclosures, and explicitly conditional reproducible assumptions.'
 const excerpt=claim.excerpt?.trim() || ''
 const seen=new Set([claim.falsifier?.trim()].filter(Boolean))
 const unique=items=>(items || []).filter(item=>{
  const text=String(item).trim()
  if(!text || seen.has(text))return false
  seen.add(text);return true
 })
 return {...claim,excerpt:excerpt===boilerplate?'':excerpt,
  excerptIsLocator:/^P-[\w-]+(?:,\s*P-[\w-]+)*$/.test(excerpt),
  hypotheses:unique(claim.hypotheses),conditions:unique(claim.conditions)}
}
