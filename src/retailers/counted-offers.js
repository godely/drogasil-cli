import { countedPack, directCountedListing, matchesCountedLabel } from '../api/counted-pack.js';
import { fold } from '../api/medications.js';
import { samePack, validBarcode } from '../api/retail-prices.js';
import { catalogType } from './catalog.js';

const values = (...fields) => fields.flat().filter(v => typeof v === 'string' && v.trim());
const localIngredient = v => fold(v).replace(/^com\s+/, '');

function requestedPack(suffix) {
  const text = fold(suffix);
  const plain = countedPack(text);
  if (plain) return {pack:plain};
  const leading = text.match(/^(?:d[aoe]\s+)?([a-z][a-z .-]*?)\s*,?\s+(\d.*)$/);
  if (leading) return {manufacturer:leading[1].trim(), pack:countedPack(leading[2])};
  const trailing = text.match(/^(\d.*(?:comprimidos?|capsulas?))[\s,]+(?:d[aoe]\s+)?([a-z][a-z .-]*)$/);
  if (trailing) return {manufacturer:trailing[2].trim(), pack:countedPack(trailing[1])};
  return {};
}

export async function countedOffers(retailer, query, source, identity, reference) {
  if (identity.kind !== 'ingredient') return null;
  // A manufacturer can precede the strength or follow the pack. Keep this
  // interpretation only when a retailer identifies the full manufacturer.
  const {pack, manufacturer} = requestedPack(identity.suffix);
  if (!pack) return null;
  const products = [], unverified = [], seen = new Set(), referenceChecks = new Map();
  let manufacturerSeen = false;
  let catalogComplete = false;
  for (let page = 1; page <= 20; page++) {
    let rows;
    try { rows = await source.search(query, page, 50); }
    catch (error) { if (page === 1) throw error; break; }
    const before = seen.size;
    for (const row of rows) {
      const key = JSON.stringify([row.sku, row.sellerId]);
      if (seen.has(key)) continue;
      seen.add(key);
      const facts = row.facts ?? {};
      if (manufacturer) {
        if (!row.manufacturer || fold(row.manufacturer) !== manufacturer) continue;
        manufacturerSeen = true;
      }
      const evidence = { pack: facts.Quantidade, form: facts['Forma Farmacêutica'] ?? facts.Apresentação,
        route: facts['Via de Administração'] ?? facts['Formas de Administração'] ?? facts['Forma de Administração'], brand: row.brand };
      const release = values(facts['Tipo de Liberação']);
      if (!matchesCountedLabel(pack, row.name, evidence) ||
          release.some(value => !/^(?:liberacao )?(?:imediata|convencional)$/.test(fold(value))) ||
          (row.itemName && !matchesCountedLabel(pack, row.itemName, evidence))) {
        unverified.push({ sku:row.sku, name:row.name, reason:'presentation_not_verified' });
        continue;
      }
      const actives = new Set(values(row.activeIngredients, facts.NomeSubstanciaPrincipioAtivo, facts['Princípio Ativo']).map(localIngredient));
      if (actives.size && (actives.size !== 1 || !actives.has(localIngredient(identity.name)))) continue;
      const strengths = values(facts.Dosagem);
      if (strengths.some(v => fold(v).replace(/\s+/g, '').replace(',', '.') !== pack.strength + pack.unit)) {
        unverified.push({ sku:row.sku, name:row.name, reason:'strength_not_verified' });
        continue;
      }
      let basis = 'retailer_ingredient_and_pack';
      if (!actives.size) {
        let match = false;
        if (validBarcode(String(row.gtin ?? ''))) {
          if (!referenceChecks.has(row.gtin)) referenceChecks.set(row.gtin, reference.byGtin(row.gtin).catch(() => null));
          const hits = await referenceChecks.get(row.gtin);
          match = hits?.some(p => directCountedListing(p, identity.name, pack) &&
            samePack({ name:p.name, gtin:String(p.eanCode) }, row));
        }
        if (!match) {
          unverified.push({ sku:row.sku, name:row.name, reason:'ingredient_not_verified' });
          continue;
        }
        basis = 'reference_barcode_and_retailer_pack';
      }
      const { facts: unused, ...offer } = row;
      products.push({ ...offer, retailerId:retailer, type:catalogType(row), role:'requested', matchBasis:basis });
    }
    if (rows.length < 50) { catalogComplete = true; break; }
    if (seen.size === before) break;
  }
  if (manufacturer && !manufacturerSeen) return null;
  products.sort((a, b) => (a.currentPrice ?? Infinity) - (b.currentPrice ?? Infinity));
  return { retailerId:retailer, status:!catalogComplete ? 'partial' : products.length ? 'matches' : unverified.length ? 'incomplete_presentation' : 'no_match',
    scope:'direct_requested_pack', products, unverified, catalogComplete };
}
