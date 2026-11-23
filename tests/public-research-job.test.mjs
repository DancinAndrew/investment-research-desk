import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import * as vue from 'vue'
import {parse,compileTemplate} from '@vue/compiler-sfc'
const source=await readFile(new URL('../src/PublicResearchJob.vue',import.meta.url),'utf8')
const canonical=await readFile(new URL('../src/CanonicalResearch.vue',import.meta.url),'utf8')
const renderer=vue.createRenderer({createElement:()=>({}),createText:()=>({}),createComment:()=>({}),insert(){},remove(){},setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}})
const capability={configured:true,supported:true,company:'NVDA',question_id:'nvda-snapshot',source_sha256:'a'.repeat(64),information_as_of:'2026-10-12',uses_model:false}
const serverId='run_12345678-1234-1234-1234-123456789abc'
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}}
const settle=async()=>{for(let i=0;i<8;i++){await Promise.resolve();await vue.nextTick()}}
function harness(handler,query='?workspace=company&company=NVDA&researchView=new'){
 const old=Object.fromEntries(['location','history'].map(k=>[k,globalThis[k]]));let current=new URL('https://example.invalid/'+query),api
 globalThis.location={get pathname(){return current.pathname},get search(){return current.search}}
 globalThis.history={state:null,replaceState(_state,_title,url){current=new URL(url,current)}}
 const props=vue.reactive({active:true,company:'NVDA'}),calls=[],emitted=[]
 const {computed,onUnmounted,ref,watch}=vue
 const deps={computed,onUnmounted,ref,watch,localApi:async(path,body,options)=>{calls.push({path,body,signal:options?.signal});return path==='research-jobs/capabilities'?capability:handler(path,body,options)},safeUrl:v=>v,defineProps:()=>props,defineEmits:()=> (...args)=>emitted.push(args)}
 const script=parse(source).descriptor.scriptSetup.content.replace(/^import[^\n]*\n/gm,'')
 const run=new Function(...Object.keys(deps),script+'\nreturn {capability,job,reading,error,busy,supported,unresolved,start,refresh,cancel,statusText}')
 const app=renderer.createApp({setup(){api=run(...Object.values(deps));return()=>null}});app.mount({})
 return {api,props,calls,emitted,get url(){return current},close(){app.unmount();for(const [k,v] of Object.entries(old))if(v===undefined)delete globalThis[k];else globalThis[k]=v}}
}
test('research templates compile and NVDA entry is discoverable',()=>{
 for(const [name,s] of [['PublicResearchJob',source],['CanonicalResearch',canonical]])assert.deepEqual(compileTemplate({source:parse(s).descriptor.template.content,filename:name+'.vue',id:name}).errors,[])
 assert.match(canonical,/開始新的公開材料研究/)
 assert.doesNotMatch(source,/使用既有 ChatGPT 額度/)
})
test('submission polls returned server identity and reads only mechanically accepted result',async()=>{
 const h=harness((path,body)=>{if(body)return {job_id:serverId,request_id:body.request_id,company:'NVDA',status:'queued'};if(path.endsWith('/reading'))return {job_id:serverId,company:'NVDA',report_markdown:'accepted'};return {job_id:serverId,company:'NVDA',status:'accepted'}})
 try{await settle();await h.api.start();const post=h.calls.find(c=>c.body);assert.notEqual(post.body.request_id,serverId);assert.equal(h.url.searchParams.get('job'),serverId);assert.equal(h.url.searchParams.get('request'),post.body.request_id);assert.ok(h.calls.some(c=>c.path==='research-jobs/'+serverId));assert.ok(h.api.reading.value);assert.equal(h.api.statusText.value,'規則檢查通過')}finally{h.close()}
})
test('unknown submission preserves durable request and refresh recovers without another POST',async()=>{
 let request
 const h=harness((path,body)=>{if(body){request=body.request_id;throw new Error('connection lost')}if(path.startsWith('research-jobs/requests/'))return {job_id:serverId,company:'NVDA'};return {job_id:serverId,company:'NVDA',status:'blocked'}})
 try{await settle();await h.api.start();assert.equal(h.url.searchParams.get('request'),request);assert.equal(h.url.searchParams.has('job'),false);assert.equal(h.api.unresolved.value,true);await h.api.start();assert.equal(h.calls.filter(c=>c.body).length,1);await h.api.refresh();assert.ok(h.calls.some(c=>c.path==='research-jobs/requests/'+request));assert.equal(h.url.searchParams.get('job'),serverId);assert.equal(h.calls.filter(c=>c.body).length,1)}finally{h.close()}
})
test('refresh from a request URL resolves server identity before polling',async()=>{
 const h=harness(path=>path.includes('/requests/')?{job_id:serverId,company:'NVDA'}:{job_id:serverId,company:'NVDA',status:'cancelled'},'?workspace=company&company=NVDA&researchView=new&request=durable-request')
 try{await settle();assert.deepEqual(h.calls.map(c=>c.path),['research-jobs/capabilities','research-jobs/requests/durable-request','research-jobs/'+serverId]);assert.equal(h.calls.some(c=>c.body),false)}finally{h.close()}
})
test('confirmed validation rejection permits recovery while never automatically reposting',async()=>{
 const h=harness(()=>{const e=new Error('input changed');e.status=409;throw e})
 try{await settle();await h.api.start();assert.equal(h.api.unresolved.value,false);assert.equal(h.api.busy.value,false);assert.equal(h.url.searchParams.has('request'),false);assert.equal(h.calls.filter(c=>c.body).length,1);assert.match(h.api.error.value,/未受理/)}finally{h.close()}
})
test('rejected, blocked and failed jobs never request a reading',async()=>{
 for(const status of ['needs_revision','blocked','failed','cancelled','timed_out','interrupted']){
  const h=harness((_path,body)=>({job_id:serverId,company:'NVDA',status:body?'queued':status}))
  try{await settle();await h.api.start();assert.equal(h.api.reading.value,null,status);assert.equal(h.calls.some(c=>c.path.endsWith('/reading')),false,status);assert.equal(h.api.busy.value,false,status)}finally{h.close()}
 }
})
test('company change aborts and ignores a late submission response',async()=>{
 const pending=deferred(),h=harness((_path,body)=>body?pending.promise:{job_id:serverId,company:'NVDA',status:'accepted'})
 try{await settle();const started=h.api.start();const signal=h.calls.find(c=>c.body).signal;h.props.company='AMD';await settle();assert.equal(signal.aborted,true);assert.equal(h.api.supported.value,false);assert.equal(h.api.job.value,null);assert.equal(h.url.searchParams.has('request'),false);pending.resolve({job_id:serverId,company:'NVDA',status:'queued'});await started;assert.equal(h.api.job.value,null);assert.equal(h.calls.some(c=>c.path==='research-jobs/'+serverId),false)}finally{h.close()}
})
test('deactivation ignores a late reading and clears state',async()=>{
 const pending=deferred(),h=harness(path=>path.endsWith('/reading')?pending.promise:{job_id:serverId,company:'NVDA',status:'accepted'},'?workspace=company&company=NVDA&researchView=new&job='+serverId)
 try{await settle();assert.ok(h.calls.some(c=>c.path.endsWith('/reading')));h.props.active=false;await settle();pending.resolve({job_id:serverId,company:'NVDA',report_markdown:'late'});await settle();assert.equal(h.api.reading.value,null);assert.equal(h.api.capability.value,null);assert.equal(h.api.job.value,null)}finally{h.close()}
})
test('cancellation posts to server identity and settles the same job',async()=>{
 let cancelled=false
 const h=harness((path,body)=>{if(path.endsWith('/cancel')){cancelled=true;return {status:'cancelled'}}return {job_id:serverId,company:'NVDA',status:cancelled?'cancelled':body?'queued':'running'}})
 try{await settle();await h.api.start();await h.api.cancel();assert.ok(h.calls.some(c=>c.path==='research-jobs/'+serverId+'/cancel' && Object.keys(c.body).length===0));assert.equal(h.api.job.value.status,'cancelled');assert.equal(h.api.busy.value,false)}finally{h.close()}
})
