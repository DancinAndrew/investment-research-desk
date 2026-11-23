import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker, {ledgerScope} from '../worker/index.mjs';
import {replayLedger} from '../src/ledger-core.mjs';
import {reportPin} from '../src/research-continuity.mjs';
import {researchWorkspace} from './helpers/research-workspace.mjs';
import {digest} from '../src/decision-workspace.mjs';

// Real SQLite executes the actual worker SQL through a minimal D1 interface.
// Every database is memory-only; no hosted or application data is accessed.
function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../drizzle/0000_ledger.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  let executions = 0;
  const DB = {prepare(sql) {
    const statement = sqlite.prepare(sql);
    return {bind(...params) {return {async first() {
      executions++;
      return statement.get(...params) ?? null;
    }, async all() {
      executions++;
      return {results: statement.all(...params)};
    }};}};
  }};
  return {env: {DB}, sqlite, executions: () => executions,
    count: () => sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_states').get().n,
    changes: () => sqlite.prepare('SELECT total_changes() AS n').get().n};
}

function record(overrides = {}) {
  return {id: 'buy-1', date: '2026-01-01', ticker: 'NVDA', side: 'BUY',
    quantity: 10, price: 100, currency: 'USD', fees: 10, reason: '當時理由',
    horizon: '一年', expectation: '成長', risk: '競爭', invalidation: '成長停滯',
    report_id: 'report-v1', source_links: ['https://example.com/source'],
    status: 'active', revision: 1, created_at: '2026-01-01T12:00:00.000Z',
    updated_at: '2026-01-01T12:00:00.000Z', ...overrides};
}
const empty = () => ({schema_version: 1, records: [], quotes: [], reviews: []});
function state(records = [record()], overrides = {}) {return {...empty(), records, ...overrides};}

async function request(env, {user = 'alice', method = 'GET', body,
  origin = 'https://private.example', headers = {}, raw, path = '/api/ledger'} = {}) {
  if(body && typeof body==='object' && !Array.isArray(body) && !Object.hasOwn(body,'expected_owner_scope'))body={...body,expected_owner_scope:await ledgerScope(user,env,'https://private.example')};
  const requestHeaders = {...headers};
  if (user !== null) requestHeaders['oai-authenticated-user-id'] = user;
  if (method === 'PUT') {
    requestHeaders['content-type'] ??= 'application/json';
    if (origin !== null) requestHeaders.origin = origin;
  }
  const response = await worker.fetch(new Request(`https://private.example${path}`, {
    method, headers: requestHeaders,
    ...(method === 'GET' || method === 'HEAD' ? {} : {body: raw ?? JSON.stringify(body)}),
  }), env);
  return {status: response.status, data: await response.json(), headers: response.headers};
}
const put = (env, ledger, revision = 0, extra = {}) => request(env, {
  method: 'PUT', body: {expected_revision: revision, state: ledger}, ...extra,
});

test('authenticated empty GET is zero writes and returns a genuinely empty ledger', async t => {
  const f = fixture(t), result = await request(f.env);
  assert.equal(result.status, 200);
  assert.equal(result.data.revision, 0);
  assert.equal(result.data.updated_at, null);
  assert.deepEqual(result.data.state, empty());
  assert.equal(f.count(), 0);
  assert.equal(f.changes(), 0);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
});

test('anonymous identity is rejected on every ledger operation before DB access', async t => {
  const f = fixture(t);
  for (const method of ['GET', 'PUT', 'POST', 'DELETE']) {
    const response = await request(f.env, {user: null, method, body: {expected_revision: 0, state: state()}});
    assert.equal(response.status, 401, method);
  }
  assert.equal(f.executions(), 0);
  assert.equal(f.count(), 0);
});

test('write rejects foreign/missing Origin, cross-site fetch, and non-JSON content', async t => {
  const f = fixture(t);
  for (const options of [{origin: null}, {origin: 'https://attacker.example'},
    {origin: 'https://private.example.attacker.example'},
    {headers: {'sec-fetch-site': 'cross-site'}}, {headers: {'content-type': 'text/plain'}}]) {
    assert.equal((await put(f.env, state(), 0, options)).status, 403);
  }
  assert.equal(f.executions(), 0);
  assert.equal(f.changes(), 0);
});

test('create persists actual decision, source and report version, then owner can reload', async t => {
  const f = fixture(t), ledger = state();
  const saved = await put(f.env, ledger);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.revision, 1);
  assert.deepEqual(saved.data.state, ledger);
  const loaded = await request(f.env);
  assert.equal(loaded.data.revision, 1);
  assert.deepEqual(loaded.data.state, ledger);
  assert.equal(f.count(), 1);
  assert.equal(f.changes(), 1);
});

test('each operation derives owner from current identity; body cannot select another owner', async t => {
  const f = fixture(t);
  await put(f.env, state([record({reason: 'Alice private'})]));
  const bobEmpty = await request(f.env, {user: 'bob'});
  assert.deepEqual(bobEmpty.data.state, empty());
  const bob = await request(f.env, {method: 'PUT', user: 'bob', body: {
    expected_revision: 0, owner_id: 'alice', state: state([record({reason: 'Bob private'})]),
  }});
  assert.equal(bob.status, 200);
  assert.equal((await request(f.env)).data.state.records[0].reason, 'Alice private');
  assert.equal((await request(f.env, {user: 'bob'})).data.state.records[0].reason, 'Bob private');
  assert.equal(f.count(), 2);
});

test('CAS SQL rejects stale revisions and impossible first-write revision with no overwrite', async t => {
  const f = fixture(t);
  assert.equal((await put(f.env, state(), 2)).status, 409);
  assert.equal(f.count(), 0);
  assert.equal((await put(f.env, state())).status, 200);
  assert.equal((await put(f.env, state([record({reason: 'stale zero'})]), 0)).status, 409);
  assert.equal((await put(f.env, state([record({reason: 'fresh'})]), 1)).status, 200);
  assert.equal((await put(f.env, state([record({reason: 'stale one'})]), 1)).status, 409);
  const loaded = await request(f.env);
  assert.equal(loaded.data.revision, 2);
  assert.equal(loaded.data.state.records[0].reason, 'fresh');
  assert.equal(f.changes(), 3); // two state writes plus one trigger snapshot
});

test('two saves with the same revision have one winner and one conflict', async t => {
  const f = fixture(t);
  await put(f.env, state());
  const results = await Promise.all([
    put(f.env, state([record({reason: 'Tab A'})]), 1),
    put(f.env, state([record({reason: 'Tab B'})]), 1),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.find(result => result.status === 200);
  const loaded = await request(f.env);
  assert.equal(loaded.data.state.records[0].reason, winner.data.state.records[0].reason);
  assert.equal(loaded.data.revision, 2);
  assert.equal(f.changes(), 3);
});

test('valid edit, withdrawal and restoration save at increasing global and record revisions', async t => {
  const f = fixture(t);
  await put(f.env, state());
  let current = record({quantity: 12, revision: 2, updated_at: '2026-01-02T12:00:00Z'});
  assert.equal((await put(f.env, state([current]), 1)).status, 200);
  current = {...current, status: 'withdrawn', revision: 3};
  assert.equal((await put(f.env, state([current]), 2)).status, 200);
  assert.deepEqual(replayLedger((await request(f.env)).data.state.records).positions, []);
  current = {...current, status: 'active', revision: 4};
  assert.equal((await put(f.env, state([current]), 3)).status, 200);
  const loaded = await request(f.env);
  assert.equal(loaded.data.revision, 4);
  assert.equal(loaded.data.state.records[0].revision, 4);
  assert.equal(replayLedger(loaded.data.state.records).positions[0].quantity, 12);
});

test('earlier buy edit or withdrawal cannot invalidate an already recorded sell', async t => {
  const f = fixture(t), buy = record(), sell = record({id: 'sell-1', date: '2026-01-02', side: 'SELL', quantity: 8});
  await put(f.env, state([buy, sell]));
  for (const patch of [{quantity: 7}, {status: 'withdrawn'}, {date: '2026-01-03'},
    {currency: 'TWD'}, {ticker: 'MSFT'}]) {
    const result = await put(f.env, state([{...buy, ...patch, revision: 2}, sell]), 1);
    assert.equal(result.status, 422, JSON.stringify(patch));
    assert.match(result.data.error, /當時(?:僅持有|只有)/);
  }
  assert.deepEqual((await request(f.env)).data.state.records, [buy, sell]);
  assert.equal(f.changes(), 1);
});

test('restoring withdrawn sell is blocked when an edited earlier buy no longer covers it', async t => {
  const f = fixture(t), buy = record({quantity: 5}), sell = record({id: 'sell-1', date: '2026-01-02',
    side: 'SELL', quantity: 8, status: 'withdrawn', revision: 2});
  await put(f.env, state([buy, sell]));
  assert.equal((await put(f.env, state([buy, {...sell, status: 'active', revision: 3}]), 1)).status, 422);
  assert.equal((await request(f.env)).data.state.records[1].status, 'withdrawn');
  assert.equal(f.changes(), 1);
});

test('actual stored ledger yields hand-calculated multicurrency results without FX', async t => {
  const f = fixture(t);
  const records = [record(), record({id: 'buy-2', date: '2026-01-02', price: 120}),
    record({id: 'sell-1', date: '2026-01-03', side: 'SELL', quantity: 5, price: 150, fees: 5}),
    record({id: 'twd-buy', currency: 'TWD', quantity: 2, price: 1000, fees: 0}),
    record({id: 'twd-sell', date: '2026-01-02', currency: 'TWD', side: 'SELL', quantity: 1, price: 1100, fees: 5})];
  assert.equal((await put(f.env, state(records, {quotes: [
    {ticker: 'NVDA', currency: 'USD', price: 140, date: '2026-01-05'},
  ]}))).status, 200);
  const loaded = (await request(f.env)).data.state;
  const calculated = replayLedger(loaded.records, loaded.quotes);
  const usd = calculated.positions.find(position => position.currency === 'USD');
  assert.equal(usd.quantity, 15);
  assert.equal(usd.cost_basis, 1665);
  assert.equal(usd.average_cost, 111);
  assert.equal(usd.realized, 190);
  assert.equal(usd.unrealized, 435);
  assert.deepEqual(calculated.realized_by_currency, {TWD: 95, USD: 190});
  assert.equal(calculated.positions.find(position => position.currency === 'TWD').unrealized, null);
});

test('invalid ledger, report/source type, review links and dates reject with 422, zero writes', async t => {
  const f = fixture(t);
  const review = {id: 'review-1', record_id: 'buy-1', date: '2026-01-02', outcome: 'pending', lesson: '', next_action: ''};
  for (const ledger of [state([record({date: '2026-02-30'})]),
    state([record({currency: 'US'})]), state([record({report_id: 7})]),
    state([record({source_links: ['javascript:alert(1)']})]),
    state([record({side: 'SELL'})]), {...state(), schema_version: 2},
    state([], {reviews: [review]}), state([record()], {reviews: [{...review, date: '2026-02-30'}]}),
    state([record()], {reviews: [{...review, outcome: 'profitable'}]}),
    state([record()], {quotes: [{ticker: 'NVDA', currency: 'USD', price: 0, date: '2026-01-02'}]})]) {
    assert.equal((await put(f.env, ledger)).status, 422);
  }
  assert.equal(f.count(), 0);
  assert.equal(f.changes(), 0);
});

test('backup-like complete replacement validates reviews and restores their decision links', async t => {
  const f = fixture(t), review = {id: 'review-1', record_id: 'buy-1', date: '2026-01-02',
    outcome: 'mixed', lesson: '證據部分支持', next_action: '等待下一期'};
  const imported = state([record()], {reviews: [review], quotes: [
    {ticker: 'NVDA', currency: 'USD', price: 110, date: '2026-01-02'},
  ]});
  await put(f.env, empty());
  const saved = await put(f.env, imported, 1);
  assert.equal(saved.status, 200);
  assert.deepEqual((await request(f.env)).data.state, imported);
  assert.equal(f.changes(), 3);
});

test('SQL injection payload in authenticated identity and decision remains bound data', async t => {
  const f = fixture(t), attacker = "alice'; DROP TABLE ledger_states; --";
  await put(f.env, state([record({reason: 'Alice original'})]));
  const reason = "'); UPDATE ledger_states SET payload = 'corrupt'; --";
  const saved = await put(f.env, state([record({reason})]), 0, {user: attacker});
  assert.equal(saved.status, 200);
  assert.equal((await request(f.env, {user: attacker})).data.state.records[0].reason, reason);
  assert.equal((await request(f.env)).data.state.records[0].reason, 'Alice original');
  assert.equal(f.count(), 2);
});

test('malformed JSON, revision numbers and excessive body fail before persistence', async t => {
  const f = fixture(t);
  assert.equal((await request(f.env, {method: 'PUT', raw: '{'})).status, 400);
  assert.equal((await request(f.env, {method: 'PUT', raw: 'null'})).status, 400);
  for (const expected_revision of [-1, 1.5, '0']) {
    assert.equal((await request(f.env, {method: 'PUT', body: {expected_revision, state: empty()}})).status, 400);
  }
  assert.equal((await request(f.env, {method: 'PUT', raw: ' '.repeat(2000001)})).status, 413);
  assert.equal(f.changes(), 0);
});

test('trigger retains original decision and review before edit; history reads are owner scoped', async t => {
  const f = fixture(t), original = state([record()], {reviews: [{
    id: 'review-1', record_id: 'buy-1', date: '2026-01-02', outcome: 'pending',
    lesson: '原回顧', next_action: '等候',
  }]});
  await put(f.env, original);
  const changed = state([record({reason: '修改後理由', expectation: '不同預期', revision: 2})],
    {reviews: [{...original.reviews[0], lesson: '修改後回顧'}]});
  assert.equal((await put(f.env, changed, 1)).status, 200);
  const loaded = await request(f.env);
  assert.deepEqual(loaded.data.state, changed);
  assert.equal(loaded.data.history.length, 1);
  assert.equal(loaded.data.history[0].revision, 1);
  const history = await request(f.env, {path: '/api/ledger?revision=1'});
  assert.equal(history.status, 200);
  assert.deepEqual(history.data.state, original);
  assert.equal((await request(f.env, {user: 'bob', path: '/api/ledger?revision=1'})).status, 404);
  assert.equal((await request(f.env, {user: null, path: '/api/ledger?revision=1'})).status, 401);
  assert.deepEqual((await request(f.env, {user: 'bob'})).data.history, []);
  assert.equal((await request(f.env, {path: '/api/ledger?revision=2'})).status, 404);
});

test('stale CAS does not fire history trigger or alter original snapshots', async t => {
  const f = fixture(t);
  await put(f.env, state());
  await put(f.env, state([record({reason: 'second', revision: 2})]), 1);
  const before = f.changes();
  assert.equal((await put(f.env, state([record({reason: 'stale'})]), 1)).status, 409);
  assert.equal(f.changes(), before);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM ledger_history').get().n, 1);
  assert.equal((await request(f.env, {path: '/api/ledger?revision=1'})).data.state.records[0].reason, '當時理由');
});

test('history revision input is validated without SQL interpolation', async t => {
  const f = fixture(t);
  for (const revision of ['0', '-1', '1.5', 'abc', "1' OR '1'='1", '1000000000']) {
    assert.equal((await request(f.env, {path: '/api/ledger?revision=' + encodeURIComponent(revision)})).status, 400);
  }
  assert.equal(f.executions(), 0);
  assert.equal(f.changes(), 0);
});


test('same-revision account switch rejects stale state before any write',async t=>{
 const f=fixture(t);await put(f.env,state());await put(f.env,empty(),0,{user:'bob'});
 const scope=(await request(f.env)).data.owner_scope,changes=f.changes();
 const result=await request(f.env,{user:'bob',method:'PUT',body:{expected_revision:1,expected_owner_scope:scope,state:state()}});
 assert.equal(result.status,409);assert.equal(result.data.code,'identity_changed');assert.equal(f.changes(),changes);
 assert.deepEqual((await request(f.env,{user:'bob'})).data.state,empty());
});
test('clearing replaces all current data and retains the complete prior state for recovery',async t=>{
 const f=fixture(t),prior=state();await put(f.env,prior);assert.equal((await put(f.env,empty(),1)).status,200);
 assert.deepEqual((await request(f.env)).data.state,empty());assert.deepEqual((await request(f.env,{path:'/api/ledger?revision=1'})).data.state,prior);
});
test('local storage is explicitly labeled and has a different owner scope',async t=>{
 const f=fixture(t),cloud=await request(f.env);f.env.LEDGER_ENV='isolated_local_qa';const local=await request(f.env);
 assert.equal(local.data.storage,'isolated_local_qa');assert.notEqual(cloud.data.owner_scope,local.data.owner_scope);
});

test('research writes preserve trade history and exact old report pins under owner CAS',async t=>{
 const f=fixture(t),now='2026-10-11T08:00:00Z';
 const observation={id:'watch-1',date:'2026-10-11',action:'watch',reason:'等現金改善',invalidation:'需求下滑',...reportPin('AMZN-20261011-v2-reader-reviewed'),claim_ids:['AMZN-capital'],status:'active',created_at:now,updated_at:now};
 const original=state([record()],{research:{observations:[observation],comparisons:[],checks:[]}});
 assert.equal((await put(f.env,original)).status,200);
 const edited={...original,research:{...original.research,observations:[{...observation,reason:'核對較新資本支出',updated_at:'2026-10-11T09:00:00Z'}]}};
 assert.equal((await put(f.env,edited,1)).status,200);
 const old=await request(f.env,{path:'/api/ledger?revision=1'});
 assert.equal(old.data.state.research.observations[0].reason,'等現金改善');
 assert.deepEqual((await request(f.env)).data.state.records,original.records);
 assert.equal((await request(f.env,{user:'bob',path:'/api/ledger?revision=1'})).status,404);
 assert.equal((await put(f.env,original,1)).status,409);
 const changes=f.changes();
 assert.equal((await put(f.env,{...edited,research:{...edited.research,observations:[{...observation,report_sha256:'0'.repeat(64)}]}},2)).status,422);
 assert.equal(f.changes(),changes);
 // Complete backup-like restore includes research and preserves prior edit.
 assert.equal((await put(f.env,original,2)).status,200);
 assert.deepEqual((await request(f.env)).data.state,original);
 assert.equal((await request(f.env,{path:'/api/ledger?revision=2'})).data.state.research.observations[0].reason,'核對較新資本支出');
});
test('finance split-adjusted state and import history survive whole backup CAS',async t=>{
 const {emptyFinance}=await import('../src/portfolio-core.mjs');const f=fixture(t),finance=emptyFinance();
 finance.events=[{id:'split:1',date:'2026-01-02',type:'SPLIT',currency:'USD',amount:0,ticker:'NVDA',ratio:2,to_currency:'',to_amount:0,note:'split fixture',order:0,created_at:'2026-01-02T00:00:00Z'}];
 const payload=state([record(),record({id:'sell',date:'2026-01-03',side:'SELL',quantity:15})],{finance,imports:[]});
 assert.equal((await put(f.env,payload)).status,200);assert.deepEqual((await request(f.env)).data.state,payload);
 const before=f.changes();assert.equal((await put(f.env,{...payload,finance:{...finance,settings:{...finance.settings,base_currency:'BAD!'}}},1)).status,422);assert.equal(f.changes(),before);
 assert.equal((await put(f.env,empty(),1)).status,200);assert.deepEqual((await request(f.env,{path:'/api/ledger?revision=1'})).data.state,payload);
});


test('private snapshots and favorites preserve each other, prior history and owner CAS',async t=>{
 const f=fixture(t),snap={id:'qa:observation',symbol:'TEST/USDT',product:'perpetual',direction:'short',exchange:null,captured_date:null,screen_time:null,imported_at:'2026-10-12T05:00:00Z',fields:{investment:{value:15,unit:'USDT'}},sources:[{name:'qa-only.png',sha256:'1'.repeat(64),library_file_id:'libfile_example'}],note:'test fixture',observed_history:[]};
 const prior=state([record()],{snapshots:[snap],company_favorites:[]});
 assert.equal((await put(f.env,prior)).status,200);
 const favorite={...prior,company_favorites:['NVDA']};assert.equal((await put(f.env,favorite,1)).status,200);
 assert.deepEqual((await request(f.env)).data.state,favorite);
 assert.deepEqual((await request(f.env,{path:'/api/ledger?revision=1'})).data.state,prior);
 const edits={...favorite,snapshots:[{...snap,exchange:'Example Exchange'}]};assert.equal((await put(f.env,edits,2)).status,200);
 assert.deepEqual((await request(f.env)).data.state.company_favorites,['NVDA']);
 assert.equal((await put(f.env,prior,2)).status,409);
 assert.deepEqual((await request(f.env,{user:'bob'})).data.state,empty());
});

test('existing journal cannot be omitted by old writer; explicit restore is base-bound',async t=>{
 const {env}=fixture(t),journal={version:1,positions:[],entries:[],intakes:[]},first=state([],{journal});assert.equal((await put(env,first)).status,200);
 const rejected=await put(env,empty(),1);assert.equal(rejected.status,409);assert.equal(rejected.data.code,'client_upgrade_required');
 const {digest}=await import('../src/decision-workspace.mjs');const bad=await request(env,{method:'PUT',body:{expected_revision:1,state:empty(),intent:'restore',restore_base_digest:'0'.repeat(64)}});assert.equal(bad.status,409);
 const good=await request(env,{method:'PUT',body:{expected_revision:1,state:empty(),intent:'restore',restore_base_digest:await digest(first)}});assert.equal(good.status,200);
 const old=await request(env,{path:'/api/ledger?revision=1'});assert.deepEqual(old.data.state.journal,journal);
});
test('invalid journal fields return paths and cause no partial write',async t=>{const {env,count}=fixture(t),r=await put(env,state([],{journal:{version:1,positions:[],entries:[{id:'bad'}],intakes:[]}}));assert.equal(r.status,422);assert.ok(r.data.fields[0].path.startsWith('journal'));assert.equal(count(),0);});

test('research versions survive old writers, rewriting and deletion without partial writes',async t=>{
 const f=fixture(t),first=state([],{research_workspace:researchWorkspace()});
 assert.equal((await put(f.env,first)).status,200);
 const writes=f.changes(),omitted=await put(f.env,empty(),1);
 assert.equal(omitted.status,409);assert.equal(omitted.data.code,'client_upgrade_required');
 for(const change of [s=>s.research_workspace.reviews[0].axes.demand.baseline='Rewritten baseline',s=>s.research_workspace.reviews[0].baseline.bundle_sha256='c'.repeat(64),s=>s.research_workspace.reviews=[]]){
  const candidate=structuredClone(first);change(candidate);
  const result=await put(f.env,candidate,1);
  assert.equal(result.status,409);assert.equal(result.data.code,'research_version_conflict');
 }
 assert.equal(f.changes(),writes);assert.deepEqual((await request(f.env)).data.state,first);
});

test('research revisions append while other writers preserve exact existing versions',async t=>{
 const f=fixture(t),first=state([],{research_workspace:researchWorkspace(),company_favorites:[]});
 await put(f.env,first);
 const next=structuredClone(first),review=next.research_workspace.reviews[0];
 next.research_workspace.reviews.push({...structuredClone(review),id:'synthetic-review-2',supersedes:review.id,created_at:'2026-10-13T01:00:00Z',learning:'Synthetic revised lesson'});
 assert.equal((await put(f.env,next,1)).status,200);
 const favorite={...next,company_favorites:['SYNTHETIC']};
 assert.equal((await put(f.env,favorite,2)).status,200);
 assert.deepEqual((await request(f.env)).data.state,favorite);
 assert.deepEqual((await request(f.env,{path:'/api/ledger?revision=1'})).data.state,first);
});

test('explicit research restore requires current digest and preserves prior history',async t=>{
 const f=fixture(t),first=state([],{research_workspace:researchWorkspace()});await put(f.env,first);
 const body={expected_revision:1,state:empty(),intent:'restore',restore_base_digest:'0'.repeat(64)};
 assert.equal((await request(f.env,{method:'PUT',body})).status,409);
 body.restore_base_digest=await digest(first);
 assert.equal((await request(f.env,{method:'PUT',body})).status,200);
 assert.deepEqual((await request(f.env)).data.state,empty());
 assert.deepEqual((await request(f.env,{path:'/api/ledger?revision=1'})).data.state,first);
});

test('research CAS permits one concurrent append and isolates another identity',async t=>{
 const f=fixture(t),first=state([],{research_workspace:researchWorkspace()});await put(f.env,first);
 const candidates=['a','b'].map(id=>{const next=structuredClone(first),review=next.research_workspace.reviews[0];next.research_workspace.reviews.push({...structuredClone(review),id:'synthetic-'+id,supersedes:review.id,created_at:'2026-10-13T01:00:00Z',learning:id});return next;});
 const results=await Promise.all(candidates.map(candidate=>put(f.env,candidate,1)));
 assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 assert.equal((await request(f.env)).data.state.research_workspace.reviews.length,2);
 assert.deepEqual((await request(f.env,{user:'bob'})).data.state,empty());
 assert.equal((await request(f.env,{user:null})).status,401);
});
