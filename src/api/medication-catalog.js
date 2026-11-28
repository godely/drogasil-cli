import { readFileSync } from 'node:fs';
import { fold, resolveName, medicationIndex, distance } from './medications.js';

const dcb = new Set(readFileSync(new URL('../data/dcb-names.txt', import.meta.url), 'utf8').trimEnd().split('\n'));
export const isDcbName = term => dcb.has(fold(term));
const clean = value => fold(value ?? '').replace(/(\d),(?=\d)/g, '$1.').replace(/\s+/g, ' ');
const tokens = value => clean(value).match(/\d+(?:\.\d+)?\s*(?:mcg|mg|ml|ui|g|%)(?:\s*\/\s*(?:ml|g|h|dose))?|[a-z]+|\d+(?:\.\d+)?/g)?.map(t=>t.replace(/\s/g,'')) ?? [];
const contains = (list, part) => part.length > 0 && list.some((_,i) => part.every((word,j)=>list[i+j]===word));
const unitDose = word => /^\d+(?:\.\d+)?(?:mg|mcg|g|ui|%)(?:\/|$)/.test(word);

export async function medicationIntent(input, getIndex = medicationIndex) {
  const query = clean(input);
  if (!query || /^\d+$/.test(query)) return {kind:'text', name:query, suffix:'', suggestions:[]};
  const words = query.split(' ');
  const names = await getIndex().catch(() => ({ingredient:new Map(),brand:new Map()}));
  for (let i=words.length; i>0; i--) {
    const name = words.slice(0,i).join(' '), suffix = words.slice(i).join(' ');
    if (isDcbName(name) || names.ingredient.has(name)) return {kind:'ingredient',name,suffix,suggestions:[]};
    if (names.brand.has(name)) return {kind:'brand',name,suffix,suggestions:[]};
  }
  const [typed,...tail] = words;
  const suffix = tail.join(' ');
  const suggested = new Set();
  if (/^[a-z]{3,40}$/.test(typed)) {
    const drugNames = new Set([...names.ingredient.keys(), ...names.brand.keys()]);
    const prefix = [...new Set([...drugNames, ...dcb])].filter(name => name.startsWith(typed) && !name.includes(' '));
    prefix.sort((a,b) => Number(drugNames.has(b))-Number(drugNames.has(a)) ||
      Number(isDcbName(b))-Number(isDcbName(a)) || a.length-b.length || a.localeCompare(b));
    for (const name of prefix) suggested.add(name);
    const result = resolveName(typed,names);
    if (result.interpretation) suggested.add(result.interpretation.interpreted);
    for (const name of result.nameCandidates ?? result.ingredientCandidates ?? []) suggested.add(name);
    if (!suggested.size && typed.length >= 5) {
      const max = typed.length < 7 ? 1 : typed.length < 11 ? 2 : 3;
      const nearby = [];
      for (const name of drugNames) {
        if (/^[a-z]+$/.test(name) && Math.abs(typed.length-name.length)<=max) {
          const edits=distance(name,typed);
          if (edits<=max) nearby.push({name,edits});
        }
      }
      nearby.sort((a,b)=>a.edits-b.edits || Number(isDcbName(b.name))-Number(isDcbName(a.name)) || a.name.localeCompare(b.name));
      for (const {name} of nearby) suggested.add(name);
    }
  }
  return {kind:'text',name:typed,suffix,suggestions:[...suggested].slice(0,50).map(name=>[name,suffix].filter(Boolean).join(' '))};
}

export function verifiedRow(row, intent, { ingredients = [], evidence } = {}) {
  const title = tokens(row.name), requested = tokens(intent.name), rest = tokens(intent.suffix);
  // An ingredient appearing after "sem" or "para" describes the product,
  // but does not establish its composition. Accept a leading identity only.
  const prefix = title.slice(0, title.indexOf(requested[0]));
  const inTitle = contains(title,requested) && prefix.every(word =>
    ['cloridrato','sulfato','fosfato','citrato','maleato','acetato','de','generico',
      'analgesico','antitermico','antialergico','e','medicamento'].includes(word));
  const inIngredients = ingredients.some(value=>contains(tokens(value),requested));
  if (intent.kind === 'ingredient' && (ingredients.length ? !inIngredients : !inTitle)) return;
  if (intent.kind === 'brand' && !inTitle && !contains(tokens(row.brand),requested)) return;
  if (intent.kind === 'text' && !contains(title,requested) && !contains(tokens(row.brand),requested)) return;
  if (!rest.filter(w=>!['de','com','em'].includes(w)).every(w=>title.includes(w))) return;
  if (rest.some(unitDose) && (title.filter(unitDose).length > 1 || /\+/.test(row.name))) {
    if (!rest.filter(unitDose).every(dose=>contains(title,[...requested,dose]))) return;
  }
  if (intent.kind !== 'ingredient') return {...row,activeIngredients:ingredients};
  return {...row,activeIngredients:inIngredients ? ingredients : [intent.name],
    ingredientEvidence: inIngredients ? evidence : {source:'retailer_title',value:row.name}};
}

export function medicationCatalog(source, { searchVerified, intentFor = medicationIntent }) {
  const adapter = {...source,
    async search(query,page=1,limit=20) {
      if (!Number.isSafeInteger(page)||page<1||!Number.isSafeInteger(limit)||limit<1||limit>1000) throw new TypeError('Invalid page or limit');
      if (/^\d+$/.test(query.trim())) return source.search(query,page,limit);
      const intent = await intentFor(query);
      if (intent.suggestions.length) return [];
      return searchVerified(intent,page,limit);
    },
    async suggest(query,limit=7) {
      if (!Number.isSafeInteger(limit)||limit<1||limit>50) throw new TypeError('Invalid suggestion limit');
      return (await intentFor(query)).suggestions.slice(0,limit);
    },
    async alternatives(query,declined,limit) {
      const others=(await adapter.suggest(query,50)).filter(s=>clean(s)!==clean(declined));
      if (others.length >= limit || clean(declined).includes(' ')) return others.slice(0,limit);
      const rows=await adapter.search(declined,1,20);
      const refinements=new Set(others);
      for (const row of rows) {
        const doses=tokens(row.name).filter(unitDose);
        if (doses.length===1) refinements.add(declined+' '+doses[0].replace(/^(\d+(?:\.\d+)?)/,'$1 '));
      }
      return [...refinements].slice(0,limit);
    },
  };
  return adapter;
}
