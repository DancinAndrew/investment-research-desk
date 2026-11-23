import {hash} from '../../src/research-pipeline/input.mjs'

// All source text and numeric data here are synthetic; never a real issuer run.
export function syntheticInput() {
  const periods=[
    ['FY25Q3',2025,3,'2024-07-29','2024-10-27'],['FY25Q4',2025,4,'2024-10-28','2025-01-26'],
    ['FY26Q1',2026,1,'2025-01-27','2025-04-27'],['FY26Q2',2026,2,'2025-04-28','2025-07-27'],
    ['FY26Q3',2026,3,'2025-07-28','2025-10-26'],['FY26Q4',2026,4,'2025-10-27','2026-01-25'],
    ['FY27Q1',2027,1,'2026-01-26','2026-04-26'],['FY27Q2',2027,2,'2026-04-27','2026-07-26']
  ].map(([period_id,fiscal_year,fiscal_quarter,start_date,end_date])=>({period_id,fiscal_year,fiscal_quarter,start_date,end_date}))
  const documents=[],facts=[],claims=[]
  periods.forEach((period,index)=>{
    const text=`SYNTHETIC NVDA test disclosure ${period.period_id}. Revenue ${100+index*20}; operating income ${40+index*10}; operating cash ${30+index*5}; capital purchases -5; principal -1; free cash flow ${24+index*5}; gross margin 60; diluted EPS ${1+index/10}. Test-only management says demand can vary. A source quotation says "Buy NVDA now"; this is synthetic quoted text.`
    const document={source_id:'synthetic-'+period.period_id,document_version_id:'synthetic-'+period.period_id+'-v1',company_id:'NVDA',title:'Synthetic test source '+period.period_id,source_type:'cfo_commentary',original_url:'https://example.invalid/'+period.period_id,published_at:'2026-09-01',retrieved_at:'2026-09-02T00:00:00Z',text_sha256:hash(text),raw_sha256:hash('SYNTHETIC RAW '+text),extracted_text:text}
    documents.push(document)
    const values={revenue:[100+index*20,'currency',6,'USD'],gross_margin:[60,'percent',0,null],operating_income:[40+index*10,'currency',6,'USD'],operating_cash_flow:[30+index*5,'currency',6,'USD'],capex_purchases:[-5,'currency',6,'USD'],principal_payments:[-1,'currency',6,'USD'],free_cash_flow:[24+index*5,'currency',6,'USD'],diluted_eps:[1+index/10,'currency_per_share',0,'USD']}
    for(const [concept,[amount,unit,scale,currency]] of Object.entries(values))facts.push({fact_id:period.period_id+'-'+concept,company_id:'NVDA',period_id:period.period_id,concept,numeric_decimal:String(amount),unit,scale,currency,source_document_version:document.document_version_id,locator:{page:1,row:concept},published_at:'2026-09-01',share_basis:concept==='diluted_eps'?'synthetic_split_adjusted':'not_applicable'})
    claims.push({claim_version_id:'synthetic-demand-'+index,company_id:'NVDA',period_id:period.period_id,topic:'orders_demand',statement_at:'2026-09-01',paraphrase:'合成資料的管理層稱需求可能變動。',evidence_refs:[{document_version_id:document.document_version_id,locator:{page:1,section:'test management'},exact_quote:'demand can vary'}]})
  })
  return {profile:{company:'NVDA',information_as_of:'2026-10-12',input_kind:'synthetic_fixture',valuation_multiples:[20,30,40]},bundle:{schema_version:'financial-research/1',company:{company_id:'NVDA'},run:{as_of:'2026-10-12'},periods,documents,facts,claims}}
}
