<template><section aria-labelledby="review-insights-title">
<h2 id="review-insights-title">從自己的記錄回看判斷</h2><p>先看資料記錄是否完整，再回查後來支持或削弱原判斷的證據。</p>
<div class="form-grid"><label>成交起日<input type="date" v-model="from"/></label><label>成交迄日<input type="date" v-model="to"/></label><label>搜尋當時理由、風險或回顧<input v-model="query" maxlength="200"/></label><label>最近回顧結果<select v-model="outcome"><option value="all">全部</option><option value="unreviewed">尚未回顧</option><option value="pending">待觀察</option><option value="supported">支持原判斷</option><option value="weakened">削弱原判斷</option><option value="mixed">結果混合</option></select></label></div>
<p v-if="!state.records.some(r=>r.status==='active')" class="empty-state">尚無有效成交；記錄交易與具體回顧後，才有自己的判斷可比較。</p><template v-else>
<p>符合 {{ rows.length }} 筆有效成交。{{ rows.filter(x=>!x.review).length }} 筆尚未回顧；{{ rows.filter(x=>!x.record.invalidation).length }} 筆未寫改變看法的條件；{{ rows.filter(x=>!x.record.expectation).length }} 筆未寫預期。</p>
<p v-if="!rows.length" class="empty-state">這個日期、搜尋與結果組合沒有紀錄。請調整篩選。</p>
<div v-if="rows.length" class="table-scroll"><table class="ledger-table"><thead><tr><th>最近回顧結果</th><th>筆數</th></tr></thead><tbody><tr v-for="(count,label) in counts" :key="label"><th>{{ label }}</th><td>{{ count }}</td></tr></tbody></table></div><p class="muted">每筆成交只取最新日期的回顧，同日取最後保存的一筆；反映你記錄的判斷，尚未回顧不算失敗。盈虧與判斷結果分開，這些筆數不能推出策略正確率或未來報酬。</p>
<article v-for="row in rows" :key="row.record.id" class="decision-card"><h3>{{ row.record.date }} · {{ row.record.ticker }} · {{ row.record.side==='BUY'?'買入':'賣出' }}</h3><p><strong>當時理由：</strong>{{ row.record.reason }}</p><p><strong>預期：</strong>{{ row.record.expectation||'未記錄' }}</p><p><strong>改變看法的條件：</strong>{{ row.record.invalidation||'未記錄' }}</p><p><strong>最近回顧：</strong>{{ row.review?row.review.date+' · '+labels[row.review.outcome]:'尚未回顧' }}</p><template v-if="row.review"><p>{{ row.review.lesson||'尚未記錄證據與學習' }}</p><p>下一步：{{ row.review.next_action||'未記錄' }}</p></template><div class="button-row"><a :href="'?workspace=review&record='+encodeURIComponent(row.record.id)" @click.prevent="$emit('navigate','review',row.record.id)">回查這筆交易與全部回顧</a><a v-if="row.record.report_id" :href="reportUrl(row.record.report_id)">閱讀當時報告版本</a></div></article>
</template></section></template>
<script setup>
import {computed,ref,watch,onMounted,onUnmounted} from 'vue';
import {reviewRows} from './review-core.mjs';
const props=defineProps({state:Object,reports:Array});defineEmits(['navigate']);
const from=ref(''),to=ref(''),query=ref(''),outcome=ref('all');
const labels={pending:'待觀察',supported:'支持原判斷',weakened:'削弱原判斷',mixed:'結果混合',unreviewed:'尚未回顧'};
const rows=computed(()=>reviewRows(props.state,{from:from.value,to:to.value,query:query.value,outcome:outcome.value}));
const counts=computed(()=>Object.fromEntries(Object.entries(labels).map(([key,label])=>[label,rows.value.filter(x=>(x.review?.outcome||'unreviewed')===key).length])));
const reportUrl=id=>{const b=props.reports.find(r=>r.bundle_id===id);return '?workspace=company&company='+encodeURIComponent(b?.security?.ticker||'')+'&bundle='+encodeURIComponent(id)+'&researchTab=report';};
function readUrl(){const p=new URLSearchParams(location.search);from.value=p.get('reviewFrom')||'';to.value=p.get('reviewTo')||'';query.value=p.get('reviewQuery')||'';outcome.value=p.get('reviewOutcome')||'all';}
watch([from,to,query,outcome],()=>{if(new URLSearchParams(location.search).get('workspace')!=='review')return;const p=new URLSearchParams(location.search);for(const [k,v] of [['reviewFrom',from.value],['reviewTo',to.value],['reviewQuery',query.value],['reviewOutcome',outcome.value==='all'?'':outcome.value]]){if(v)p.set(k,v);else p.delete(k);}history.replaceState(history.state,'','?'+p);});
readUrl();onMounted(()=>window.addEventListener('popstate',readUrl));onUnmounted(()=>window.removeEventListener('popstate',readUrl));
</script>
