import { getAddress, listStores } from './graphql.js';
import { normalizeOrigin } from './compare.js';
import { haversineKm, parseCoords } from '../geo.js';

const source = 'https://www.drogasil.com.br/nossas-lojas';
const areaKey = value => String(value ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

function describeStore(store, point) {
  const address = store.address ?? {};
  const contacts = String(store.telephone ?? '').split('/').map(s => s.trim()).filter(s => /^\d{8,9}$/.test(s))
    .map(s => /^\d{2}$/.test(store.telephoneAreaCode) ? '(' + store.telephoneAreaCode + ') ' + s : s);
  const hours = store.labelAttendance;
  const openingHours = (Array.isArray(hours) ? hours : [hours]).filter(s => typeof s === 'string' && s.trim());
  const row = {...store, displayName:store.fantasyName?.trim() || store.storeName, openingHours, phone:contacts[0] ?? null, phones:contacts};
  if (point) {
    row.distanceKm = null;
    if (address.latitude != null && address.longitude != null) {
      try { row.distanceKm = haversineKm(point, parseCoords(address.latitude,address.longitude)); }
      catch { /* A store without usable coordinates stays at the end. */ }
    }
  }
  return row;
}

export async function getStoreDirectory(location, { read = listStores, addressFor = getAddress } = {}) {
  const origin = normalizeOrigin(location);
  if (origin?.zipcode && (!/^\d{5}-?\d{3}$/.test(location.zipcode) || /^0{8}$/.test(origin.zipcode))) throw new TypeError('Invalid CEP');
  let scope = 'national';
  let area;
  if (origin?.zipcode) {
    area = await addressFor(origin.zipcode);
    if (!areaKey(area?.ufSg) || !areaKey(area?.locationName)) {
      return {status:'location_unconfirmed', scope:'postal_area', order:'directory', source, stores:[]};
    }
    scope = areaKey(area.neighborhoodName) ? 'neighborhood' : 'city';
  }
  const records = await read({detailed:true});
  const selected = area ? records.filter(({address:a}) => areaKey(a?.regionId) === areaKey(area.ufSg) &&
    areaKey(a?.cityName) === areaKey(area.locationName) &&
    (scope === 'city' || areaKey(a?.neighborhood) === areaKey(area.neighborhoodName))) : records;
  const point = origin && !origin.zipcode ? origin : undefined;
  const stores = selected.map(store => describeStore(store, point));
  if (point) stores.sort((a,b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || String(a.id).localeCompare(String(b.id)));
  return {status:'checked', scope, order:point ? 'straight_line_distance' : 'directory', source, stores};
}
