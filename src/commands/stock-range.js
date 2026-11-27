import { createInterface } from 'node:readline/promises';
import { STOCK_RADIUS_KM } from '../api/stock-search.js';
import { formatAddress, table } from '../format.js';

const distance = km => km.toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' km';

export function describeRange({ coverage, expandedSearch: wider }) {
  const lines = [];
  if (coverage?.allZero) {
    const reach = coverage.radiusKm == null ? '' : ' (a mais distante a ' + coverage.radiusKm.toLocaleString('pt-BR', { maximumFractionDigits: 3 }) + ' km' + ' em linha reta)';
    const initial = coverage.checkedStores === 1 ? 'na única filial consultada inicialmente' : 'nas ' + coverage.checkedStores + ' filiais consultadas inicialmente';
    lines.push('Estoque zero ' + initial + reach + '.');
  }
  if (wider) {
    lines.push('Busca até ' + wider.radiusKm + ' km em linha reta. Filiais participantes verificadas: ' + wider.checkedStores + '.');
    if (wider.partial) lines.push('Cobertura parcial. Algumas filiais ou quantidades ficaram sem confirmação.');
    if (wider.stores.length) {
      const rows = wider.stores.map(s => [s.name, (wider.distanceEstimated ? '≈ ' : '') + distance(s.distanceKm),
        s.stocks.map(p => p.sku + ' × ' + p.quantity).join(', '), formatAddress(s.address), s.phone || '—']);
      lines.push(table(['Farmácia', 'Distância', 'SKU × estoque', 'Endereço', 'Telefone'], rows), wider.advice);
    } else {
      lines.push('Nenhuma filial com a quantidade pedida foi confirmada na busca ampliada.');
    }
  }
  return lines.length ? lines.join('\n') + '\n' : '';
}

export async function acceptExpansion(coverage, interactive) {
  if (!coverage?.canExpand) return false;
  const question = 'Quer ampliar a busca para até ' + STOCK_RADIUS_KM + ' km?';
  if (!interactive || !process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write(question + ' Para aceitar, repita o comando com --expand.\n');
    return false;
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^(sim|s|yes|y)$/i.test((await prompt.question(question + ' [s/N] ')).trim());
  } finally { prompt.close(); }
}
