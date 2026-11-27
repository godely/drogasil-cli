import { searchProducts, getProductsBySku } from './algolia.js';
import { compareProducts } from './compare.js';
import { medicationType, productInfo } from './product-info.js';
import { readStorefront } from './storefront.js';
import { normalizeCep } from './graphql.js';

const norm = text => String(text ?? '').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase()
  .replace(/(\d),(\d)/g,'$1.$2').replace(/\s*\/\s*/g,'/');
export function validBarcode(code) {
  return /^(?:\d{8}|\d{12,14})$/.test(code) && !/^0+$/.test(code) &&
    [...code].reverse().reduce((sum,n,i) => sum + Number(n) * (i % 2 ? 3 : 1),0) % 10 === 0;
}
function dimensions(title) {
  const text = norm(title);
  const tokens = pattern => [...new Set([...text.matchAll(pattern)].map(m => m[0].replace(/\s/g,'')))].sort().join('|');
  const forms = ['comprimido','capsula','gotas','xarope','pomada','creme','injeta','suspensao','spray','adesivo','supositorio'];
  return {
    strength: tokens(/\d+(?:\.\d+)?\s*(?:mcg|mg|ui|g)\b(?:\/(?:\d+\s*)?(?:ml|g|dose|gota)\b)?/g),
    volume: tokens(/(?<!\/)\b\d+(?:\.\d+)?\s*ml\b/g),
    count: [...text.matchAll(/(\d+)\s*(?:comprimidos?|capsulas?|unidades?|ampolas?|frascos?)\b/g)].map(m=>m[1]).join('|'),
    form: forms.filter(f=>text.includes(f)).join('|'),
    release: /\b(xr|xl|sr|cr|lp|retard)\b|liberacao (?:prolongada|modificada|controlada)/.test(text),
    sublingual: /sub[- ]?lingual/.test(text),
    route: ['nasal','oftalm','otolog','vaginal','retal','topico'].filter(f=>text.includes(f)).join('|'),
    multiplier: text.match(/\b(\d+)\s*[x×]\s*\d+/)?.[1] ?? '1',
  };
}
export function samePack(anchor, row) {
  if (!validBarcode(anchor.gtin) || anchor.gtin !== row.gtin) return false;
  const a = dimensions(anchor.itemName ?? anchor.name), b = dimensions(row.itemName ?? row.name);
  if (a.release !== b.release || a.sublingual !== b.sublingual || a.route !== b.route || a.multiplier !== b.multiplier) return false;
  for (const key of ['strength','volume','count','form']) if (a[key] && b[key] && a[key] !== b[key]) return false;
  return !!(a.strength && a.strength === b.strength && ((a.volume && a.volume === b.volume) || (a.count && a.count === b.count)));
}
function reference(p) { return { ...productInfo(p), gtin: String(p.eanCode ?? ''), itemName: p.name }; }

export async function compareRetailPrices(input, { zipcode, retailers, includeGenerics = false }) {
  const query = String(input).trim();
  zipcode = normalizeCep(zipcode);
  const exactGtin = validBarcode(query);
  let hits, catalogFailed = false;
  if (exactGtin) {
    try {
      hits = (await searchProducts(query, { hitsPerPage: 100 })).hits.filter(p => String(p.eanCode) === query);
    } catch {
      hits = [];
      catalogFailed = true;
    }
  }
  else if (/^\d+$/.test(query)) hits = (await getProductsBySku([query])).filter(Boolean);
  else {
    const r = await compareProducts(query, { resolveNames:true, includeUnpriced:true });
    if (r.candidates || r.groups || r.nameCandidates || r.ingredientCandidates) return { status: 'ambiguous',
      candidates: (r.candidates ?? r.groups?.flat() ?? []).map(reference), names: r.nameCandidates ?? r.ingredientCandidates };
    hits = (r.products ?? []).filter(p => !r.requestedBrandSkus || r.requestedBrandSkus.includes(String(p.sku)));
  }
  const unique = new Map(hits.map(p => [String(p.sku),p]));
  if (unique.size > 1) return { status: 'ambiguous', candidates: [...unique.values()].map(reference) };
  const hit = [...unique.values()][0];
  if (!hit && !exactGtin) return { status: 'no_reference', verifiedOffers: [], onlineOffers: [], checkedRetailers:[{ retailer:'Drogasil', status:'no_exact_match' }] };
  let anchor = hit ? { ...reference(hit), retailer: 'Drogasil' } : null;
  if (anchor && !validBarcode(anchor.gtin)) return { status: 'missing_gtin', reference:anchor };
  const verifiedOffers = [], onlineOffers = [], checked = [], issues = [];
  if (!hit) checked.push({ retailer: 'Drogasil', status: catalogFailed ? 'source_failed' : 'no_exact_match' });
  else try {
    const { snapshot } = await readStorefront(hit,query);
    onlineOffers.push({ retailer:'Drogasil', sku:anchor.sku, gtin:anchor.gtin, name:anchor.name, seller:snapshot.seller,
      currentPrice:snapshot.currentPrice,listPrice:snapshot.listPrice,inStock:snapshot.inStock, currency:'BRL', type:anchor.type,
      productUrl:snapshot.productUrl, observedAt:snapshot.scrapedAt, priceScope:'anonymous_online' });
    checked.push({ retailer:'Drogasil', status:'online_only' });
  } catch { checked.push({ retailer:'Drogasil',status:'source_failed' }); }
  for (const provider of retailers) {
    try {
      if (provider.serves && !await provider.serves(zipcode)) {
        checked.push({ retailer: provider.name, status: 'outside_local_directory' });
        continue;
      }
      const candidates = await provider.byGtin(anchor?.gtin ?? query);
      if (!anchor) {
        const row = candidates.find(candidate => candidate.gtin === query && samePack(candidate, candidate));
        if (row) anchor = { retailer: provider.name, sku: row.sku, gtin: row.gtin, name: row.name, itemName: row.itemName };
      }
      const matched = anchor ? candidates.filter(row => samePack(anchor,row)) : [];
      let verified = 0;
      for (const row of matched) {
        let offer = row;
        try { offer = await provider.local(row,zipcode); }
        catch { issues.push({ retailer:provider.name, sku:row.sku, status:'location_lookup_failed' }); }
        const { facts, methods = [], branches, ...publicFields } = offer;
        const entry = { ...publicFields, type: offer.type ?? medicationType(offer),
          ...(branches ? { reportedBranches: branches } : {}),
          fulfillment: [...new Set(methods.map(m => m.channel))],
          fulfillmentOptions: methods.map(({ channel, service, feeBRL, pickupPointId, branch, address }) => ({
            channel, service, feeBRL, ...(channel === 'pickup-in-point' && { pickupPointId, branch, address }),
          })),
        };
        if (offer.priceScope === 'verified_for_cep' && Number.isFinite(offer.currentPrice)) {
          verifiedOffers.push(entry); verified++;
        } else onlineOffers.push(entry);
      }
      checked.push({ retailer:provider.name,status:verified ? 'verified' : matched.length ? 'online_only' :
        candidates.length ? 'presentation_unconfirmed' : 'no_exact_match' });
    } catch { checked.push({ retailer:provider.name,status:'source_failed' }); }
  }
  verifiedOffers.sort((a,b)=>a.currentPrice-b.currentPrice || a.retailer.localeCompare(b.retailer));
  if (!anchor) return { status: 'no_reference', verifiedOffers, onlineOffers, checkedRetailers: checked, issues };
  const genericOptions = [];
  if (includeGenerics && !hit) issues.push({ retailer: 'Drogasil', status: 'generic_reference_unavailable' });
  if (includeGenerics && hit) try {
    const result = await compareProducts(anchor.sku,{ resolveNames:true });
    for (const product of result.products ?? []) {
      const option = reference(product);
      if (option.type === 'Genérico' && option.sku !== anchor.sku) genericOptions.push(option);
    }
  } catch { issues.push({ retailer: 'Drogasil', status: 'generic_lookup_failed' }); }
  return { status:'matched', reference:anchor, verifiedOffers, onlineOffers, genericOptions, checkedRetailers:checked, issues,
    conditions:'Anonymous prices for one pack. Delivery fees and personalized discounts are excluded. Online-only prices have no verified local quote.' };
}
