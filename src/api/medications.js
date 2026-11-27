import { medicationFacets, searchProducts } from './algolia.js';

const aliases = new Map(Object.entries({
  morphine: 'morfina', morphina: 'morfina', acetaminophen: 'paracetamol', metamizole: 'dipirona',
  metamizol: 'dipirona', metformin: 'metformina', metimorfina: 'metformina', amoxicillin: 'amoxicilina',
  amoxilina: 'amoxicilina', dimenidrato: 'dimenidrinato', dimenhydrinate: 'dimenidrinato',
  glicasida: 'gliclazida', glicazida: 'gliclazida', gliclazide: 'gliclazida',
  clonazepan: 'clonazepam', monjauro: 'mounjaro', frantal: 'frontal', ibuprofen: 'ibuprofeno',
  amitriptyline: 'amitriptilina', nortriptyline: 'nortriptilina',
}));
export const fold = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
const phonetic = text => text.replace(/ph/g, 'f').replace(/z/g, 's').replace(/n$/, 'm').replace(/(.)\1/g, '$1');
const qualifiers = new Set('cloridrato sulfato sodico sodica potassico potassica calcio monoidratada monoidratado diidratado pentaidratado acetato citrato fosfato brometo maleato nitrato anidro anidra'.split(' '));

function add(map, key, value) {
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}
export function nameIndex([ingredients, brands]) {
  const ingredient = new Map(), brand = new Map();
  for (const value of ingredients) {
    const full = fold(value);
    add(ingredient, full, value);
    const words = full.split(/\s+/).filter(word => !['de', 'do', 'da'].includes(word) && !qualifiers.has(word)
      && !/^(mono|di|tri|tetra|penta|hexa)?-?hidratad[oa]$/.test(word));
    if (words.length === 1) add(ingredient, aliases.get(words[0]) ?? words[0], value);
  }
  for (const value of brands) add(brand, fold(value), value);
  return { ingredient, brand };
}
let pending, expires = 0;
function index() {
  if (!pending || Date.now() >= expires) {
    expires = Date.now() + 24 * 60 * 60 * 1000;
    pending = medicationFacets().then(nameIndex).catch(err => { pending = undefined; throw err; });
  }
  return pending;
}
function distance(a, b) {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  let previousRow;
  for (let i = 0; i < a.length; i++) {
    const c = a[i];
    const next = [row[0] + 1];
    for (let j = 0; j < b.length; j++) {
      let cost = Math.min(row[j + 1] + 1, next[j] + 1, row[j] + Number(c !== b[j]));
      if (i > 0 && j > 0 && c === b[j - 1] && a[i - 1] === b[j]) {
        cost = Math.min(cost, previousRow[j - 1] + 1);
      }
      next.push(cost);
    }
    previousRow = row;
    row = next;
  }
  return row[b.length];
}
export function resolveName(query, names) {
  const input = fold(query);
  const tokens = input.split(/\s+/);
  for (let n = tokens.length; n; n--) {
    const prefix = tokens.slice(0, n).join(' ');
    const suffix = tokens.slice(n).join(' ');
    if (prefix === 'tiptilina') return { status: 'ambiguous', ingredientCandidates: ['amitriptilina', 'nortriptilina'] };
    let key = aliases.get(prefix) ?? prefix;
    if (!names.ingredient.has(key) && !names.brand.has(key)) {
      if (n !== 1 || !/^[a-z]{5,40}$/.test(key)) continue;
      let best = Infinity, found = [];
      for (const word of new Set([...names.ingredient.keys(), ...names.brand.keys()])) {
        const limit = key.length >= 8 ? 2 : 1;
        if (Math.abs(word.length - key.length) > limit) continue;
        const d = distance(phonetic(key), phonetic(word));
        if (d > limit || d > best) continue;
        if (d < best) { best = d; found = []; }
        found.push(word);
      }
      if (!found.length) continue;
      if (found.length > 1) return { status: 'ambiguous', nameCandidates: found.sort() };
      key = found[0];
    }
    const ingredient = names.ingredient.get(key), brand = names.brand.get(key);
    if (!ingredient && !brand) continue;
    const field = ingredient ? 'details.activeIngredients.description' : 'filters.Marca';
    const terms = [...(ingredient ?? brand)].map(value => field + ':' + JSON.stringify(value));
    const filters = 'categories.id=532 AND (' + terms.join(' OR ') + ')';
    const interpreted = [key, suffix].filter(Boolean).join(' ');
    return { kind: ingredient ? 'ingredient' : 'brand', suffix, filters,
      ...(interpreted !== input ? { interpretation: { original: query, interpreted } } : {}) };
  }
  return { kind: 'text', suffix: input };
}
export async function resolveMedication(query) {
  if (/^\d+$/.test(query)) return { kind: 'sku', suffix: query };
  return resolveName(query, await index());
}
export async function medicationSearch(query, options = {}, resolved) {
  const name = resolved ?? await resolveMedication(query);
  if (name.status === 'ambiguous') return { ...name, hits: [], nbPages: 0 };
  const result = await searchProducts(name.suffix, { ...options, filters: name.filters });
  return { ...result, interpretation: name.interpretation, status: result.nbHits ? 'matches' : 'no_reference',
    ...(!result.nbHits ? { hint: `Catalog names are in Portuguese; no match for "${query}".` } : {}) };
}
export async function ingredientPresentations(query, resolved) {
  const first = await medicationSearch(query, { hitsPerPage: 100 }, resolved);
  const products = first.hits.slice();
  for (let page = 1; page < first.nbPages; page++) {
    const next = await medicationSearch(query, { page, hitsPerPage: 100 }, resolved);
    products.push(...next.hits);
  }
  return products.filter(p => p.isActive !== false && Number.isFinite(p.price) && p.price > 0)
    .sort((a, b) => a.price - b.price || String(a.sku).localeCompare(String(b.sku)));
}
