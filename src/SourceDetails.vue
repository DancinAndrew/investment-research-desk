<template>
  <details class="provenance">
    <summary>來源、時間與版本</summary>
    <dl>
      <template v-for="row in rows" :key="row[0]"><dt>{{ row[0] }}</dt><dd>{{ row[1] || '未提供' }}</dd></template>
    </dl>
  </details>
</template>
<script setup>
import {computed} from 'vue'
import {formatDate,publicationLabel} from './workbench-model'
const props=defineProps({source:{type:Object,required:true}})
const rows=computed(()=>[
  ['來源標題',props.source.title],
  ['發布',publicationLabel(props.source)],['首次看見',formatDate(props.source.seen_at)],
  ['分類／處理',formatDate(props.source.processed_at)],['修訂',formatDate(props.source.revised_at)],
  ['來源時間原值',props.source.published_at || props.source.published_date],['表述類型',props.source.representation],['使用權限',props.source.permission],
  ['來源識別',props.source.id],['版本識別',props.source.revision_id],
  ['定位',typeof props.source.locator==='string'?props.source.locator:JSON.stringify(props.source.locator)],
  ['內容 SHA-256',props.source.content_sha256]
])
</script>
<style scoped>
.provenance {margin-top:16px;color:var(--research-muted);font-size:13px}
summary {cursor:pointer;min-height:44px;display:flex;align-items:center;gap:.5rem;font-weight:600}
summary::before {content:'＋';font-size:1rem} details[open] summary::before {content:'−'}
summary:hover {color:var(--research-accent)} summary:focus-visible {outline:2px solid var(--research-accent);outline-offset:3px;border-radius:4px}
dl {display:grid;grid-template-columns:minmax(6em,auto) minmax(0,1fr);gap:12px 16px;margin:8px 0 16px;padding:16px;background:var(--research-control);border-radius:4px}
dt {font-weight:600} dd {margin:0;overflow-wrap:anywhere;color:var(--research-ink)}
@media(max-width:480px) {dl {grid-template-columns:1fr;gap:.25rem} dd {margin-bottom:.6rem}}
</style>
