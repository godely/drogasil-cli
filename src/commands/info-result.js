const unknown = 'não confirmado';
const yesNo = value => value == null ? unknown : value ? 'sim' : 'não';
const list = value => [value].flat().filter(Boolean).join(', ') || unknown;

export function renderInfoResult(result, retailer) {
  const lines = [result.query];
  const national = result.brazil;
  if (national) {
    lines.push(national.scope);
    for (const p of national.presentations) {
      lines.push([p.name, p.ingredient, p.strength, p.form, p.route, p.release, p.pack].filter(Boolean).join(' · '), p.source);
    }
    if (!national.presentations.length && !national.lookupFailed)
      lines.push('Apresentações nacionais: ' + unknown, national.lookup);
  }
  if (result.nationalStatus === 'source_failed' || national?.lookupFailed)
    lines.push('Falha ao consultar as apresentações nacionais.', national?.lookup);

  if (result.products.length || result.unconfirmedProducts?.length) lines.push('Catálogo ' + retailer);
  for (const p of [...result.products, ...(result.unconfirmedProducts ?? [])]) {
    lines.push([p.name, p.type].filter(Boolean).join(' · '));
    if (p.manufacturer) lines.push('Fabricante: ' + p.manufacturer);
    if (p.manufacturerClaims?.length) lines.push('Fabricante não confirmado. As fontes citam ' +
      p.manufacturerClaims.map(claim => claim.name).join(' e ') + '.');
    if (p.ingredients) {
      lines.push('Princípios ativos: ' + (p.ingredients.map(a => [a.name, a.strength ?? unknown].join(' ')).join(' + ') || unknown));
    } else {
      lines.push('Princípios ativos: ' + list(p.activeIngredients), 'Concentração: ' + list(p.strengths));
    }
    const route = p.routeStatus === 'conflicting_evidence' ? 'não confirmada (informações divergentes na ficha)' :
      p.routes?.length > 1 ? 'não confirmada (a ficha lista ' + list(p.routes) + ')' : list(p.route ?? p.routes);
    lines.push('Forma: ' + list(p.form ?? p.forms) + ' · Via: ' + route,
      'Liberação: ' + list(p.release) + ' · Embalagem: ' + list(p.pack ?? p.packs));
    const rx = p.prescription;
    lines.push('Precisa de receita? ' + yesNo(rx.required) + ' · A farmácia retém? ' + yesNo(rx.retained) +
      ' · Qual receituário? ' + (rx.form ?? unknown));
    if (rx.conflict) lines.push('As fontes divergem sobre a receita.');
    for (const url of new Set([p.source, p.presentationSource, p.manufacturerSource,
      ...(p.manufacturerClaims ?? []).map(claim => claim.url), rx.rule, rx.stripeRule].filter(Boolean))) lines.push(url);
  }
  if (result.status === 'source_failed') lines.push('Falha ao consultar o catálogo de ' + retailer + '.');
  if (result.status === 'partial') lines.push('Consulta parcial ao catálogo de ' + retailer + '.');
  if (['unknown_sku','no_match','no_reference'].includes(result.status))
    lines.push('Nenhuma apresentação encontrada no catálogo de ' + retailer + '.');
  if (result.status === 'ambiguous') lines.push('Confirme o nome: ' + (result.nameCandidates ?? result.ingredientCandidates ?? []).join(', '));
  return lines.filter(Boolean).join('\n');
}

export function infoExitCode(results) {
  if (results.some(r => ['source_failed','partial'].includes(r.status) || r.nationalStatus === 'source_failed' || r.brazil?.lookupFailed)) return 2;
  return results.every(r => r.status === 'matches' || r.brazil?.presentations.length) ? 0 : 3;
}
