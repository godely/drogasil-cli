import { readFileSync } from 'node:fs';
import { fold, resolveName, medicationIndex, distance, resolveMedication } from './medications.js';
import { catalogQuery, documentedSublingual, normalizeSublingual } from './presentation-label.js';

const dcb = new Set(readFileSync(new URL('../data/dcb-names.txt', import.meta.url), 'utf8').trimEnd().split('\n'));
export const isDcbName = term => dcb.has(fold(term));
const clean = value => fold(value ?? '').replace(/(\d),(?=\d)/g, '$1.').replace(/\s+/g, ' ');
const tokens = value => normalizeSublingual(clean(value)).match(/\d+(?:\.\d+)?\s*(?:mcg|mg|ml|ui|g|%)(?:\s*\/\s*(?:ml|g|h|dose))?|[a-z]+|\d+(?:\.\d+)?/g)?.map(t=>t.replace(/\s/g,'')) ?? [];
const contains = (list, part) => part.length > 0 && list.some((_,i) => part.every((word,j)=>list[i+j]===word));
const unitDose = word => /^\d+(?:\.\d+)?(?:mg|mcg|g|ui|%)(?:\/|$)/.test(word);

// This spelling is only used to propose catalog names for confirmation.
// Keep nh/lh distinct and allow syllable-final l to sound like u.
function spokenSpelling(word) {
  return word.replace(/ph/g, 'f').replace(/ch/g, 'x').replace(/(?<![ln])h/g, '')
    .replace(/qu(?=[ei])|c(?![ei])/g, 'k').replace(/c(?=[ei])|z/g, 's')
    .replace(/(.)\1+/g, '$1').replace(/l(?=[^aeiou]|$)/g, 'u').replace(/n$/, 'm');
}

function similarSoundingNames(typed, names) {
  const key = spokenSpelling(typed);
  if (key.length < 6) return [];
  const limit = key.length >= 9 ? 2 : 1;
  let best = limit + 1;
  const matches = [];
  for (const name of names) {
    if (!/^[a-z]+$/.test(name)) continue;
    const other = spokenSpelling(name);
    if (other.length < 6 || other.slice(0, 2) !== key.slice(0, 2) || Math.abs(other.length - key.length) > limit) continue;
    const edits = distance(key, other);
    if (edits > limit || edits > best) continue;
    if (edits < best) matches.length = 0;
    best = edits;
    matches.push(name);
  }
  return matches.sort();
}

// Suggestions often repeat a declined name with a different strength or form.
// Compare complete words so a rejection of loratadina still permits desloratadina.
export function alternativeNames(terms, query, declined, limit = 7) {
  const rejected = declined.map(term => {
    const words = tokens(catalogQuery(term));
    const presentation = words.findIndex(word => /^\d/.test(word) ||
      /^(?:gotas?|comprimidos?|capsulas?|solucao|suspensao|xarope|frascos?|ampolas?|pomada|creme|sublingual|injetavel|liberacao|xr|cr|sr)$/.test(word));
    const name = presentation > 0 ? words.slice(0, presentation) : words;
    if (presentation > 0 && ['em','de','com'].includes(name.at(-1))) name.pop();
    return name;
  });
  const seen = new Set([tokens(query).join(' ')]);
  const alternatives = [];
  for (const term of terms) {
    const words = tokens(term);
    const key = words.join(' ');
    if (!key || seen.has(key) || rejected.some(name => contains(words, name))) continue;
    seen.add(key);
    alternatives.push(term);
    if (alternatives.length === limit) break;
  }
  return alternatives;
}

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
  let phoneticChoices = false;
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
    if (!suggested.size && typed.length >= 6) {
      for (const name of similarSoundingNames(typed, drugNames)) suggested.add(name);
      phoneticChoices = suggested.size > 0;
    }
  }
  return {kind:'text',name:typed,suffix,...(phoneticChoices && {suggestionBasis:'phonetic'}),
    suggestions:[...suggested].slice(0,50).map(name=>[name,suffix].filter(Boolean).join(' '))};
}

// An explicitly named retail brand can be before or after its product line.
// Require the complete brand beside the line on the actual pack title. This
// evidence is for a literal shopping name, never ingredient equivalence.
export function matchesRetailBrandLine(row, query) {
  const input = tokens(query), title = tokens(row.name), brand = tokens(row.brand);
  if (!brand.length || !contains(input,brand) || !contains(title,brand)) return false;
  const measure = input.findIndex(word => /^\d/.test(word));
  const names = measure === -1 ? input : input.slice(0,measure);
  // A package volume may follow the line. Dose, combination, pack count or
  // release constraints need the normal presentation matcher.
  if (measure !== -1 && (measure !== input.length - 1 || !/^\d+(?:\.\d+)?ml$/.test(input[measure]) ||
      !title.includes(input[measure]))) return false;
  const label = clean(row.name);
  if (/\b(?:kit|combo|sem|para|compativel|refil|acessorio)\b/.test(label) ||
      /\b[2-9]\d*\s*(?:x|frascos?|unidades?)\b|\b\d+\s*x\s*\d/.test(label)) return false;
  const startsWithBrand = brand.every((word,i)=>names[i] === word);
  const endsWithBrand = brand.every((word,i)=>names[names.length-brand.length+i] === word);
  if (!startsWithBrand && !endsWithBrand) return false;
  const line = startsWithBrand ? names.slice(brand.length) : names.slice(0,-brand.length);
  if (line.length < 2 || line.some(word=>!/^\p{L}+$/u.test(word))) return false;
  const variants = line.length === 2 ? [line,[line[1],line[0]]] : [line];
  return variants.some(words=>contains(title,[...brand,...words]) || contains(title,[...words,...brand]));
}

// A lone uncertain drug name or a name followed by a presentation still
// requires confirmation. Longer literal merchandise names can prove identity
// with the retailer's own brand and title before interpreting a short prefix.
export function canVerifyRetailBrandLine(intent) {
  return intent.kind === 'text' && !startsWithPresentation(intent.suffix) &&
    tokens(intent.suffix).filter(word=>/^[a-z]+$/.test(word)).length >= 2;
}

export function verifiedRow(row, intent, { ingredients = [], evidence } = {}) {
  if (intent.requireRetailBrandLine) {
    if (!matchesRetailBrandLine(row,intent.name+' '+intent.suffix)) return;
    return {...row,activeIngredients:ingredients};
  }
  const title = tokens(row.name), requested = tokens(intent.name), rest = tokens(catalogQuery(intent.suffix ?? ''));
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
  const maker = tokens(row.manufacturer);
  const makerStart = contains(rest, maker) ? rest.findIndex((_, i) => maker.every((word, j) => rest[i+j] === word)) : -1;
  const qualifiers = rest.filter((_, i) => makerStart < 0 || i < makerStart || i >= makerStart + maker.length);
  const supportsTerm = word => word === 'sublingual' ? documentedSublingual(row.name,
    row.facts?.['Forma Farmacêutica'] ?? row.facts?.Apresentação,
    row.facts?.['Via de Administração'] ?? row.facts?.['Forma de Administração']) : title.includes(word);
  if (!qualifiers.filter(w=>!['da','do','de','com','em'].includes(w)).every(supportsTerm)) return;
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
      if (intent.suggestions.length) {
        if (!canVerifyRetailBrandLine(intent)) return [];
        return searchVerified({...intent,requireRetailBrandLine:true},page,limit);
      }
      return searchVerified(intent,page,limit);
    },
    async suggest(query,limit=7) {
      if (!Number.isSafeInteger(limit)||limit<1||limit>50) throw new TypeError('Invalid suggestion limit');
      return (await intentFor(query)).suggestions.slice(0,limit);
    },
    async alternatives(query,declined,limit) {
      return alternativeNames(await adapter.suggest(query,50), query, [declined], limit);
    },
  };
  return adapter;
}

// Preserve full catalog queries for merchandise. Only treat trailing words
// after a possible misspelling as a presentation when they look like one.
const presentation = /^(?:\d|(?:em|com|de|xr|cr|sr|sl|gotas?|frasco|solucao|comprimidos?|capsulas?|spray|gel|pomada|suspensao|sublingual|liberacao)\b)/;
function startsWithPresentation(suffix = '') {
  return presentation.test(normalizeSublingual(catalogQuery(suffix)));
}
const catalogTerms = new Set(['gel','spray','diet','dor','protetor','creme','kit','cha','oleo','solucao','pomada','gotas']);
export async function nameChoices(query, {intentFor = medicationIntent, resolve = resolveMedication} = {}) {
  const intent = await intentFor(query);
  if (catalogTerms.has(intent.name) || !intent.suggestions.length || (intent.suffix && !startsWithPresentation(intent.suffix))) return [];
  const candidates = intent.suggestions.slice(0, 7);
  if (candidates.length === 1 || intent.suggestionBasis === 'phonetic') return candidates;
  const suffix = intent.suffix ? ' ' + intent.suffix : '';
  // A brand and an ingredient can share the exact letters the shopper typed.
  // Keep live prefix matches ahead of approximate spellings and DCB-only entries.
  const ranked = await Promise.all(candidates.map(async term => {
    const name = suffix ? term.slice(0, -suffix.length) : term;
    const prefix = /^[a-z]+$/.test(name) && name.startsWith(intent.name);
    const dcbName = isDcbName(name);
    if (!prefix && !dcbName) return {};
    const resolved = await resolve(name).catch(() => null);
    const exact = resolved && !resolved.interpretation && !resolved.suffix;
    const ingredient = exact && resolved.kind === 'ingredient';
    const livePrefix = prefix && exact && (ingredient || resolved.kind === 'brand');
    return {livePrefix, ingredient: dcbName && (ingredient || !resolved)};
  }));
  const prefixes = candidates.filter((_, i) => ranked[i].livePrefix);
  if (prefixes.length) return prefixes;
  const ingredients = candidates.filter((_, i) => ranked[i].ingredient);
  return ingredients.length ? ingredients : [candidates[0]];
}

export function namePrompt(choices) {
  return 'Você quis dizer ' + new Intl.ListFormat('pt-BR', {type:'disjunction'}).format(choices) + '?';
}
