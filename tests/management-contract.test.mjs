import test from 'node:test';
import assert from 'node:assert/strict';
import {reviewsForEvent,copy} from '../src/decision-workspace.mjs';
import {ledgerClearDependencies,journalRestoreImpact} from '../src/ledger-backup.mjs';

test('legacy associated review preserves its edit identity and original record target',()=>{
 const review={id:'review-original',record_id:'trade-original',date:'2026-01-02',outcome:'mixed',lesson:'Original lesson',next_action:'Check'},state={reviews:[review],journal:{entries:[]}},before=copy(state);
 const row=reviewsForEvent(state,{kind:'record',id:'trade-original'})[0];
 assert.equal(row.kind,'legacy_review');assert.equal(row.id,review.id);assert.equal(row.record_id,review.record_id);assert.deepEqual(row.payload,review);assert.deepEqual(state,before);
 assert.deepEqual(reviewsForEvent(state,{kind:'record',id:'another-trade'}),[]);
});
test('clearing preserves referenced ledger targets even after decisions are withdrawn',()=>{
 const state={journal:{entries:[{position_id:'ledger:TEST:USD',status:'withdrawn'},{position_id:'ledger:TEST:USD',status:'active'},{position_id:'legacy-snapshot:test',status:'active'}]}};
 assert.deepEqual(ledgerClearDependencies(state),['ledger:TEST:USD']);assert.deepEqual(ledgerClearDependencies({}),[]);
});
test('restore impact discloses loss of journal data from old backups and full new counts',()=>{
 const current={journal:{positions:[{}],entries:[{},{}],intakes:[{}]}};
 const legacy=journalRestoreImpact(current,{});assert.equal(legacy.missing_journal,true);assert.deepEqual(legacy.before,{positions:1,entries:2,intakes:1});assert.deepEqual(legacy.after,{positions:0,entries:0,intakes:0});
 assert.equal(journalRestoreImpact({},{}).missing_journal,false);assert.equal(journalRestoreImpact(current,current).missing_journal,false);
 assert.deepEqual(journalRestoreImpact(current,current).after,legacy.before);
});
