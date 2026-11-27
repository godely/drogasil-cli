import { getProductsBySku, searchProducts } from './algolia.js';
import { resolveMedication, fold } from './medications.js';
import { medicationType } from './product-info.js';
import { brazilianPresentations, prescriptionInfo } from './regulatory-info.js';

const attributes = ['sku', 'name', 'url', 'isActive', 'brand', 'details', 'filters.Forma farmacêutica',
  'filters.Via de administração', 'filters.Marca', 'filters.Tipo de medicamento', 'filters.Medicamentos genéricos',
  'description', 'productDescription'];
const clean = text => String(text ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/\s+/g, ' ').trim();
const concentrations = text => [...text.matchAll(/\b(\d+(?:[.,]\d+)?)\s*(mcg|µg|mg|g|ui)\s*\/\s*(\d+(?:[.,]\d+)?\s*)?(ml|l|g|dose|gota)\b/gi)]
  .map(m => ({ value: Number(m[1].replace(',', '.')), unit: fold(m[2]), text: m[1].replace('.', ',') + ' ' + m[2].toLowerCase() + '/' + (m[3]?.trim() ?? '') + (m[4].toLowerCase() === 'ml' ? 'mL' : m[4].toLowerCase()) }));
function facts(product) {
  const details = product.details ?? {}, filters = product.filters ?? {};
  const title = clean(product.name);
  const description = clean(product.description);
  const body = clean(product.productDescription);
  const pack = details.quantidade ?? null;
  const label = fold([title, filters['Forma farmacêutica'], pack].join(' '));
  const sublingual = /\bsub[- ]?lingua[li]/.test(label);
  const form = sublingual ? 'Comprimido sublingual' : filters['Forma farmacêutica'] ??
    [title, pack].filter(Boolean).join(' ').match(/comprimidos?(?: revestidos?)?|c[áa]psulas?|solução oral|gotas|suspensão oral|xarope|pomada|creme/iu)?.[0] ?? null;
  const route = sublingual ? 'Sublingual' : filters['Via de administração'] ?? (label.includes('solucao oral') ? 'Oral' : null);
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
    ingredients, form, route, release, pack, source,
    prescription: prescriptionInfo(details.descricao_tarja, description || body, ingredients.map(a => a.name), route) };
}

async function lookup(query, scope) {
  const name = await resolveMedication(query);
  if (name.status === 'ambiguous') return { query, ...name, products: [] };
  let hits;
  if (name.kind === 'sku') hits = (await getProductsBySku([query], attributes)).filter(Boolean);
  else {
    const opts = { filters: name.filters ?? 'categories.id=532', hitsPerPage: 100, attributes };
    const first = await searchProducts(name.suffix, opts);
    hits = first.hits.slice();
    for (let page = 1; page < first.nbPages; page++) {
      hits.push(...(await searchProducts(name.suffix, { ...opts, page })).hits);
    }
    if (name.kind === 'text') {
      const terms = fold(query).split(/\s+/);
      hits = hits.filter(p => terms.every(term => fold(p.name).split(/[^\p{L}\d.,/]+/u).includes(term)));
    }
  }
  if (name.suffix && name.filters) {
    const doses = text => [...fold(text).matchAll(/\b(\d+(?:[.,]\d+)?)\s*(mg|mcg|g|ml|ui)\b/g)]
      .map(m => Number(m[1].replace(',', '.')) + m[2]);
    const requested = doses(name.suffix);
    if (requested.length) hits = hits.filter(p => {
      const listed = doses([p.name, ...(p.details?.dosageList ?? [])].join(' '));
      return requested.every(dose => listed.includes(dose));
    });
  }
  const products = [...new Map(hits.filter(p => p.isActive !== false).map(p => [String(p.sku), facts(p)])).values()];
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
