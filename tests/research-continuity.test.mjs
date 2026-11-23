import test from 'node:test';
import assert from 'node:assert/strict';
import {validateResearch, compareClaims, comparisonCells, reportPin} from '../src/research-continuity.mjs';
import {validateState} from '../worker/index.mjs';
import {reportRegistry} from '../src/report-registry.mjs';

const oldId='AMZN-20261011-v2-reader-reviewed',newId='AMZN-20261011-v3-reader-reviewed';
const empty=()=>({schema_version:1,records:[],quotes:[],reviews:[]});
const observation=()=>({id:'watch-1',date:'2026-10-11',action:'watch',reason:'等待現金回報改善',invalidation:'付費使用持續下降',...reportPin(oldId),claim_ids:['AMZN-capital'],status:'active',created_at:'2026-10-11T08:00:00Z',updated_at:'2026-10-11T08:00:00Z'});
const research=()=>({observations:[observation()],comparisons:[],checks:[]});

test('old v1 state is unchanged and reading research never creates observations',()=>{
 assert.deepEqual(validateState(empty()).value,empty());
 assert.deepEqual(validateResearch({observations:[],comparisons:[],checks:[]}).value,{observations:[],comparisons:[],checks:[]});
});
test('nontrade decision binds exact old report bytes and claims',()=>{
 const value=validateResearch(research());assert.equal(value.ok,true);
 assert.equal(value.value.observations[0].report_id,oldId);
 assert.notEqual(value.value.observations[0].report_sha256,reportPin(newId).report_sha256);
 const current=validateState({...empty(),research:research()});assert.equal(current.ok,true);
 for(const patch of [{report_sha256:'0'.repeat(64)},{report_id:newId},{report_id:'__proto__',report_sha256:undefined},{report_id:undefined,report_sha256:undefined},{claim_ids:['NVDA-value-capture']},{date:'2026-02-30'},{action:'BUY'},{reason:''},{status:'deleted'},{unexpected:'ignored'}]){
  assert.equal(validateResearch({...research(),observations:[{...observation(),...patch}]}).ok,false,JSON.stringify(patch));
 }
 assert.equal(validateState({...empty(),unknown:{secret:'silently lost'}}).ok,false);
});
test('comparison saves exact versions and fixed questions, not current aliases',()=>{
 const c={id:'comparison-1',name:'AI現金與設備',reports:[reportPin(oldId),reportPin(newId)],questions:['cash','capital'],created_at:'2026-10-11T08:00:00Z'};
 assert.equal(validateResearch({...research(),comparisons:[c]}).ok,true);
 for(const patch of [{questions:['auto-rank']},{reports:[reportPin(oldId)]},{reports:[reportPin(oldId),reportPin(oldId)]}])assert.equal(validateResearch({...research(),comparisons:[{...c,...patch}]}).ok,false);
 const cells=comparisonCells([oldId,newId],['capital']);assert.equal(cells.length,1);
 assert.ok(cells[0].cells.every(cell=>cell.claims.some(c=>c.id==='AMZN-capital')));
 assert.notEqual(cells[0].cells[0].report_sha256,cells[0].cells[1].report_sha256);
 assert.ok(cells[0].cells[1].claims[0].conditions.some(c=>c.includes('2,200')));
});
test('claim diff catches revised condition even when main statement is unchanged',()=>{
 const before=[{id:'capital',text:'設備提高資本依賴',conditions:['2000億'],falsifier:'回報下降'}];
 const after=[{...before[0],conditions:['2200億待核']},{id:'new',text:'新說法',conditions:[],falsifier:''}];
 const diff=compareClaims(before,after,['capital']);assert.equal(diff.length,1);assert.equal(diff[0].status,'changed');
 assert.equal(compareClaims(before,[],['capital'])[0].status,'removed');
 assert.equal(compareClaims(before,before,['capital'])[0].status,'unchanged');
});
test('recheck ties observation and target version without replacing original decision',()=>{
 const check={id:'check-1',observation_id:'watch-1',date:'2026-10-11',...reportPin(newId),outcome:'mixed',note:'指引線索提高成本壓力，一手錄音未核',created_at:'2026-10-11T08:10:00Z'};
 const r={...research(),checks:[check]};assert.equal(validateResearch(r).ok,true);
 assert.equal(validateResearch({...r,checks:[{...check,observation_id:'missing'}]}).ok,false);
 const nvda=Object.keys(reportRegistry).find(id=>id.includes('NVDA-20261011-v6'));
 assert.equal(validateResearch({...r,checks:[{...check,...reportPin(nvda)}]}).ok,false);
 assert.equal(r.observations[0].report_id,oldId);
});
