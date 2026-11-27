import { fold } from './medications.js';

const leafletBase = 'https://product-data.raiadrogasil.io/documents/';
const clonazepamLeaflet = 'https://www.blanver.com.br/wp-content/uploads/2021/12/Bula_Paciente_Rivotril.pdf';
const rule = 'https://anvisalegis.datalegis.net/action/ActionDatalegis.php?acao=abrirTextoAto&tipo=RDC&numeroAto=00001036&valorAno=2026&orgao=RDC%2FDC%2FANVISA%2FMS&cod_modulo=134&cod_menu=1696';
export const bulario = 'https://consultas.anvisa.gov.br/#/bulario/';
const registrations = 'https://dados.anvisa.gov.br/dados/TA_RESTRICAO_MEDICAMENTO.csv';

// Presentation facts from the cited Brazilian patient leaflets. Keep family variants separate.
const leaflets = [
  ['Frontal', 'alprazolam', 'comprimido', 'oral', 'convencional', ['0,25 mg', '0,5 mg', '1 mg', '2 mg'], '30 comprimidos', leafletBase + '12145336.pdf'],
  ['Frontal XR', 'alprazolam', 'comprimido', 'oral', 'prolongada', ['0,5 mg', '1 mg', '2 mg'], '30 comprimidos', leafletBase + '12145378.pdf'],
  ['Rivotril', 'clonazepam', 'comprimido', 'oral', null, ['0,5 mg', '2 mg'], '20 ou 30 comprimidos', clonazepamLeaflet],
  ['Rivotril', 'clonazepam', 'comprimido sublingual', 'sublingual', null, ['0,25 mg'], '30 comprimidos', clonazepamLeaflet],
  ['Rivotril', 'clonazepam', 'solução oral (gotas)', 'oral', null, ['2,5 mg/mL'], '20 mL', clonazepamLeaflet],
];

// The catalog often omits the release label for conventional tablets.
export function documentedConventionalTablet(product) {
  const ingredients = product.details?.activeIngredients;
  if (ingredients?.length !== 1 || !/^comprimidos?$/.test(fold(product.filters?.['Forma farmacêutica'] ?? ''))) return false;
  const [active] = ingredients;
  const strength = fold(String(active.dosageValue) + ' ' + (active.unitOfMeasurement?.name ?? '')).replace(',', '.');
  return leaflets.some(([brand, ingredient, form, , release, strengths, pack]) =>
    release === 'convencional' && form === 'comprimido' && fold(product.brand ?? '') === fold(brand) &&
    fold(active.description ?? '') === ingredient && fold(product.details.quantidade ?? '') === pack &&
    strengths.some(value => value.replace(',', '.') === strength));
}

const simpleOralRules = new Map([
  ['alprazolam', 'Notificação de Receita B'], ['clonazepam', 'Notificação de Receita B'],
  ['metilfenidato', 'Notificação de Receita A'], ['sibutramina', 'Notificação de Receita B2'],
  ['amitriptilina', 'Receita de Controle Especial'], ['isotretinoina', 'Notificação de Receita Especial para Retinoides de Uso Sistêmico'],
  ['talidomida', 'Notificação de Receita de Talidomida'],
]);

export function prescriptionInfo(stripe, description, ingredients, route) {
  const evidence = fold([stripe, description].filter(Boolean).join(' '));
  const retained = /(?:com|sujeit[ao] a) retencao (?:de |da )?receita/.test(evidence);
  const noRetention = /sem retencao (?:de |da )?receita/.test(evidence);
  const exempt = /isento de prescricao|venda (?:livre|sem prescricao)/.test(evidence);
  const prescribed = /venda (?:sob|so(?:b)?(?: com)?) prescricao|venda mediante (?:a )?prescricao|receita obrigatoria/.test(evidence) || retained || (noRetention && /tarjad[oa]/.test(evidence));
  const single = ingredients.length === 1 ? fold(ingredients[0]).replace(/^cloridrato de /, '').replace(/ mono(idratad[oa]|hidratad[oa])$/, '') : '';
  const oral = /^(?:uso |via )?(?:oral|sublingual)$/.test(fold(route ?? ''));
  const form = oral && simpleOralRules.get(single);
  const conflict = (exempt && prescribed) || (retained && noRetention) || (form && (exempt || noRetention));
  if (conflict) return { required: null, retained: null, form: null, conflict: true };
  if (form) return { required: true, retained: true, form, rule, verifiedOn: '2026-11-26' };
  return { required: prescribed ? true : exempt ? false : null,
    retained: noRetention || exempt ? false : retained ? true : null,
    form: exempt ? 'Isento de prescrição' : prescribed && noRetention ? 'Receita simples' : null };
}

let pendingRegistry, expires;
async function loadRegistry() {
  const response = await fetch(registrations, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('ANVISA retornou HTTP ' + response.status);
  const lines = new TextDecoder('windows-1252').decode(await response.arrayBuffer()).trim().split(/\r?\n/);
  const header = lines.shift().split(';');
  const indexes = ['NO_PRODUTO', 'NO_PRINICIPIO_ATIVO', 'DS_FORMA_FISICA'].map(key =>
    key === 'NO_PRINICIPIO_ATIVO' && header.includes('NO_PRINCIPIO_ATIVO') ? header.indexOf('NO_PRINCIPIO_ATIVO') : header.indexOf(key));
  if (indexes.includes(-1)) throw new Error('Formato de registro ANVISA desconhecido');
  const forms = new Map();
  for (const line of lines) {
    const columns = line.split(';');
    if (columns.length !== header.length) continue;
    const [name, ingredient, form] = indexes.map(i => columns[i].trim());
    if (!name || !form) continue;
    const record = { name, ingredient, form };
    forms.set(JSON.stringify(record), record);
  }
  return [...forms.values()];
}
function registry() {
  if (!pendingRegistry || Date.now() >= expires) {
    expires = Date.now() + 86400000;
    pendingRegistry = loadRegistry().catch(error => { pendingRegistry = undefined; throw error; });
  }
  return pendingRegistry;
}

const compact = text => fold(text).replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)\s+(?=mg|ml|mcg)/g, '$1');

export async function brazilianPresentations(query, resolved, skuProduct) {
  const name = fold(resolved?.name ?? query);
  const suffix = resolved?.name ? compact(resolved.suffix) : '';
  const exactSku = /^\d+$/.test(query);
  const matchName = exactSku ? fold(skuProduct?.filters?.Marca ?? '') : name;
  const skuName = compact(skuProduct?.name ?? '');
  const skuForm = fold(skuProduct?.filters?.['Forma farmacêutica'] ?? '');
  const presentations = [];
  for (const [brand, ingredient, form, route, release, strengths, pack, source] of leaflets) {
    if (![fold(brand), fold(brand.split(' ')[0]), ingredient].includes(matchName)) continue;
    if (exactSku && (!skuName.startsWith(compact(brand) + ' ') ||
        skuName.includes(' xr ') !== (release === 'prolongada') ||
        skuForm.includes('sublingual') !== (route === 'sublingual') ||
        skuForm.includes('solucao') !== form.includes('solução'))) continue;
    for (const strength of strengths) {
      const description = compact([brand, strength, form, route, release, pack].join(' '));
      if (exactSku) {
        const reg = String(skuProduct?.details?.ms ?? '').slice(0, 9);
        if (brand.startsWith('Frontal') ? reg !== '188300091' : !['115240011', '101000072'].includes(reg)) continue;
        const numerator = compact(strength).split('/')[0];
        if (!skuName.split(/[^a-z0-9.]+/).includes(numerator)) continue;
      }
      if (suffix && !suffix.split(/\s+/).every(term => description.split(/[^a-z0-9./]+/).includes(term))) continue;
      const skuLeaflet = exactSku && String(skuProduct?.details?.ms).startsWith('101000072') ?
        'https://img.drogasil.com.br/raiadrogasil_bula/RIVOTRIL.pdf' : source;
      presentations.push({ name: brand, ingredient, form, route, release, strength,
        pack: exactSku ? skuProduct.details.quantidade : pack, source: skuLeaflet });
    }
  }
  const result = { presentations, scope: 'Apresentações documentadas no Brasil. Cobertura parcial.', lookup: bulario };
  if (presentations.length || exactSku || suffix) return result;
  try {
    // The registration export lacks strength units and pack identifiers. Report only the facts it establishes.
    for (const record of await registry()) {
      if ([fold(record.name), fold(record.ingredient)].includes(matchName) ||
          [fold(record.name), fold(record.ingredient)].includes(fold(query))) {
        presentations.push({ ...record, source: registrations });
      }
    }
  } catch { result.lookupFailed = true; }
  return result;
}
