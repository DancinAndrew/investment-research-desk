const markdownAST=Object.create(null),markdownRequests=new Map()
// Local research uses the same safe renderer as saved reports. Accept data-only
// Pandoc blocks; RenderedMath is reserved for the build-time trusted conversion.
export function registerMarkdown(markdown,blocks){
 if(!Array.isArray(blocks)||JSON.stringify(blocks).length>4000000)throw new Error('研究本文解析格式無效。')
 let nodes=0
 function check(value,depth=0){if(depth>64||++nodes>200000)throw new Error('研究本文解析過大。');if(value&&typeof value==='object'){if(value.t==='RenderedMath')throw new Error('動態研究不接受原始數學 HTML。');for(const item of Object.values(value))check(item,depth+1)}}
 check(blocks)
 const text=String(markdown||'').replace(/\r\n/g,'\n').replace(/^---\n[\s\S]*?\n---\n/,'')
 // Vue refs may expose this JSON response through reactive proxies. Serialize at
 // the same data boundary as HTTP rather than structured-cloning a proxy.
 markdownAST[markdownKey(text)]=JSON.parse(JSON.stringify(blocks))
}
export async function prepareMarkdown(markdown,signal){
 const text=String(markdown||'').replace(/\r\n/g,'\n').replace(/^---\n[\s\S]*?\n---\n/,'')
 if(!text)return
 const id=markdownKey(text)
 if(markdownAST[id])return
 // Abort belongs to the caller, so an aborted navigation never poisons another read.
 if(signal){const response=await fetch('/data/markdown-ast/'+id+'.json',{signal});if(!response.ok)throw new Error('本文解析資料未能載入（'+response.status+'）');markdownAST[id]=await response.json();return}
 if(!markdownRequests.has(id))markdownRequests.set(id,(async()=>{const response=await fetch('/data/markdown-ast/'+id+'.json');if(!response.ok)throw new Error('本文解析資料未能載入（'+response.status+'）');markdownAST[id]=await response.json()})().catch(e=>{markdownRequests.delete(id);throw e}))
 await markdownRequests.get(id)
}
const researchLabel=value=>({reviewed_limited:'限定範圍已審查',insufficient_evidence:'證據不足',not_reviewed:'本判定機制未審查；舊審查另見原版'}[value] || '未審查')
export function assessmentRows(assessment) {
  const a=assessment || {}
  return [
    {label:'資料完整性',value:a.data_integrity?.status==='verified_registered'?'登錄檔案一致；不等於來源全部真實':'資料完整性未驗證'},
    {label:'研究適用範圍',value:researchLabel(a.research?.status)},
    {label:'自動流程',value:'自動流程未驗證'},
    {label:'預測成效',value:'預測成效未驗證'+(Number.isInteger(a.prediction?.sample_count) && a.prediction.sample_count>0?`；${a.prediction.pending_outcomes} 個 outcome 未知`:'；未登錄樣本')},
  ]
}
export function revisionStatus(acceptance={},assessment) {
  const label={agent_reviewed:'agent 審修成品',model_original:'模型原始輸出'}[acceptance.publication_type]
  if(assessment)return (label || '保存研究')+'；'+researchLabel(assessment.research?.status)
  if(!label)return null
  const gate=acceptance.formal_research_accepted===true?'已通過':acceptance.formal_research_accepted===false?'尚未全部通過':'未標示'
  return label+'；正式研究 gate '+gate
}
export function displayValue(value) {
  if(value===null || value===undefined)return '未知'
  if(typeof value==='boolean')return value?'是':'否'
  if(typeof value==='number')return Number.isFinite(value)?String(value):'未知'
  return String(value)
}
export function sourceStatus(source) {
  if(source.direct_download_status===403)return '原始 HTTP 403；只有委派摘錄，未重試'
  return {permission_hold:'權限待核准',auth_required:'需要既有授權',blocked:'來源受限',not_tested:'連通性未測',verified:'已核對'}[source.access_status] || '閱讀範圍見來源紀錄'
}
export function artifactLink(target,reportPath,artifacts) {
  if(typeof target==='string'&&target.startsWith('/')){const clean=target.replace(/&amp;/g,'&').split('#')[0];return artifacts.find(item=>clean.endsWith('/'+item.path))?.artifact_id||null}
  if(typeof target!=='string' || target.startsWith('/') || /^(?:[a-z]+:|\\)/i.test(target))return null
  try {
    const base='https://registered.invalid/'+reportPath
    const url=new URL(target.split('#')[0],base)
    const path=decodeURIComponent(url.pathname.slice(1))
    return artifacts.find(item=>item.path===path)?.artifact_id || null
  } catch {return null}
}
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
export const headingId=value=>'section-'+String(value).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'')
function markdownKey(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16)+'-'+s.length}
export function safeMarkdown(markdown,linkFor,options={}) {
 const text=String(markdown||'').replace(/\r\n/g,'\n').replace(/^---\n[\s\S]*?\n---\n/,'')
 const blocks=markdownAST[markdownKey(text)];if(!blocks)return '<pre><code>'+escape(text)+'</code></pre>'
 const render=nodes=>(nodes||[]).map(node).join('')
 const plain=nodes=>(nodes||[]).map(n=>n.t==='Str'?n.c:n.t==='Space'?' ':Array.isArray(n.c)?plain(n.c):'').join('')
 const row=(r,tag)=>'<tr>'+r[1].map(cell=>'<'+tag+(cell[2]>1?' rowspan="'+cell[2]+'"':'')+(cell[3]>1?' colspan="'+cell[3]+'"':'')+'>'+render(cell[4])+'</'+tag+'>').join('')+'</tr>'
 function node(n){const c=n.c;switch(n.t){
 case 'Str':return escape(c);case 'Space':case 'SoftBreak':return ' ';case 'LineBreak':return '<br>';
 case 'Para':return '<p>'+render(c)+'</p>';case 'Plain':return render(c);
 case 'Header':{const level=Math.min(6,c[0]+(options.headingOffset||0));return '<h'+level+' id="'+headingId(plain(c[2]))+'">'+render(c[2])+'</h'+level+'>'}
 case 'Strong':return '<strong>'+render(c)+'</strong>';case 'Emph':return '<em>'+render(c)+'</em>';case 'Strikeout':return '<del>'+render(c)+'</del>';case 'Superscript':return '<sup>'+render(c)+'</sup>';case 'Subscript':return '<sub>'+render(c)+'</sub>';case 'SmallCaps':return render(c);
 case 'Quoted':return '「'+render(c[1])+'」';case 'Span':return render(c[1]);case 'Div':return render(c[1]);case 'Cite':return render(c[1]);
 case 'Code':return '<code>'+escape(c[1])+'</code>';case 'CodeBlock':return c[0][1].includes('chart')?safeChart(c[1]):'<pre><code>'+escape(c[1])+'</code></pre>';
 case 'BulletList':return '<ul>'+c.map(v=>'<li>'+render(v)+'</li>').join('')+'</ul>';
 case 'OrderedList':return '<ol start="'+c[0][0]+'">'+c[1].map(v=>'<li>'+render(v)+'</li>').join('')+'</ol>';
 case 'DefinitionList':return '<dl>'+c.map(v=>'<dt>'+render(v[0])+'</dt>'+v[1].map(d=>'<dd>'+render(d)+'</dd>').join('')).join('')+'</dl>';
 case 'BlockQuote':return '<blockquote>'+render(c)+'</blockquote>';case 'HorizontalRule':return '<hr>';
 case 'Table':return '<div class="table-scroll"><table><caption>'+render(c[1][1])+'</caption><thead>'+c[3][1].map(r=>row(r,'th')).join('')+'</thead><tbody>'+c[4].map(b=>[...b[2],...b[3]].map(r=>row(r,'td')).join('')).join('')+'</tbody><tfoot>'+c[5][1].map(r=>row(r,'td')).join('')+'</tfoot></table></div>';
 case 'Link':{const target=c[2][0],label=render(c[1]),local=linkFor?.(target);if(local && (/^#artifact:/.test(local)||/^\?workspace=company&/.test(local)))return '<a href="'+escape(local)+'">'+label+'</a>';if(target.startsWith('#'))return '<a href="'+escape(target)+'">'+label+'</a>';try{const u=new URL(target);if(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password)return '<a href="'+escape(u.href)+'" target="_blank" rel="noopener noreferrer">'+label+'</a>'}catch{}return label}
 case 'Image':return '<span>圖片：'+render(c[1])+'</span>';
 case 'RenderedMath':return c.html||'<code class="formula">'+escape(c.source)+'</code>';
 case 'Note':return '<aside class="markdown-note">'+render(c)+'</aside>';
 // Raw HTML/TeX never executes; unrecognized Pandoc nodes preserve their text.
 case 'RawInline':case 'RawBlock':return escape(c[1]);default:return Array.isArray(c)?render(c.filter(v=>v&&typeof v==='object'&&v.t)):''
 }}return render(blocks)
}

// Data-only chart fence. No remote libraries, raw SVG, HTML or executable source.
export function safeChart(raw) {
  try {
    const data=JSON.parse(raw)
    if(!Array.isArray(data.labels) || !Array.isArray(data.values) || !data.values.length || data.values.length>12 || data.labels.length!==data.values.length || data.values.some(v=>typeof v!=='number' || !Number.isFinite(v) || v<0))throw new Error('invalid chart')
    const isEstimate=i=>Array.isArray(data.estimated)?data.estimated[i]===true:data.estimated===true
    const mixed=Array.isArray(data.estimated) && data.estimated.some(Boolean) && data.estimated.some(v=>!v)
    const max=Math.max(1,...data.values),unit=escape(data.unit || ''),caption=escape(data.caption || ''),title=escape(data.title || '資料比較')
    const rows=data.values.map((v,i)=>`<div class="chart-row"><span>${escape(data.labels[i])}</span><div><div class="chart-bar${isEstimate(i)?' estimate':''}" style="width:${100*v/max}%"></div></div><strong>${v.toLocaleString('en-US',{maximumFractionDigits:2})}</strong></div>`).join('')
    const table='<details><summary>查看數據表</summary><div class="table-scroll"><table><thead><tr><th>項目</th><th>'+unit+'</th></tr></thead><tbody>'+data.values.map((v,i)=>'<tr><td>'+escape(data.labels[i])+(isEstimate(i)?'（估算）':'（已記錄）')+'</td><td>'+v+'</td></tr>').join('')+'</tbody></table></div></details>'
    return `<figure class="report-chart" role="group" aria-label="${title}"><h3>${title}</h3><p class="muted">單位：${unit}；${mixed?'斜紋為條件估算；實色為已記錄資料':data.estimated?'條件估算':'已公布資料'}</p>${rows}<figcaption>${caption}</figcaption>${table}</figure>`
  } catch {return '<pre><code>'+escape(raw)+'</code></pre>'}
}
