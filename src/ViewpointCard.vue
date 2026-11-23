<template>
 <article :id="viewpointAnchor(view.id)" tabindex="-1" class="viewpoint-card">
  <p class="viewpoint-byline">{{ view.author }} · {{ view.source_date || '發表日未知' }}</p>
  <p class="viewpoint-source-title">{{ view.source_title }}</p>
  <p v-if="view.company_role" class="viewpoint-context"><strong>{{ viewpointRole(view.company_role.role) }}：</strong>{{ view.company_role.reason }}</p>
  <p v-else class="viewpoint-context">此觀點提及本公司；與主張的關聯角色尚未判讀。</p>
  <h3>{{ view.author_view }}</h3>
  <p><strong>作者提出的依據：</strong>{{ view.support }}</p>
  <p v-if="view.falsifier"><strong>查核與可能反證：</strong>{{ view.falsifier }}</p>
  <details v-if="traces.length" class="viewpoint-report-use"><summary>本報告如何處理這份來源（{{ traces.length }} 項）</summary><p class="muted">以下逐項對照指定原稿位置；同一份文章的其他說法各有自己的查核狀態。</p><SourceTrace :rows="traces"/></details>
  <p v-else class="muted viewpoint-use-status">尚未建立這份來源與本報告的逐項對應。</p>
  <details><summary>來源與位置</summary><p>來源識別：{{ view.source_id }}</p><p>章節：{{ viewpointSections(view.section_id) }}</p><p>原稿位置：{{ view.locator }}（L 代表行號）</p><p v-if="view.co_mentioned_entities?.length">同段提及：{{ view.co_mentioned_entities.join('、') }}</p><a v-if="safeUrl(view.source_url)" :href="safeUrl(view.source_url)" target="_blank" rel="noopener noreferrer">原始來源 ↗</a></details>
 </article>
</template>
<script setup>
import {safeUrl} from './workbench-model.js'
import {viewpointSections,viewpointRole,viewpointAnchor} from './company-model.mjs'
import SourceTrace from './SourceTrace.vue'
defineProps({view:Object,traces:{type:Array,default:()=>[]}})
</script>
