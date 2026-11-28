export function normalize(value) {
  return String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)\s+(?=mg|mcg|ml|g\b)/g, '$1')
    .replace(/(\d)\.0+(?=[a-z\s]|$)/g, '$1').trim().replace(/\s+/g, ' ');
}

// Packaging prose can sit between the dosage and the count in a user's query.
export function catalogQuery(value) {
  return value.replace(/\bem\s+(?=gotas?\b)/giu, '')
    .replace(/\bfrasco\s+(?:de|com)\s+(?=\d+(?:[.,]\d+)?\s*m[lL]\b)/gu, (phrase, offset, text) =>
      /\d\s*$/.test(text.slice(0, offset)) ? phrase : '')
    .replace(/\s*,?\s*\b(?:(?:caixa|embalagem)\s+(?:de|com)|com)\s+(?=\d+\s+(?:comprimidos?|c[áa]psulas?)\b)/giu, ' ').trim();
}

export function presentationTokens(value) {
  return normalize(value).replace(/\s*\/\s*/g, '/')
    .replace(/\b(\d+)\s+(comprimidos?|capsulas?|frascos?)\b/g, '$1$2')
    .replace(/(comprimido|capsula|frasco)s\b/g, '$1')
    .match(/[\p{L}\d.]+(?:\/[\p{L}\d.]+)?/gu) ?? [];
}

// Some oral drops are indexed as "solução oral". Broaden retrieval only;
// the original request must still match the product's own presentation.
export function dropSearchTerms(query) {
  return query.replace(/\bgotas\b/giu, ' ').replace(/\s+/g, ' ').trim();
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
  if (/\b(?:kit|brinde|gratis|injet[a-z]*|ampolas?|comprimidos?|capsulas?)\b/.test(normalize([row.name, row.itemName, form].join(' ')))) return false;
  const requested = catalogQuery(query);
  return [row.name,row.itemName ?? row.name].every(name => matchesRequest(asProduct(name),requested));
}

export function labelDescription(product) {
  return normalize(String(product.productDescription ?? '').replace(/<[^>]*>/g, ' ')
    .replace(/&([aeiou])(?:acute|circ|tilde|grave);/gi, '$1').replace(/&ccedil;/gi, 'c')
    .replace(/(?:&reg;|®)/g, '').replace(/&nbsp;/g, ' '));
}
