export function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)\s+(?=mg|mcg|ml|g\b)/g, '$1')
    .replace(/(\d)\.0+(?=[a-z\s]|$)/g, '$1').trim().replace(/\s+/g, ' ');
}

// Packaging prose can sit between the dosage and the count in a user's query.
export function catalogQuery(value) {
  return value.replace(/\bem\s+(?=gotas?\b)/giu, '')
    .replace(/\b(?:por\s+via|via)\s+(?=sub[- ]?lingua(?:l|is)\b)|\bem\s+(?=comprimidos?\s+sub[- ]?lingua(?:l|is)\b)/giu, '')
    .replace(/\bfrasco\s+(?:de|com)\s+(?=\d+(?:[.,]\d+)?\s*m[lL]\b)/gu, (phrase, offset, text) =>
      /\d\s*$/.test(text.slice(0, offset)) ? phrase : '')
    .replace(/\s*,?\s*\b(?:(?:caixa|embalagem)\s+(?:de|com)|com)\s+(?=\d+\s+(?:comprimidos?|c[áa]psulas?)\b)/giu, ' ').trim();
}

export const normalizeSublingual = value => value.replace(/\bsub[- ]?lingua(?:l|is)\b/giu, 'sublingual');

export function presentationTokens(value) {
  return normalizeSublingual(normalize(value)).replace(/\s*\/\s*/g, '/')
    .replace(/\b(\d+)\s+(comprimidos?|capsulas?|frascos?)\b/g, '$1$2')
    .replace(/(comprimido|capsula|frasco)s\b/g, '$1')
    .match(/[\p{L}\d.]+(?:\/[\p{L}\d.]+)?/gu) ?? [];
}

// Full-text search can omit fields that identify drops and sublingual tablets.
// Remove these terms for retrieval, then verify the entire request on each pack.
export function presentationSearchTerms(query) {
  return query.replace(/\b(?:gotas|sub[- ]?lingua(?:l|is))\b/giu, ' ').replace(/\s+/g, ' ').trim();
}

export const requestsSublingual = query => /\bsub[- ]?lingua(?:l|is)\b/iu.test(query);

// A category may list several administration routes shared by unrelated packs.
// The title, a specific form, or a single declared route can identify this pack.
export function documentedSublingual(title, forms, routes) {
  if (requestsSublingual(title)) return true;
  const labels = [...new Set([forms].flat().filter(Boolean).map(normalize))];
  if (labels.length === 1 && requestsSublingual(labels[0])) return true;
  const declared = [...new Set([routes].flat().filter(Boolean).map(normalize))];
  return declared.length === 1 && /^(?:(?:uso|via) )?sublingual$/.test(declared[0]);
}

export function requestsDrops(query) {
  return /\b(?:gotas?|gts)\b/iu.test(query);
}

export function documentedDrops(product) {
  const label = normalize([product.name, product.filters?.['Forma farmacêutica']].join(' '));
  if (/\b(?:injet[a-z]*|ampolas?|comprimidos?|capsulas?)\b/.test(label)) return false;
  if (/\bgotas\b/.test(label)) return true;
  if (!/\b(?:solucao|suspensao)\b/.test(label) || !/\boral\b/.test(normalize(
    [label, product.filters?.['Via de administração']].join(' ')))) return false;
  const brand = normalize(product.brand);
  if (!brand) return false;
  const description = labelDescription(product);
  if (/\badministrar por via oral[.:; ]+dissolver as gotas\b/.test(description)) return true;
  const prefixes = description.split(/[.:;!?]/).map(part => part.trim().replace(/^(?:a|o) /, ''));
  return prefixes.some(part => part.startsWith(brand + ' ') &&
    /^(?:solucao|suspensao)(?: oral)?(?: em)? gotas\b/.test(part.slice(brand.length + 1)));
}

export function matchesRequest(product, query) {
  const requested = presentationTokens(query);
  const fields = [product.name, product.filters?.['Forma farmacêutica'], product.details?.quantidade,
    ...(product.details?.dosageList ?? [])];
  const route = product.filters?.['Via de administração'];
  if (requestsSublingual(query)) {
    if (!documentedSublingual(product.name, product.filters?.['Forma farmacêutica'], route) &&
        !requestsSublingual(product.details?.quantidade)) return false;
    fields.push('sublingual');
  } else fields.push(route);
  const evidence = fields.flat().flatMap(presentationTokens);
  for (const word of [...evidence]) {
    const count = /^\d+(comprimido|capsula|frasco)$/.exec(word);
    if (count) evidence.push(count[1]);
  }
  if (requested.includes('gotas') && documentedDrops(product)) evidence.push('gotas');
  const packVolumes = presentationTokens(product.details?.quantidade).filter(t => /^\d+(?:\.\d+)?ml$/.test(t));
  return requested.length > 0 && requested.every(term =>
    evidence.includes(term) && (!/^\d+(?:\.\d+)?ml$/.test(term) || !packVolumes.length || packVolumes.includes(term)));
}

export function matchesLabeledDropRequest(row,query) {
  const [form,route] = [row.facts?.['Forma Farmacêutica'] ?? row.facts?.Apresentação, row.facts?.['Forma de Administração']];
  const asProduct = name => ({name,filters:{'Forma farmacêutica':form,'Via de administração':route}});
  if (/\b(?:kit|brinde|gratis|injet[a-z]*|ampolas?|comprimidos?|capsulas?)\b/.test(normalize([row.name, row.itemName, form].join(' ')))) return false;
  const requested = catalogQuery(query);
  return [row.name,row.itemName ?? row.name].every(name => matchesRequest(asProduct(name),requested) &&
    (!/\bgts\b/iu.test(query) || documentedDrops(asProduct(name))));
}

export function labelDescription(product) {
  return normalize(String(product.productDescription ?? '').replace(/<[^>]*>/g, ' ')
    .replace(/&([aeiou])(?:acute|circ|tilde|grave);/gi, '$1').replace(/&ccedil;/gi, 'c')
    .replace(/(?:&reg;|®)/g, '').replace(/&nbsp;/g, ' '));
}
