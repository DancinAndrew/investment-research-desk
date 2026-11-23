import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,prepareCsvImport,applyCsvImport,undoCsvImport,exportTradesCsv,validateImports} from '../src/csv-ledger.mjs';
const empty=()=>({schema_version:1,records:[],quotes:[],reviews:[]});
const map={date:0,ticker:1,side:2,quantity:3,price:4,currency:5,fees:6,reason:7};
const options={dateFormat:'ISO',numberFormat:'dot',buyValue:'BUY',sellValue:'SELL',defaultCurrency:'',feesMissingZero:false,reasonFallback:'匯入；當時理由未記錄',ownExport:false};
const csv='date,ticker,side,quantity,price,currency,fees,reason\n2026-01-01,NVDA,BUY,10,100,USD,1,"等待成長, 核對付款"\n';
test('CSV handles BOM, quoted commas, embedded newlines, doubled quotes and CRLF',()=>{
 const p=parseCsv('\uFEFFdate,note\r\n2026-01-01,"a,b\n""quoted"""\r\n');
 assert.deepEqual(p.headers,['date','note']);assert.equal(p.rows[0].cells[1],'a,b\n"quoted"');
 for(const text of ['a,a\n1,2','a,b\n"unterminated','a,b\n"x"junk,2'])assert.throws(()=>parseCsv(text));
 assert.throws(()=>parseCsv('x'.repeat(2000001)));
});
test('portable mapping requires explicit fee/currency/date conventions',async()=>{
 const p=parseCsv('D;T;S;Q;P\n02/03/2026;NVDA;買;2;1.234,50',';');
 const mapping={date:0,ticker:1,side:2,quantity:3,price:4};
 const preview=await prepareCsvImport(p,mapping,{...options,dateFormat:'DMY',numberFormat:'comma',buyValue:'買',sellValue:'賣',defaultCurrency:'USD',feesMissingZero:true},empty());
 assert.equal(preview.entries[0].status,'ready');assert.equal(preview.entries[0].record.date,'2026-03-02');assert.equal(preview.entries[0].record.price,1234.5);
 const noFees=await prepareCsvImport(p,mapping,{...options,dateFormat:'DMY',numberFormat:'comma',buyValue:'買',defaultCurrency:'USD'},empty());assert.equal(noFees.entries[0].status,'invalid');
});
test('preview does not write and full import preserves research then detects duplicates',async()=>{
 const state={...empty(),research:{observations:[],comparisons:[],checks:[]}},before=JSON.stringify(state);
 const p=await prepareCsvImport(parseCsv(csv),map,options,state);assert.equal(JSON.stringify(state),before);
 const applied=await applyCsvImport(state,p,[2]);assert.equal(applied.ok,true);assert.equal(applied.state.records.length,1);assert.deepEqual(applied.state.research,state.research);
 const repeated=await prepareCsvImport(parseCsv(csv),map,options,applied.state);assert.equal(repeated.entries[0].status,'duplicate');
 assert.equal((await applyCsvImport(applied.state,repeated,[2])).ok,false);
 assert.equal(validateImports(applied.state.imports,applied.state.records).ok,true);
});
test('identical partial fills need explicit retention and IDs remain unique',async()=>{
 const p=await prepareCsvImport(parseCsv(csv+csv.split('\n')[1]+'\n'),map,options,empty());
 assert.equal(p.entries[1].status,'possible_duplicate');
 assert.equal((await applyCsvImport(empty(),p,[2,3])).ok,false);
 const applied=await applyCsvImport(empty(),p,[2,3],{allowPossibleDuplicates:true});assert.equal(applied.ok,true);assert.equal(new Set(applied.state.records.map(r=>r.id)).size,2);
});
test('full candidate rejects oversell and stale preview; no partial import escapes',async()=>{
 const p=await prepareCsvImport(parseCsv(csv.replace('BUY','SELL')),map,options,empty());
 assert.equal((await applyCsvImport(empty(),p,[2])).ok,false);
 const good=await prepareCsvImport(parseCsv(csv),map,options,empty());
 assert.equal((await applyCsvImport({...empty(),reviews:[{id:'changed'}]},good,[2])).ok,false);
});
test('undo removes only unchanged import, blocks later sells/reviews and leaves history metadata',async()=>{
 const p=await prepareCsvImport(parseCsv(csv),map,options,empty()),a=await applyCsvImport(empty(),p,[2]);
 const undone=await undoCsvImport(a.state,a.batch.id);assert.equal(undone.ok,true);assert.equal(undone.state.records.length,0);assert.equal(undone.state.imports[0].status,'undone');
 const changed={...a.state,records:a.state.records.map(r=>({...r,reason:'改過理由',revision:2}))};assert.equal((await undoCsvImport(changed,a.batch.id)).ok,false);
 const sell={...a.state.records[0],id:'sell-later',date:'2026-01-02',side:'SELL',quantity:1};assert.equal((await undoCsvImport({...a.state,records:[...a.state.records,sell]},a.batch.id)).ok,false);
 assert.equal((await undoCsvImport({...a.state,reviews:[{record_id:a.state.records[0].id}]},a.batch.id)).ok,false);
});
test('CSV export defuses formulas and own-export roundtrip restores exact values',async()=>{
 const p=await prepareCsvImport(parseCsv(csv),map,options,empty()),a=await applyCsvImport(empty(),p,[2]);
 const records=a.state.records.map(r=>({...r,reason:'=HYPERLINK("https://example.com")',invalidation:'line1\nline2'}));
 const exported=exportTradesCsv(records);assert.match(exported,/"'=HYPERLINK/);
 const parsed=parseCsv(exported),mapping=Object.fromEntries(parsed.headers.map((k,i)=>[k,i]));
 const restored=await prepareCsvImport(parsed,mapping,{...options,ownExport:true},empty());assert.equal(restored.entries[0].record.reason,records[0].reason);assert.equal(restored.entries[0].record.invalidation,records[0].invalidation);
 assert.equal(restored.entries[0].record.id,records[0].id);
});
test('batch IDs accept every valid record identifier',async()=>{
 const state={schema_version:1,records:[],quotes:[],reviews:[]};
 const parsed=parseCsv('id,date,ticker,side,quantity,price\nbroker:buy.1,2025-01-01,NVDA,BUY,1,1');
 const preview=await prepareCsvImport(parsed,{id:0,date:1,ticker:2,side:3,quantity:4,price:5},{dateFormat:'ISO',numberFormat:'dot',buyValue:'BUY',sellValue:'SELL',defaultCurrency:'USD',feesMissingZero:true,reasonFallback:'未記錄'},state);
 const r=await applyCsvImport(state,preview,[2]);assert.equal(r.ok,true);assert.equal(validateImports(r.state.imports).ok,true);
});
test('own-export preserves a literal leading apostrophe',async()=>{
 const state=empty(),text=csv.replace('等待成長, 核對付款',"'=1+1");const preview=await prepareCsvImport(parseCsv(text),map,options,state);const applied=await applyCsvImport(state,preview,[2]);const exported=exportTradesCsv(applied.state.records),p=parseCsv(exported),m=Object.fromEntries(p.headers.map((h,i)=>[h,i]));const round=await prepareCsvImport(p,m,{...options,ownExport:true},empty());assert.equal(round.entries[0].record.reason,"'=1+1");
});
