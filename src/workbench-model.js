export const topics = [
  {id:'all', label:'全部'}, {id:'infrastructure', label:'AI 基礎建設'},
  {id:'software', label:'軟體與應用'}, {id:'finance', label:'財務與資本'}, {id:'other', label:'其他'}
]
const rules = {
  infrastructure:/\b(hbm|gpu|memory|semiconductor|datacenter|data center|chip|nand|ssd)\b|晶片|記憶體|半導體|資料中心/i,
  software:/\b(software|agent|saas|cloud|app|application)\b|軟體|應用|雲端|代理/i,
  finance:/\b(capex|debt|capital|cash flow|valuation|earnings|margin)\b|資本|估值|債務|現金流|獲利/i
}
export function groupSignals(signals) {
  const groups = new Map()
  for (const signal of signals) {
    const key = signal.source?.id || signal.id
    if (!groups.has(key)) groups.set(key,{id:key,text:signal.text,source:signal.source,signals:[],topics:[]})
    groups.get(key).signals.push(signal)
  }
  return [...groups.values()].map(group => ({...group,topics:Object.entries(rules).filter(([,rule])=>rule.test(group.text)).map(([id])=>id)}))
}
export function filterLeads(leads, search, topic) {
  const words=search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return leads.filter(lead=>{
    const text=[lead.text,lead.source?.title,...lead.signals.map(s=>s.ticker_key)].join(' ').toLocaleLowerCase()
    return words.every(word=>text.includes(word)) && (topic==='all' || (topic==='other' ? !lead.topics.length : lead.topics.includes(topic)))
  })
}
export function formatDate(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return '日期未知'
  return new Intl.DateTimeFormat('zh-TW',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'}).format(new Date(value))
}
export function publicationLabel(source) {
  if(source?.published_at)return formatDate(source.published_at)
  const day=source?.published_date
  if(typeof day!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(day))return '日期未知'
  const parsed=new Date(day+'T00:00:00Z')
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10)===day ? `${day}（時刻未知）` : '日期未知'
}
export function safeUrl(value) {
  try { const u=new URL(value); return ['https:','http:'].includes(u.protocol) ? u.href : null } catch { return null }
}
export function sourceName(source) {
  const title=source.title || 'X 來源'
  const match=title.match(/^X post \S+ by (\S+)$/)
  return match ? `${match[1]} · X` : title
}
export function stanceLabel(value) {
  if(!value)return '未提供'
  return {bullish:'看多',bearish:'看空',neutral:'中性',bull:'看多',bear:'看空',unclear:'方向未明',mixed:'混合'}[value.toLowerCase()] || value
}
export function isSignalReview(data) {
  return Boolean(data?.run?.mode==='signal_review' && typeof data.run.id==='string' && data.signal?.id && data.signal.source &&
    typeof data.query==='string' && data.evaluation && ['cases','support','counter','pending'].every(key=>Array.isArray(data[key])))
}
export function readState(search) {
  const p=new URLSearchParams(search)
  return {search:p.get('q')||'',author:p.get('author')||'',from:p.get('from')||'',to:p.get('to')||'',topic:topics.some(t=>t.id===p.get('topic'))?p.get('topic'):'all',
    lead:p.get('lead')||'',run:p.get('run')||'',bucket:['pending','support','counter'].includes(p.get('bucket'))?p.get('bucket'):'pending',
    view:p.get('view')==='history'?'history':'leads',match:p.get('match')==='phrase'?'phrase':'all_terms',
    offset:/^\d+$/.test(p.get('offset') || '')?Number(p.get('offset')):0}
}
export function stateUrl(state) {
  const p=new URLSearchParams()
  for(const [key,value] of Object.entries({q:state.search,author:state.author,from:state.from,to:state.to,topic:state.topic==='all'?'':state.topic,lead:state.lead,run:state.run,
    bucket:state.bucket==='pending'?'':state.bucket,view:state.view==='leads'?'':state.view,
    match:state.match==='phrase'?'phrase':'',offset:state.offset || ''})) if(value) p.set(key,value)
  return p.size ? '?'+p.toString() : ''
}
