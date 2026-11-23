import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeBackup,parseBackup,researchRestoreImpact} from '../src/ledger-backup.mjs';
import {researchWorkspace} from './helpers/research-workspace.mjs';
import {emptyFinance} from '../src/portfolio-core.mjs';
const state={schema_version:1,records:[],quotes:[],reviews:[]};
test('backup text round trips the whole validated state',()=>assert.deepEqual(parseBackup(serializeBackup(state,'2026-10-11T00:00:00Z')),state));
test('bad JSON gives Chinese explanation without exposing parser internals',()=>assert.throws(()=>parseBackup('{bad-json'),/JSON 格式錯誤/));
test('full backup retains research workspace alongside every optional legacy slice',()=>{
 const full={...state,finance:emptyFinance(),imports:[],snapshots:[],company_favorites:['SYNTHETIC'],research:{observations:[],comparisons:[],checks:[]},journal:{version:1,positions:[],entries:[],intakes:[]},research_workspace:researchWorkspace()};
 assert.deepEqual(parseBackup(serializeBackup(full)),full);
});
test('restore impact detects replaced research IDs even when version counts match',()=>{
 const current={...state,research_workspace:researchWorkspace()},candidate=structuredClone(current);
 candidate.research_workspace.reviews[0].id='synthetic-replacement';
 assert.equal(researchRestoreImpact(current,candidate).removes_versions,true);
 assert.equal(researchRestoreImpact(current,current).removes_versions,false);
 assert.equal(researchRestoreImpact(current,state).missing_workspace,true);
});
