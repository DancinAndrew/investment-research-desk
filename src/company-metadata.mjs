import {companyMetadata} from './local-research-config.mjs';
export {companyMetadata};
export const marketLabels={TW:'台股',US:'美股',JP:'日股',HK:'港股',CN:'中國股市',EU:'歐洲股市',unclassified:'未分類'};
export function filterCompanies(items,{query='',industry='',market='',favoritesOnly=false,favorites=[]}={}){
 const q=query.trim().toLocaleLowerCase(),saved=new Set(favorites);
 return items.filter(c=>(!q||[c.id,c.ticker||'',c.name].join(' ').toLocaleLowerCase().includes(q))
  && (!industry||(c.industry||'unclassified')===industry)
  && (!market||(market==='unclassified'?!(c.markets||[]).length:(c.markets||[]).includes(market)))
  && (!favoritesOnly||saved.has(c.id)));
}
