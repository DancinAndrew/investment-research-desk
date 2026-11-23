/**
 * Pure manual-ledger domain. All functions return {ok, errors, value}; failures
 * never expose partially calculated holdings. Numbers are numbers, not form
 * strings. Callers validate the entire proposed ledger before committing any
 * edit, withdrawal, restoration or import. No prices, FX or trades are fetched.
 */
const MAX_ROWS = 10000;
const MAX_NUMBER = 1e12;
const TEXT_LIMITS = {
  reason: 5000, horizon: 200, expectation: 5000, risk: 5000,
  invalidation: 5000, report_id: 200,
};
const THESIS_FIELDS = ['horizon', 'expectation', 'risk', 'invalidation'];
const RECORD_KEYS = new Set([
  'id', 'date', 'ticker', 'side', 'quantity', 'price', 'currency', 'fees',
  ...Object.keys(TEXT_LIMITS), 'source_links', 'status', 'revision',
  'created_at', 'updated_at',
]);
const plainObject = value => value !== null && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const issue = (path, code, message) => ({path, code, message});
const result = (errors, value, extra = {}) => ({ok: errors.length === 0, errors,
  value: errors.length ? null : value, ...extra});
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
      || value.startsWith('0000')) return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function timestamp(value) {
  if (typeof value !== 'string' || value.length > 40
      || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)
      || !validDate(value.slice(0, 10))) return null;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const normalized = new Date(time).toISOString();
  return /^\d{4}-/.test(normalized) ? normalized : null;
}

function textField(value, path, limit, errors, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > limit
      || (required && !value.trim())) {
    errors.push(issue(path, 'invalid_text', `${path} 需為${required ? '非空' : ''}文字，最多 ${limit} 字元`));
    return '';
  }
  return value.trim();
}

function numberField(value, path, errors, positive = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)
      || (positive ? value <= 0 : value < 0) || value > MAX_NUMBER) {
    errors.push(issue(path, 'invalid_number', `${path} 需為${positive ? '大於零' : '非負'}有限數字，最多 ${MAX_NUMBER}`));
  }
  return value;
}

function instrument(input, errors) {
  const ticker = textField(input.ticker, 'ticker', 32, errors, true).toUpperCase();
  const currency = textField(input.currency, 'currency', 3, errors, true).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._:^/\-]{0,31}$/.test(ticker)) {
    errors.push(issue('ticker', 'invalid_ticker', '標的代號格式無效'));
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    errors.push(issue('currency', 'invalid_currency', '幣別需為三個英文字母'));
  }
  return {ticker, currency};
}

/** Optional thesis fields normalize to ''; missing_fields makes omissions explicit. */
export function validateRecord(input) {
  const errors = [];
  if (!plainObject(input)) return result([issue('', 'invalid_record', '交易需為物件')], null);
  for (const key of Object.keys(input)) {
    if (!RECORD_KEYS.has(key)) errors.push(issue(key, 'unknown_field', '交易含未知欄位'));
  }
  const value = {id: textField(input.id, 'id', 128, errors, true),
    date: input.date, ...instrument(input, errors), side: input.side,
    quantity: numberField(input.quantity, 'quantity', errors, true),
    price: numberField(input.price, 'price', errors, true),
    fees: numberField(input.fees, 'fees', errors),
    status: input.status, revision: input.revision,
    created_at: timestamp(input.created_at), updated_at: timestamp(input.updated_at)};
  if (!/^[A-Za-z0-9][A-Za-z0-9._:\-]{0,127}$/.test(value.id)) {
    errors.push(issue('id', 'invalid_id', '交易 ID 格式無效'));
  }
  if (!validDate(value.date)) errors.push(issue('date', 'invalid_date', '交易日期需為有效 YYYY-MM-DD'));
  if (!['BUY', 'SELL'].includes(value.side)) errors.push(issue('side', 'invalid_side', '交易方向需為 BUY 或 SELL'));
  if (!['active', 'withdrawn'].includes(value.status)) errors.push(issue('status', 'invalid_status', '狀態需為 active 或 withdrawn'));
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    errors.push(issue('revision', 'invalid_revision', '版本需為大於零的安全整數'));
  }
  if (!value.created_at) errors.push(issue('created_at', 'invalid_timestamp', '建立時間需為有效且含時區的 ISO 時間'));
  if (!value.updated_at) errors.push(issue('updated_at', 'invalid_timestamp', '更新時間需為有效且含時區的 ISO 時間'));
  if (value.created_at && value.updated_at && value.updated_at < value.created_at) {
    errors.push(issue('updated_at', 'invalid_timestamp_order', '更新時間不可早於建立時間'));
  }
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    value[field] = textField(input[field], field, limit, errors, field === 'reason');
  }
  value.source_links = [];
  if (input.source_links !== undefined && (!Array.isArray(input.source_links) || input.source_links.length > 30)) {
    errors.push(issue('source_links', 'invalid_links', '來源需為最多 30 筆網址陣列'));
  } else {
    for (const [index, link] of (input.source_links || []).entries()) {
      let valid = typeof link === 'string' && link.length <= 2048 && link === link.trim()
        && !/[\s\u0000-\u001f\u007f]/.test(link);
      if (valid) {
        try {
          const url = new URL(link);
          valid = ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname)
            && !url.username && !url.password;
        } catch { valid = false; }
      }
      if (!valid) errors.push(issue(`source_links[${index}]`, 'invalid_url', '來源需為有效 HTTP(S) 網址'));
      else value.source_links.push(link);
    }
  }
  return result(errors, value, {missing_fields: THESIS_FIELDS.filter(field => !value[field])});
}

function validateQuotes(quotes) {
  const errors = [], values = [], keys = new Set();
  if (!Array.isArray(quotes) || quotes.length > MAX_ROWS) {
    return result([issue('quotes', 'invalid_quotes', `報價需為最多 ${MAX_ROWS} 筆陣列`)], null);
  }
  for (const [index, input] of quotes.entries()) {
    const quoteErrors = [];
    if (!plainObject(input)) {
      errors.push(issue(`quotes[${index}]`, 'invalid_quote', '報價需為物件'));
      continue;
    }
    for (const key of Object.keys(input)) {
      if (!['ticker', 'currency', 'price', 'date'].includes(key)) {
        quoteErrors.push(issue(key, 'unknown_field', '報價含未知欄位'));
      }
    }
    const quote = {...instrument(input, quoteErrors),
      price: numberField(input.price, 'price', quoteErrors, true), date: input.date};
    if (!validDate(quote.date)) quoteErrors.push(issue('date', 'invalid_date', '報價日期需為有效 YYYY-MM-DD'));
    const key = `${quote.ticker}|${quote.currency}`;
    if (keys.has(key)) quoteErrors.push(issue('', 'duplicate_quote', '同標的及幣別只能有一筆手動報價'));
    keys.add(key);
    errors.push(...quoteErrors.map(error => ({...error, path: `quotes[${index}]${error.path ? '.' + error.path : ''}`})));
    values.push(quote);
  }
  return result(errors, values);
}

function emptyCalculation() {
  return {positions: [], realized_by_currency: {}, ordered_records: [], incomplete_records: []};
}

/** Weighted average cost, grouped by ticker AND currency. No FX aggregation. */
export function replayLedger(records, quotes = [], splits = []) {
  const errors = [], normalized = [];
  if (!Array.isArray(records) || records.length > MAX_ROWS) {
    return result([issue('records', 'invalid_ledger', `帳本需為最多 ${MAX_ROWS} 筆陣列`)], null, emptyCalculation());
  }
  const ids = new Set();
  for (const [index, record] of records.entries()) {
    const checked = validateRecord(record);
    errors.push(...checked.errors.map(error => ({...error, path: `records[${index}]${error.path ? '.' + error.path : ''}`})));
    if (checked.ok) {
      if (ids.has(checked.value.id)) errors.push(issue(`records[${index}].id`, 'duplicate_id', '帳本含重複交易 ID'));
      ids.add(checked.value.id);
      normalized.push(checked.value);
    }
  }
  const checkedQuotes = validateQuotes(quotes);
  errors.push(...checkedQuotes.errors);
  if(!Array.isArray(splits)||splits.length>MAX_ROWS)errors.push(issue('splits','invalid_split','拆併股格式無效'));
  else for(const s of splits){
    if(!plainObject(s)||Object.keys(s).some(k=>!['id','date','ticker','currency','ratio'].includes(k))||typeof s.id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:\-]{0,127}$/.test(s.id)||ids.has(s.id)||!validDate(s.date)||typeof s.ticker!=='string'||!/^[A-Z0-9][A-Z0-9._:^/\-]{0,31}$/.test(s.ticker)||typeof s.currency!=='string'||!/^[A-Z]{3}$/.test(s.currency)||typeof s.ratio!=='number'||!Number.isFinite(s.ratio)||s.ratio<=0||s.ratio>MAX_NUMBER)errors.push(issue('splits','invalid_split','拆併股日期、標的、幣別或比例無效'));
    ids.add(s?.id);
  }
  if (errors.length) return result(errors, null, emptyCalculation());
  const ordered = [...normalized,...splits.map(s=>({...s,side:'SPLIT',created_at:''}))].sort((a, b) => compareText(a.date, b.date)
    || compareText(a.created_at, b.created_at) || compareText(a.id, b.id));
  const holdings = new Map(), realized = new Map();
  for (const record of ordered) {
    if (record.status === 'withdrawn') continue;
    if(record.side==='SPLIT'){
      const key=record.ticker+'|'+record.currency,holding=holdings.get(key);
      if(holding){const quantity=holding.quantity*record.ratio;if(!Number.isFinite(quantity)||quantity>Number.MAX_SAFE_INTEGER){errors.push(issue('splits','numeric_overflow','拆併股後股數超過可安全計算範圍'));break;}holdings.set(key,{...holding,quantity});}
      continue;
    }
    if (record.quantity * record.price + record.fees > Number.MAX_SAFE_INTEGER) {
      errors.push(issue(`records.${record.id}`, 'numeric_overflow', '交易總額超過可安全計算的數值範圍'));
      break;
    }
    const key = `${record.ticker}|${record.currency}`;
    const holding = holdings.get(key) || {ticker: record.ticker, currency: record.currency,
      quantity: 0, cost_basis: 0, realized: 0};
    if (record.side === 'BUY') {
      holding.quantity += record.quantity;
      holding.cost_basis += record.quantity * record.price + record.fees;
    } else {
      // Tolerance only covers machine rounding, never an arbitrary share amount.
      const tolerance = 8 * Number.EPSILON * Math.max(holding.quantity, record.quantity);
      if (record.quantity - holding.quantity > tolerance || holding.quantity === 0) {
        errors.push(issue(`records.${record.id}.quantity`, 'oversell', `${record.date} 的 ${record.ticker} 賣出 ${record.quantity} 股，但當時只有 ${holding.quantity} 股（${record.currency}）。請先修正前後交易。`));
        break;
      }
      const fullSale = Math.abs(holding.quantity - record.quantity) <= tolerance;
      const sold = Math.min(record.quantity, holding.quantity);
      const soldCost = fullSale ? holding.cost_basis : holding.cost_basis * (sold / holding.quantity);
      const gain = sold * record.price - record.fees - soldCost;
      holding.quantity = fullSale ? 0 : holding.quantity - sold;
      holding.cost_basis -= soldCost;
      if (holding.quantity === 0) holding.cost_basis = 0;
      holding.realized += gain;
      realized.set(record.currency, (realized.get(record.currency) || 0) + gain);
    }
    if (![holding.quantity, holding.cost_basis, holding.realized,
      realized.get(record.currency) || 0].every(value => Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)) {
      errors.push(issue(`records.${record.id}`, 'numeric_overflow', '交易總額超過可安全計算的數值範圍'));
      break;
    }
    holdings.set(key, holding);
  }
  if (errors.length) return result(errors, null, emptyCalculation());
  const quoteMap = new Map(checkedQuotes.value.map(quote => [`${quote.ticker}|${quote.currency}`, quote]));
  const positions = [...holdings.entries()].sort(([a], [b]) => compareText(a, b)).map(([key, holding]) => {
    const latestSplit=splits.filter(s=>s.ticker===holding.ticker&&s.currency===holding.currency).map(s=>s.date).sort().at(-1);
    const candidate=quoteMap.get(key),quote=candidate&&(!latestSplit||candidate.date>=latestSplit)?candidate:null, marketValue = quote ? holding.quantity * quote.price : null;
    return {...holding, average_cost: holding.quantity ? holding.cost_basis / holding.quantity : null,
      quote_price: quote?.price ?? null, quote_date: quote?.date ?? null,
      market_value: marketValue, unrealized: quote ? marketValue - holding.cost_basis : null};
  });
  if (positions.some(position => position.market_value !== null
      && (!Number.isFinite(position.market_value) || position.market_value > Number.MAX_SAFE_INTEGER))) {
    return result([issue('quotes', 'numeric_overflow', '持倉市值超過可安全計算的數值範圍')], null, emptyCalculation());
  }
  return result([], {records: normalized, quotes: checkedQuotes.value}, {
    positions, realized_by_currency: Object.fromEntries([...realized.entries()].sort(([a], [b]) => compareText(a, b))),
    ordered_records: ordered.filter(r=>r.side!=='SPLIT'),
    incomplete_records: ordered.filter(record => record.status === 'active').map(record => ({
      id: record.id, fields: THESIS_FIELDS.filter(field => !record[field]),
    })).filter(record => record.fields.length),
  });
}

/** Validate the complete candidate state before persistence; also returns calculations. */
export function validateLedger(records, quotes = [], splits = []) {
  return replayLedger(records, quotes, splits);
}

/** Backup v1 is exactly {schema_version:1, records, quotes}; importing is caller-owned. */
export function validateBackup(input, splits = []) {
  if (!plainObject(input) || input.schema_version !== 1
      || !Object.hasOwn(input, 'records') || !Object.hasOwn(input, 'quotes')
      || !Array.isArray(input.records) || !Array.isArray(input.quotes)
      || Object.keys(input).some(key => !['schema_version', 'records', 'quotes'].includes(key))) {
    return result([issue('', 'invalid_backup', '備份需為 schema_version 1，並含 records 與 quotes')], null);
  }
  const checked = validateLedger(input.records, input.quotes, splits);
  return result(checked.errors, {schema_version: 1, ...checked.value});
}
