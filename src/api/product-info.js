import { fold } from './medications.js';

export function medicationType(product) {
  const filters = product.filters ?? {};
  const details = product.details ?? {};
  const types = [filters['Medicamentos genéricos'], details.medicamentos_genéricos,
    filters['Tipo de medicamento'], details.tipo_de_medicamento].filter(Boolean).map(fold);
  if (types.some(type => /^generic[oa]s?$/.test(type)) ||
      /\bgeneric[oa]\b/.test(fold(product.name ?? ''))) return 'Genérico';
  if (types.some(type => /^(medicamento )?similar$/.test(type))) return 'Similar';
  if (types.some(type => /^(medicamento (de )?)?referencia$/.test(type))) return 'Referência';
  return 'Não informado';
}

export function productInfo(product) {
  return { sku: String(product.sku), name: product.name, brand: product.brand,
    referencePriceBRL: product.price, pack: product.details?.quantidade, type: medicationType(product) };
}

// Input order is the catalog's price order. Partition it without changing order within each group.
export function brandOptions(products, requestedSkus, includeGenerics) {
  if (includeGenerics === undefined) return products;
  const named = new Set(requestedSkus);
  const branded = products.filter(p => named.has(String(p.sku)));
  if (!includeGenerics || !named.size) return branded;
  return branded.concat(products.filter(p => !named.has(String(p.sku)) && medicationType(p) === 'Genérico'));
}
