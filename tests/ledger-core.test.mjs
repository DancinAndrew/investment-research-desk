import test from 'node:test';
import assert from 'node:assert/strict';
import {validateRecord, replayLedger, validateLedger, validateBackup} from '../src/ledger-core.mjs';

// Synthetic values exist only in test memory, never in application storage.
function transaction(overrides = {}) {
  return {id: 'buy-1', date: '2026-01-01', ticker: 'NVDA', side: 'BUY',
    quantity: 10, price: 100, currency: 'USD', fees: 10,
    reason: '手動記錄的研究理由', horizon: '', expectation: '', risk: '',
    invalidation: '', report_id: '', source_links: [], status: 'active',
    revision: 1, created_at: '2026-01-01T12:00:00.000Z',
    updated_at: '2026-01-01T12:00:00.000Z', ...overrides};
}
function near(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}
function oversell(result) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.code === 'oversell'));
  assert.equal(result.value, null);
  assert.deepEqual(result.positions, []);
}

test('empty manual ledger has no invented positions, prices or realized gains', () => {
  const result = replayLedger([]);
  assert.equal(result.ok, true);
  assert.deepEqual(result.positions, []);
  assert.deepEqual(result.realized_by_currency, {});
  assert.deepEqual(result.value, {records: [], quotes: []});
});

test('weighted average includes buy fees; partial sell deducts sell fees', () => {
  // 10*100+10 + 10*120+10 = 2220, 20 shares => 111 each.
  // Sell 5*150-5 = 745; cost 555; realized 190; remaining cost 1665.
  const records = [transaction(), transaction({id: 'buy-2', date: '2026-01-02', price: 120}),
    transaction({id: 'sell-1', date: '2026-01-03', side: 'SELL', quantity: 5, price: 150, fees: 5})];
  const result = replayLedger(records, [{ticker: 'NVDA', currency: 'USD', price: 140, date: '2026-01-05'}]);
  assert.equal(result.ok, true);
  const holding = result.positions[0];
  assert.equal(holding.quantity, 15);
  near(holding.average_cost, 111);
  near(holding.cost_basis, 1665);
  near(holding.realized, 190);
  near(holding.market_value, 2100);
  near(holding.unrealized, 435);
  assert.deepEqual(result.realized_by_currency, {USD: 190});
});

test('full liquidation clears cost; a later buy starts a new average', () => {
  const sold = transaction({id: 'sell-1', date: '2026-01-02', side: 'SELL', price: 90, fees: 5});
  const closed = replayLedger([transaction(), sold]);
  assert.equal(closed.positions[0].quantity, 0);
  assert.equal(closed.positions[0].cost_basis, 0);
  assert.equal(closed.positions[0].average_cost, null);
  near(closed.positions[0].realized, -115);
  const reopened = replayLedger([transaction(), sold,
    transaction({id: 'buy-2', date: '2026-01-03', quantity: 2, price: 80, fees: 2})]);
  near(reopened.positions[0].average_cost, 81);
  near(reopened.positions[0].realized, -115);
});

test('historical oversell fails even when a later purchase would cover it', () => {
  oversell(validateLedger([transaction({quantity: 3}),
    transaction({id: 'sell-1', date: '2026-01-02', side: 'SELL', quantity: 4}),
    transaction({id: 'buy-2', date: '2026-01-03', quantity: 100})]));
  oversell(replayLedger([transaction({side: 'SELL', quantity: 0.000001})]));
});

test('editing earlier quantity, date, ticker or currency revalidates subsequent sells', () => {
  const buy = transaction(), sell = transaction({id: 'sell-1', date: '2026-01-02', side: 'SELL', quantity: 8});
  assert.equal(validateLedger([buy, sell]).ok, true);
  for (const edit of [{quantity: 7}, {date: '2026-01-03'}, {ticker: 'MSFT'}, {currency: 'TWD'}]) {
    oversell(validateLedger([{...buy, ...edit, revision: 2}, sell]));
  }
});

test('withdrawing a needed buy is blocked; restoring a withdrawn sell can be blocked', () => {
  const buy = transaction(), sell = transaction({id: 'sell-1', date: '2026-01-02', side: 'SELL', quantity: 8});
  oversell(validateLedger([{...buy, status: 'withdrawn', revision: 2}, sell]));
  const withdrawnSell = {...sell, status: 'withdrawn', revision: 2};
  assert.equal(validateLedger([{...buy, quantity: 5}, withdrawnSell]).ok, true);
  oversell(validateLedger([{...buy, quantity: 5}, {...withdrawnSell, status: 'active', revision: 3}]));
});

test('withdrawn records remain in the audit order and restoring recomputes gains', () => {
  const buy = transaction({status: 'withdrawn', revision: 2});
  const withdrawn = replayLedger([buy]);
  assert.equal(withdrawn.ok, true);
  assert.deepEqual(withdrawn.positions, []);
  assert.equal(withdrawn.ordered_records[0].status, 'withdrawn');
  const restored = replayLedger([{...buy, status: 'active', revision: 3}]);
  assert.equal(restored.positions[0].quantity, 10);
  near(restored.positions[0].cost_basis, 1010);
});

test('ticker and currency jointly identify holdings; realized currencies never combine', () => {
  const result = replayLedger([transaction({fees: 0}),
    transaction({id: 'buy-twd', currency: 'TWD', price: 1000, fees: 0}),
    transaction({id: 'sell-usd', date: '2026-01-02', side: 'SELL', quantity: 2, price: 120, fees: 0}),
    transaction({id: 'sell-twd', date: '2026-01-02', side: 'SELL', currency: 'TWD', quantity: 1, price: 900, fees: 0})],
  [{ticker: 'NVDA', currency: 'USD', price: 130, date: '2026-01-02'}]);
  assert.equal(result.ok, true);
  assert.equal(result.positions.length, 2);
  assert.deepEqual(result.realized_by_currency, {TWD: -100, USD: 40});
  const twd = result.positions.find(position => position.currency === 'TWD');
  assert.equal(twd.quantity, 9);
  assert.equal(twd.unrealized, null);
  oversell(replayLedger([transaction({currency: 'TWD'}),
    transaction({id: 'sell-usd', date: '2026-01-02', side: 'SELL', quantity: 1})]));
});

test('same date uses normalized creation time then ID, independent of input order', () => {
  const buy = transaction({id: 'a-buy', fees: 0});
  const sell = transaction({id: 'z-sell', side: 'SELL', fees: 0});
  for (const records of [[sell, buy], [buy, sell]]) {
    const result = replayLedger(records);
    assert.equal(result.ok, true);
    assert.deepEqual(result.ordered_records.map(record => record.id), ['a-buy', 'z-sell']);
  }
  oversell(replayLedger([{...buy, created_at: '2026-01-01T12:01:00Z', updated_at: '2026-01-01T12:01:00Z'}, sell]));
  assert.equal(replayLedger([{...buy, created_at: '2026-01-01T14:00:00+02:00'}, sell]).ok, true);
});

test('floating point rounding permits selling 0.3 after buying 0.1 and 0.2', () => {
  const result = replayLedger([transaction({quantity: 0.1, fees: 0}),
    transaction({id: 'buy-2', date: '2026-01-02', quantity: 0.2, fees: 0}),
    transaction({id: 'sell-1', date: '2026-01-03', side: 'SELL', quantity: 0.3, fees: 0})]);
  assert.equal(result.ok, true);
  assert.equal(result.positions[0].quantity, 0);
  assert.equal(result.positions[0].cost_basis, 0);
  oversell(replayLedger([transaction({quantity: 0.3, fees: 0}),
    transaction({id: 'sell-1', date: '2026-01-02', side: 'SELL', quantity: 0.300001, fees: 0})]));
  oversell(replayLedger([transaction({quantity: 1e-20, fees: 0}),
    transaction({id: 'sell-1', date: '2026-01-02', side: 'SELL', quantity: 2e-20, fees: 0})]));
});

test('missing quote means unknown market value and unrealized; zero quote is rejected', () => {
  const holding = replayLedger([transaction()]).positions[0];
  for (const field of ['quote_price', 'quote_date', 'market_value', 'unrealized']) assert.equal(holding[field], null);
  for (const price of [0, -1, Infinity, NaN, '100']) {
    assert.equal(replayLedger([transaction()], [{ticker: 'NVDA', currency: 'USD', price, date: '2026-01-02'}]).ok, false);
  }
});

test('optional thesis can be blank; omissions are explicit and reason is required', () => {
  const input = transaction({ticker: 'nvda', currency: 'usd', reason: '  理由  '});
  delete input.risk;
  const result = validateRecord(input);
  assert.equal(result.ok, true);
  assert.equal(result.value.risk, '');
  assert.equal(result.value.reason, '理由');
  assert.equal(result.value.ticker, 'NVDA');
  assert.deepEqual(result.missing_fields, ['horizon', 'expectation', 'risk', 'invalidation']);
  assert.deepEqual(replayLedger([input]).incomplete_records, [{id: 'buy-1', fields: result.missing_fields}]);
  assert.equal(validateRecord(transaction({reason: '   '})).ok, false);
});

test('rejects negative, infinite, typed strings, impossible dates and excess text', () => {
  for (const patch of [{quantity: -1}, {quantity: 0}, {price: 0}, {fees: -0.1},
    {price: Infinity}, {quantity: NaN}, {quantity: '10'}, {date: '2026-02-30'},
    {created_at: '2026-02-30T12:00:00Z'}, {created_at: '2026-01-01T12:00:00'},
    {updated_at: '2025-12-31T12:00:00Z'}, {reason: 'a'.repeat(5001)},
    {risk: 'a'.repeat(5001)}, {revision: 0}, {revision: 1.5}, {side: 'buy'},
    {status: 'deleted'}, {unexpected: 'field'}]) {
    assert.equal(validateRecord(transaction(patch)).ok, false, JSON.stringify(patch));
  }
  assert.equal(validateRecord(transaction({date: '2024-02-29'})).ok, true);
});

test('source links reject executable schemes, credentials, malformed URLs and excessive lists', () => {
  for (const link of ['javascript:alert(1)', 'data:text/html,test', 'file:///private/test',
    'not-a-url', 'https://', 'https://user:secret@example.com', ' https://example.com',
    'https://example.com/\nspoof', 'https://example.com/' + 'a'.repeat(2048)]) {
    assert.equal(validateRecord(transaction({source_links: [link]})).ok, false);
  }
  assert.equal(validateRecord(transaction({source_links: Array(31).fill('https://example.com')})).ok, false);
  assert.equal(validateRecord(transaction({source_links: ['https://example.com/report?q=NVDA#section']})).ok, true);
});

test('rejects duplicate IDs, ambiguous quotes, overlarge amounts and non-array inputs', () => {
  assert.equal(validateLedger([transaction(), transaction()]).errors[0].code, 'duplicate_id');
  const quote = {ticker: 'NVDA', currency: 'USD', price: 100, date: '2026-01-01'};
  assert.equal(replayLedger([], [quote, {...quote, ticker: 'nvda'}]).ok, false);
  assert.equal(replayLedger([transaction({quantity: 1e12, price: 1e12})]).errors[0].code, 'numeric_overflow');
  assert.equal(replayLedger({}).ok, false);
  assert.equal(replayLedger([], {}).ok, false);
  assert.equal(validateRecord(null).ok, false);
});

test('backup validation rejects wrong schema, malformed records and historical oversell', () => {
  const backup = {schema_version: 1, records: [transaction()], quotes: []};
  const checked = validateBackup(backup);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.value, backup);
  for (const invalid of [null, [], {}, {...backup, schema_version: 2},
    {...backup, quotes: undefined}, {...backup, extra: []}, {...backup, records: [{}]},
    {...backup, records: [transaction({side: 'SELL'})]},
    {...backup, quotes: [{ticker: 'NVDA', currency: 'USD', price: 1, date: '2026-02-30'}]}]) {
    const result = validateBackup(invalid);
    assert.equal(result.ok, false);
    assert.equal(result.value, null);
  }
});

test('functions do not mutate records, quotes or caller-owned backups', () => {
  const record = Object.freeze({...transaction(), source_links: Object.freeze(['https://example.com'])});
  const records = Object.freeze([record]);
  const quotes = Object.freeze([Object.freeze({ticker: 'NVDA', currency: 'USD', price: 100, date: '2026-01-02'})]);
  const original = JSON.stringify({records, quotes});
  const result = replayLedger(records, quotes);
  assert.equal(result.ok, true);
  result.value.records[0].source_links.push('https://other.example');
  result.positions[0].quantity = 999;
  assert.equal(JSON.stringify({records, quotes}), original);
  assert.equal(validateBackup(Object.freeze({schema_version: 1, records, quotes})).ok, true);
});
