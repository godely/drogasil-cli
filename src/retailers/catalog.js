import { prescriptionInfo } from '../api/regulatory-info.js';
import { documentedDrops, documentedSublingual, matchesLabeledDropRequest, requestsDrops } from '../api/presentation-label.js';
import { validBarcode } from '../api/retail-prices.js';
import { matchesDropListing } from './drop-listing.js';
import { getMedicationInfo, infoRecords, medicationFacts } from '../api/medication-info.js';
import { collectSnapshot } from '../snapshots/index.js';
import { partnerSnapshotRecord } from './snapshot-record.js';

function values(...fields) {
  return [...new Set(fields.flat().filter(v => typeof v === 'string' && v.trim()).map(v => v.trim()))];
}

export function catalogType(row) {
  const facts = row.facts ?? {};
  const labels = values(facts['Tipo de Medicamento'], facts.Generico, row.type);
  if (labels.some(v => /^gen[eé]ric[oa]s?$/iu.test(v)) || values(facts.Generico).some(v => /^sim$/iu.test(v))
      || /\bgen[eé]ric[oa]\b/iu.test(row.name)) return 'Genérico';
  if (labels.some(v=>/^refer[eê]ncia$/iu.test(v))) return 'Referência';
  if (labels.some(v=>/^similar(?:es)?$/iu.test(v))) return 'Similar';
  return row.type ?? 'Não informado';
}

// A merchant's A/B/C list code is not a verified legal classification.
function retailerPrescription(fields, ingredients, routes) {
  const labels = values(fields['Prescrição Médica'], fields['Tipo de Receita']);
  const retentionLabel = values(fields['Retenção de Receita']);
  const evidence = [...labels, ...retentionLabel].join(' ');
  const prescription = prescriptionInfo(evidence, '', ingredients.map(name => name.replace(/^com\s+/iu,'')),
    routes.length === 1 ? routes[0] : null);
  if (prescription.required === null && labels.some(label => /^sob prescri[çc][ãa]o(?: m[eé]dica)?$/iu.test(label)) && !prescription.conflict)
    prescription.required = true;
  const hasList = /\b(?:lista\s+)?[abc]\s*[-–]?\s*[1-5]\b/iu;
  function generalLabel(label) {
    if (!hasList.test(label)) return label;
    if (/sem reten[çc][ãa]o/iu.test(label)) return 'Sem retenção de receita';
    if (/(?:com|sujeit[ao] [aà]) reten[çc][ãa]o/iu.test(label)) return 'Com retenção de receita';
    return null;
  }
  const prescriptionLabel = values(labels.map(generalLabel));
  return {prescription, prescriptionLabel, retentionLabel:values(retentionLabel.map(generalLabel))};
}

// These are catalog labels. A missing regulatory field must remain unknown.
export function medicationCard(row) {
  const fields = row.facts ?? {};
  const title = row.name ?? '';
  const form = title.match(/\b(?:comprimidos?(?:\s+(?:sublingua(?:l|is)|revestidos?|efervescentes?|mastig[aá]veis))?|c[áa]psulas?|gotas|solu[çc][ãa]o oral|suspens[ãa]o oral|xarope|pomada|creme)\b/giu);
  const strengths = title.match(/\b\d+(?:[.,]\d+)?\s*(?:mcg|µg|mg|g|ui|%)(?:\s*\/\s*(?:\d+(?:[.,]\d+)?\s*)?(?:ml|g|h|dose|gota))?(?![\p{L}\p{N}]|\s*\/)/giu);
  const packs = title.replace(/\/\s*(?:\d+(?:[.,]\d+)?\s*)?ml\b/gi, '/').match(/\b\d+(?:[.,]\d+)?\s*(?:ml|comprimidos?|c[áa]psulas?|ampolas?|sach[eê]s?)\b/giu);
  const activeIngredients = values(row.activeIngredients, fields.NomeSubstanciaPrincipioAtivo, fields['Princípio Ativo']);
  const declaredRoutes = values(fields['Forma de Administração'], fields['Formas de Administração'], fields['Via de Administração']);
  const routes = documentedSublingual(title, fields['Forma Farmacêutica'] ?? fields.Apresentação, declaredRoutes)
    ? ['Sublingual'] : declaredRoutes;
  const release = title.match(/\blibera[çc][ãa]o (?:imediata|prolongada|modificada|retardada|controlada)|\b(?:XR|SR|LP|CR)\b/gi);
  const forms = values(fields['Forma Farmacêutica'], fields.Apresentação, form ?? []);
  const liquid = /gotas?|solu[çc][ãa]o|suspens[ãa]o|xarope|col[ií]rio/iu.test([title,...forms].join(' '));
  const dosage = values(fields.Dosagem, strengths ?? []).filter(value => !liquid ||
    /(?:%|\/\s*(?:\d+(?:[.,]\d+)?\s*)?(?:mL|L|g|h|dose|gotas?))$/iu.test(value.trim()));
  const uniqueDosages = new Map(dosage.map(value => [value.toLowerCase().replace(/\s+/g, '').replace(',', '.'), value]));
  const makers = values(fields.Fabricante, row.manufacturer);
  const manufacturer = makers.length === 1 ? makers[0] : null;
  return { sku: row.sku, gtin: row.gtin ?? null, name: title, type: catalogType(row), source: row.productUrl ?? null,
    manufacturer, manufacturerSource:manufacturer ? row.manufacturerSource ?? row.productUrl ?? null : null,
    activeIngredients, ingredientEvidence: row.ingredientEvidence ?? (activeIngredients.length ? {source:'retailer_field'} : null),
    strengths: [...uniqueDosages.values()], forms,
    routes,
    release: values(fields['Tipo de Liberação'], release ?? []), packs: values(fields.Quantidade, packs ?? []),
    ...retailerPrescription(fields,activeIngredients,routes), observedAt: row.observedAt ?? null };
}

// Explicit local labels stand on their own. For abbreviated labels, join a documented
// presentation to a product in the selected catalog, independently of sellers and offers.
async function dropCards(query, source, referenceRecords) {
  const cards = new Map();
  const issues = new Set();
  try {
    for (let page = 1; ; page++) {
      const rows = await source.facts(query, page, 50);
      for (const row of rows) {
        if (matchesLabeledDropRequest(row, query)) cards.set(row.sku, medicationCard(row));
      }
      if (rows.length < 50) break;
    }
  } catch { issues.add('retailer_catalog_failed'); }

  try {
    const { hits } = await referenceRecords(query);
    for (const hit of hits) {
      if (/\bgts\b/iu.test(query) && !documentedDrops(hit)) continue;
      const code = String(hit.eanCode ?? '');
      if (!validBarcode(code)) continue;
      const fact = medicationFacts(hit);
      let rows;
      try { rows = await source.factsByGtin(code); }
      catch { issues.add('retailer_catalog_failed'); continue; }
      for (const row of rows) {
        if (!matchesDropListing(hit, row)) continue;
        const card = medicationCard(row);
        if (fact.source) {
          // The matched pack can supply a missing liquid denominator but never replace a local fact.
          if (!card.strengths.length && fact.ingredients.length === 1 && fact.ingredients[0].strength?.includes('/'))
            card.strengths = [fact.ingredients[0].strength];
          card.forms = values(card.forms, 'Gotas');
          card.presentationSource = fact.source;
        }
        cards.set(row.sku, card);
      }
    }
  } catch { issues.add('reference_catalog_failed'); }
  return { cards:[...cards.values()], issues:[...issues] };
}

export async function catalogInfo({retailer, queries, page = 1, limit = 20, scope = 'catalog'}, source, nationalInfo = getMedicationInfo, referenceRecords = infoRecords) {
  const results = [];
  for (const query of queries) {
    const bySku = /^\d+$/.test(query);
    let result;
    try {
      let products, issues = [];
      if (requestsDrops(query) && source.facts && source.factsByGtin) {
        const found = await dropCards(query, source, referenceRecords);
        products = found.cards.slice((page-1)*limit, page*limit);
        issues = found.issues;
      } else {
        let rows;
        if (source.factsPage) {
          ({rows, issues} = await source.factsPage(query, page, limit));
        } else {
          rows = source.facts ? await source.facts(query,page,limit)
            : bySku ? await source.product(query) : await source.search(query,page,limit);
        }
        products = [...new Map(rows.map(row => [row.sku, medicationCard(row)])).values()];
      }
      const status = issues.length ? (products.length ? 'partial' : 'source_failed') :
        products.length ? 'matches' : bySku ? 'unknown_sku' : 'no_match';
      result = {query, status, products, ...(issues.length && {issues})};
    } catch {
      result = {query, status:'source_failed', products:[]};
    }
    // National presentations by name can still be checked during a retailer outage.
    // A local code requires the name from this very retailer.
    const lookup = bySku ? result.products[0]?.name : query;
    if (scope === 'brazil' && lookup) {
      try {
        const national = (await nationalInfo([lookup], {scope})).results[0];
        result.brazil = national?.brazil ?? null;
        if (result.brazil?.lookupFailed || (!result.brazil && national?.status === 'source_failed'))
          result.nationalStatus = 'source_failed';
      } catch {
        result.brazil = null;
        result.nationalStatus = 'source_failed';
      }
    }
    results.push(result);
  }
  return {retailerId:retailer, scope:'retailer_catalog', page, limitPerQuery:limit, results};
}

export async function catalogSnapshot({retailer, queries, maxItems}, source, {background = true} = {}) {
  if (retailer === 'drogasil') return collectSnapshot(queries, {background, maxItems});
  // One run belongs to one retailer. The snapshot store keys rows by its local SKU.
  return collectSnapshot(queries, {background, maxItems}, {
    async search(query, {page}) {
      const rows = await source.search(query, page + 1, 50);
      const products = new Map();
      for (const row of rows) {
        if (!products.has(row.sku)) products.set(row.sku, {sku:row.sku, name:row.name, offers:[]});
        const {facts, ...offer} = row;
        const packageQuantities = values(facts?.Quantidade);
        products.get(row.sku).offers.push(packageQuantities.length ? {...offer, packageQuantities} : offer);
      }
      // VTEX paginates products and can emit several sellers per product. Read to an empty page.
      return {hits:[...products.values()], nbPages:rows.length ? page + 2 : page + 1};
    },
    async read(hit, query) {
      return {snapshot:partnerSnapshotRecord({retailerId:retailer, searchQuery:query, ...hit})};
    },
  });
}
