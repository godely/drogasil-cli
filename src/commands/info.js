import { getMedicationInfo } from '../api/medication-info.js';
import { printJson } from '../format.js';

export const usage = 'Usage: drogasil info "<medication or SKU>" ["<another medication>" ...] [--brazil] [--json]';
export const options = { brazil: { type: 'boolean' } };
const unknown = 'não confirmado';
const answer = value => value == null ? unknown : value ? 'sim' : 'não';

export async function run(queries, values) {
  if (!queries.length) { process.stderr.write(usage + '\n'); return 1; }
  const info = await getMedicationInfo(queries, { scope: values.brazil ? 'brazil' : 'catalog' });
  if (values.json) printJson(info);
  else for (const r of info.results) {
    const lines = [r.query];
    if (r.brazil) {
      lines.push(r.brazil.scope);
      for (const p of r.brazil.presentations) {
        lines.push([p.name, p.ingredient, p.strength, p.form, p.route, p.release, p.pack].filter(Boolean).join(' · '), p.source);
      }
      if (!r.brazil.presentations.length) lines.push('Apresentações nacionais: ' + unknown, r.brazil.lookup);
    }
    if (r.products.length) lines.push('Catálogo Drogasil');
    for (const p of r.products) {
      lines.push([p.name, p.type, 'SKU ' + p.sku].join(' · '));
      lines.push('Princípios ativos: ' + (p.ingredients.map(a => [a.name, a.strength ?? unknown].join(' ')).join(' + ') || unknown));
      lines.push('Forma: ' + (p.form ?? unknown) + ' · Via: ' + (p.route ?? unknown) + ' · Liberação: ' +
        (p.release ?? unknown) + ' · Embalagem: ' + (p.pack ?? unknown));
      const rx = p.prescription;
      lines.push('Precisa de receita? ' + answer(rx.required) + ' · A farmácia retém? ' + answer(rx.retained) +
        ' · Qual receituário? ' + (rx.form ?? unknown));
      if (p.source) lines.push(p.source);
      if (rx.rule) lines.push(rx.rule);
    }
    if (r.status === 'no_reference') lines.push('Medicamento não encontrado.');
    if (r.status === 'ambiguous') lines.push('Confirme o nome: ' + (r.nameCandidates ?? r.ingredientCandidates ?? []).join(', '));
    process.stdout.write(lines.join('\n') + '\n');
  }
  return info.results.every(r => r.status === 'matches') ? 0 : 3;
}
