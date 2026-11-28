import { getStoreDirectory } from '../api/index.js';
import { normalizeOrigin } from '../api/compare.js';
import { formatKm, optionError, printJson, table } from '../format.js';

export const usage = 'Usage: drogasil stores [--cep CEP | --lat LAT --lon LON] [--json]';
export const options = { cep:{type:'string'}, lat:{type:'string'}, lon:{type:'string'} };

export async function run(positionals, values) {
  if (positionals.length) return optionError(usage, values.json);
  let origin;
  try {
    if (values.cep != null || values.lat != null || values.lon != null) {
      if (values.cep != null && (!/^\d{5}-?\d{3}$/.test(values.cep) || /^0{5}-?0{3}$/.test(values.cep))) throw new TypeError('Invalid CEP');
      origin = normalizeOrigin({zipcode:values.cep, latitude:values.lat, longitude:values.lon});
    }
  } catch (error) { return optionError(error.message, values.json); }
  const directory = await getStoreDirectory(origin);
  if (values.json) printJson(directory.stores);
  else {
    const rows = directory.stores.map(s => [s.id, s.displayName, [s.address?.street, s.address?.number].filter(Boolean).join(', '),
      s.address?.latitude, s.address?.longitude, formatKm(s.distanceKm), s.openingHours.join(' / '), s.phones.join(' / ')]);
    console.log(table(['ID', 'NAME', 'ADDRESS', 'LAT', 'LON', 'DISTANCE', 'HORÁRIO', 'TELEFONE'], rows));
    console.log(directory.stores.length + ' stores');
  }
  if (directory.status === 'location_unconfirmed') console.error('A Drogasil não identificou a localidade desse CEP.');
  else if (origin?.zipcode) console.error(directory.scope === 'city' ? 'Filiais no município do CEP.' : 'Filiais no bairro do CEP.');
  return directory.stores.length ? 0 : 3;
}
