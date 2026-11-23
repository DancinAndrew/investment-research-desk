<template>
 <section v-if="items.length" class="snapshot-list" aria-label="持倉快照">
  <h2>持倉快照</h2><p class="muted">{{ items.length }} 個獨立部位。畫面日期未知時保留未知；快照與不完整成交證據不納入交易重播或報酬計算。</p>
  <article v-for="s in items" :key="s.id" class="snapshot-row">
   <div class="record-heading"><h3>{{ s.symbol }} <span>{{ product(s.product) }} · {{ direction(s.direction) }}</span></h3><span>{{ s.exchange || '交易所待確認' }}</span></div>
   <dl class="snapshot-values"><template v-for="(f,key) in s.fields" :key="key"><dt>{{ snapshotFields[key] }}</dt><dd>{{ number(f.value) }} {{ f.unit }}</dd></template></dl>
   <p class="muted">數量：{{ s.fields.quantity ? number(s.fields.quantity.value)+' '+s.fields.quantity.unit : '畫面未顯示' }} · 快照日期：{{ s.captured_date || '未知' }}<template v-if="s.screen_time"> · 畫面時間 {{ s.screen_time }}（時區未知）</template></p>
   <details><summary>來源與缺口</summary><p>{{ s.note }}</p><p v-for="p in s.sources" :key="p.name">{{ p.name }}</p><p>匯入時間 {{ s.imported_at }}；不等於成交或拍攝時間。</p><p v-for="(h,i) in s.observed_history" :key="i">{{ h.side==='BUY'?'買入':'賣出' }} {{ h.quantity }} · 畫面日期 {{ h.local_datetime }} · 時區 {{ h.timezone || '未知' }} · 成交價 {{ h.price ?? '未知' }}<template v-if="h.currency"> {{ h.currency }}</template></p></details>
   <button v-if="editable && editing!==s.id" :disabled="busy" @click="editing=s.id;exchange=s.exchange||''">{{ s.exchange?'修改交易所':'填寫交易所' }}</button>
   <form v-if="editable && editing===s.id" class="snapshot-exchange" @submit.prevent="submit(s)"><label>交易所<input v-model="exchange" maxlength="100" required/></label><button :disabled="busy">儲存交易所</button><button type="button" @click="editing=''">取消</button></form>
  </article>
 </section>
</template>
<script setup>
import {ref} from 'vue'
import {snapshotFields} from './snapshot-core.mjs'
defineProps({items:{type:Array,default:()=>[]},busy:Boolean,editable:Boolean})
const emit=defineEmits(['exchange'])
const editing=ref(''),exchange=ref('')
const number=v=>new Intl.NumberFormat('zh-TW',{maximumFractionDigits:10}).format(v)
const product=v=>({perpetual:'永續',spot:'現貨',stock_token:'股票代幣',bot:'機器人',unknown:'商品待確認'}[v])
const direction=v=>({long:'做多',short:'做空',unknown:'方向未顯示'}[v])
function submit(s){emit('exchange',{id:s.id,exchange:exchange.value.trim()});editing.value=''}
</script>
