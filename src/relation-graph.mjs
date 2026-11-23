// A relation is an evidence-backed hyperedge; centering never changes its parties.
export function relationCategory(edge){return /^(de-minimis|ftc-|eu-)/.test(edge.id)?'policy':/^(merchant|logistics)/.test(edge.id)?'retail':'cloud'}
export function graphSelection(index,search){
 const p=search instanceof URLSearchParams?search:new URLSearchParams(search)
 const companies=new Set(index.nodes.filter(n=>n.type==='company').map(n=>n.id))
 const center=companies.has(p.get('center'))?p.get('center'):''
 return {center,mode:p.get('graphMode')==='global'?'global':center?'center':'choose',category:['cloud','policy','retail','all'].includes(p.get('category'))?p.get('category'):'all',filter:p.get('filter')||'',focus:index.nodes.some(n=>n.id===p.get('focus'))?p.get('focus'):'',edge:p.get('edge')||'',node:p.get('node')||''}
}
export function graphEdges(index,state,searchText=edge=>edge.id){
 if(state.mode==='choose')return []
 return index.edges.filter(e=>(state.mode==='global'||e.parties.includes(state.center))&&(state.category==='all'||relationCategory(e)===state.category)&&(!state.focus||e.parties.includes(state.focus))&&searchText(e).toLowerCase().includes(state.filter.toLowerCase()))
}
export function graphPositions(nodes,center=''){
 const positions={}
 const centered=nodes.some(n=>n.id===center)
 if(centered)positions[center]={x:500,y:360}
 const others=nodes.filter(n=>!centered||n.id!==center)
 others.forEach((n,i)=>{const a=-Math.PI/2+2*Math.PI*i/Math.max(others.length,1);positions[n.id]={x:500+370*Math.cos(a),y:360+280*Math.sin(a)}})
 return positions
}
export function graphGeometry(edges,positions,{labelWidth=112,labelHeight=44}={}){
 const labels=[]
 // At far zoom-out, CSS-sized targets need more world-space room. The existing
 // panning canvas can extend past the node ring instead of overlapping controls.
 const canvasExtension=Math.max(0,labelHeight-80)*4
 const overlaps=(point,other,width,height)=>Math.abs(point.x-other.x)<width&&Math.abs(point.y-other.y)<height
 function placeLabel(anchor){
  // Label dimensions include the viewport/zoom conversion to CSS pixels.
  // Keep each independently selectable label clear of nodes and
  // previously placed labels so its visible text selects its own evidence.
  for(const bounded of [true,false])for(let ring=0;ring<24;ring++){
   const count=ring?ring*8:1
   for(let i=0;i<count;i++){
    const angle=2*Math.PI*i/count
    const point={x:anchor.x+ring*32*Math.cos(angle),y:anchor.y+ring*32*Math.sin(angle)}
    if(bounded&&(point.x<labelWidth/2+8-canvasExtension||point.x>1000-labelWidth/2-8+canvasExtension||point.y<labelHeight/2+8-canvasExtension||point.y>720-labelHeight/2-8+canvasExtension))continue
    if(labels.some(other=>overlaps(point,other,labelWidth+12,labelHeight+12)))continue
    if(Object.values(positions).some(other=>overlaps(point,other,(labelWidth+146)/2+8,(labelHeight+56)/2+8)))continue
    labels.push(point)
    return point
   }
  }
  // Preserve the full workspace at every zoom. If the dense canvas cannot fit
  // another CSS-sized target, extend its pannable world to the right.
  const right=Math.max(1000,...labels.map(p=>p.x+labelWidth/2),...Object.values(positions).map(p=>p.x+73))
  const point={x:right+labelWidth/2+12,y:anchor.y}
  labels.push(point)
  return point
 }
 return edges.map(edge=>{
  const parties=edge.parties.slice().sort().map(id=>positions[id]).filter(Boolean)
  if(parties.length<2)return {...edge,label:parties[0]||{x:500,y:360},paths:[]}
  const key=edge.parties.slice().sort().join('|')
  const siblings=edges.filter(e=>e.parties.slice().sort().join('|')===key)
  const offset=(siblings.findIndex(e=>e.id===edge.id)-(siblings.length-1)/2)*64
  const dx=parties[1].x-parties[0].x,dy=parties[1].y-parties[0].y,length=Math.hypot(dx,dy)||1
  const label=placeLabel({x:parties.reduce((sum,p)=>sum+p.x,0)/parties.length-dy/length*offset,y:parties.reduce((sum,p)=>sum+p.y,0)/parties.length+dx/length*offset})
  return {...edge,label,paths:parties.map(p=>`M ${p.x} ${p.y} Q ${(p.x+label.x)/2} ${(p.y+label.y)/2} ${label.x} ${label.y}`)}
 })
}
