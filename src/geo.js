// The API's distanceKMFromSearch is plain haversine over the directory
// coordinates, so distances can be recomputed offline against any origin.

const EARTH_RADIUS_KM = 6371.0088;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle distance in kilometres between two lat/lon points.
 * @param {{ latitude: number, longitude: number }} a
 * @param {{ latitude: number, longitude: number }} b
 */
export function haversineKm(a, b) {
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(s));
}

// Number('') and Number('  ') are 0, which would turn a missing value into a
// valid point in the Gulf of Guinea. Treat blank input as not-a-number.
function toNumber(raw) {
  if (typeof raw === 'string' && raw.trim() === '') return NaN;
  return Number(raw);
}

/**
 * Convert separate latitude and longitude values (strings or numbers) into
 * numbers, validating ranges. Throws on blank, non-numeric or out-of-range input.
 * @param {string|number} lat
 * @param {string|number} lon
 */
export function parseCoords(lat, lon) {
  const latitude = toNumber(lat);
  const longitude = toNumber(lon);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new Error(`invalid latitude: ${JSON.stringify(lat)}`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error(`invalid longitude: ${JSON.stringify(lon)}`);
  }
  return { latitude, longitude };
}
