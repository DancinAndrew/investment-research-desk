import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderer} from 'vue';
import {usePrivateState} from '../src/private-state.js';
import {copy,emptyJournal} from '../src/decision-workspace.mjs';
import {researchWorkspace} from './helpers/research-workspace.mjs';
const initial=()=>({schema_version:1,records:[],quotes:[],reviews:[],journal:emptyJournal(),company_favorites:[]});
const renderer=createRenderer({createElement:()=>({}),createText:()=>({}),createComment:()=>({}),insert(){},remove(){},setText(){},setElementText(){},parentNode:()=>null,nextSibling:()=>null,patchProp(){}});
function harness(seed=initial()){let remote=copy(seed),revision=1,scope='synthetic-owner',fault='',puts=[],defer=false,release;let client;const oldFetch=globalThis.fetch,oldWindow=globalThis.window;globalThis.window={addEventListener(){},removeEventListener(){},dispatchEvent(){}};
 globalThis.fetch=async(url,opt)=>{if(opt.method==='PUT'){const body=JSON.parse(opt.body);puts.push(body);if(fault==='identity409'){fault='';return new Response(JSON.stringify({error:'identity changed',code:'identity_changed'}),{status:409});}if(fault==='401'){fault='';return new Response(JSON.stringify({error:'signed out'}),{status:401});}if(body.expected_revision!==revision)return new Response(JSON.stringify({error:'conflict'}),{status:409});remote=copy(body.state);revision++;if(fault==='persist409'){fault='';remote.company_favorites.push('concurrent-favorite');revision++;return new Response(JSON.stringify({error:'conflict'}),{status:409});}if(fault==='drop'){fault='';remote.company_favorites.push('concurrent-favorite');revision++;throw new TypeError('dropped response');}}
 const response=new Response(JSON.stringify({state:copy(remote),revision,owner_scope:scope,history:[],storage:'isolated_local_qa'}));if(defer&&opt.method==='GET'){defer=false;return await new Promise(resolve=>release=()=>resolve(response));}return response;};
 const app=renderer.createApp({setup(){client=usePrivateState();return()=>null;}});app.mount({});
 return {get client(){return client;},get remote(){return remote;},get puts(){return puts;},change(){remote.company_favorites.push('second-writer');revision++;},delay(){defer=true;},release(){release();},fault(value){fault=value;},scope(value){scope=value;},close(){app.unmount();globalThis.fetch=oldFetch;globalThis.window=oldWindow;}};
}
test('draft baseline stays frozen through passive reload, then explicit recheck preserves concurrent slices',async()=>{const h=harness();try{const c=h.client;await c.load();c.beginEdit();h.change();await c.load();const next=copy(c.state.value);next.company_favorites.push('draft-choice');assert.equal(await c.save(next,'saved'),false);assert.equal(h.puts.length,0);assert.equal(await c.recheckDraft(),true);assert.equal(await c.save(next,'saved'),true);assert.deepEqual(h.remote.company_favorites,['second-writer','draft-choice']);assert.deepEqual(h.remote.journal,emptyJournal());}finally{h.close();}});
test('lost response confirms only operation delta and keeps newer favorites',async()=>{const h=harness();try{const c=h.client;await c.load();c.beginEdit();const next=copy(c.state.value);next.quotes=[{ticker:'TEST',currency:'USD',date:'2026-01-01',price:10}];h.fault('drop');assert.equal(await c.save(next,'saved'),true);assert.equal(h.puts.length,1);assert.equal(c.saveStatus.value,'saved');assert.equal(c.error.value,'');assert.deepEqual(c.state.value.company_favorites,['concurrent-favorite']);assert.deepEqual(c.state.value.journal,emptyJournal());}finally{h.close();}});
test('401 discards state and old draft; explicit recheck cannot adopt a changed identity',async()=>{const h=harness();try{const c=h.client;await c.load();c.beginEdit();h.scope('another-synthetic-owner');assert.equal(await c.recheckDraft(),false);assert.equal(c.scope.value,'another-synthetic-owner');c.beginEdit();h.fault('401');const next=copy(c.state.value);assert.equal(await c.save(next,'saved'),false);assert.equal(c.loaded.value,false);assert.equal(c.scope.value,'');assert.equal(c.saveStatus.value,'auth_lost');}finally{h.close();}});

test('implicit retry conflict after persistence reads back matching delta instead of claiming failure',async()=>{const h=harness();try{const c=h.client;await c.load();const next=copy(c.state.value);next.quotes=[{ticker:'TEST',currency:'USD',date:'2026-01-01',price:10}];h.fault('persist409');assert.equal(await c.save(next,'saved'),true);assert.equal(h.puts.length,1);assert.equal(c.saveStatus.value,'saved');assert.deepEqual(c.state.value.company_favorites,['concurrent-favorite']);}finally{h.close();}});

test('GET started before a 401 save cannot restore private state after auth loss',async()=>{const h=harness();try{const c=h.client;await c.load();h.delay();const old=c.load();h.fault('401');assert.equal(await c.save(copy(c.state.value),'saved'),false);h.release();await old;assert.equal(c.loaded.value,false);assert.equal(c.scope.value,'');assert.deepEqual(c.history.value,[]);}finally{h.close();}});

test('409 identity_changed discards immediately instead of entering conflict readback',async()=>{const h=harness();try{const c=h.client;await c.load();h.fault('identity409');assert.equal(await c.save(copy(c.state.value),'saved'),false);assert.equal(c.loaded.value,false);assert.equal(c.scope.value,'');assert.equal(c.saveStatus.value,'auth_lost');}finally{h.close();}});

test('research workspace cannot return through a delayed GET after authentication is lost',async()=>{
 const h=harness({...initial(),research_workspace:researchWorkspace()});try{
  const c=h.client;await c.load();assert.equal(c.state.value.research_workspace.reviews.length,1);
  h.delay();const pending=c.load();h.fault('401');
  assert.equal(await c.save(copy(c.state.value),'saved'),false);h.release();await pending;
  assert.equal(c.loaded.value,false);assert.equal(c.scope.value,'');
  assert.equal(c.state.value.research_workspace,undefined);assert.deepEqual(c.history.value,[]);
 }finally{h.close();}
});

test('saving a research append after a lost response preserves newer unrelated favorites',async()=>{
 const h=harness({...initial(),research_workspace:researchWorkspace()});try{
  const c=h.client;await c.load();c.beginEdit();const next=copy(c.state.value),before=next.research_workspace.reviews[0];
  next.research_workspace.reviews.push({...copy(before),id:'synthetic-review-2',supersedes:before.id,learning:'Synthetic correction'});
  h.fault('drop');assert.equal(await c.save(next,'saved'),true);assert.equal(h.puts.length,1);
  assert.deepEqual(c.state.value.company_favorites,['concurrent-favorite']);
  assert.deepEqual(c.state.value.research_workspace,next.research_workspace);
 }finally{h.close();}
});
