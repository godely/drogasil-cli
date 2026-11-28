import { createInterface } from 'node:readline/promises';
import { acceptExpansion, describeRange } from './stock-range.js';
import { planPurchase, tableLabel } from '../api/purchase.js';
import { normalizeOrigin } from '../api/compare.js';
import { optionError, formatAddress, formatKm, formatPrice, printJson, table } from '../format.js';

export const usage = `Usage: drogasil plan "<medication A>" ["<medication B>" ...] (--cep CEP | --lat LAT --lon LON)
  [--store nearest | --expand] [--quantity A=2] [--sku A=123] [--brand B=Frontal] [--generic B] [--brand-only A | --include-generics A] [--json]
Quote each medication separately. Preferences apply to the indicated table letter.`;
export const options = { cep: { type: 'string' }, lat: { type: 'string' }, lon: { type: 'string' },
  expand: { type: 'boolean' }, store: { type: 'string' }, ...Object.fromEntries(['quantity', 'brand', 'generic', 'sku', 'brand-only', 'include-generics'].map(k =>
    [k, { type: 'string', multiple: true }])) };

const issues = { no_reference: 'Apresentação não encontrada', conflicting_release: 'Confirme o tipo de liberação',
  ambiguous: 'Qual apresentação?', presentation_options: 'Qual apresentação?', preference_unavailable: 'Preferência indisponível',
  catalog_lookup_failed: 'Falha na consulta ao catálogo' };

export function renderPurchase(result) {
  if (result.status === 'needs_generic_preference') {
    const brands = result.pendingBrands.map(p => p.label + ' (' + p.name + ')').join(', ');
    return 'Quer que eu veja também os genéricos na mesma apresentação de ' + brands + '? Eles podem custar menos.\n';
  }
  const out = [];
  for (const t of result.tables) {
    out.push(t.label + '. ' + t.query + (t.quantity > 1 ? ' × ' + t.quantity : '') + (t.selectedSku ? ' · SKU ' + t.selectedSku : ''));
    const requested = new Set(t.requestedBrandSkus);
    const notes = [['unavailable', 'Sem estoque suficiente'], ['unknown', 'Estoque desconhecido'], ['failed', 'Falha na consulta de estoque']];
    function showNotes(brandFirst) {
      for (const [key, label] of notes) {
        const products = t[key].filter(p => requested.has(p.sku) === brandFirst);
        if (products.length) out.push(label + ': ' + products.map(p => p.name + ' (' + p.type + ')').join(', '));
      }
    }
    showNotes(true);
    const only = t.rows.length === 1 && (t.includeGenerics === false || (t.includeGenerics === undefined && t.brand)) && t.rows[0].option ? t.rows[0] : null;
    if (only) {
      out.push(only.name + ' (' + only.type + ') está disponível em ' + only.store.name +
        ' (' + (formatKm(only.store.distanceKm) || 'distância desconhecida') + '), com preço de referência ' +
        (formatPrice(only.referencePriceBRL) || 'não informado') + ' e ' + only.store.quantity + ' unidade(s) em estoque.');
    } else if (t.rows.length) out.push(table(['#', 'Medicamento', 'Tipo', 'Farmácia', 'Distância', 'Preço de referência', 'Qtd. em estoque'],
      t.rows.map(p => [p.option ?? '—', p.name, p.type, p.store?.name ?? '—', formatKm(p.store?.distanceKm) || '—',
        formatPrice(p.referencePriceBRL) || 'Não informado', p.store?.quantity ?? 'Desconhecida'])));
    showNotes(false);
    if (issues[t.status]) out.push(issues[t.status]);
    if (t.candidates?.length) out.push(table(['SKU', 'Medicamento', 'Tipo'], t.candidates.map(p => [p.sku, p.name, p.type])));
    if (t.nameCandidates?.length) out.push(t.nameCandidates.join(', '));
    if (t.missingFields) out.push('Equivalência não verificada. Campos ausentes: ' + t.missingFields.join(', '));
    if (t.needsSelection) out.push('Escolha uma apresentação para o plano.');
    out.push('');
  }
  for (const plan of result.plans) {
    out.push((result.searchComplete ? '' : 'Melhor plano encontrado · ') + plan.label + (plan.unfilled.length ? ' · parcial' : '') + ' — ' +
      [plan.stopCount + ' parada(s)', (formatKm(plan.roundTripKm) || 'distância desconhecida') + ' ida e volta',
        formatPrice(plan.totalBRL) || 'total desconhecido'].join(' · '));
    for (const [i, stop] of plan.stops.entries()) {
      out.push((i + 1) + '. ' + stop.name + ' · ' + formatAddress(stop.address));
      for (const p of stop.pickups) out.push('   ' + p.option + ' ' + p.packs + ' × ' + p.name + ' (' + p.type + ')');
    }
    if (plan.unfilled.length) out.push('Fora deste plano: ' + plan.unfilled.join(', '));
    out.push('');
  }
  if (result.tradeoff) {
    const d = result.tradeoff;
    out.push('Economia estimada: ' + formatPrice(d.savingsBRL) + ' · diferença de paradas: ' + d.extraStops +
      (d.extraKm == null ? '' : ' · diferença de percurso: ' + formatKm(d.extraKm)));
  }
  if (result.plans.length) out.push('Comparação entre as filiais consultadas. Ida e volta em linha reta. Preços de referência do catálogo.');
  if (!result.searchComplete || result.directoryFailed) out.push('Não foi possível confirmar a otimização completa de preço e percurso.');
  if (result.priceIncomplete) out.push('Há preços desconhecidos. A comparação de totais considera os preços disponíveis.');
  if (result.stockIncomplete && result.plans.length) out.push('Planos consideram somente estoque confirmado.');
  if (result.scope !== 'nearest') out.push(describeRange(result));
  return out.join('\n').trimEnd() + '\n';
}

function itemsFromArgs(queries, values) {
  const items = queries.map(query => ({ query }));
  const labels = items.map((_, i) => tableLabel(i));
  for (const key of ['quantity', 'sku', 'brand', 'generic', 'brand-only', 'include-generics']) {
    for (const arg of values[key] ?? []) {
      const match = ['generic', 'brand-only', 'include-generics'].includes(key) ? /^([A-Z]+)$/i.exec(arg) : /^([A-Z]+)=(.+)$/i.exec(arg);
      const item = match && items[labels.indexOf(match[1].toUpperCase())];
      if (!item) throw new TypeError('Invalid table preference: ' + arg);
      if (key === 'generic') item.genericOnly = true;
      if (key === 'brand-only' || key === 'include-generics') {
        if (item.includeGenerics !== undefined) throw new TypeError('Conflicting generics preference: ' + arg);
        item.includeGenerics = key === 'include-generics';
      }
      if (key === 'sku') item.selectedSku = match[2];
      if (key === 'brand') item.brand = match[2];
      if (key === 'quantity') item.quantity = Number(match[2]);
    }
  }
  return items;
}

// Translate against the table the user actually saw, before refreshing stock.
export function applySelections(items, tables, answer) {
  const selected = items.map(item => ({ ...item }));
  for (const token of answer.trim().toUpperCase().split(/[,\s]+/).filter(Boolean)) {
    const index = tables.findIndex(t => t.rows.some(p => p.option === token));
    if (index < 0) throw new TypeError('Opção inválida: ' + token);
    selected[index].selectedSku = tables[index].rows.find(p => p.option === token).sku;
  }
  return selected;
}

export async function run(positionals, values) {
  if (!positionals.length) { process.stderr.write(usage + '\n'); return 1; }
  try {
    const origin = normalizeOrigin({ zipcode: values.cep, latitude: values.lat, longitude: values.lon });
    let items = itemsFromArgs(positionals, values);
    if (values.expand && values.store) throw new TypeError('--expand requires a search across stores');
    const opts = { origin, store: values.store, expandSearch: values.expand, confirmBrands: true };
    let result = await planPurchase(items, opts);
    if (result.status === 'needs_generic_preference' && !values.json && process.stdin.isTTY && process.stdout.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const labels = result.pendingBrands.map(p => p.label);
      try {
        for (;;) {
          const reply = (await rl.question(renderPurchase(result) + 'Responda sim, não ou as letras desejadas: ')).trim().toUpperCase();
          const chosen = reply === 'SIM' ? labels : /^(NÃO|NAO)$/.test(reply) ? [] : reply.split(/[,\s]+/);
          if (chosen.some(label => !labels.includes(label))) continue;
          items = items.map((item, i) => labels.includes(tableLabel(i)) ?
            { ...item, includeGenerics: chosen.includes(tableLabel(i)) } : item);
          break;
        }
      } finally { rl.close(); }
      result = await planPurchase(items, opts);
    }
    if (values.json) printJson(result);
    else {
      process.stdout.write(renderPurchase(result));
      if (await acceptExpansion(result.coverage, true)) {
        opts.expandSearch = true;
        result = await planPurchase(items, opts);
        process.stdout.write(renderPurchase(result));
      }
      if (items.length > 1 && process.stdin.isTTY && process.stdout.isTTY && result.tables.some(t => t.rows.some(p => p.option))) {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        try {
          for (;;) {
            const answer = (await rl.question('Alguma preferência? Ex.: A2, B1 (Enter = sem preferência): ')).trim();
            if (!answer || /^sem prefer[eê]ncia$/i.test(answer)) break;
            try { items = applySelections(items, result.tables, answer); }
            catch (err) { process.stderr.write(err.message + '\n'); continue; }
            result = await planPurchase(items, opts);
            process.stdout.write(renderPurchase(result));
            break;
          }
        } finally { rl.close(); }
      }
    }
    if (result.status === 'needs_generic_preference' && !values.json) {
      process.stderr.write('Informe --brand-only A ou --include-generics A para cada marca.\n');
    }
    return purchaseExitCode(result);
  } catch (error) {
    if (!(error instanceof TypeError) && !/invalid (CEP|latitude|longitude)|either --cep/.test(error.message)) throw error;
    return optionError(error.message, values.json);
  }
}

export function purchaseExitCode(result) {
  if (result.tables.some(t => t.status === 'catalog_lookup_failed' || t.failed.length)) return 2;
  return result.status === 'complete' ? 0 : 3;
}
