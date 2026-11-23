<template><section class="canonical-desk"><h1 tabindex="-1">研究方法</h1><div class="canonical-reading">
<p>我們先研究生意，再研究價格。先說清楚公司向誰收錢、客戶為什麼留下、成長需要付出什麼，以及最後能留下多少現金；接著才問，現在的股價要求公司做到什麼。</p>
<div class="method-steps"><section v-for="s in steps" :key="s.title"><h2>{{ s.title }}</h2><p>{{ s.text }}</p></section></div>
<p>本站閱讀研究與來源快照，月度回顧、情境與人工規則由你明確核對後保存。新來源取得、重算與審查在 Mac 的本機流程執行，完成後再匯入；頁面重新整理不會啟動背景研究。</p>
<div class="button-row"><a href="?workspace=company">閱讀公司研究</a><a href="?workspace=signals">查閱 X 原文線索</a><a href="?workspace=ledger">記錄自己的買賣理由</a></div>
<details><summary>流程與資料保護</summary><p>本機流程以來源 hash、設定版本和階段收據保存進度；中斷或取消會保留已完成工作。新資料產生候選，人工接受後才形成新版本。</p><p>完整原文依權利留在本機，網站只顯示允許的財務事實、自寫摘要、短引與原件連結。私人研究、提示與 trace 不送往第三方服務。</p><p>目前使用既有資料包、確定性公式與本機紀錄。LangGraph 僅是未來續跑工具候選，LangChain 按需要評估；Langfuse 尚未啟用。</p></details>
<details><summary>可重現操作手冊</summary><p v-if="error" role="alert">{{ error }} <button @click="load">重試手冊</button></p><article v-if="manual" class="canonical-markdown" v-html="safeMarkdown(manual,manualLink,{headingOffset:1})"/><p v-else>正在載入完整手冊…</p></details>
</div></section></template>
<script setup>
import {ref,onMounted} from 'vue'
import {localApi} from './api.js'
import {artifactLink,safeMarkdown,prepareMarkdown} from './canonical-view.js'
const steps=[
{title:'1 · 建立公司底稿',text:'用年報與財報確認誰付錢、公司提供什麼，以及成本花在哪裡。分清公司、股票與業務部門，並說明需求、競爭、客戶、供應商與政策怎樣影響收入和現金。'},
{title:'2 · 交代八季資料與缺口',text:'財報、管理層說明與問答的完整度分開計算。取得文件、完整閱讀與語義覆核各留紀錄；缺稿的季度限制可比較範圍。同一公告在不同網站出現，仍是同一個上游。'},
{title:'3 · 跨季核對原話與目標',text:'一起追蹤訂單與拉貨、資本支出與產能、毛利與產品組合、驗證與量產、瓶頸。分開已實現業績、管理層展望與研究者推論。保留目標提出時的條件、期限和口徑；修訂不抹去原始版本，未披露也不等於失敗。'},
{title:'4 · 讓數字可以重算',text:'核對幣別、單位、期間、會計口徑與股數。营收、利潤及現金流的推導保留公式與依據；缺值不填零。財季末、發布日和取回時間分開，事後取得的材料不回填成當時已讀。'},
{title:'5 · 用三情境檢查價格',text:'保守、基準與樂觀情境用相同算式。每個假設有來源或理由，也寫出需求、產品組合和資本投入的交互限制。沒有資料的市場共識不補造；情境不代表機率，虧損時不套正盈利本益比。'},
{title:'6 · 找最強反方與改觀條件',text:'每個重要說法連到原文版本、發布時間和頁／段定位。遇到矛盾，先核時間、範圍和定義；語氣轉保守本身不代表營運變壞。保存最有力的替代解釋、未識別項與接下來三個可查問題。'},
{title:'7 · 手動更新並回顧研究',text:'月度回顧固定原報告與資料包，分看需求、營運、競爭和價格。記錄新證據、維持或改判理由及事前／事後資訊，再安排至多五項下月工作。價格與損益不代替基本面證據，新的個人判斷另存版本。'},
{title:'8 · 把提醒留在研究流程內',text:'人工價量與法人流核對先確認資料權利、復權、交易日和公開時間。符合條件只產生待查候選，接著核基本面確認與失效條件。AI協助整理與提出疑點；數字由可重算方法核對，重要判斷由人負責。'}]
const manual=ref(''),error=ref(''),artifacts=ref([])
const manualPath='公司/AMZN/2026-10-11-v2/06-公司研究操作手冊-v4.md'
function manualLink(target){const id=artifactLink(target,manualPath,artifacts.value);return id?'?workspace=company&bundle=AMZN-20261011-v2-reader-reviewed&researchTab=artifact&artifact='+encodeURIComponent(id):null}
async function load(){error.value='';try{const a=await localApi('canonical/bundles/AMZN-20261011-v2-reader-reviewed/artifacts/'+encodeURIComponent('amzn-06-公司研究操作手冊-v4.md'));await prepareMarkdown(a.content);manual.value=a.content;const bundle=await localApi('canonical/bundles/AMZN-20261011-v2-reader-reviewed');artifacts.value=bundle.artifacts}catch(e){error.value=e.message}}
onMounted(load)
</script>
