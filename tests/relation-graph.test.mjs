import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {graphSelection,graphEdges,graphPositions,graphGeometry} from '../src/relation-graph.mjs'
const index={nodes:[{id:'AMZN',type:'company'},{id:'NVDA',type:'company'},{id:'Anthropic',type:'company'},{id:'FTC',type:'regulator'}],edges:[{id:'gpu',parties:['NVDA','AMZN']},{id:'training',parties:['AMZN','Anthropic']},{id:'ftc-seller',parties:['FTC','AMZN','Anthropic']},{id:'gpu-coop',parties:['AMZN','NVDA']}]}
test('generic entry requires a choice, unknown centers cannot silently become AMZN',()=>{for(const q of ['', 'center=FAKE']){const state=graphSelection(index,q);assert.equal(state.mode,'choose');assert.deepEqual(graphEdges(index,state),[])}})
test('NVDA center shows only actual related edges and positions NVDA in the middle',()=>{const state=graphSelection(index,'center=NVDA');const edges=graphEdges(index,state);assert.deepEqual(edges.map(e=>e.id),['gpu','gpu-coop']);assert.deepEqual(graphPositions(index.nodes,'NVDA').NVDA,{x:500,y:360});assert.deepEqual(edges[0].parties,['NVDA','AMZN'])})
test('explicit global mode retains multi-party facts and separates parallel labels regardless of party order',()=>{const state=graphSelection(index,'graphMode=global');const edges=graphEdges(index,state);assert.equal(edges.length,4);const geometry=graphGeometry(edges,graphPositions(index.nodes));assert.notDeepEqual(geometry[0].label,geometry[3].label);assert.equal(geometry[2].paths.length,3);for(const e of geometry)assert.ok(Number.isFinite(e.label.x)&&Number.isFinite(e.label.y))})
test('URL restores policy, focus and search without inventing edges',()=>{const s=graphSelection(index,'center=AMZN&category=policy&focus=FTC&filter=seller');assert.deepEqual(graphEdges(index,s).map(e=>e.id),['ftc-seller']);assert.equal(graphSelection(index,'center=AMZN&category=invalid&focus=missing').category,'all')})
test('registered Amazon/Anthropic/OpenAI labels have distinct visible targets, clear of all nodes',()=>{
 const registered=JSON.parse(fs.readFileSync(new URL('../public/data/company-relations.json',import.meta.url)))
 for(const center of ['AMZN','Anthropic','OpenAI','NVDA','']){
  const edges=registered.edges.filter(e=>!center||e.parties.includes(center)),ids=new Set(edges.flatMap(e=>e.parties))
  const positions=graphPositions(registered.nodes.filter(n=>ids.has(n.id)),center)
  for(const labelHeight of [44,54,60,68,78,90,110,164]){
  const labelWidth=Math.max(112,labelHeight),geometry=graphGeometry(edges,positions,{labelWidth,labelHeight})
  assert.deepEqual(geometry.map(e=>e.id),edges.map(e=>e.id))
  geometry.forEach((edge,i)=>{
   assert.deepEqual(edge.parties,edges[i].parties)
   for(const other of geometry.slice(i+1))assert.ok(Math.abs(edge.label.x-other.label.x)>=labelWidth||Math.abs(edge.label.y-other.label.y)>=labelHeight,edge.id+' overlaps '+other.id)
   for(const [id,node] of Object.entries(positions))assert.ok(Math.abs(edge.label.x-node.x)>=(labelWidth+146)/2||Math.abs(edge.label.y-node.y)>=(labelHeight+56)/2,edge.id+' overlaps node '+id)
  })
  }
 }
})
