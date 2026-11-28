import { fold } from '../api/medications.js';
import { samePack, validBarcode as validGtin } from '../api/retail-prices.js';

// Some partner titles omit the "/mL" on an oral solution. Only accept that
// abbreviation when its unit, bottle size, route and validated trade barcode
// agree with the documented drops. A solution alone does not establish drops.
export function matchesDropListing(hit, row) {
  const anchor = {name:hit.name,gtin:String(hit.eanCode)};
  if (!validGtin(anchor.gtin) || row.gtin !== anchor.gtin) return false;
  const facts = row.facts ?? {};
  const route = fold([facts['Forma de Administração'],facts['Via de Administração']].flat().filter(Boolean).join(' '));
  const form = fold([row.name,row.itemName,facts.Apresentação,facts['Forma Farmacêutica']].flat().filter(Boolean).join(' '));
  if (route && !/^(?:(?:uso|via) )?oral$/.test(route)) return false;
  if (!/\b(?:solucao|gotas|suspensao)\b/.test(form) || /injet|ampola|oftalm|otolog|nasal|subling|comprimido|capsula|xarope/.test(form)) return false;
  if (!hit.brand) return false;
  const name = fold(hit.brand);
  if (!name || !(' '+fold(row.name)+' ').includes(' '+name+' ')) return false;
  const concentration = /\b(\d+(?:[.,]\d+)?)\s*(mcg|mg|g)\s*\/\s*ml\b/i.exec(hit.name);
  const pack = /\b(\d+(?:[.,]\d+)?)\s*ml\b/i.exec(hit.details?.quantidade ?? '') ??
    /\b(\d+(?:[.,]\d+)?)\s*ml\b/i.exec(hit.name);
  if (!pack || !concentration) return false;
  const normalizedDose = value => fold(value).replace(/\s+/g, '').replace(',', '.');
  const dose = normalizedDose(concentration[0]);
  for (const field of [facts.Dosagem].flat().filter(Boolean)) {
    const local = normalizedDose(field);
    if (local !== dose && local !== dose.replace(/\/ml$/, '')) return false;
  }
  return [row.name,row.itemName ?? row.name].every(title=>{
    if (!title) return false;
    const text = fold(title).replace(/(\d),(\d)/g,'$1.$2');
    if (/\b(?:[2-9]|[1-9]\d+)\s*(?:frascos?|unidades?)\b/.test(text)) return false;
    const volumes = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*ml\b/g)];
    if (volumes.length !== 1 || Number(volumes[0][1]) !== Number(pack[1].replace(',','.'))) return false;
    const label = text.replace(/\b(\d+(?:\.\d+)?)\s*(mcg|mg|g)\b(?!\s*\/)/gi, (strength,n,unit)=>
      Number(n)===Number(concentration[1].replace(',','.')) && unit===concentration[2].toLowerCase() ? strength+'/ml' : strength);
    return samePack(anchor,{...row,name:label,itemName:label});
  });
}
