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

// Manufacturer and trade brand are separate fields in the Drogasil catalog.
// Accept a shortened generic manufacturer only with a full name in the title.
export function genericManufacturers(products, requested) {
  const normalize = value => fold(value).replace(/[^\p{L}0-9]+/gu, ' ').trim();
  const wanted = normalize(requested);
  const shortName = /^\p{L}{4,}$/u.test(wanted) &&
    !['laboratorio','laboratorios','industria','grupo','generico','pharma','farma'].includes(wanted);
  const matches = new Map();
  for (const product of products) {
    if (medicationType(product) !== 'Genérico') continue;
    const manufacturer = product.details?.fabricante;
    if (typeof manufacturer !== 'string' || !manufacturer.trim()) continue;
    const name = normalize(manufacturer);
    if (name !== wanted && !(shortName && name.startsWith(wanted+' ') &&
        (' '+normalize(product.name)+' ').includes(' '+name+' '))) continue;
    if (!matches.has(name)) matches.set(name, {name:manufacturer, products:[]});
    matches.get(name).products.push(product);
  }
  return matches.has(wanted) ? [matches.get(wanted)] : [...matches.values()];
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
