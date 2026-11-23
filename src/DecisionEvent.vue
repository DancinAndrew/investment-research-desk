<template>
<section class="event-reading" aria-label="理由與回顧">
<h3 tabindex="-1" id="event-reading-title">{{ event.title }}</h3>
<template v-if="event.kind==='snapshot'"><p>尚未記錄理由</p><button @click="$emit('edit','reason',event)">補記理由</button></template>
<template v-else-if="event.kind==='decision'||event.kind==='record'">
<p class="local-state">{{ event.kind==='record'?'當時已保存':event.payload.authorship==='retrospective'?'事後補記':event.payload.authorship==='contemporaneous_source'?'當時文字來源':'新決定，未代表已成交' }}</p>
<h4>理由</h4><p class="prose">{{ event.payload.reason }}</p>
<h4>預期</h4><p class="prose">{{ event.payload.expectation||'尚未記錄' }}</p>
<h4>改變看法的條件</h4><p class="prose">{{ event.payload.invalidation||'尚未記錄' }}</p>
<details><summary>更多決策依據</summary><p class="prose">風險：{{ event.payload.risk||'尚未記錄' }}</p><p>期間：{{ event.payload.horizon||'尚未記錄' }}</p><a v-if="event.payload.report_id" :href="'?workspace=company&bundle='+encodeURIComponent(event.payload.report_id)+'&researchTab=report'">閱讀當時引用的報告版本</a><p class="muted">記錄 {{ event.created_at }} · 最後修改 {{ event.updated_at }}</p></details>
<button @click="$emit('edit',event.kind==='record'?'record':'reason',event)">修改理由</button>
</template>
<template v-else-if="event.kind==='execution_evidence'"><p class="local-state">僅留存，尚未納入績效</p><dl class="summary-values"><div><dt>買賣</dt><dd>{{ event.payload.side==='BUY'?'買入':'賣出' }}</dd></div><div><dt>數量</dt><dd>{{ event.payload.quantity??'未提供' }}</dd></div><div><dt>成交價</dt><dd>{{ event.payload.price===null?'未提供':event.payload.price+' '+(event.payload.currency||'幣別未知') }}</dd></div><div><dt>費用</dt><dd>{{ event.payload.fees??'未提供' }}</dd></div></dl><p v-if="event.payload.local_datetime">{{ event.payload.local_datetime }} · {{ event.payload.timezone||'時區未確認' }} · 當日順序未確認</p><p class="prose">{{ event.payload.note }}</p></template>
<template v-else><p>{{ outcomes[event.payload.outcome] }}</p><p class="prose">{{ event.payload.lesson||'尚未記錄後來看到的證據' }}</p><p class="prose">下一步：{{ event.payload.next_action||'尚未記錄' }}</p><button @click="$emit('edit','review',event)">修改回顧</button></template>
<section class="follow-up" v-if="!['review','legacy_review'].includes(event.kind)"><h3>後續回顧</h3><p v-if="!reviews.length" class="muted">尚未回顧這筆紀錄。</p><article v-for="r in reviews" :key="r.id"><h4>{{ r.date||r.event_date }} · {{ outcomes[(r.payload||r).outcome] }}</h4><p class="prose">{{ (r.payload||r).lesson||'尚未記錄證據與學到什麼' }}</p><p class="prose">下一步：{{ (r.payload||r).next_action||'尚未記錄' }}</p><button @click="$emit('edit','review',r)">修改回顧</button></article><button v-if="['snapshot','decision','record'].includes(event.kind)" @click="$emit('edit','review',event)">新增回顧</button></section>
<details><summary>紀錄操作</summary><p>撤回保留原文與歷史，不代表已賣出。</p><button v-if="['decision','review','execution_evidence','record'].includes(event.kind)&&event.revision" @click="$emit('toggle',event)">{{ event.status==='withdrawn'?'恢復紀錄':'撤回紀錄' }}</button></details>
</section>
</template>
<script setup>
defineProps({event:Object,reviews:{type:Array,default:()=>[]}});defineEmits(['edit','toggle']);
const outcomes={pending:'待觀察',supported:'支持原判斷',weakened:'削弱原判斷',mixed:'結果混合'};
</script>
