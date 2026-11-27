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
