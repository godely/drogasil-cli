import { compareProducts, literalBrandPack } from '../api/compare.js';
import { resolveMedication, fold } from '../api/medications.js';
import { samePack, validBarcode } from '../api/retail-prices.js';

const presentationMarker = /\d\s*(?:mg|mcg|ml|g\b|comprimidos?|capsulas?)|\b(?:gts|gotas?|sub[- ]?lingua(?:l|is)|liberacao|xr|sr|lp)\b/;

// Only a literally named brand enters this path. Spelling corrections keep
// their existing confirmation step on the retailer's normal search path.
export async function brandPacks(query, { resolve = resolveMedication, compare = compareProducts } = {}) {
  const text = fold(query);
  if (!presentationMarker.test(text)) return null;
  const identity = await resolve(query);
  if (identity.kind !== 'brand') return null;
  const brand = fold(identity.name);
  if (text !== brand && !text.startsWith(brand + ' ')) return null;
  const result = await compare(query, { resolveNames: true, includeGenerics: false, includeUnpriced: true });
  const originals = new Set((result.requestedBrandSkus ?? result.referenceSkus ?? []).map(String));
  const hits = (result.products ?? result.candidates ?? []).filter(row =>
    originals.has(String(row.sku)) || literalBrandPack(row, query, identity.name));
  return { brand: identity.name, hits };
}

export async function searchBrandPage(query, { page = 0, hitsPerPage = 20 } = {}) {
  const match = await brandPacks(query);
  if (!match) return null;
  const nbHits = match.hits.length;
  return { query, page, hitsPerPage, hits: match.hits.slice(page * hitsPerPage, (page + 1) * hitsPerPage),
    nbHits, nbPages: Math.ceil(nbHits / hitsPerPage), status: nbHits ? 'matches' : 'no_reference',
    searchEvidence: 'verified_brand_presentation' };
}

export function withBrandPacks(source, resolvePacks = brandPacks) {
  return { ...source, async search(query, page = 1, limit = 20) {
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
      throw new TypeError('Invalid page or limit');
    const match = await resolvePacks(query);
    if (!match) return source.search(query, page, limit);
    const bySku = new Map();
    function append(row, evidence) {
      const sellers = bySku.get(row.sku) ?? new Map();
      if (!sellers.has(row.sellerId)) {
        const tradeName = literalBrandPack(row, match.brand, match.brand) ? match.brand : undefined;
        sellers.set(row.sellerId, { ...row, presentationEvidence:evidence, requestedTradeName:tradeName });
      }
      bySku.set(row.sku, sellers);
    }
    for (const ref of match.hits) {
      const gtin = String(ref.eanCode ?? '');
      if (!validBarcode(gtin)) continue;
      for (const row of await source.byGtin(gtin)) {
        if (samePack({ gtin, name: ref.name, filters:ref.filters }, row)) append(row, 'verified_reference_barcode_and_pack');
      }
    }
    // Local packs can exist without a reference barcode. An upstream page
    // repeated past the end must not leave the CLI in a retry loop.
    const seen = new Set();
    for (let n = 1; ; n++) {
      const before = seen.size;
      const rows = await source.search(match.brand, n, 50);
      for (const row of rows) {
        seen.add(row.sku);
        if (literalBrandPack(row, query, match.brand)) append(row, 'retailer_presentation');
      }
      if (rows.length < 50 || bySku.size >= page * limit || seen.size === before) break;
    }
    return [...bySku.values()].slice((page - 1) * limit, page * limit).flatMap(sellers => [...sellers.values()]);
  } };
}
