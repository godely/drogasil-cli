import { getProductsBySku, searchProducts } from './algolia.js';
import { resolveMedication, fold } from './medications.js';
import { medicationType } from './product-info.js';
import { brazilianPresentations, prescriptionInfo } from './regulatory-info.js';
import { catalogQuery, documentedDrops, dropSearchTerms, labelDescription, matchesRequest, requestsDrops } from './presentation-label.js';

const attributes = ['eanCode', 'sku', 'name', 'url', 'isActive', 'brand', 'details', 'filters.Forma farmacêutica',
  'filters.Via de administração', 'filters.Marca', 'filters.Tipo de medicamento', 'filters.Medicamentos genéricos',
  'description', 'productDescription'];
const clean = text => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
const concentrations = text => [...text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(mcg|µg|mg|g|ui)\s*\/\s*(\d+(?:[.,]\d+)?\s*)?(ml|l|g|dose|gota)\b/gi)]
  .map(m => ({ value: Number(m[1].replace(',', '.')), unit: fold(m[2]), text: m[1].replace('.', ',') + ' ' + m[2].toLowerCase() + '/' + (m[3]?.trim() ?? '') + (m[4].toLowerCase() === 'ml' ? 'mL' : m[4].toLowerCase()) }));
export function medicationFacts(product) {
  const details = product.details ?? {}, filters = product.filters ?? {};
  const title = clean(product.name);
  const description = clean(product.description);
  const body = clean(product.productDescription);
  const pack = details.quantidade ?? null;
  const label = fold([title, filters['Forma farmacêutica'], pack].join(' '));
  const sublingual = /\bsub[- ]?lingua[li]/.test(label);
  const form = sublingual ? 'Comprimido sublingual' : filters['Forma farmacêutica'] ??
    [title, pack].filter(Boolean).join(' ').match(/comprimidos?(?: revestidos?)?|c[áa]psulas?|solução oral|gotas|suspensão oral|xarope|pomada|creme/iu)?.[0] ?? null;
  const drops = documentedDrops(product);
  const oralLabel = drops && /\b(?:gotas (?:de uso|por via) oral|administrar por via oral)\b/.test(labelDescription(product));
  const routeField = filters['Via de administração'];
  const routeConflict = Boolean(oralLabel && routeField && !/\boral\b/.test(fold(routeField)));
  const dropForm = form && !/gotas/i.test(form) ? form + ' em gotas' : form ?? 'Gotas';
  const route = routeConflict ? null : oralLabel ? 'Oral' : sublingual ? 'Sublingual' : filters['Via de administração'] ?? (label.includes('solucao oral') ? 'Oral' : null);
  const release = label.match(/liberacao (prolongada|retardada|lenta|modificada|imediata|controlada)/)?.[1] ??
    (/\bxr\b/.test(label) ? 'prolongada' : null);
  const actives = details.activeIngredients ?? [];
  const direct = concentrations(title);
  const ingredients = actives.map(a => {
    const value = Number(String(a.dosageValue).replace(',', '.'));
    const unit = fold(a.unitOfMeasurement?.name ?? '');
    let strength = value > 0 && unit ? String(value).replace('.', ',') + ' ' + unit : null;
    if (actives.length === 1 && !unit.includes('/')) {
      const possible = direct.length ? direct : concentrations(description);
      if (!possible.length) {
        // Full descriptions can also discuss other products. Use only headings naming this presentation.
        const headings = [...String(product.productDescription ?? '').matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
        for (const [, heading] of headings) {
          if (product.brand && fold(clean(heading)).includes(fold(product.brand))) possible.push(...concentrations(clean(heading)));
        }
      }
      const candidates = [...new Set(possible.filter(c => c.value === value && c.unit === unit).map(c => c.text))];
      if (candidates.length === 1) strength = candidates[0];
      else if (/solucao|suspensao|gotas|xarope|colirio/.test(label)) strength = null;
    }
    if (actives.length > 1 && /solucao|suspensao|gotas|xarope|colirio/.test(label) && !unit.includes('/')) strength = null;
    return { name: a.description, strength };
  });
  const source = typeof product.url === 'string' && /^[\w%-][\w%./-]*\.html$/i.test(product.url) ?
    'https://www.drogasil.com.br/' + product.url : null;
  return { sku: String(product.sku), name: title, type: medicationType(product), registration: details.ms ?? null,
    ingredients, form: drops ? dropForm : form,
    route, ...(routeConflict && {routeStatus:'conflicting_evidence'}), release, pack, source,
    prescription: prescriptionInfo(details.descricao_tarja, description || body, ingredients.map(a => a.name), route) };
}

export async function infoRecords(query) {
  const name = await resolveMedication(query);
  if (name.status === 'ambiguous') return { name, hits: [] };
  let hits;
  if (name.kind === 'sku') hits = (await getProductsBySku([query], attributes)).filter(Boolean);
  else {
    const opts = { filters: name.filters ?? 'categories.id=532', hitsPerPage: 100, attributes };
    const drops = requestsDrops(query);
    const requested = catalogQuery(name.suffix);
    const term = drops ? (name.filters ? '' : dropSearchTerms(requested)) : name.suffix;
    const first = await searchProducts(term, opts);
    hits = first.hits.slice();
    for (let page = 1; page < first.nbPages; page++) {
      hits.push(...(await searchProducts(term, { ...opts, page })).hits);
    }
    if (drops) {
      hits = hits.filter(product => {
        if (!documentedDrops(product)) return false;
        const fact = medicationFacts(product);
        const evidence = {...product, filters:{...product.filters, 'Via de administração':fact.route},
          details:{...product.details, dosageList:fact.ingredients.map(ingredient => ingredient.strength)}};
        return !requested || matchesRequest(evidence, requested);
      });
    } else if (name.kind === 'text') {
      const terms = fold(query).split(/\s+/);
      hits = hits.filter(p => terms.every(term => fold(p.name).split(/[^\p{L}\d.,/]+/u).includes(term)));
    }
  }
  if (name.suffix && name.filters && !requestsDrops(query)) {
    const doses = text => [...fold(text).matchAll(/\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|g|ml|ui)\b/g)]
      .map(m => Number(m[1].replace(',', '.')) + m[2]);
    const requested = doses(name.suffix);
    if (requested.length) hits = hits.filter(p => {
      const listed = doses([p.name, ...(p.details?.dosageList ?? [])].join(' '));
      return requested.every(dose => listed.includes(dose));
    });
  }
  return { name, hits: hits.filter(product => product.isActive !== false) };
}

async function lookup(query, scope) {
  const {name, hits} = await infoRecords(query);
  if (name.status === 'ambiguous') return { query, ...name, products: [] };
  const products = [...new Map(hits.map(p => [String(p.sku), medicationFacts(p)])).values()];
  const brazil = scope === 'brazil' ? await brazilianPresentations(query, name, hits[0]) : undefined;
  return { query, status: products.length || brazil?.presentations.length ? 'matches' : 'no_reference',
    interpretation: name.interpretation, products, ...(brazil ? { brazil } : {}) };
}

export async function getMedicationInfo(input, { scope = 'catalog' } = {}) {
  const queries = Array.isArray(input) ? input : [input];
  if (!queries.length || queries.some(q => !['string', 'number'].includes(typeof q) || !String(q).trim())) throw new TypeError('Supply a medication name or SKU');
  if (!['catalog', 'brazil'].includes(scope)) throw new TypeError('scope must be catalog or brazil');
  const results = [];
  for (const q of queries) results.push(await lookup(String(q).trim(), scope));
  return { scope, results };
}
