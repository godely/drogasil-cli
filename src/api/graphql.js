// Everything that is not search or price: the product-hub GraphQL endpoint.

import { postJson } from './http.js';

const ENDPOINT = 'https://www.drogasil.com.br/api/next/product-hub/graphql';
const GRAPHQL_HEADERS = { origin: 'https://www.drogasil.com.br' };

// Project decision: always DROGASIL. Droga Raia stores are not wanted, and
// filtering server side spends the whole branch window on relevant stores.
export const LOGOTYPE = 'DROGASIL';

export class GraphQLError extends Error {
  constructor(errors) {
    super(errors.map((e) => e.message).join('; '));
    this.name = 'GraphQLError';
    this.errors = errors;
  }
}

/**
 * True when the API answered "not found": the resolver reports HTTP 404 in
 * `extensions.exception.status`. Both "Filial próxima sem estoque" and
 * "Endereço não encontrado!" arrive this way, with `data: null`.
 */
export function isNotFound(err) {
  return (
    err instanceof GraphQLError &&
    err.errors.some((e) => e.extensions?.exception?.status === 404)
  );
}

/** True when the API says no branch in the searched window met the threshold. */
export function isNoNearbyStock(err) {
  return err instanceof GraphQLError && err.errors.length > 0 &&
    err.errors.every(e => /sem estoque/i.test(e.message ?? ''));
}

/**
 * Low-level GraphQL call. Throws GraphQLError when `errors` is present.
 * @param {string} query
 * @param {Record<string, unknown>} [variables]
 * @returns {Promise<any>} the `data` object
 */
export async function gql(query, variables = {}) {
  const json = await postJson(ENDPOINT, { query, variables }, GRAPHQL_HEADERS);
  if (json?.errors?.length) throw new GraphQLError(json.errors);
  return json?.data ?? null;
}

// Branch fields the stock commands care about. Note `hourOpenSaTurday` with a
// capital T: that is the real schema field name.
const BRANCH_FIELDS = `
  branch {
    id
    businessName
    distanceKMFromSearch
    address { addressLocal addressNumber district city sgState }
    branchService {
      hourOpenNormaly hourEndNormaly
      hourOpenSaTurday hourEndSaturday
      hourOpenSunday hourEndSunday
      isOpen
    }
  }
  stocks { sku quantity }
`;

/**
 * Nearest participating branches to an exact point. Preferred stock query.
 * Pass `quantity` to filter to branches with stock >= quantity; omit it for
 * discovery calls that need the zero-stock rows too.
 * Throws GraphQLError (see isNoNearbyStock) when nothing meets the threshold.
 * An unknown SKU produces the same "sem estoque" answer; check the SKU with
 * Algolia if that distinction matters.
 *
 * @param {{ sku: string, latitude: number|string, longitude: number|string, quantity?: number }} p
 * @returns {Promise<any[]>}
 */
export async function getNearbyStockByLatLong({ sku, latitude, longitude, quantity }) {
  const product = { sku: String(sku) };
  if (quantity != null) product.quantity = quantity;
  const data = await gql(
    `query Q($p: [StockNearbyBtZipCodeTypeInput!]!, $lat: String!, $lon: String!, $logo: String!) {
      getNearbyStockByLatLong(products: $p, latitude: $lat, longitude: $lon, logotype: $logo) {
        ${BRANCH_FIELDS}
      }
    }`,
    { p: [product], lat: String(latitude), lon: String(longitude), logo: LOGOTYPE },
  );
  return data?.getNearbyStockByLatLong ?? [];
}

/**
 * Same question from a CEP. Fallback for when no coordinates are available.
 * `maxBranches` is "3".."30" and caps branches searched, not rows returned.
 * Do NOT use the V2 field: it silently ignores `quantity`.
 *
 * @param {{ sku: string, zipcode: string, quantity?: number, maxBranches?: number }} p
 * @returns {Promise<any[]>}
 */
export async function getNearbyStockByZipCode({ sku, zipcode, quantity, maxBranches = 30 }) {
  const product = { sku: String(sku) };
  if (quantity != null) product.quantity = quantity;
  const data = await gql(
    `query Q($p: [StockNearbyBtZipCodeTypeInput!]!, $z: String!, $logo: String!, $max: String) {
      getNearbyStockByZipCode(products: $p, zipcode: $z, logotype: $logo, maxQuantityBranchSearch: $max) {
        ${BRANCH_FIELDS}
      }
    }`,
    { p: [product], z: normalizeCep(zipcode), logo: LOGOTYPE, max: String(maxBranches) },
  );
  return data?.getNearbyStockByZipCode ?? [];
}

// The directory was 2292 stores when measured, well under one page. Keep
// paging anyway so growth past the page size is not silently truncated.
const STORES_PAGE_SIZE = 3000;

/**
 * Full store directory: every DROGASIL store with coordinates.
 * `id` matches `branch.id` in the stock queries.
 * @returns {Promise<Array<{ id: number, storeName: string, address: { street: string, number: string, cityId: number, latitude: number, longitude: number } }>>}
 */
export async function listStores({ detailed = false } = {}) {
  const fields = detailed ? 'fantasyName labelAttendance' : '';
  const addressFields = detailed ? 'regionId cityName neighborhood postcode' : '';
  const items = [];
  for (let page = 1; ; page++) {
    const data = await gql(
      `{ stores(input: { currentPage: ${page}, pageSize: ${STORES_PAGE_SIZE} }) {
          items { id storeName telephone telephoneAreaCode ${fields} address { street number cityId latitude longitude ${addressFields} } }
        } }`,
    );
    const batch = data?.stores?.items;
    if (!Array.isArray(batch)) throw new GraphQLError([{ message: 'Unexpected store directory response' }]);
    items.push(...batch);
    if (batch.length < STORES_PAGE_SIZE) return items;
  }
}

/**
 * CEP validation and address lookup. Results are stable and cacheable.
 * Resolves to null for a well-formed CEP the API does not know.
 * @param {string} zipcode
 * @returns {Promise<{ ufSg: string, locationName: string, neighborhoodName: string, streetName: string, zipCode: string } | null>}
 */
export async function getAddress(zipcode) {
  try {
    const data = await gql(
      `query A($z: String!) { getAddress(zipCode: $z) { ufSg locationName neighborhoodName streetName zipCode } }`,
      { z: normalizeCep(zipcode) },
    );
    return data?.getAddress ?? null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

/** Strip everything but digits: "01001-000" -> "01001000". */
export function normalizeCep(cep) {
  const digits = String(cep).replace(/\D/g, '');
  if (digits.length !== 8) throw new Error(`invalid CEP: ${cep}`);
  return digits;
}
