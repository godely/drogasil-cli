import { countedPack, directCountedListing } from './counted-pack.js';
import { getProductsBySku, searchProducts } from './algolia.js';
import { normalizeCep } from './graphql.js';
import { resolveMedication, ingredientPresentations } from './medications.js';
import { documentedConventionalTablet } from './regulatory-info.js';
import { brandOptions } from './product-info.js';
import { searchStockWindows, stockQuantity } from './stock-search.js';
import { parseCoords } from '../geo.js';

export function normalizeOrigin(origin) {
  if (origin == null) return null;
  const { zipcode, latitude, longitude } = origin;
  if (zipcode != null && latitude == null && longitude == null) return { zipcode: normalizeCep(zipcode) };
  if (zipcode == null && latitude != null && longitude != null) return parseCoords(latitude, longitude);
  throw new TypeError('use either --cep or both --lat and --lon');
}

async function compareNearby(products, origin, store, expandSearch, info) {
  const minimums = new Map(products.map(p => [String(p.sku), 1]));
  const { windows, coverage, expandedSearch } = await searchStockWindows(minimums, origin, { expandSearch, allowExpansion: !store });
  info.coverage = coverage;
  if (expandedSearch) info.expandedSearch = expandedSearch;
  let storeId = store;
  const available = [];
  for (const product of products) {
    const { rows } = windows.get(String(product.sku));
    if (store) {
      if (storeId === 'nearest') {
        if (!rows.length) throw new Error('Unable to identify the nearest participating store');
        storeId = String(rows[0].branch.id);
      }
      const row = rows.find(r => String(r.branch.id) === storeId);
      const quantity = row ? stockQuantity(row, String(product.sku)) : null;
      available.push({ ...product, storeId, stockStatus: !row ? 'outside_search_window' :
        quantity == null ? 'unknown' : quantity > 0 ? 'in_stock' : 'out_of_stock',
        stores: row ? [{ ...row.branch, quantity }] : [] });
      continue;
    }
    const stores = [];
    for (const row of rows) {
      const quantity = stockQuantity(row, String(product.sku));
      if (quantity > 0) stores.push({ ...row.branch, quantity });
    }
    if (expandedSearch) stores.splice(10);
    if (stores.length) available.push({ ...product, stores });
  }
  return available;
}

function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)\s+(?=mg|mcg|ml|g\b)/g, '$1')
    .replace(/(\d)\.0+(?=[a-z\s]|$)/g, '$1').trim().replace(/\s+/g, ' ');
}

// Packaging prose can sit between the dosage and the count in a user's query.
function catalogQuery(value) {
  return value.replace(/\bem\s+(?=gotas?\b)/giu, '')
    .replace(/\bfrasco\s+(?:de|com)\s+(?=\d+(?:[.,]\d+)?\s*m[lL]\b)/gu, (phrase, offset, text) =>
      /\d\s*$/.test(text.slice(0, offset)) ? phrase : '')
    .replace(/\s*,?\s*\b(?:(?:caixa|embalagem)\s+(?:de|com)|com)\s+(?=\d+\s+(?:comprimidos?|c[áa]psulas?)\b)/giu, ' ').trim();
}

function presentationTokens(value) {
  return normalize(value).replace(/\s*\/\s*/g, '/')
    .replace(/\b(\d+)\s+(comprimidos?|capsulas?|frascos?)\b/g, '$1$2')
    .replace(/(comprimido|capsula|frasco)s\b/g, '$1')
    .match(/[\p{L}\d.]+(?:\/[\p{L}\d.]+)?/gu) ?? [];
}

// Some oral drops are indexed as "solução oral". Broaden retrieval only;
// the original request must still match the product's own presentation.
function dropSearchTerms(query) {
  return query.replace(/\bgotas\b/giu, ' ').replace(/\s+/g, ' ').trim();
}

function documentedDrops(product) {
  const label = normalize([product.name, product.filters?.['Forma farmacêutica']].join(' '));
  if (/\bgotas\b/.test(label)) return true;
  if (!/\b(?:solucao|suspensao)\b/.test(label) || !/\boral\b/.test(normalize(
    [label, product.filters?.['Via de administração']].join(' ')))) return false;
  const brand = normalize(product.brand);
  if (!brand) return false;
  const description = normalize(String(product.productDescription ?? '').replace(/<[^>]*>/g, ' ')
    .replace(/&([aeiou])(?:acute|circ|tilde|grave);/gi, '$1').replace(/&ccedil;/gi, 'c')
    .replace(/(?:&reg;|®)/g, '').replace(/&nbsp;/g, ' '));
  const prefixes = description.split(/[.:;!?]/).map(part => part.trim().replace(/^(?:a|o) /, ''));
  return prefixes.some(part => part.startsWith(brand + ' ') &&
    /^(?:solucao|suspensao)(?: oral)?(?: em)? gotas\b/.test(part.slice(brand.length + 1)));
}

function matchesRequest(product, query) {
  const requested = presentationTokens(query);
  const evidence = presentationTokens([product.name, product.filters?.['Forma farmacêutica'],
    product.filters?.['Via de administração'], product.details?.quantidade, ...(product.details?.dosageList ?? [])].join(' '));
  if (requested.includes('gotas') && documentedDrops(product)) evidence.push('gotas');
  const packVolumes = presentationTokens(product.details?.quantidade).filter(t => /^\d+(?:\.\d+)?ml$/.test(t));
  return requested.length > 0 && requested.every(term =>
    evidence.includes(term) && (!/^\d+(?:\.\d+)?ml$/.test(term) || !packVolumes.length || packVolumes.includes(term)));
}

export function matchesLabeledDropRequest(row,query) {
  const [form,route] = [row.facts?.['Forma Farmacêutica'] ?? row.facts?.Apresentação, row.facts?.['Forma de Administração']];
  const asProduct = name => ({name,filters:{'Forma farmacêutica':form,'Via de administração':route}});
  const requested = catalogQuery(query);
  return [row.name,row.itemName ?? row.name].every(name => matchesRequest(asProduct(name),requested));
}

function describePresentation(product) {
  const ingredients = product.details?.activeIngredients;
  const form = normalize(product.filters?.['Forma farmacêutica']);
  const pack = normalize(product.details?.quantidade);
  const missing = new Set();
  if (!form) missing.add('dosage_form');
  if (!/^\d/.test(pack)) missing.add('pack_size');
  if (!Array.isArray(ingredients) || !ingredients.length ||
      (product.details.activeNumberIngredient != null && Number(product.details.activeNumberIngredient) !== ingredients.length)) {
    missing.add('active_ingredients');
  }

  const doses = [];
  for (const ingredient of Array.isArray(ingredients) ? ingredients : []) {
    const name = normalize(ingredient?.description);
    const unit = normalize(ingredient?.unitOfMeasurement?.name);
    const dose = Number(String(ingredient?.dosageValue).replace(',', '.'));
    if (!name) missing.add('active_ingredients');
    if (!unit || !Number.isFinite(dose) || dose <= 0) missing.add('strength');
    doses.push(JSON.stringify([name, dose, unit]));
  }
  const label = normalize([product.name, product.brand, form, pack].join(' '));
  const markers = label.match(/\b(?:xr|xl|sr|cr|er|dr|la|lp|mr|retard|chrono|depot|orodispersivel|sublingual|mastigavel|efervescente|gastrorresistente|liberacao (?:prolongada|modificada|controlada|retardada|lenta|bifasica))\b/g) ?? [];
  // Titles disambiguate liquid concentrations and bottle counts missing from structured doses.
  const liquidDetails = presentationTokens(product.name).filter(t => t.includes('/') || /^\d+frasco$/.test(t));
  if (documentedDrops(product)) liquidDetails.push('gotas');
  const signature = JSON.stringify([liquidDetails.sort(), doses.sort(), form, pack, normalize(product.filters?.['Via de administração']), [...new Set(markers)].sort()]);
  return { key: missing.size ? null : signature, signature, missingFields: [...missing] };
}

function presentation(product) {
  return describePresentation(product).key;
}

async function searchAll(query, filters) {
  const first = await searchProducts(query, { hitsPerPage: 100, filters });
  const hits = [...first.hits];
  for (let page = 1; page < first.nbPages; page++) {
    hits.push(...(await searchProducts(query, { hitsPerPage: 100, page, filters })).hits);
  }
  return hits;
}

const immediateLabel = /\b(?:liberacao (?:imediata|convencional)|immediate[- ]release|ir)\b/;
const extendedLabel = /\b(?:xr|xl|er|sr|lp|liberacao (?:prolongada|lenta)|extended[- ]release)\b/;
const otherModifiedLabel = /\b(?:cr|dr|la|mr|retard|chrono|depot|gastrorresistente|liberacao (?:modificada|controlada|retardada|bifasica))\b/;

function matchesRelease(product, release) {
  if (!release) return true;
  const label = normalize([product.name, product.brand, product.filters?.['Forma farmacêutica'], product.details?.quantidade].join(' '));
  if (release === 'extended') return extendedLabel.test(label) && !immediateLabel.test(label);
  return !extendedLabel.test(label) && !otherModifiedLabel.test(label) &&
    (immediateLabel.test(label) || documentedConventionalTablet(product));
}

async function referenceOptions(query, release) {
  if (/^\d+$/.test(query)) return (await getProductsBySku([query])).filter(p => p && matchesRelease(p, release));
  const candidates = (await searchAll(dropSearchTerms(query) || query)).filter(product => matchesRequest(product, query) && matchesRelease(product, release));
  const exact = candidates.filter(product => {
    const brandDose = [product.brand, ...(product.details?.dosageList ?? [])].join(' ');
    return [product.name, brandDose].some(value => normalize(value) === normalize(query));
  });
  return exact.length ? exact : candidates;
}

export async function compareProducts(query, { origin = null, store, resolveNames = false, includeUnpriced = false, directShopping = false, includeGenerics, expandSearch = false } = {}) {
  if (!['string', 'number'].includes(typeof query) || !String(query).trim()) throw new TypeError('expected a medication name or SKU');
  origin = normalizeOrigin(origin);
  if (store && (!origin || (store !== 'nearest' && !/^\d+$/.test(store)))) {
    throw new TypeError('store requires an origin and either nearest or a numeric store ID');
  }
  query = String(query).trim();
  const label = normalize(query);
  const immediate = immediateLabel.test(label);
  if (immediate && (extendedLabel.test(label) || otherModifiedLabel.test(label))) {
    return { status: 'conflicting_release', products: [],
      hint: 'Ask which release the user intends. Stock has not been checked for either presentation.' };
  }
  const release = immediate ? 'immediate' : extendedLabel.test(label) ? 'extended' : null;
  // Keep brand suffixes such as XR in the search. Descriptive release wording is
  // checked against each candidate, as the conventional form often omits it.
  const lookup = !release ? query : query.replace(/\b(?:de\s+)?libera[çc][ãa]o\s+(?:imediata|convencional|prolongada|lenta)\b|\b(?:immediate|extended)[- ]release\b|\bir\b/gi, ' ')
    .replace(/\s+,|,(?!\d)/g, ' ').replace(/\s+/g, ' ').trim();
  const resolved = lookup && (resolveNames || includeGenerics !== undefined) ? await resolveMedication(lookup) : null;
  if (resolved?.status === 'ambiguous') return resolved;
  const info = resolved?.interpretation ? { interpretation: resolved.interpretation } : {};
  let refs;
  if (!lookup) {
    refs = [];
  } else if (resolved?.filters) {
    const suffix = catalogQuery(resolved.suffix);
    refs = await ingredientPresentations(lookup, { ...resolved, suffix:dropSearchTerms(suffix) }, includeUnpriced);
    refs = refs.filter(product => (!suffix || matchesRequest(product, suffix)) && matchesRelease(product, release));
    if (!refs.length && release === 'extended' && resolved.kind === 'brand') {
      const family = normalize(resolved.name);
      refs = (await referenceOptions(catalogQuery(lookup), release)).filter(product =>
        normalize(product.brand).startsWith(family + ' '));
    }
  } else {
    refs = await referenceOptions(catalogQuery(lookup), release);
  }
  refs = refs.filter(product => product.isActive !== false);
  if (!refs.length) return { ...info, status: 'no_reference', products: [], hint: 'No catalog match for the supplied name and presentation. Ask for clarification before changing strength, release or pack.' };
  if (resolved?.kind === 'brand') {
    info.requestedBrandName = resolved.name;
    info.requestedBrandSkus = refs.map(p => String(p.sku));
  }
  if (!info.requestedBrandSkus && resolved?.kind === 'text') {
    const brand = refs[0].brand;
    if (brand && (normalize(query) + ' ').startsWith(normalize(brand) + ' ') &&
        refs.every(p => normalize(p.brand) === normalize(brand))) {
      info.requestedBrandName = brand;
      info.requestedBrandSkus = refs.map(p => String(p.sku));
    }
  }
  const descriptions = refs.map(describePresentation);
  const { key, signature, missingFields } = descriptions[0];
  const sameSignature = descriptions.every(item => item.signature === signature);
  // Direct catalog hits can be priced and located even when equivalence cannot be established.
  // Several incomplete hits are only reported together when their known presentation fields agree.
  const onlyFormMissing = descriptions.every(item =>
    item.missingFields.length === 1 && item.missingFields[0] === 'dosage_form');
  if (!key && (refs.length === 1 || (sameSignature && onlyFormMissing))) {
    const direct = refs.map(product =>
      Number.isFinite(product.price) && product.price > 0 ? product : { ...product, price: null });
    direct.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || String(a.sku).localeCompare(String(b.sku)));
    const products = origin ? await compareNearby(direct, origin, store, expandSearch, info) : direct;
    return { ...info, status: 'incomplete_presentation', missingFields, referenceSkus: direct.map(p => String(p.sku)),
      products, hint: 'Report these direct catalog hits and their available stock. Equivalence is unverified. Confirmation or retrying these SKUs cannot fill the missing catalog fields.' };
  }
  if (!key || descriptions.some(item => item.key !== key)) {
    if (resolved?.kind === 'ingredient' && !origin) {
      const pack = directShopping && countedPack(resolved.suffix);
      if (pack && refs.every(product => directCountedListing(product, resolved.name, pack))) {
        const products = refs.map(p => Number.isFinite(p.price) && p.price > 0 ? p : { ...p, price: null })
          .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || String(a.sku).localeCompare(String(b.sku)));
        return { ...info, status: 'incomplete_presentation', matchBasis: 'direct_requested_pack',
          missingFields: [...new Set(descriptions.flatMap(d => d.missingFields))], products };
      }
      const groups = new Map();
      for (const product of refs) {
        const id = presentation(product) ?? 'unverified:' + product.sku;
        if (!groups.has(id)) groups.set(id, []);
        groups.get(id).push(product);
      }
      return { ...info, status: 'presentation_options', groups: [...groups.values()] };
    }
    return { ...info, status: 'ambiguous', candidates: refs };
  }
  const search = refs[0].details.activeIngredients[0].description;
  const matches = new Map();
  const excluded = [];
  const expansion = resolveNames
    ? await searchAll('', 'details.activeIngredients.description:' + JSON.stringify(search))
    : await searchAll(search);
  for (const product of [...refs, ...expansion]) {
    const pack = normalize(product.details?.quantidade);
    const titleCount = normalize(product.name).match(/\b(\d+) (comprimidos?|capsulas?)\b/);
    if (titleCount && /^\d+(?:[.,]\d+)?\s*(?:mg|g|ml)$/.test(pack) &&
        presentation({ ...product, details: { ...product.details, quantidade: titleCount[0] } }) === key) {
      if (!excluded.some(p => p.sku === product.sku)) excluded.push({ sku: product.sku, name: product.name,
        reason: 'Pack conflict: catalog quantity ' + pack + ', title ' + titleCount[0] });
      continue;
    }
    if (product.isActive === false || presentation(product) !== key) continue;
    const priced = Number.isFinite(product.price) && product.price > 0;
    if (priced || includeUnpriced) matches.set(String(product.sku), priced ? product : { ...product, price: null });
  }
  const sorted = [...matches.values()].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || String(a.sku).localeCompare(String(b.sku)));
  if (!sorted.length) return { ...info, status: 'no_prices', products: [], excluded };
  const options = brandOptions(sorted, info.requestedBrandSkus, includeGenerics);
  const products = origin ? await compareNearby(options, origin, store, expandSearch, info) : options;
  return { ...info, ...(excluded.length ? { excluded } : {}), status: products.length ? 'matches' : (info.expandedSearch?.partial || info.coverage?.stockUnknown) ? 'stock_unknown' : 'no_stock', products };
}
