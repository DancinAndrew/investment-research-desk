<template>
<section class="canonical-desk ledger-page">
<h1>CSV 匯入與匯出</h1><p>把每行一筆成交的 CSV 對映到私人帳本。先預覽與核對，確認後一次儲存。</p>
<PrivateStateStatus :loading="loading" :loaded="loaded" :error="error" :message="message" :storage="storage" :auth-required="authRequired" @reload="load"/>
<p v-if="working" role="status">正在核對完整帳本…</p>
<template v-if="loaded">
<label>選擇成交 CSV（最多 2 MB）<input type="file" accept=".csv,text/csv" @change="readFile"/></label>
<details open><summary>或貼上 CSV</summary><label>CSV 文字<textarea v-model="text" maxlength="2000000" rows="5" placeholder="date,ticker,side,quantity,price,currency,fees&#10;2026-01-01,AMZN,BUY,1,100,USD,0" /></label></details>
<label>分隔符號<select v-model="delimiter"><option value=",">逗號</option><option value=";">分號</option><option value="\t">Tab（定位字元）</option></select></label><button :disabled="busy||!text.trim()" @click="parse">解析欄位</button>
<template v-if="parsed">
<h2>1. 對映欄位</h2><p>{{ parsed.rows.length }} 筆資料。日期、標的、買賣、股數、價格為必填對映。</p>
<div class="form-grid"><label v-for="field in csvFields" :key="field">{{ labels[field] }}<select v-model="mapping[field]"><option :value="null">未提供</option><option v-for="(h,i) in parsed.headers" :key="i" :value="i">{{ h }}</option></select></label></div>
<h2>2. 核對格式</h2><div class="form-grid"><label>日期格式<select v-model="options.dateFormat"><option value="ISO">年-月-日（2026-01-31）</option><option value="DMY">日/月/年（31/01/2026）</option><option value="MDY">月/日/年（01/31/2026）</option></select></label><label>數字格式<select v-model="options.numberFormat"><option value="dot">小數點 .，千分位 ,</option><option value="comma">小數點 ,，千分位 .</option></select></label><label>買入代碼<input v-model="options.buyValue" maxlength="30" /></label><label>賣出代碼<input v-model="options.sellValue" maxlength="30" /></label><label>缺幣別時採用<input v-model="options.defaultCurrency" maxlength="3" /></label></div>
<label class="check-label"><input type="checkbox" v-model="options.feesMissingZero"/>我已核對未提供費用的成交，確認費用為零</label><label>原檔缺理由時保存的文字<input v-model="options.reasonFallback" maxlength="5000" /></label><label class="check-label"><input type="checkbox" v-model="options.ownExport"/>這是本工作台匯出的 CSV，還原試算表防公式轉義</label><p class="muted">未提供的當時理由會明示未記錄；匯入屬使用者資料，不代表券商已核證。股息、換匯與拆併股請在「資金與績效」另記。</p>
<button :disabled="busy||working" @click="previewImport">產生匯入預覽</button>
</template>
<template v-if="preview">
<h2>3. 選擇與確認</h2><p>可新增 {{ preview.entries.filter(e=>e.status==='ready').length }} 筆；可能重複 {{ preview.entries.filter(e=>e.status==='possible_duplicate').length }} 筆；重複、衝突與格式錯誤不會新增。</p>
<p>預設選取全部可新增成交；分頁只影響顯示，不改变選取。</p><div class="button-row"><button :disabled="page<=1" @click="page--">上一頁成交</button><span>第 {{ page }} / {{ pages }} 頁 · 每頁50筆</span><button :disabled="page>=pages" @click="page++">下一頁成交</button><button :disabled="working||busy" @click="selected=[]">取消全部成交選取</button><button :disabled="working||busy" @click="selected=preview.entries.filter(e=>e.status==='ready').map(e=>e.number)">選取全部可新增成交</button></div><div class="table-scroll"><table class="ledger-table"><thead><tr><th>選取</th><th>資料列</th><th>日期／標的</th><th>成交</th><th>核對結果</th></tr></thead><tbody><tr v-for="e in pageEntries" :key="e.number"><td><label class="check-label"><input type="checkbox" v-model="selected" :value="e.number" :disabled="!['ready','possible_duplicate'].includes(e.status)"/>第 {{ e.number }} 列</label></td><td>{{ e.number }}</td><td>{{ e.record?.date }} {{ e.record?.ticker }}</td><td v-if="e.record">{{ e.record.side==='BUY'?'買入':'賣出' }} {{ e.record.quantity }} × {{ e.record.price }} {{ e.record.currency }}；費用 {{ e.record.fees }}</td><td v-else>無法解析</td><td>{{ e.reason }}</td></tr></tbody></table></div>
<label class="check-label"><input type="checkbox" v-model="allowDuplicates"/>已核對所選「可能重複」項目，確認為不同實際成交</label><p>這次選 {{ selected.length }} 筆；不覆寫既有成交。按確認後會檢查整帳股數及目前版本。</p><div class="button-row"><button class="primary" :disabled="busy||working||!selected.length" @click="apply">確認新增所選成交</button><button :disabled="busy||working" @click="resetPreview">取消匯入預覽</button></div>
</template>
<h2>匯入批次</h2><p v-if="!state.imports?.length" class="empty-state">尚無 CSV 匯入批次。</p><article v-for="b in state.imports||[]" :key="b.id" class="decision-card"><h3>{{ b.created_at.slice(0,16).replace('T',' ') }} UTC · {{ b.record_ids.length }} 筆</h3><p>{{ b.status==='applied'?'已套用':'已撤銷' }} · 本批來源指紋 {{ b.source_hash.slice(0,12) }}</p><button v-if="b.status==='applied'" :disabled="busy||working" @click="undo(b.id)">撤銷本批匯入</button></article><p class="muted">撤銷只移除本批未修改成交；已有回顧、後續賣出依賴或被修改時會阻擋，保留原資料與歷史。</p>
<h2>帶走成交資料</h2><button @click="exportText=exportTradesCsv(state.records)">產生成交 CSV</button><template v-if="exportText"><label>完整成交 CSV（可複製）<textarea :value="exportText" readonly rows="7" spellcheck="false"/></label><button @click="download">下載成交 CSV</button><button @click="exportText=''">關閉 CSV</button></template><p>CSV 含所有交易欄位及理由；完整研究決定、回顧與資金資料請用<a href="?workspace=ledger">帳本 JSON 備份</a>。</p>
</template></section>
</template>
<script setup>
import {computed,ref,watch} from 'vue';
import PrivateStateStatus from './PrivateStateStatus.vue';
import {usePrivateState} from './private-state.js';
import {csvFields,parseCsv,prepareCsvImport,applyCsvImport,undoCsvImport,exportTradesCsv} from './csv-ledger.mjs';
const {state,loaded,loading,busy,error,message,storage,authRequired,scope,revision,load,save}=usePrivateState();
let previewSequence=0;
const page=ref(1);
const pages=computed(()=>Math.max(1,Math.ceil((preview.value?.entries.length||0)/50)));
const pageEntries=computed(()=>preview.value?.entries.slice((page.value-1)*50,page.value*50)||[]);
const text=ref(''),delimiter=ref(','),parsed=ref(null),mapping=ref({}),preview=ref(null),selected=ref([]),allowDuplicates=ref(false),working=ref(false),exportText=ref('');
const options=ref({dateFormat:'ISO',numberFormat:'dot',buyValue:'BUY',sellValue:'SELL',defaultCurrency:'',feesMissingZero:false,reasonFallback:'匯入；當時理由未記錄',ownExport:false});
const labels={id:'成交 ID',date:'日期 *',ticker:'標的 *',side:'買賣 *',quantity:'股數 *',price:'成交價格 *',currency:'幣別',fees:'費用',reason:'當時理由',horizon:'期間',expectation:'預期',risk:'風險',invalidation:'失效條件',report_id:'報告版本',source_links:'來源連結',status:'有效／撤回狀態',revision:'紀錄版本',created_at:'建立時間',updated_at:'更新時間'};
function resetPreview(){page.value=1;previewSequence++;preview.value=null;selected.value=[];allowDuplicates.value=false;}
watch([text,delimiter],()=>{parsed.value=null;resetPreview();});watch([mapping,options],resetPreview,{deep:true});watch(scope,(c,p)=>{if(p&&c!==p){text.value='';parsed.value=null;exportText.value='';resetPreview();}});
function parse(){error.value='';try{parsed.value=parseCsv(text.value,delimiter.value==='\\t'?'\t':delimiter.value);mapping.value=Object.fromEntries(csvFields.map(k=>[k,parsed.value.headers.indexOf(k)>=0?parsed.value.headers.indexOf(k):null]));resetPreview();}catch(e){error.value=e.message;}}
async function readFile(e){const file=e.target.files[0],expected=scope.value;if(!file)return;try{if(file.size>2000000)throw new Error('CSV 超過 2 MB。');let data;try{data=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}catch{throw new Error('CSV 需為 UTF-8 文字，請從來源另存 UTF-8 後再匯入。');}if(loaded.value&&scope.value===expected){text.value=data;parsed.value=null;}}catch(e){error.value=e.message;}finally{e.target.value='';}}
async function previewImport(){const expected=scope.value,expectedRevision=revision.value,sequence=++previewSequence;working.value=true;error.value='';try{const result=await prepareCsvImport(JSON.parse(JSON.stringify(parsed.value)),JSON.parse(JSON.stringify(mapping.value)),JSON.parse(JSON.stringify(options.value)),JSON.parse(JSON.stringify(state.value)));if(scope.value===expected&&loaded.value&&revision.value===expectedRevision&&sequence===previewSequence){preview.value=result;selected.value=result.entries.filter(e=>e.status==='ready').map(e=>e.number);allowDuplicates.value=false;}}catch(e){error.value=e.message;}finally{working.value=false;}}
async function apply(){const expected=scope.value,expectedRevision=revision.value;working.value=true;try{const r=await applyCsvImport(state.value,preview.value,[...selected.value],{allowPossibleDuplicates:allowDuplicates.value});if(!r.ok){error.value=r.errors.map(e=>e.message).join('；');return;}if(scope.value!==expected||!loaded.value)return;if(await save(r.state,'CSV 所選成交已匯入；原帳本版本保留於歷史。',{expectedScope:expected,expectedRevision}))resetPreview();}catch(e){error.value=e.message;}finally{working.value=false;}}
async function undo(id){const expected=scope.value,expectedRevision=revision.value;working.value=true;try{const r=await undoCsvImport(state.value,id);if(!r.ok){error.value=r.errors.map(e=>e.message).join('；');return;}if(scope.value!==expected||!loaded.value)return;if(await save(r.state,'本批未修改成交已撤銷，其他資料保留。',{expectedScope:expected,expectedRevision}))resetPreview();}catch(e){error.value=e.message;}finally{working.value=false;}}
function download(){const a=document.createElement('a'),url=URL.createObjectURL(new Blob([exportText.value],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='investment-trades.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
</script>
