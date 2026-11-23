import test from 'node:test';
import assert from 'node:assert/strict';
import {validateState} from '../worker/index.mjs';
import {validateSnapshots} from '../src/snapshot-core.mjs';
import {serializeBackup,parseBackup} from '../src/ledger-backup.mjs';
import {replayLedger} from '../src/ledger-core.mjs';
import {filterCompanies} from '../src/company-metadata.mjs';
import {companyCards} from '../src/company-model.mjs';
const observation=()=>({id:'evidence:1',symbol:'TEST/USDT',product:'perpetual',direction:'short',exchange:null,captured_date:null,screen_time:'08:20',imported_at:'2026-10-12T05:00:00Z',fields:{investment:{value:15,unit:'USDT'},average_price:{value:27,unit:'USDT'},total_profit:{value:-3,unit:'USDT'},leverage:{value:2,unit:'x'}},sources:[{name:'private-image.png',sha256:'1'.repeat(64),library_file_id:'libfile_example'}],note:'Quantity and capture date absent.',observed_history:[]});
const empty=()=>({schema_version:1,records:[],quotes:[],reviews:[]});
test('snapshot and favorite survive full backup without creating transactions or positions',()=>{
 const input={...empty(),snapshots:[observation()],company_favorites:['NVDA']};
 assert.deepEqual(validateState(input).value,input);assert.deepEqual(parseBackup(serializeBackup(input)),input);
 assert.deepEqual(replayLedger(input.records,input.quotes).positions,[]);
 assert.equal(input.snapshots[0].fields.quantity,undefined);assert.equal(input.snapshots[0].captured_date,null);
 assert.deepEqual(validateState(empty()).value,empty());
});
test('same instrument distinct observations remain separate; exact duplicate IDs rejected',()=>{
 const a=observation(),b={...observation(),id:'evidence:2',direction:'long'};
 assert.equal(validateSnapshots([a,b]).ok,true);assert.equal(validateSnapshots([a,a]).ok,false);
});
test('stock-token historical quantities can remain incomplete and timezone unknown',()=>{
 const s={...observation(),symbol:'TESTTOKEN',product:'stock_token',direction:'unknown',observed_history:[{side:'BUY',local_datetime:'2026-05-02 08:10:10',timezone:null,quantity:2.5,price:null,currency:null}]};
 assert.equal(validateSnapshots([s]).ok,true);
 for(const local_datetime of ['2026-99-20 08:00:00','2026-02-30 08:00:00','2026-05-02 25:00:00'])assert.equal(validateSnapshots([{...s,observed_history:[{...s.observed_history[0],local_datetime}]}]).ok,false);
});
test('invalid schema, unknown fields, unsafe numbers, sources and favorites reject',()=>{
 const s=observation();
 for(const candidate of [{...s,captured_date:'2026-99-20'},{...s,exchange:15},{...s,fields:{quantity:{value:NaN,unit:'token'}}},{...s,sources:[]},{...s,fields:{pretend_shares:{value:15,unit:'unit'}}},{...s,secret:'x'}])assert.equal(validateSnapshots([candidate]).ok,false);
 for(const company_favorites of [['NVDA','NVDA'],['<script>'],{},[null]])assert.equal(validateState({...empty(),company_favorites}).ok,false);
});
test('search, industry, market and favorite filters compose with explicit unclassified',()=>{
 const items=[{id:'A',name:'Alpha',industry:'chips',markets:['TW','US'],headquarters:'TW'},{id:'B',name:'Beta',industry:'cloud',markets:['US'],headquarters:'TW'},{id:'C',name:'Unknown',industry:null,markets:[]}];
 assert.deepEqual(filterCompanies(items,{query:'alpha',industry:'chips',market:'US',favoritesOnly:true,favorites:['A']}).map(c=>c.id),['A']);
 assert.deepEqual(filterCompanies(items,{market:'TW'}).map(c=>c.id),['A']);
 assert.deepEqual(filterCompanies(items,{industry:'unclassified',market:'unclassified'}).map(c=>c.id),['C']);
 assert.deepEqual(filterCompanies(items,{query:'beta',market:'TW'}),[]);assert.equal(filterCompanies(items).length,3);
});
test('company model preserves explicit industry, listing market and headquarters separately',()=>{
 const cards=companyCards({bundles:[]},{companies:[{company_id:'a',name:'A',industry:'energy',markets:['US'],headquarters:'TW'}]});
 assert.equal(cards[0].industry,'energy');assert.deepEqual(cards[0].markets,['US']);assert.equal(cards[0].headquarters,'TW');
});
