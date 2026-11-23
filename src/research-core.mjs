import {groupSignals} from './workbench-model.js'

const stop=new Set('的確 可以 因此 目前 這個 that this with only the and for are was were from have has will would could should into about not but can how what when which does than its our their them is to of in as on at be it an or by we you'.split(' '))
export function tokens(value){const text=value.toLowerCase(),out=new Set(text.match(/[a-z0-9]{2,}/g)||[]);for(const part of text.match(/[\u4e00-\u9fff]+/g)||[])for(let i=0;i<part.length-1;i++)out.add(part.slice(i,i+2));return new Set([...out].filter(t=>!stop.has(t)))}
export async function digest(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('')}
const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
function includesTerm(field,term){return /[a-z0-9]/.test(term)?new RegExp('(?<![a-z0-9])'+escape(term)+'(?![a-z0-9])','i').test(field):field.includes(term)}
export function queryPosts(dataset,params){
 const q=(params.q||'').trim().toLowerCase(),match=params.match||'all_terms',topic=params.topic||'all',offset=Number(params.offset||0),limit=Number(params.limit||30),author=(params.author||'').trim().replace(/^@/,'').toLowerCase(),from=params.from||'',to=params.to||''
 if(q.length>500||!['phrase','all_terms'].includes(match)||!['all','infrastructure','software','finance','other'].includes(topic)||!Number.isSafeInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50)throw new Error('查詢參數無效')
 const validDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s
 if(author.length>100||(from&&!validDay(from))||(to&&!validDay(to))||(from&&to&&from>to))throw new Error('日期篩選無效')
 const words=q.match(/[\u4e00-\u9fff]+|[a-z0-9]+(?:[.:_-][a-z0-9]+)*|[^\s]+/g)||[]
 const selected=dataset.posts.filter(post=>{
  const day=post.source.published_at?.slice(0,10),handle=(post.source.title?.match(/by @([^ ]+)/)?.[1]||'').toLowerCase();if((author&&author!==handle)||(from&&(!day||day<from))||(to&&(!day||day>to)))return false
  const fields=[post.text,post.source.title,post.source.origin_id,...post.signals.map(s=>s.ticker_key||'')].map(x=>(x||'').toLowerCase())
  const categories=groupSignals([{text:post.text,source:post.source}])[0].topics
  return (topic==='all'||(topic==='other'?!categories.length:categories.includes(topic)))&&(!q||(match==='phrase'?fields.some(f=>f.includes(q)):words.every(w=>fields.some(f=>includesTerm(f,w)))))
 })
 const posts=selected.slice(offset,offset+limit)
 return {posts,signals:posts.flatMap(p=>p.signals),dataset_id:dataset.dataset_id,captured_at:dataset.metadata.prepared_at_utc,
  query:{q:q,match,topic,offset,limit,author,from,to},coverage:{raw_post_count:dataset.posts.length,matched_posts:selected.length,returned_posts:posts.length,next_offset:offset+limit<selected.length?offset+limit:null,
   scope:dataset.metadata.scope,source_snapshot_total_posts:dataset.metadata.source_snapshot_total_posts,data_as_of_utc:dataset.metadata.data_as_of_utc,automatic_updates:false,live_prices:false}}
}
function time(value){if(value==null)return null;if(typeof value!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(value)||Number.isNaN(Date.parse(value)))throw new Error('時間須包含時區');return Date.parse(value)}
export async function reviewCases(signal,cases,query,asOf,observedAt){
 const cutoff=time(asOf);if(cutoff==null||typeof query!=='string'||!query.trim()||query.length>1000)throw new Error('研究需有效關鍵字與截至時間')
 const fields=['published_at','seen_at','processed_at','revised_at'],signalTimes=fields.map(k=>time(signal.source[k]))
 if(signalTimes.some(t=>t!=null&&t>cutoff))throw new Error('原文資料晚於截至時間')
 if(!signalTimes.slice(2).some(t=>t!=null)&&(time(observedAt)==null||time(observedAt)>cutoff))throw new Error('無法確認當時可用的分類')
 const wanted=tokens(query),rejected=[],eligible=new Map()
 for(const c of cases){const times=fields.map(k=>time(c.source[k]));let reason=null
  if(times.some(t=>t!=null&&t>cutoff))reason='after_as_of'
  else if(!times.slice(1).some(t=>t!=null))reason='availability_at_as_of_unknown'
  else if(await digest(c.excerpt)!==c.excerpt_sha256)reason='citation_hash_mismatch'
  if(reason){rejected.push({id:c.id,reason});continue}
  const revisionTime=Math.max(...times.filter(t=>t!=null)),prior=eligible.get(c.id)
  if(!prior||revisionTime>prior.time||(revisionTime===prior.time&&c.revision_id>prior.case.revision_id))eligible.set(c.id,{time:revisionTime,case:c})
 }
 const ranked=[]
 for(const {case:c,time:revisionTime} of eligible.values()){
  const tags=tokens(c.tags.join(' ')),all=tokens(c.tags.join(' ')+' '+c.excerpt),matched=[...wanted].filter(t=>all.has(t)).sort()
  if(!matched.length||(wanted.size>1&&matched.length<2)||(wanted.size===1&&![...wanted].some(t=>tags.has(t))))continue
  ranked.push({case:c,matched,revisionTime})
 }
 ranked.sort((a,b)=>b.matched.length-a.matched.length||a.case.id.localeCompare(b.case.id)||b.revisionTime-a.revisionTime)
 const selected=[],groups=new Set(),support=[],counter=[],pending=[]
 for(const row of ranked){const c=structuredClone(row.case),group=c.source.upstream_group||c.source.id;if(groups.has(group))continue;groups.add(group)
  let valid=c.reviewed===true&&c.related_signal_id===signal.id&&c.source.published_at!=null&&['original_post','transcript','excerpt','article','official_document','original_document','original_video','original_audio'].includes(c.source.representation)
  if(c.instrument)valid=valid&&`${c.instrument.market}:${c.instrument.symbol}`===signal.ticker_key&&(!c.instrument.share_class||c.instrument.share_class===signal.instrument?.share_class)
  Object.assign(c,{direction:c.relation||'context',matched_terms:row.matched,retrieval_score:row.matched.length,citation_exists:true,semantic_support:'not_evaluated',verification:{citation_hash:'matched',source_review:c.reviewed?'reviewed':'not_reviewed',relation_review:valid&&['supports','contradicts'].includes(c.relation)?'reviewed':'not_reviewed',claim_truth:'not_evaluated'}})
  selected.push(c);(valid&&c.relation==='supports'?support:valid&&c.relation==='contradicts'?counter:pending).push(c);if(selected.length===3)break
 }
 return {status:selected.length?'review_ready':'abstained',as_of:asOf,mode:'deterministic_retrieval',query,signal,cases:selected,support,counter,pending,rejected,
  retrieval:{method:'content_token_overlap_v2',case_revisions_scanned:cases.length,eligible_case_ids:eligible.size,query_terms:[...wanted].sort(),rule:'minimum two content tokens; a single query token requires an explicit tag'},
  gaps:['引用存在不等於主張成立；未自動驗證投資正確率','支持／反證僅接受與此訊號明確關聯且已審閱的原始證據；其餘待查'],
  evaluation:{citation_checks:selected.length?'passed':'no_matches',semantic_support:'not_evaluated',investment_accuracy:'not_evaluated'}}
}
export function validateDecision(body,run){
 if(typeof body.text!=='string'||!body.text.trim()||body.text.length>10000||!Number.isInteger(body.expected_revision)||body.expected_revision<0)throw new Error('判斷格式無效')
 const d=body.details;if(!d||!['researching','waiting','skip','bounded_judgment'].includes(d.status)||typeof d.next_step!=='string'||d.next_step.length>2000||!Array.isArray(d.source_refs)||d.source_refs.length>4||new Set(d.source_refs).size!==d.source_refs.length)throw new Error('判斷欄位無效')
 if(d.status==='waiting'&&!d.next_step.trim())throw new Error('待查需要具體下一步')
 if(d.status==='bounded_judgment'&&!d.source_refs.length)throw new Error('有界判斷需要引用材料')
 const refs=new Set([`${run.signal.source.id}@${run.signal.source.revision_id}`,...run.cases.map(c=>`${c.id}@${c.revision_id}`)])
 if(d.source_refs.some(ref=>!refs.has(ref)))throw new Error('引用不屬於本次研究')
 if(d.review_on!=null&&(!/^\d{4}-\d{2}-\d{2}$/.test(d.review_on)||Number.isNaN(Date.parse(d.review_on))||new Date(d.review_on).toISOString().slice(0,10)!==d.review_on))throw new Error('複查日期無效')
}
