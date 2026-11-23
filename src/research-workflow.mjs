// Manual research only. These functions never fetch sources or execute imports.
export const AXES = Object.freeze({demand:'需求',operations:'營運',competition:'競爭',price:'價格'});
export const REASON_CATEGORIES = Object.freeze({fact:'事實改變',cause:'因果改判',deadline:'期限改變',valuation_opportunity:'估值／機會成本',data_gap:'資料缺口'});
export const SCENARIOS = Object.freeze({conservative:'保守',base:'基準',optimistic:'樂觀'});
export const INPUT_LABELS = Object.freeze({gm:'毛利率（小數）',opex:'營業費用',other:'其他淨收入',tax:'稅額／稅率',shares:'稀釋加權平均股數',nci:'非控制權益',dividends:'特別股股利',pe:'假設本益比'});
export const emptyResearchWorkspace = () => ({schema_version:1,reviews:[],scenarios:[],rules:[]});
const clone = value => JSON.parse(JSON.stringify(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max=5000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const optionalText = (value,max=5000) => typeof value === 'string' && value.length <= max;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,120}$/.test(value);
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && date(value.slice(0,10)) && Number.isFinite(Date.parse(value));
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const month = value => typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
export function safeResearchUrl(value) {try {const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
const fail = (path,message) => {throw {path,message};};
function shape(value,keys,path) {if(!object(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))fail(path,'欄位不完整或含未登錄欄位。');}
function required(condition,path,message) {if(!condition)fail(path,message);}
function list(value,max,path) {required(Array.isArray(value)&&value.length<=max,path,'清單格式或數量無效。');}
function baseline(value,path) {
 shape(value,['report_id','report_sha256','bundle_sha256','month','cutoff'],path);
 required(((value.report_id===null&&value.report_sha256===null)||(identifier(value.report_id)&&hash(value.report_sha256)))&&hash(value.bundle_sha256),path,'請固定報告與資料包的版本；無已接受正文時報告識別碼和內容hash均為null。');
 required(month(value.month)&&timestamp(value.cutoff),path,'月份及含時區的資料截止時間無效。');
 required(value.cutoff.slice(0,7)>=value.month,path,'資料截止時間不能早於回顧月份。');
}
function common(value,keys,path) {
 shape(value,['id','company','created_at','supersedes','baseline',...keys],path);
 required(identifier(value.id)&&identifier(value.company)&&timestamp(value.created_at),path,'研究識別碼、公司或建立時間無效。');
 required(value.supersedes===null||identifier(value.supersedes),path+'.supersedes','前版識別碼無效。');baseline(value.baseline,path+'.baseline');
 required(Date.parse(value.baseline.cutoff)<=Date.parse(value.created_at),path+'.baseline.cutoff','資料截止時間不能晚於這次研究建立時間。');
}
function input(value,path,{min=-Infinity,max=Infinity}={}) {
 shape(value,['value','kind','source','as_of','reason','missing_reason'],path);
 required(['actual','assumption'].includes(value.kind)&&text(value.source)&&timestamp(value.as_of)&&text(value.reason),path,'每個輸入須記錄實際／假設、來源、時點和理由。');
 required(value.value===null||Number.isFinite(value.value)&&value.value>=min&&value.value<=max,path+'.value','數值超出有效範圍。');
 required(value.value===null?text(value.missing_reason):value.missing_reason==='',path+'.missing_reason','缺值須寫原因；已知數值不可帶缺值原因。');
}
function evidence(value,path) {
 shape(value,['id','title','url','locator','published_at','precision','rights'],path);
 required(identifier(value.id)&&text(value.title,500)&&safeResearchUrl(value.url)&&text(value.locator,1000),path,'引用須有標題、合法網址和頁／段定位。');
 required(['timestamp','day','unknown'].includes(value.precision)&&['link_only','quoted_allowed'].includes(value.rights),path,'引用時間精度或展示權利無效。');
 required(value.precision==='timestamp'?timestamp(value.published_at):value.precision==='day'?date(value.published_at):value.published_at===null,path+'.published_at','發布時間與精度不一致。');
}
export function classifyPublication(evidence,cutoff) {
 if(!timestamp(cutoff))return 'unknown';
 if(evidence?.precision==='timestamp'&&timestamp(evidence.published_at))return Date.parse(evidence.published_at)<=Date.parse(cutoff)?'known_by_cutoff':'later';
 if(evidence?.precision==='day'&&date(evidence.published_at)) {
  // A whole UTC envelope for every legal timezone; same-day data is never assumed public at midnight.
  const earliest=Date.parse(evidence.published_at+'T00:00:00Z')-14*3600000,latest=Date.parse(evidence.published_at+'T00:00:00Z')+38*3600000;
  return latest<=Date.parse(cutoff)?'known_by_cutoff':earliest>Date.parse(cutoff)?'later':'time_unconfirmed';
 }
 return 'unknown';
}
function review(value,path) {
 common(value,['outcome','axes','evidence','reasons','counter_case','learning','tasks'],path);
 required(['keep','increase','decrease','withdraw','pending'].includes(value.outcome),path+'.outcome','請明確選擇這次人工核對結果。');
 shape(value.axes,Object.keys(AXES),path+'.axes');list(value.evidence,100,path+'.evidence');const ids=new Set();
 value.evidence.forEach((e,i)=>{evidence(e,`${path}.evidence.${i}`);required(!ids.has(e.id),path+'.evidence','引用識別碼重複。');ids.add(e.id);});
 for(const key of Object.keys(AXES)){const a=value.axes[key];shape(a,['baseline','new_evidence','support','counterevidence','unknown'],path+'.axes.'+key);required(['baseline','support','counterevidence','unknown'].every(k=>text(a[k])),path+'.axes.'+key,'四軸均須記錄基線、支持、反證及未知；未取得資料請如實說明。');list(a.new_evidence,100,path+'.axes.'+key);required(a.new_evidence.every(id=>ids.has(id)),path+'.axes.'+key,'新證據引用不存在。');}
 list(value.reasons,5,path+'.reasons');required(value.reasons.length>0,path+'.reasons','至少選擇一項改判／維持原因。');const categories=new Set();
 value.reasons.forEach((r,i)=>{shape(r,['category','note','evidence_ids'],`${path}.reasons.${i}`);required(Object.hasOwn(REASON_CATEGORIES,r.category)&&!categories.has(r.category)&&text(r.note),path+'.reasons','理由類型、文字或重複項目無效。');categories.add(r.category);list(r.evidence_ids,100,path+'.reasons');required(r.evidence_ids.length>0&&r.evidence_ids.every(id=>ids.has(id)),path+'.reasons','每個理由須連結可回查的引用。');});
 required(text(value.counter_case)&&text(value.learning),path,'請記錄最強反方及遺漏／過度解讀，不以損益裁定真偽。');list(value.tasks,5,path+'.tasks');
 value.tasks.forEach((t,i)=>{shape(t,['question','primary_source','completion_condition','deadline','deadline_reason','priority','unfinished_reason'],`${path}.tasks.${i}`);required(['question','primary_source','completion_condition','priority'].every(k=>text(t[k]))&&safeResearchUrl(t.primary_source),path+'.tasks','每項工作須有問題、一手來源網址、完成條件和優先理由。');required(t.deadline===null?text(t.deadline_reason):date(t.deadline)&&t.deadline_reason==='',path+'.tasks','期限未知須說明原因。');required(optionalText(t.unfinished_reason),path+'.tasks','未完成原因無效。');});
}
function scenario(value,path) {
 shape(value,['segments','inputs','tax_mode'],path);list(value.segments,30,path+'.segments');required(value.segments.length>0,path,'至少記錄一個營收分部。');
 value.segments.forEach((s,i)=>{shape(s,['name','method','volume','price','base_revenue','growth'],`${path}.segments.${i}`);required(text(s.name,200)&&['drivers','growth'].includes(s.method),path,'分部與營收公式無效。');for(const k of ['volume','price','base_revenue','growth'])input(s[k],`${path}.segments.${i}.${k}`,{min:k==='growth'?-1:0});});
 shape(value.inputs,Object.keys(INPUT_LABELS),path+'.inputs');for(const k of Object.keys(INPUT_LABELS))input(value.inputs[k],path+'.inputs.'+k,{min:['gm','tax','shares','nci','dividends','pe'].includes(k)?0:-Infinity,max:k==='gm'?1:Infinity});
 required(['amount','rate_no_credit'].includes(value.tax_mode),path+'.tax_mode','稅務處理無效。');required(value.tax_mode!=='rate_no_credit'||value.inputs.tax.value===null||value.inputs.tax.value<=1,path+'.inputs.tax','稅率請填0至1。');required(value.inputs.shares.value===null||value.inputs.shares.value>0,path+'.inputs.shares','稀釋股數必須大於0。');required(value.inputs.pe.value===null||value.inputs.pe.value>0,path+'.inputs.pe','假設本益比必須大於0。');
}
function model(value,path) {
 common(value,['horizon','currency','amount_unit','share_basis','constraints','invalidation','cases'],path);
 required(['horizon','amount_unit','share_basis','constraints','invalidation'].every(k=>text(value[k]))&&/^[A-Z]{3}$/.test(value.currency),path,'期限、貨幣、金額／股數單位、交互約束及失效條件必填。');
 shape(value.cases,Object.keys(SCENARIOS),path+'.cases');for(const k of Object.keys(SCENARIOS))scenario(value.cases[k],path+'.cases.'+k);
 for(const s of Object.values(value.cases)){const inputs=[...Object.values(s.inputs),...s.segments.flatMap(x=>x.method==='drivers'?[x.volume,x.price]:[x.base_revenue,x.growth])];required(inputs.every(x=>x.kind!=='actual'||Date.parse(x.as_of)<=Date.parse(value.baseline.cutoff)),path+'.cases','實際值公開晚於截止時間；請另建事後模型。');}
 const signature=s=>s.segments.map(x=>x.name+'|'+x.method).join(';')+'|'+s.tax_mode;
 required(new Set(Object.values(value.cases).map(signature)).size===1,path+'.cases','三情境必須使用相同分部、公式與稅务處理。');
}
function dataset(value,path) {
 shape(value,['rights','rights_source','source_url','adjustment_basis','volume_unit','flow_unit','available_at','calendar_source_url','calendar_verified','corporate_actions','benchmark','calendar','sessions','events'],path);
 required(['licensed','public_metadata'].includes(value.rights)&&text(value.rights_source)&&safeResearchUrl(value.source_url),path,'行情權利與來源未確認，不能接受。');
 required(['split_adjusted','unadjusted_no_actions'].includes(value.adjustment_basis)&&['shares','lots_1000'].includes(value.volume_unit)&&['shares','lots_1000','TWD'].includes(value.flow_unit)&&timestamp(value.available_at),path,'復權基準、成交量／法人淨流量單位及可用時間必填。');
 required(safeResearchUrl(value.calendar_source_url)&&typeof value.calendar_verified==='boolean',path,'交易日曆須有來源與人工完整性核對狀態。');list(value.corporate_actions,100,path+'.corporate_actions');
 value.corporate_actions.forEach((a,i)=>{shape(a,['type','effective_date','ratio','source_url','applied'],`${path}.corporate_actions.${i}`);required(a.type==='split'&&date(a.effective_date)&&Number.isFinite(a.ratio)&&a.ratio>0&&safeResearchUrl(a.source_url)&&typeof a.applied==='boolean',path+'.corporate_actions','拆股來源、比例與一次調整標記無效。');});
 list(value.calendar,400,path+'.calendar');list(value.sessions,400,path+'.sessions');list(value.events,100,path+'.events');const dates=new Set();let previous='';
 value.calendar.forEach((c,i)=>{shape(c,['date','close_at','status'],`${path}.calendar.${i}`);required(date(c.date)&&c.date>previous&&timestamp(c.close_at)&&['open','suspended','closed'].includes(c.status),path+'.calendar','交易日曆須依日期排序、唯一且有收盤時間及停牌／休市狀態。');previous=c.date;});
 value.sessions.forEach((s,i)=>{shape(s,['date','close','volume','net_flow','available_at'],`${path}.sessions.${i}`);required(date(s.date)&&!dates.has(s.date)&&timestamp(s.available_at),path+'.sessions','行情日期重複或可用時間無效。');dates.add(s.date);required(['close','volume','net_flow'].every(k=>s[k]===null||Number.isFinite(s[k]))&&(s.close===null||s.close>0)&&(s.volume===null||s.volume>=0),path+'.sessions','行情保留缺值；價格及成交量數值無效。');required(value.calendar.some(c=>c.date===s.date&&c.status==='open'),path+'.sessions','行情日期不在可交易日曆。');});
 value.events.forEach((e,i)=>{shape(e,['title','published_at'],`${path}.events.${i}`);required(text(e.title,500)&&timestamp(e.published_at),path+'.events','事件須有精確公開時間。');});
 if(value.benchmark!==null){const b=value.benchmark;shape(b,['source_url','rights','rights_source','adjustment_basis','available_at','sessions'],path+'.benchmark');required(safeResearchUrl(b.source_url)&&['licensed','public_metadata'].includes(b.rights)&&text(b.rights_source)&&['split_adjusted','unadjusted_no_actions'].includes(b.adjustment_basis)&&timestamp(b.available_at),path+'.benchmark','指數來源、權利、可用時間或價格調整基準無效。');list(b.sessions,400,path+'.benchmark.sessions');const days=new Set();b.sessions.forEach((s,i)=>{shape(s,['date','close','available_at'],`${path}.benchmark.sessions.${i}`);required(date(s.date)&&!days.has(s.date)&&(s.close===null||Number.isFinite(s.close)&&s.close>0)&&timestamp(s.available_at),path+'.benchmark.sessions','指數觀察日期重複、價格或公開時間無效。');days.add(s.date);});}
}
function rule(value,path) {
 common(value,['name','frozen_at','market','security','fundamental_confirmation','falsification','thresholds','dataset'],path);
 required(text(value.name,200)&&timestamp(value.frozen_at)&&value.market==='TW'&&identifier(value.security)&&text(value.fundamental_confirmation)&&text(value.falsification),path,'請記錄台股標的、凍結時間、基本面確認及推翻條件。');
 required(Date.parse(value.frozen_at)<=Date.parse(value.created_at),path+'.frozen_at','規則凍結時間不能晚於版本建立時間。');
 shape(value.thresholds,['volume_ratio','price_change_pct','net_flow','relative_return_5d_pct'],path+'.thresholds');required(['volume_ratio','price_change_pct','net_flow'].every(k=>Number.isFinite(value.thresholds[k]))&&value.thresholds.volume_ratio>0&&(value.thresholds.relative_return_5d_pct===null||Number.isFinite(value.thresholds.relative_return_5d_pct)),path+'.thresholds','門檻須有有限數值，量比須大於0；未設相對報酬條件請填null。');dataset(value.dataset,path+'.dataset');
}
export function validateResearchWorkspace(value) {
 try {shape(value,['schema_version','reviews','scenarios','rules'],'research_workspace');required(value.schema_version===1,'research_workspace.schema_version','研究工作區版本無效。');
  for(const [domain,validator] of [['reviews',review],['scenarios',model],['rules',rule]]) {list(value[domain],1000,'research_workspace.'+domain);const ids=new Map();for(const [i,row] of value[domain].entries()){const path=`research_workspace.${domain}.${i}`;validator(row,path);required(!ids.has(row.id),path+'.id','版本識別碼重複。');if(row.supersedes!==null){const before=ids.get(row.supersedes);required(before&&before.company===row.company&&Date.parse(row.created_at)>=Date.parse(before.created_at),path+'.supersedes','前版不存在、公司不同或時間倒置。');required(JSON.stringify(before.baseline)===JSON.stringify(row.baseline),path+'.baseline','既有版本的固定基線不可變更；換基線請另建研究。');if(domain==='reviews')required(Object.keys(AXES).every(k=>before.axes[k].baseline===row.axes[k].baseline),path+'.axes','原四軸基線不可變更。');if(domain==='rules')required(row.frozen_at===before.frozen_at&&row.security===before.security&&JSON.stringify(row.thresholds)===JSON.stringify(before.thresholds)&&row.fundamental_confirmation===before.fundamental_confirmation&&row.falsification===before.falsification,path,'凍結規則不可修改；調整條件請建立新規則。');}ids.set(row.id,row);}}
  return {ok:true,value:clone(value)};
 }catch(error){return {ok:false,errors:[{path:error.path||'research_workspace',message:error.message||'研究資料無效。'}]};}
}
export function calculateScenario(value) {
 const missing=[];const get=(x,label)=>{if(x?.value===null||!Number.isFinite(x?.value)){missing.push({input:label,reason:x?.missing_reason||'未提供有效輸入'});return null;}return x.value;};
 const segmentRevenue=(value?.segments||[]).map(s=>{const a=get(s.method==='growth'?s.base_revenue:s.volume,s.name+':'+(s.method==='growth'?'base_revenue':'volume')),b=get(s.method==='growth'?s.growth:s.price,s.name+':'+(s.method==='growth'?'growth':'price'));return a===null||b===null?null:s.method==='growth'?a*(1+b):a*b;});
 const revenue=segmentRevenue.length&&segmentRevenue.every(x=>x!==null)?segmentRevenue.reduce((a,b)=>a+b,0):null;
 const i={};for(const k of Object.keys(INPUT_LABELS))i[k]=get(value?.inputs?.[k],k);
 const mul=(a,b)=>a===null||b===null?null:a*b,sub=(a,b)=>a===null||b===null?null:a-b;
 const gross_profit=mul(revenue,i.gm),operating_income=sub(gross_profit,i.opex),pretax=operating_income===null||i.other===null?null:operating_income+i.other;
 const tax=value?.tax_mode==='rate_no_credit'?pretax===null||i.tax===null?null:Math.max(0,pretax)*i.tax:i.tax;
 const common_net_income=sub(sub(sub(pretax,tax),i.nci),i.dividends),eps=common_net_income===null||i.shares===null||i.shares<=0?null:common_net_income/i.shares;
 const value_per_share=eps!==null&&eps>0&&i.pe!==null&&i.pe>0?eps*i.pe:null;
 const outputs={revenue,gross_profit,operating_income,pretax,tax,common_net_income,eps,value_per_share};for(const k of Object.keys(outputs))if(!Number.isFinite(outputs[k]))outputs[k]=null;
 return {...outputs,missing,valuation_reason:eps===null?'缺少盈利輸入':eps<=0?'盈利為零或負值，本益比試算不適用':i.pe===null?'未提供研究者假設本益比':'研究者假設；相同期限與股數口徑的條件試算',formula_version:'research-scenario/1'};
}
export function calculateScenarioSet(model) {return Object.fromEntries(Object.keys(SCENARIOS).map(k=>[k,calculateScenario(model.cases[k])]));}
export function evaluateManualRule(value) {
 const blocked=reason=>({status:'not_comparable',reason,volume_ratio:null,price_change_pct:null,net_flow:null,event_alignment:[]});
 try{rule(value,'rule');}catch(e){return blocked(e.message);}
 const d=value.dataset,cutoff=Date.parse(value.baseline.cutoff);if(Date.parse(d.available_at)>cutoff)return blocked('資料包在截止時間後才公開可用。');
 if(!d.calendar_verified)return blocked('交易日曆尚未人工核對完整性。');
 if(d.adjustment_basis==='unadjusted_no_actions'&&d.corporate_actions.length)return blocked('觀察窗包含拆股，未復權價格不能比較。');
 if(d.adjustment_basis==='split_adjusted'&&d.corporate_actions.some(a=>!a.applied))return blocked('拆股調整尚未完成或無法確認只調整一次。');
 const eligible=d.calendar.filter(c=>c.status==='open'&&Date.parse(c.close_at)<=cutoff);if(eligible.length<21)return blocked('不足目前一日加前20個可交易session。');
 const window=eligible.slice(-21),byDate=new Map(d.sessions.map(s=>[s.date,s]));const rows=window.map(c=>byDate.get(c.date));
 if(rows.some((s,i)=>!s||s.close===null||s.volume===null||Date.parse(s.available_at)>cutoff||Date.parse(s.available_at)<Date.parse(window[i].close_at)))return blocked('20日觀察窗有缺件、發布晚於截止或收盤前不可用資料。');
 const last=rows.at(-1),previous=rows.at(-2),volumes=rows.slice(0,-1).map(s=>s.volume).sort((a,b)=>a-b),median=(volumes[9]+volumes[10])/2;if(median<=0)return blocked('前20日成交量中位數為零，無法計算量比。');if(last.net_flow===null)return blocked('當日法人淨流量缺值。');
 const volume_ratio=last.volume/median,price_change_pct=(last.close/previous.close-1)*100,net_flow=last.net_flow;
 let relative_return_5d_pct=null,relative_return_reason='未提供有來源及權利的指數基準。';const b=d.benchmark;
 if(b){const benchmarkByDate=new Map(b.sessions.map(s=>[s.date,s])),dates=window.slice(-6),bench=dates.map(c=>benchmarkByDate.get(c.date));if(Date.parse(b.available_at)>cutoff)relative_return_reason='指數資料在截止後可用。';else if(b.adjustment_basis!==d.adjustment_basis)relative_return_reason='個股與指數價格調整基準不同。';else if(bench.some((s,i)=>!s||s.close===null||Date.parse(s.available_at)>cutoff||Date.parse(s.available_at)<Date.parse(dates[i].close_at)))relative_return_reason='指數五日觀察窗缺件或公開時點不可比。';else{relative_return_5d_pct=((last.close/rows.at(-6).close-1)-(bench.at(-1).close/bench[0].close-1))*100;relative_return_reason='五個相同交易session的個股報酬減指數報酬；描述差異，不是因果。';}}
 if(value.thresholds.relative_return_5d_pct!==null&&relative_return_5d_pct===null)return blocked(relative_return_reason);
 const flow_ratio=last.volume>0&&d.flow_unit!=='TWD'?(net_flow*(d.flow_unit==='lots_1000'?1000:1))/(last.volume*(d.volume_unit==='lots_1000'?1000:1)):null;
 const event_alignment=d.events.map(e=>({title:e.title,published_at:e.published_at,session_date:d.calendar.find(c=>c.status==='open'&&Date.parse(c.close_at)>=Date.parse(e.published_at))?.date||null}));
 const matched=volume_ratio>=value.thresholds.volume_ratio&&price_change_pct>=value.thresholds.price_change_pct&&net_flow>=value.thresholds.net_flow&&(value.thresholds.relative_return_5d_pct===null||relative_return_5d_pct>=value.thresholds.relative_return_5d_pct);
 const timing=Date.parse(value.frozen_at)<=Date.parse(window.at(-1).close_at)?'prospective':'retrospective';
 return {status:matched?'candidate':'not_matched',timing,reason:(timing==='retrospective'?'規則晚於觀察日收盤才凍結，屬事後試算。':'')+(matched?'符合凍結的觀察門檻；仍須人工核對基本面確認／推翻條件。':'未同時符合凍結門檻。'),volume_ratio,volume_median_20:median,price_change_pct,net_flow,flow_ratio,relative_return_5d_pct,relative_return_reason,event_alignment,flow_unit:d.flow_unit,volume_unit:d.volume_unit,session_date:last.date,formula_version:'manual-tw-rule/1'};
}
export function previewManualImport(raw) {
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>1000000)return {ok:false,errors:[{message:'候選資料須為1 MB內JSON。'}]};
 try{const candidate=JSON.parse(raw),check=validateResearchWorkspace(candidate);return check.ok?{ok:true,candidate:check.value,counts:{reviews:candidate.reviews.length,scenarios:candidate.scenarios.length,rules:candidate.rules.length},read_only:true}:check;}catch{return {ok:false,errors:[{message:'JSON格式錯誤；尚未寫入任何私人資料。'}]};}
}
export function appendResearchRevision(workspace,domain,record) {
 if(!['reviews','scenarios','rules'].includes(domain))return {ok:false,errors:[{message:'研究域無效。'}]};
 return validateResearchWorkspace({...workspace,[domain]:[...workspace[domain],clone(record)]});
}
