<template>
 <div class="report-navigation" @keydown.esc="closeOptions(true)">
  <div class="report-nav-bar">
   <nav class="report-primary-tabs" aria-label="研究內容">
    <a v-for="item in primary" :key="item.id" :href="hrefFor(item.id)" :aria-current="tab===item.id?'page':undefined" @click.prevent="choose(item.id)">{{ item.label }}</a>
   </nav>
   <button ref="toggle" type="button" class="report-options-toggle" :class="{'is-current':secondary.some(item=>item.id===tab)}" :aria-expanded="optionsOpen" aria-controls="report-options" @click="optionsOpen=!optionsOpen">附錄與版本<svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" :class="{'is-open':optionsOpen}"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></button>
  </div>
  <section v-if="optionsOpen" id="report-options" class="report-options" aria-label="附錄與研究版本">
   <nav aria-label="研究附錄"><a v-for="item in secondary" :key="item.id" :href="hrefFor(item.id)" :aria-current="tab===item.id?'page':undefined" @click.prevent="choose(item.id,true)">{{ item.label }}</a></nav>
   <label class="report-version-field">研究版本<select aria-label="研究版本" :value="selectedId" :disabled="loading" @change="changeVersion($event.target.value)"><option v-for="item in versions" :key="item.bundle_id" :value="item.bundle_id">{{ item.label }}</option></select></label>
   <div class="report-related-actions"><button type="button" @click="recordDecision">引用研究記錄交易理由</button><a :href="relationsHref">公司關係</a></div>
  </section>
 </div>
</template>
<script setup>
import {nextTick,ref,watch} from 'vue'
const props=defineProps({primary:Array,secondary:Array,tab:String,hrefFor:Function,versions:Array,selectedId:String,loading:Boolean,relationsHref:String})
const emit=defineEmits(['navigate','version','record-decision'])
const optionsOpen=ref(false),toggle=ref(null)
function closeOptions(restoreFocus=false){optionsOpen.value=false;if(restoreFocus)nextTick(()=>toggle.value?.focus())}
function choose(id,fromOptions=false){closeOptions(fromOptions);emit('navigate',id)}
function changeVersion(id){closeOptions(true);emit('version',id)}
function recordDecision(){closeOptions();emit('record-decision')}
watch(()=>props.selectedId,()=>closeOptions())
</script>
