import test from 'node:test';
import assert from 'node:assert/strict';
import {replayLedger} from '../src/ledger-core.mjs';
import {validateFinance,replayPortfolio,portfolioReturns} from '../src/portfolio-core.mjs';
const record=(patch={})=>({id:'buy',date:'2025-01-01',ticker:'NVDA',side:'BUY',quantity:10,price:100,currency:'USD',fees:10,reason:'fixture',horizon:'',expectation:'',risk:'',invalidation:'',report_id:'',source_links:[],status:'active',revision:1,created_at:'2025-01-01T00:00:00Z',updated_at:'2025-01-01T00:00:00Z',...patch});
const event=(patch={})=>({id:'deposit',date:'2025-01-01',type:'DEPOSIT',currency:'USD',amount:2000,ticker:'',ratio:1,to_currency:'',to_amount:0,note:'fixture',order:0,created_at:'2025-01-01T00:00:00Z',...patch});
const finance=()=>({events:[],prices:[],fx:[],valuations:[],benchmark:[],settings:{base_currency:'USD',history_complete:false,benchmark_name:'',benchmark_kind:'total_return'}});
test('split doubles shares without creating profit, and later sell uses adjusted average',()=>{
 const split={id:'split',date:'2025-02-01',ticker:'NVDA',currency:'USD',ratio:2};
 const r=replayLedger([record(),record({id:'sell',date:'2025-03-01',side:'SELL',quantity:15,price:60,fees:5})],[],[split]);
 assert.equal(r.ok,true);assert.equal(r.positions[0].quantity,5);assert.equal(r.positions[0].cost_basis,252.5);assert.equal(r.positions[0].realized,137.5);
 assert.equal(replayLedger([record()],[{ticker:'NVDA',currency:'USD',price:100,date:'2025-01-31'}],[split]).positions[0].market_value,null);
});
test('cash includes actual trades, dividends, fees, tax and FX without adding external flows twice',()=>{
 const f=finance();f.events=[event(),event({id:'div',date:'2025-02-01',type:'DIVIDEND',ticker:'NVDA',amount:20}),event({id:'tax',date:'2025-02-01',type:'TAX',amount:3}),event({id:'fee',date:'2025-02-01',type:'FEE',amount:2}),event({id:'fx',date:'2025-03-01',type:'FX',amount:100,to_currency:'TWD',to_amount:3200})];
 f.prices=[{ticker:'NVDA',currency:'USD',date:'2025-03-01',price:110}];f.fx=[{date:'2025-03-01',currency:'TWD',base_currency:'USD',rate:1/32}];
 const r=replayPortfolio([record()],f,'2025-03-01');assert.equal(r.ok,true);assert.equal(r.cash.USD,905);assert.equal(r.cash.TWD,3200);assert.equal(r.total_value,2105);
 assert.equal(replayPortfolio([record()],{...f,fx:[]},'2025-03-01').total_value,null);
 assert.equal(replayPortfolio([record()],{...f,prices:[]},'2025-03-01').total_value,null);
 assert.ok(replayPortfolio([record()],finance(),'2025-03-01').gaps.some(g=>g.includes('現金')));
});
test('finance validation rejects impossible dates, cross currency identity, invalid corporate actions',()=>{
 assert.equal(validateFinance(finance()).ok,true);
 for(const patch of [{date:'2025-02-30'},{amount:-1},{type:'CASH_GUESS'},{type:'FX',to_currency:'USD',to_amount:10},{type:'SPLIT',ticker:'NVDA',amount:0,ratio:0},{extra:'ignored'}])assert.equal(validateFinance({...finance(),events:[event(patch)]}).ok,false,JSON.stringify(patch));
});
const value=(id,date,amount,phase='close',flow_id='')=>({id,date,currency:'USD',value:amount,phase,flow_id});
test('known one year return is 21% and benchmark 18%, cash-flow boundary TWR remains 21%',()=>{
 const f=finance();f.settings.history_complete=true;f.valuations=[value('start','2025-01-01',100),value('end','2026-01-01',121)];f.benchmark=[{date:'2025-01-01',currency:'USD',value:100},{date:'2026-01-01',currency:'USD',value:118}];
 const r=portfolioReturns(f,'2025-01-01','2026-01-01');assert.ok(Math.abs(r.twr-0.21)<1e-12);assert.ok(Math.abs(r.mwr-0.21)<1e-9);assert.ok(Math.abs(r.benchmark_return-0.18)<1e-12);assert.ok(Math.abs(r.excess_return-0.03)<1e-12);
 const dep=event({id:'mid',date:'2025-07-01',amount:100});f.events=[dep];f.valuations=[value('start','2025-01-01',100),value('pre','2025-07-01',110,'before_flow','mid'),value('post','2025-07-01',210,'after_flow','mid'),value('end','2026-01-01',231)];
 const withFlow=portfolioReturns(f,'2025-01-01','2026-01-01');assert.ok(Math.abs(withFlow.twr-.21)<1e-12);assert.ok(withFlow.mwr>0.20&&withFlow.mwr<0.22);
 assert.equal(portfolioReturns({...f,valuations:f.valuations.filter(v=>v.id!=='pre')},'2025-01-01','2026-01-01').twr,null);
});
test('missing attestation/FX, conflicting boundary value and ambiguous IRR do not invent performance',()=>{
 const f=finance();f.valuations=[value('start','2025-01-01',100),value('end','2026-01-01',121)];
 assert.equal(portfolioReturns(f,'2025-01-01','2026-01-01').mwr,null);f.settings.history_complete=true;
 f.events=[event({id:'out',date:'2025-06-01',type:'WITHDRAWAL',amount:10}),event({id:'in',date:'2025-07-01',amount:10})];
 assert.equal(portfolioReturns(f,'2025-01-01','2026-01-01').mwr,null);
 f.events=[event({id:'twd',date:'2025-07-01',currency:'TWD',amount:3200})];
 assert.equal(portfolioReturns(f,'2025-01-01','2026-01-01').mwr,null);
});
test('accepted punctuation split ID replays, and historical negative cash remains a gap',()=>{
 const f=finance();f.events=[event(),event({id:'split:1',date:'2025-02-01',type:'SPLIT',ticker:'NVDA',amount:0,ratio:2})];f.prices=[{ticker:'NVDA',currency:'USD',date:'2025-03-01',price:55}];
 assert.equal(replayPortfolio([record()],f,'2025-03-01').ok,true);
 f.events=[event({date:'2025-02-01'})];f.prices[0].price=110;
 const r=replayPortfolio([record()],f,'2025-03-01');assert.equal(r.total_value,null);assert.ok(r.gaps.some(g=>g.includes('2025-01-01')&&g.includes('現金')));
});
test('forty-five-year XIRR remains stable at five percent',()=>{
 const f=finance();f.settings.history_complete=true;const years=(Date.parse('2025-01-01')-Date.parse('1980-01-01'))/86400000/365;
 f.valuations=[value('start','1980-01-01',100),value('end','2025-01-01',100*1.05**years)];
 assert.ok(Math.abs(portfolioReturns(f,'1980-01-01','2025-01-01').mwr-.05)<1e-10);
});
test('small valid fractional holding is valued and malformed records fail safely',()=>{
 const f=finance();f.events=[event({amount:1})];f.prices=[{ticker:'NVDA',currency:'USD',date:'2025-03-01',price:1e12}];
 const r=replayPortfolio([record({quantity:5e-9,price:1,fees:0})],f,'2025-03-01');assert.equal(r.positions[0].market_value,5000);
 assert.equal(replayPortfolio([null],finance(),'2025-03-01').ok,false);
});
