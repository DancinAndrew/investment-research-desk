// Synthetic research only: no real issuer, source, report or private state.
export function researchWorkspace() {
  return {schema_version:1,reviews:[{
    id:'synthetic-review-1',company:'SYNTHETIC',created_at:'2026-10-13T00:00:00Z',supersedes:null,
    baseline:{report_id:null,report_sha256:null,bundle_sha256:'b'.repeat(64),month:'2026-10',cutoff:'2026-10-12T00:00:00Z'},
    outcome:'pending',axes:Object.fromEntries(['demand','operations','competition','price'].map(key=>[key,{baseline:'Synthetic frozen baseline',new_evidence:['synthetic-source'],support:'Synthetic support',counterevidence:'Synthetic counterevidence',unknown:'Synthetic missing evidence'}])),
    evidence:[{id:'synthetic-source',title:'Synthetic source',url:'https://example.invalid/research',locator:'paragraph 1',published_at:'2026-10-11T00:00:00Z',precision:'timestamp',rights:'link_only'}],
    reasons:[{category:'data_gap',note:'Synthetic gap',evidence_ids:['synthetic-source']}],counter_case:'Synthetic alternative',learning:'Synthetic lesson',tasks:[]
  }],scenarios:[],rules:[]};
}
