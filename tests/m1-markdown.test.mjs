import test from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {registerMarkdown,safeMarkdown} from '../src/canonical-view.js'
import {reactive} from 'vue'
test('new local reports render headings, source links and escaped hostile text without static exports',()=>{
 const markdown='# Local M1 report\n\n## Evidence\n\n[Source](https://example.invalid/report)\n\n<script>alert(1)</script>\n'
 const ast=JSON.parse(execFileSync('pandoc',['--from=markdown-raw_html-raw_tex','--to=json'],{input:markdown,encoding:'utf8'}))
 registerMarkdown(markdown,reactive(ast.blocks))
 const html=safeMarkdown(markdown)
 assert.match(html,/<h1/);assert.match(html,/<h2/);assert.match(html,/href="https:\/\/example.invalid\/report"/)
 assert.doesNotMatch(html,/<script>/)
 assert.throws(()=>registerMarkdown('unsafe',[{t:'RenderedMath',c:{html:'<img onerror=alert(1)>'}}]),/HTML/)
})
