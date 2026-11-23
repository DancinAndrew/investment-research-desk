<template>
 <div class="source-trace">
  <article v-for="row in rows" :key="row.id" class="trace-row">
   <p class="trace-role">{{ traceRole(row.role) }}</p>
   <h3>{{ row.claim_text }}</h3>
   <p>{{ row.explanation }}</p>
   <p class="muted">{{ row.source_title }} · {{ row.source_published_at || '發表日未知' }}</p>
   <div class="trace-links"><a :href="traceReportUrl(row)">閱讀報告：{{ row.report_section }}</a><a v-if="row.viewpoint_url" :href="row.viewpoint_url">第三方觀點與原稿位置</a><a v-else-if="row.artifact_url" :href="row.artifact_url">固定參數</a><a v-if="row.result_artifact_url" :href="row.result_artifact_url">保存計算結果</a><a v-if="!row.viewpoint_url && !row.artifact_url && safeUrl(row.source_url)" :href="safeUrl(row.source_url)" target="_blank" rel="noopener noreferrer">原始來源 ↗</a></div>
   <details><summary>精確位置與支持範圍</summary><p>主張：{{ row.claim_id }}／{{ row.subclaim_id }}</p><p>報告第 {{ row.report_lines.join('–') }} 行；{{ row.source_locator }}</p><p v-if="row.source_local_path">Mac 原稿位置：{{ row.source_local_path }}</p><p v-if="row.source_sha256">來源 SHA-256：{{ row.source_sha256 }}</p><p>{{ row.support_limit }}</p></details>
  </article>
 </div>
</template>
<script setup>
import {safeUrl} from './workbench-model.js'
import {traceRole,traceReportUrl} from './company-model.mjs'
defineProps({rows:{type:Array,default:()=>[]}})
</script>
