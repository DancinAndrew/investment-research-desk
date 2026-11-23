import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import {prepareMarkdown,safeMarkdown} from '../src/canonical-view.js'

test('all migrated documents retain the exact previously generated tables, formulas and links',async()=>{
 const prior=JSON.parse(await readFile(new URL('../src/markdown-ast.json',import.meta.url),'utf8'))
 const dir=new URL('../public/data/markdown-ast/',import.meta.url)
 assert.ok((await readdir(dir)).length>=Object.keys(prior).length)
 for(const [id,blocks] of Object.entries(prior))assert.deepEqual(JSON.parse(await readFile(new URL(id+'.json',dir),'utf8')),blocks,id)
})

test('failed or aborted reads can retry; loaded Markdown preserves structure and blocks executable links',async()=>{
 const saved=globalThis.fetch,markdown='# Loading fixture\n\n[unsafe](javascript:alert(1))\n'
 let calls=0
 globalThis.fetch=async(_url,{signal}={})=>{
  calls++
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError')
  if(calls===1)return {ok:false,status:503}
  return {ok:true,json:async()=>[
   {t:'Header',c:[1,['',[],[]],[{t:'Str',c:'Loading fixture'}]]},
   {t:'Para',c:[{t:'Link',c:[['',[],[]],[{t:'Str',c:'unsafe'}],['javascript:alert(1)','']]}]},
   {t:'RenderedMath',c:{source:'x^2',html:'<math><msup><mi>x</mi><mn>2</mn></msup></math>'}},
   {t:'CodeBlock',c:[['',['chart'],[]],JSON.stringify({labels:['a'],values:[2],unit:'USD'})]}
  ]}
 }
 try{
  await assert.rejects(prepareMarkdown(markdown),/503/)
  const controller=new AbortController();controller.abort()
  await assert.rejects(prepareMarkdown(markdown,controller.signal),{name:'AbortError'})
  await prepareMarkdown(markdown)
  const html=safeMarkdown(markdown)
  assert.match(html,/<h1 id="section-loading-fixture">/)
  assert.match(html,/<math>/)
  assert.match(html,/查看數據表/)
  assert.doesNotMatch(html,/javascript:|href="unsafe"/)
  const count=calls;await prepareMarkdown(markdown);assert.equal(calls,count)
 }finally{globalThis.fetch=saved}
})
