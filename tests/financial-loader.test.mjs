import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createFinancialLoader} from '../src/financial-loader.mjs';

const bundle=company=>({schema_version:'financial-research/1',company:{company_id:company},run:{run_id:company+'-run',as_of:'2026-10-12',as_of_mode:'public_information'},periods:[],documents:[],facts:[],claims:[],targets:[],outcomes:[],changes:[],assessments:[],coverage:[]});
function data(company='NVDA'){
 const body=JSON.stringify(bundle(company)),file='/data/financial-research/'+company+'.json';
 const index={schema_version:'financial-research-index/1',entries:[{company_id:company,file,sha256:createHash('sha256').update(body).digest('hex'),run_id:company+'-run',as_of:'2026-10-12'}]};
 return {body,file,index};
}
test('validated same-company bytes bind to index hash; no private endpoint is accessed',async()=>{
 const d=data(),paths=[];const loader=createFinancialLoader({fetcher:async file=>{paths.push(file);return new Response(file.endsWith('index.json')?JSON.stringify(d.index):d.body);}});
 const result=await loader.load('NVDA');assert.equal(result.company.company_id,'NVDA');assert.equal(result._load_receipt.status,'loaded');assert.equal(paths.length,2);assert.ok(paths.every(p=>p.startsWith('/data/financial-research/')));
});
test('hash mismatch retains previous valid bundle and does not accept mixed bytes',async()=>{
 const d=data();let corrupt=false;const loader=createFinancialLoader({fetcher:async file=>new Response(file.endsWith('index.json')?JSON.stringify(d.index):corrupt?d.body+' ':d.body)});
 const first=await loader.load('NVDA');corrupt=true;await assert.rejects(loader.load('NVDA'),e=>e.code==='hash_mismatch'&&e.receipt.status==='partial');assert.strictEqual(loader.lastValid('NVDA'),first);assert.equal(loader.lastValid('TSMC'),null);
});
test('missing, forbidden, unauthorized and rate limited reads never silently retry or supply zeros',async()=>{
 for(const status of [401,403,404,429]){
  let count=0;const loader=createFinancialLoader({fetcher:async()=>{count++;return new Response('{}',{status,headers:{'retry-after':'60'}});},delay:async()=>{}});
  await assert.rejects(loader.load('NVDA'),e=>e.status===status&&e.receipt.attempts.length===1);assert.equal(count,1);assert.equal(loader.lastValid('NVDA'),null);
 }
});
test('transient retries are capped at two; final failure has all attempts in receipt',async()=>{
 let count=0;const loader=createFinancialLoader({fetcher:async()=>{count++;return new Response('{}',{status:503});},delay:async()=>{}});
 await assert.rejects(loader.load('NVDA'),e=>e.status===503&&e.receipt.attempts.length===3);assert.equal(count,3);
});
test('manifest rejects cross-company payload, duplicate entries and unregistered paths',async()=>{
 for(const mode of ['cross-company','duplicate','path']){
  const d=data();if(mode==='cross-company'){d.body=JSON.stringify(bundle('TSMC'));d.index.entries[0].sha256=createHash('sha256').update(d.body).digest('hex');}
  if(mode==='duplicate')d.index.entries.push({...d.index.entries[0]});if(mode==='path')d.index.entries[0].file='https://other.example/data.json';
  const loader=createFinancialLoader({fetcher:async file=>new Response(file.endsWith('index.json')?JSON.stringify(d.index):d.body)});
  await assert.rejects(loader.load('NVDA'),e=>e.status===409);assert.equal(loader.lastValid('NVDA'),null);
 }
});
test('explicit cancellation aborts live fetch and persists cancelled status',async()=>{
 const controller=new AbortController();const loader=createFinancialLoader({fetcher:async(_file,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true}))});
 const pending=loader.load('NVDA',{signal:controller.signal});controller.abort();await assert.rejects(pending,e=>e.code==='cancelled'&&e.receipt.status==='cancelled');
});
test('timeout is distinct from user cancellation and is not automatically retried',async()=>{
 let count=0;const loader=createFinancialLoader({timeoutMs:5,fetcher:async(_file,{signal})=>{count++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('timeout','AbortError')),{once:true}));}});
 await assert.rejects(loader.load('NVDA'),e=>e.code==='timeout'&&e.receipt.status==='partial');assert.equal(count,1);
});
