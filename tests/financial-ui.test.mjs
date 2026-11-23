import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import * as vue from 'vue'
import {parse,compileTemplate} from '@vue/compiler-sfc'
import {baseParse} from '@vue/compiler-dom'
import * as workflow from '../src/research-workflow.mjs'
import {selectDocumentVersions} from '../src/financial-research.mjs'

const renderer=vue.createRenderer({createElement:()=>({}),createText:()=>({}),createComment:()=>({}),insert(){},remove(){},setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}})
const sources=Object.fromEntries(await Promise.all(['ResearchCycle','FinancialResearch','CanonicalResearch','CompanyHub'].map(async name=>[name,(await readFile(new URL(`../src/${name}.vue`,import.meta.url),'utf8'))])))
const hash='a'.repeat(64)
const financialBundle=()=>({schema_version:'financial-research/1',company:{company_id:'SYNTHETIC'},run:{as_of:'2026-06-03T12:00:00Z'},bundle_sha256:hash,periods:[{period_id:'q1',end_date:'2026-03-31'}],documents:[],facts:[],claims:[]})

function harness(name,{bundle=financialBundle(),registry={},loader=null,query='?workspace=company&company=SYNTHETIC&companyTab=financials&financialView=changes&asOf=2026-06-01'}={}){
 const old=Object.fromEntries(['window','location','history','document'].map(key=>[key,globalThis[key]]))
 let current=new URL('https://example.invalid/'+query),api
 const listeners=new Map(),writes=[],saves=[],reads=[]
 globalThis.location={get href(){return current.href},get pathname(){return current.pathname},get search(){return current.search},get hash(){return current.hash}}
 globalThis.history={state:null,pushState(_state,_title,url){current=new URL(url,current);writes.push(current.href)},replaceState(_state,_title,url){current=new URL(url,current)}}
 globalThis.document={activeElement:null,getElementById:()=>null,querySelectorAll:()=>[]}
 globalThis.window={location:globalThis.location,confirm:()=>false,addEventListener(type,callback,capture=false){const list=listeners.get(type)||[];list.push({callback,capture});listeners.set(type,list)},removeEventListener(type,callback){listeners.set(type,(listeners.get(type)||[]).filter(item=>item.callback!==callback))},dispatchEvent(event){let stopped=false;const stop=event.stopImmediatePropagation.bind(event);event.stopImmediatePropagation=()=>{stopped=true;stop()};for(const item of [...(listeners.get(event.type)||[])].sort((a,b)=>Number(b.capture)-Number(a.capture))){item.callback(event);if(stopped)break}return !event.defaultPrevented}}
 const props=vue.reactive({company:'SYNTHETIC',bundle,active:true,mode:'monthly'})
 const privateState={state:vue.ref({research_workspace:workflow.emptyResearchWorkspace()}),loaded:vue.ref(true),loading:vue.ref(false),busy:vue.ref(false),error:vue.ref(''),message:vue.ref(''),storage:vue.ref('test'),authRequired:vue.ref(false),scope:vue.ref('synthetic-owner'),revision:1,resetBase(){},beginEdit(){return this.context()},context(){return {expectedRevision:this.revision,expectedScope:this.scope.value}},async recheckDraft(){this.revision++;return true},async save(candidate,_message,base){saves.push({candidate,base});return true}}
 for(const key of ['beginEdit','context','recheckDraft'])privateState[key]=privateState[key].bind(privateState)
 const {computed,onMounted,onUnmounted,ref,toRaw,watch}=vue
 const nextTick=callback=>{callback?.();return Promise.resolve()}
 const deps={computed,nextTick,onMounted,onUnmounted,ref,toRaw,watch,...workflow,selectDocumentVersions,usePrivateState:()=>privateState,reportRegistry:registry,PrivateStateStatus:{},financialResearch:loader||(async()=>bundle),companyHubs:async()=>({companies:[]}),researchTraceability:async()=>null,localApi:async url=>{reads.push(url);return {bundles:[],jobs:[]}},defineProps:()=>props,defineEmits:()=>()=>{},defineExpose(){}}
 const exposed=name==='ResearchCycle'?['draft','tab','discardPrompt','datasetText','importText','baselineReady','start','revise','save','recheckDraft','selectTab','discard']:name==='CanonicalResearch'?['view','company','loadBundle','openJob']:['bundle','facts','asOf','syncUrl','view','coverageRows','outcome','changes','changeEligible','error','showEmpty']
 const script=parse(sources[name]).descriptor.scriptSetup.content.replace(/^import[^\n]*\n/gm,'')
 const run=new Function(...Object.keys(deps),script+`\nreturn {${exposed.join(',')}}`)
 const app=renderer.createApp({setup(){api=run(...Object.values(deps));return()=>null}})
 app.mount({})
 return {api,props,privateState,saves,writes,reads,go(url){current=new URL(url,current);window.dispatchEvent(new Event('popstate'))},close(){app.unmount();for(const [key,value] of Object.entries(old)){if(value===undefined)delete globalThis[key];else globalThis[key]=value}}}
}
const settle=async()=>{await Promise.resolve();await vue.nextTick();await Promise.resolve()}

test('financial UI templates compile and empty-bundle research entry is outside content gate',()=>{
 for(const [name,source] of Object.entries(sources)){const {descriptor}=parse(source);assert.deepEqual(compileTemplate({source:descriptor.template.content,filename:`${name}.vue`,id:name}).errors,[],name)}
 let slotAncestors
 function visit(node,ancestors=[]){if(node.type===1&&node.tag==='slot')slotAncestors=ancestors;for(const child of node.children||[])visit(child,[...ancestors,node])}
 visit(baseParse(parse(sources.FinancialResearch).descriptor.template.content))
 assert.ok(slotAncestors)
 assert.equal(slotAncestors.some(node=>node.props?.some(prop=>prop.name==='if'&&prop.exp?.content==='hasContent')),false)
})

test('manual research without a real bundle pin stays editable but cannot save',async()=>{
 const h=harness('ResearchCycle',{bundle:null});try{h.api.start();assert.ok(h.api.draft.value);assert.equal(h.api.baselineReady.value,false);await h.api.save();assert.equal(h.saves.length,0)}finally{h.close()}
 const pinned=harness('ResearchCycle',{bundle:null,registry:{'synthetic-report':{ticker:'SYNTHETIC',created_at:'2026-06-01T00:00:00Z',report_sha256:'b'.repeat(64),bundle_sha256:hash}}});try{pinned.api.start();assert.equal(pinned.api.draft.value.baseline.bundle_sha256,hash);assert.equal(pinned.api.baselineReady.value,true)}finally{pinned.close()}
})

test('rejecting browser history departure restores URL and preserves draft before parent listeners',()=>{
 const h=harness('ResearchCycle');try{h.api.start();const draft=h.api.draft.value,original=location.href;let parents=0;window.addEventListener('popstate',()=>parents++);h.go('?workspace=company&company=SYNTHETIC');assert.equal(h.api.draft.value,draft);assert.equal(location.href,original);assert.equal(parents,0);window.confirm=()=>true;h.go('?workspace=company');assert.equal(h.api.draft.value,null);assert.equal(parents,1)}finally{h.close()}
})

test('citation-only history keeps draft while busy saves prevent tab changes',()=>{
 const h=harness('ResearchCycle');try{h.api.start();const draft=h.api.draft.value;h.go(location.href+'&claim=synthetic-claim');assert.equal(h.api.draft.value,draft);h.privateState.busy.value=true;h.api.selectTab('model');assert.equal(h.api.tab.value,'monthly');assert.equal(h.api.discardPrompt.value,false)}finally{h.close()}
})

test('explicit conflict recheck refreshes the actual save pin and appends the existing version',async()=>{
 const h=harness('ResearchCycle');try{
  h.api.start();const r=h.api.draft.value
  for(const a of Object.values(r.axes))Object.assign(a,{baseline:'Synthetic baseline',support:'Synthetic support',counterevidence:'Synthetic counterevidence',unknown:'Synthetic gap'})
  r.evidence=[{id:'synthetic-evidence',title:'Synthetic source',url:'https://example.invalid/source',locator:'Synthetic paragraph',published_at:'2026-05-01T00:00:00Z',precision:'timestamp',rights:'link_only'}]
  r.reasons=[{category:'data_gap',note:'Synthetic reason',evidence_ids:['synthetic-evidence']}];r.counter_case='Synthetic alternative';r.learning='Synthetic lesson'
  const previous=JSON.parse(JSON.stringify({...r,id:'synthetic-previous'}));h.privateState.state.value.research_workspace.reviews.push(previous)
  await h.api.recheckDraft();await h.api.save()
  assert.equal(h.saves.length,1);assert.equal(h.saves[0].base.expectedRevision,2);assert.deepEqual(h.saves[0].candidate.research_workspace.reviews[0],previous);assert.equal(h.saves[0].candidate.research_workspace.reviews.length,2)
 }finally{h.close()}
})

test('changed identity clears private dataset previews along with the draft',async()=>{
 const h=harness('ResearchCycle');try{h.api.start();h.api.datasetText.value='private synthetic dataset';h.api.importText.value='private synthetic import';h.privateState.scope.value='different-owner';await vue.nextTick();assert.equal(h.api.draft.value,null);assert.equal(h.api.datasetText.value,'');assert.equal(h.api.importText.value,'')}finally{h.close()}
})

test('financial UI uses witnessed availability and does not rewrite history outside financials',async()=>{
 const bundle=financialBundle();bundle.documents=[{source_id:'mutable',document_version_id:'mutable-1',published_at:'2026-05-01T00:00:00Z',published_precision:'second',first_seen_at:'2026-06-02T10:00:00Z',access_status:'retrieved',stable_original:false},{source_id:'stable',document_version_id:'stable-1',published_at:'2026-05-01T00:00:00Z',published_precision:'second',stable_original:true}];bundle.facts=bundle.documents.map(d=>({company_id:'SYNTHETIC',source_document_version:d.document_version_id}))
 const h=harness('FinancialResearch',{bundle});try{await settle();assert.equal(h.api.facts.value.length,1);h.api.asOf.value='2026-06-02';assert.equal(h.api.facts.value.length,2);h.go('?workspace=company&company=SYNTHETIC');await settle();assert.equal(new URLSearchParams(location.search).has('companyTab'),false)}finally{h.close()}
})

// Synthetic cutoff fixture: 'stable' is public before 2026-06-01; 'late' only becomes available on 2026-06-02.
function cutoffBundle() {
 const bundle=financialBundle()
 bundle.documents=[{source_id:'stable',document_version_id:'stable-1',published_at:'2026-05-01T00:00:00Z',published_precision:'second',stable_original:true},{source_id:'late',document_version_id:'late-1',published_at:'2026-05-01T00:00:00Z',published_precision:'second',first_seen_at:'2026-06-02T10:00:00Z',access_status:'retrieved',stable_original:false}]
 bundle.facts=[{fact_id:'f-stable',company_id:'SYNTHETIC',period_id:'q1',source_document_version:'stable-1'},{fact_id:'f-late',company_id:'SYNTHETIC',period_id:'q1',source_document_version:'late-1'}]
 const claim=(id,doc)=>({claim_id:id,claim_version_id:id+'-v1',period_id:'q1',paraphrase:id,evidence_refs:[{document_version_id:doc,quote_match_status:'exact'}]})
 bundle.claims=[claim('early','stable-1'),claim('later','stable-1'),claim('hidden','late-1')]
 return bundle
}
test('coverage shows a cutoff-eligible partial source before an ineligible full read',async()=>{
 const bundle=cutoffBundle()
 bundle.coverage=[{company_id:'SYNTHETIC',period_id:'q1',required_material_type:'cfo_commentary',status:'full_text',read_spans:5,total_spans:5,document_version_ids:['late-1']},{company_id:'SYNTHETIC',period_id:'q1',required_material_type:'statement',status:'partial_read',read_spans:2,total_spans:40,document_version_ids:['stable-1']}]
 const h=harness('FinancialResearch',{bundle});try{await settle()
  const row=h.api.coverageRows.value.find(r=>r.type==='financial_statement')
  assert.equal(row.required_material_type,'statement');assert.equal(row.available,true)
  h.api.asOf.value='2026-06-02';const later=h.api.coverageRows.value.find(r=>r.type==='financial_statement')
  assert.equal(later.required_material_type,'cfo_commentary')
 }finally{h.close()}
})
test('a qualitative outcome stays unsettled until every required evidence claim is eligible',async()=>{
 const h=harness('FinancialResearch',{bundle:Object.assign(cutoffBundle(),{outcomes:[{outcome_id:'o1',target_id:'t1',status:'met',eligible_fact_ids:[],evidence_claim_version_ids:['later-v1','hidden-v1']},{outcome_id:'o2',target_id:'t2',status:'met',eligible_fact_ids:[],evidence_claim_version_ids:['later-v1']},{outcome_id:'o3',target_id:'t3',status:'not_comparable',eligible_fact_ids:[],evidence_claim_version_ids:['hidden-v1']}]})})
 try{await settle()
  assert.equal(h.api.outcome({target_id:'t1'}),undefined)
  assert.equal(h.api.outcome({target_id:'t2'}).status,'met')
  assert.equal(h.api.outcome({target_id:'t3'}),undefined)
  h.api.asOf.value='2026-06-02';assert.equal(h.api.outcome({target_id:'t1'}).status,'met')
 }finally{h.close()}
})
test('earlier cutoffs never display a change whose prose needs later facts or knowledge',async()=>{
 const change=(id,extra)=>({change_id:id,period_id:'q1',before_claim_version_id:'early-v1',after_claim_version_id:'later-v1',change_type:'numeric',review_status:'draft',...extra})
 const bundle=Object.assign(cutoffBundle(),{changes:[change('ok',{observed_at:'2026-05-01',support:[{fact_id:'f-stable'}]}),change('late-fact',{observed_at:'2026-05-01',support:[{fact_id:'f-late'}]}),change('late-knowledge',{observed_at:'2026-06-02',support:[{fact_id:'f-stable'}]})]})
 const h=harness('FinancialResearch',{bundle});try{await settle()
  assert.deepEqual(h.api.changes.value.map(c=>c.change_id),['ok'])
  h.api.asOf.value='2026-06-02';assert.deepEqual(h.api.changes.value.map(c=>c.change_id),['ok','late-fact','late-knowledge'])
 }finally{h.close()}
})
test('wording-only and omitted change candidates stay unresolved drafts in the reader',async()=>{
 const {projectFinancialBundle}=await import('../src/financial-research.mjs')
 const doc={source_id:'s',document_version_id:'d1',company_id:'SYNTHETIC',published_at:'2026-05-01T00:00:00Z',published_precision:'second',stable_original:true,allowed_display:['facts','paraphrase']}
 const claim=id=>({claim_id:id,claim_version_id:id+'-v1',company_id:'SYNTHETIC',period_id:'q1',paraphrase:id,evidence_refs:[{evidence_id:id+'-e',document_version_id:'d1',quote_match_status:'exact'}]})
 const source={schema_version:'financial-research/1',company:{company_id:'SYNTHETIC'},run:{as_of:'2026-06-01',as_of_mode:'public_information'},periods:[{period_id:'q1',start_date:'2026-01-01',end_date:'2026-03-31',period_kind:'duration'}],documents:[doc],facts:[],coverage:[],claims:[claim('a'),claim('b'),claim('c')],
  changes:[{change_id:'wording',period_id:'q1',before_claim_version_id:'a-v1',after_claim_version_id:'b-v1',change_type:'wording',potential_contradiction:true,decision:'accepted',author_id:'author'},{change_id:'omitted',period_id:'q1',before_claim_version_id:'a-v1',after_claim_version_id:'c-v1',change_type:'omitted',decision:'rejected',author_id:'author'}]}
 const projected={...projectFinancialBundle(source),bundle_sha256:hash}
 const h=harness('FinancialResearch',{bundle:projected});try{await settle()
  assert.deepEqual(h.api.changes.value.map(c=>[c.change_id,c.review_status,c.decision]),[['wording','draft','unresolved'],['omitted','draft','unresolved']])
 }finally{h.close()}
})
test('authorization, rate-limit, server and timeout failures never claim the company has no data',async()=>{
 for(const [status,empty] of [[401,false],[403,false],[429,false],[500,false],[404,true]]){
  const h=harness('FinancialResearch',{loader:async()=>{throw Object.assign(new Error('failed'),{status})}});try{await settle();await settle()
   assert.ok(h.api.error.value,String(status));assert.equal(h.api.showEmpty.value,empty,String(status))
  }finally{h.close()}
 }
 const t=harness('FinancialResearch',{loader:async()=>{throw Object.assign(new Error('slow'),{code:'timeout'})}});try{await settle();await settle();assert.equal(t.api.showEmpty.value,false)}finally{t.close()}
})
test('company child history stays mounted and report/job navigation respects cancelled draft departure',async()=>{
 const h=harness('CanonicalResearch');try{await settle();assert.equal(h.api.view.value,'company');const count=h.reads.length;h.go(location.href+'&claim=synthetic-claim');assert.equal(h.reads.length,count);window.addEventListener('workspace-leave',event=>event.preventDefault());await h.api.loadBundle('synthetic-report',true);h.api.openJob({company:'SYNTHETIC',status:'complete_report',job_id:'synthetic-job'});assert.equal(h.reads.length,count);assert.equal(h.writes.length,0)}finally{h.close()}
})
