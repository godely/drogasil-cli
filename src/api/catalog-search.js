import { searchProducts } from './algolia.js';
import { compareProducts } from './compare.js';
import { medicationIntent, verifiedRow } from './medication-catalog.js';
import { medicationSearch, resolveMedication } from './medications.js';

// Public search hits retain their original catalog fields and zero-based pages.
// Prices/stock of another retailer must never come through this function.
export async function searchCatalogPage(query, {page = 0, hitsPerPage = 20} = {}) {
  const options = {page, hitsPerPage};
  const intent = await medicationIntent(query);
  const explicitForm = /\b(?:gotas?|comprimidos?|capsulas?|sublingual|efervescente|liberacao)\b/.test(intent.suffix);
  if (!['ingredient', 'brand'].includes(intent.kind) && !explicitForm) return searchProducts(query, options);

  const resolved = await resolveMedication(query).catch(() => null);
  const exactFacet = resolved?.kind === intent.kind && resolved.filters && !resolved.interpretation;
  const matchPresentation = explicitForm || (exactFacet && intent.suffix);
  const identity = (matchPresentation || exactFacet) ? {...intent, suffix:''} : intent;
  const verify = hit => verifiedRow(hit, identity, {
    ingredients:(hit.details?.activeIngredients ?? []).map(item => item.description).filter(Boolean),
    evidence:{source:'retailer_field'},
  });

  if (matchPresentation) {
    const result = await compareProducts(query, {resolveNames:true, includeGenerics:false, includeUnpriced:true});
    const matches = (result.candidates ?? result.groups?.flat() ?? result.products ?? []).map(verify).filter(Boolean);
    return {hits:matches.slice(page * hitsPerPage, (page + 1) * hitsPerPage), page,
      nbHits:matches.length, nbPages:Math.ceil(matches.length / hitsPerPage)};
  }
  const result = exactFacet ? await medicationSearch(query, options, resolved) : await searchProducts(query, options);
  return {...result, hits:result.hits.map(verify).filter(Boolean)};
}
