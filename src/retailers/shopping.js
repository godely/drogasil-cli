import { fold, resolveMedication } from '../api/medications.js';
import { matchesLabeledDropRequest } from '../api/presentation-label.js';
import { matchesDropListing } from './drop-listing.js';
import { countedOffers } from './counted-offers.js';
import { compareProducts, medicationType, samePack, searchProducts } from '../api/index.js';
import { validBarcode as validGtin } from '../api/retail-prices.js';
import { catalogType } from './catalog.js';

function listed(row, retailerId) {
  const {facts, ...product} = row;
  return {...product, retailerId, type:catalogType(row)};
}

const references = {
  resolve: resolveMedication,
  drops:(query,includeGenerics)=>compareProducts(query,{resolveNames:true,includeUnpriced:true,includeGenerics:!!includeGenerics}),
  async byGtin(gtin) {
    const {hits} = await searchProducts(gtin,{hitsPerPage:100});
    return hits.filter(hit=>hit.isActive !== false && String(hit.eanCode)===gtin);
  },
  compare: sku => compareProducts(sku,{resolveNames:true,includeUnpriced:true}),
};

async function findDropOffers(retailer,query,source,reference,includeGenerics) {
  const selection = await reference.drops(query,includeGenerics);
  const allowed = new Set((selection.requestedBrandSkus ?? selection.referenceSkus ?? []).map(String));
  const eligible = selection.status === 'ambiguous' ? selection.candidates : selection.products;
  if (!eligible?.length) return null;
  const offers = new Map();
  for (const hit of eligible) {
    const original = allowed.has(String(hit.sku)) || selection.status === 'ambiguous';
    if (!original && (!includeGenerics || medicationType(hit)!=='Genérico')) continue;
    const code = String(hit.eanCode);
    if (!validGtin(code)) continue;
    for (const row of await source.byGtin(code)) {
      if (!matchesDropListing(hit,row)) continue;
      const key = JSON.stringify([row.sku,row.sellerId]);
      offers.set(key,{...listed(row,retailer),role:original?'requested':'generic',
        ...(original && {requestedTradeName:hit.brand}),matchBasis:'verified_drop_presentation_and_barcode'});
    }
  }
  const products = [...offers.values()];
  if (!products.length) return null;
  if (selection.status === 'ambiguous' && new Set(products.map(p=>p.gtin)).size > 1)
    return {retailerId:retailer,status:'choose_reference',candidates:products};
  return {retailerId:retailer,status:'matches',scope:'verified_drop_presentation',products};
}

// The reference catalog establishes presentation equivalence. The selected retailer
// must independently list every suggested generic with the same barcode and pack.
export async function retailerComparison({retailer, query, includeGenerics}, source, reference = references) {
  const exact = /^\d+$/.test(query);
  const wantsDrops = /\bgotas?\b/iu.test(query);
  let referenceFailure;
  if (wantsDrops && reference.drops && source.byGtin) {
    try {
      const matched = await findDropOffers(retailer,query,source,reference,includeGenerics);
      if (matched) return matched;
    } catch (error) { referenceFailure=error; }
  }
  if (!exact && /\d+\s*(?:comprimidos?|c[áa]psulas?)\b/iu.test(query) && reference.resolve) {
    const identity = await reference.resolve(query).catch(() => null);
    if (identity) {
      const direct = await countedOffers(retailer, query, source, identity, reference);
      if (direct) return direct;
    }
  }
  let discovery = exact ? await source.product(query) : await source.search(query,1,wantsDrops ? 50 : 2);
  if (wantsDrops) {
    discovery = discovery.filter(p=>matchesLabeledDropRequest(p,query));
    if (!discovery.length && referenceFailure) throw referenceFailure;
  }
  const distinct = [...new Set(discovery.map(row=>row.sku))];
  if (!distinct.length) return {retailerId:retailer,status:exact?'unknown_sku':'no_match',products:[]};
  if (distinct.length > 1) return {retailerId:retailer,status:'choose_reference',candidates:discovery.map(r=>listed(r,retailer)),
    guidance:'Use pharmacy_search for more presentations, then pass the chosen local SKU.'};
  const originals = exact || wantsDrops ? discovery : await source.product(distinct[0]);
  const products = originals.map(row=>({...listed(row,retailer),role:'requested'}));
  const result = {retailerId:retailer,status:'matches',products};
  if (!originals.length) return {...result,status:'unknown_sku'};
  if (!includeGenerics) return result;
  const [anchor] = originals;
  if (!validGtin(anchor.gtin??'') || originals.some(r=>r.gtin!==anchor.gtin)) return {...result,status:'incomplete_presentation',missingFields:['verified_barcode']};
  let equivalents;
  try {
    const refs=(await reference.byGtin(anchor.gtin)).filter(p=>samePack(anchor,{name:p.name,gtin:String(p.eanCode)}));
    if (refs.length!==1) return {...result,status:'incomplete_presentation',missingFields:['verified_reference_pack']};
    equivalents=await reference.compare(String(refs[0].sku));
  } catch { return {...result,status:'partial',issues:['reference_lookup_failed']}; }
  if (equivalents.status!=='matches') return {...result,status:'incomplete_presentation',
    missingFields:equivalents.missingFields??['verified_equivalence']};
  const checked = new Set([anchor.gtin]);
  const generics = [], issues=[];
  for (const hit of equivalents.products) {
    const gtin=String(hit.eanCode??'');
    if (medicationType(hit)!=='Genérico' || checked.has(gtin) || !validGtin(gtin)) continue;
    checked.add(gtin);
    try {
      for (const row of await source.byGtin(gtin)) {
        if (!samePack({name:hit.name,gtin},row)) continue;
        if (['Referência','Similar'].includes(catalogType(row))) continue;
        generics.push({...listed(row,retailer),role:'generic',type:'Genérico',
          equivalenceEvidence:{source:'drogasil',referenceSku:String(hit.sku),gtin}});
      }
    } catch {issues.push({gtin,status:'source_failed'});}
  }
  const byPrice=(a,b)=>(a.currentPrice??Infinity)-(b.currentPrice??Infinity) || String(a.sku).localeCompare(String(b.sku));
  return {...result,status:issues.length?'partial':'matches',issues,
    products:[...products.sort(byPrice),...generics.sort(byPrice)], scope:'equivalents_in_reference_catalog'};
}

// An exact-SKU basket is a fulfillment check. Each quantity is an order quantity.
export async function retailerBasket({retailer, items, zipcode}, source) {
  const base = {retailerId:retailer};
  if (source.serves && !await source.serves(zipcode)) return {...base,status:'outside_local_directory',items:[]};
  const chosen=[], pending=[];
  const catalog = new Map();
  for (const {sku, sellerId, quantity} of items) {
    if (!catalog.has(sku)) {
      try { catalog.set(sku,await source.product(sku)); }
      catch { catalog.set(sku,null); }
    }
    const all = catalog.get(sku);
    if (!all) {
      pending.push({sku,status:'source_failed'});
      continue;
    }
    const rows = sellerId ? all.filter(row=>row.sellerId===sellerId) : all;
    if (rows.length!==1) {
      pending.push({sku, status:rows.length?'choose_seller':all.length?'unknown_seller':'unknown_sku',
        sellers:rows.map(row=>({id:row.sellerId,name:row.seller}))});
    } else chosen.push({offer:rows[0],quantity});
  }
  if (pending.length) return {...base,status:'unresolved_items',pending};
  const quotes=await source.basket(chosen,zipcode);
  const available=quotes.filter(q=>q.localStatus==='available');
  const complete=available.length===quotes.length && quotes.length>0;
  const pickupIds=q=>new Set(q.methods.filter(m=>m.channel==='pickup-in-point' && m.pickupPointId).map(m=>m.pickupPointId));
  const shared=new Map();
  if (complete) {
    const sets=quotes.map(pickupIds);
    for (const method of quotes[0].methods) {
      if (method.channel==='pickup-in-point' && method.pickupPointId && sets.every(s=>s.has(method.pickupPointId))) {
        shared.set(method.pickupPointId,{id:method.pickupPointId,name:method.branch,address:method.address});
      }
    }
  }
  const status=complete?'fulfillable':available.length?'partial':
    quotes.every(q=>q.localStatus==='unavailable')?'unavailable':'unconfirmed';
  return {...base,status,
    items:quotes.map(q=>listed(q,retailer)),commonPickupPoints:[...shared.values()],
    deliveryForEveryItem:complete && quotes.every(q=>q.methods.some(m=>m.channel==='delivery')),
    estimatedProductTotalBRL:complete && quotes.every(q=>Number.isFinite(q.currentPrice))
      ? quotes.reduce((sum,q)=>sum+Math.round(100*q.currentPrice)*q.requestedQuantity,0)/100:null};
}
