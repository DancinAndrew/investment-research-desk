// Uses the already installed Pandoc. No package installation, remote rendering or source modification.
import {readFile,writeFile,readdir,mkdir,rm} from 'node:fs/promises'
import {execFileSync} from 'node:child_process'
export function normalized(s){return String(s).replace(/\r\n/g,'\n').replace(/^---\n[\s\S]*?\n---\n/,'')}
export function key(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16)+'-'+s.length}
const records={},sources=new Map();let documents=0
function collect(value){if(!value || typeof value!=='object')return;if(typeof value.content==='string' && value.format==='markdown'){const content=normalized(value.content),id=key(content);if(sources.has(id)&&sources.get(id)!==content)throw new Error('Markdown identity collision');sources.set(id,content)}for(const [k,v] of Object.entries(value))if(k!=='content')collect(v)}
for(const file of await readdir('public/data'))if(file.endsWith('.json'))collect(JSON.parse(await readFile('public/data/'+file,'utf8')))
for(const [id,content] of sources){
 const ast=JSON.parse(execFileSync('pandoc',['--from=markdown-raw_html-raw_tex+tex_math_dollars','--to=json'],{input:content,encoding:'utf8',maxBuffer:20_000_000}));
 function walk(v){if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){if(v.t==='Math'){const source=v.c[1],doc={...ast,blocks:[{t:'Para',c:[v]}]};const html=execFileSync('pandoc',['--from=json','--to=html5','--mathml'],{input:JSON.stringify(doc),encoding:'utf8',maxBuffer:1_000_000,stdio:['pipe','pipe','pipe']});const math=html.match(/<math\b[\s\S]*?<\/math>/);v.t='RenderedMath';v.c={source,html:math?.[0]||null}}else Object.values(v).forEach(walk)}}walk(ast.blocks)
 records[id]=ast.blocks;documents++
}
await rm('public/data/markdown-ast',{recursive:true,force:true})
await mkdir('public/data/markdown-ast',{recursive:true})
for(const [id,blocks] of Object.entries(records))await writeFile('public/data/markdown-ast/'+id+'.json',JSON.stringify(blocks)+'\n')
console.log('Pandoc parsed '+documents+' registered text documents; per-document AST loads on demand. Original snapshots unchanged.')
