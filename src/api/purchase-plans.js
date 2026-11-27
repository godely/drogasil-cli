// Compare monetary values in centavos. Distances stay unrounded until display.
import { haversineKm } from '../geo.js';

function rank(a, b) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

function routeFinder(stores, coordinates) {
  const routes = new Map();
  return function tour(storeIds) {
    const ids = Array.from(storeIds).sort();
    const key = ids.join(',');
    if (routes.has(key)) return routes.get(key);
    const fromOrigin = ids.map(id => stores.get(id).distanceKm);
    // A single stop uses the stock service's distance directly, even for a CEP.
    let result = { ids, km: null, exact: false };
    if (ids.length === 1 && fromOrigin[0] != null) {
      result = { ids, km: 2 * fromOrigin[0], exact: true };
    } else if (fromOrigin.every(x => x != null) && ids.every(id => coordinates.has(id))) {
      const legs = ids.map(id => ids.map(other => haversineKm(coordinates.get(id), coordinates.get(other))));
      if (ids.length <= 10) {
        // Held–Karp for this set of stops. Retain predecessors for the visit order.
        const memo = new Map();
        function path(mask, last) {
          const index = mask * ids.length + last;
          if (memo.has(index)) return memo.get(index);
          const rest = mask ^ (1 << last);
          let best = { km: rest ? Infinity : fromOrigin[last], prev: -1 };
          for (let i = 0; i < ids.length; i++) {
            if (!(rest & (1 << i))) continue;
            const km = path(rest, i).km + legs[i][last];
            if (km < best.km) best = { km, prev: i };
          }
          memo.set(index, best);
          return best;
        }
        let mask = (1 << ids.length) - 1;
        const totals = ids.map((_, i) => path(mask, i).km + fromOrigin[i]);
        const km = Math.min(...totals);
        const order = [];
        let last = totals.indexOf(km);
        while (last >= 0) {
          order.push(ids[last]);
          const prev = path(mask, last).prev;
          mask ^= 1 << last;
          last = prev;
        }
        result = { ids: order.reverse(), km, exact: true };
      } else {
        // Keep large requests usable on the Jetson. Mark this itinerary as estimated.
        const remaining = new Set(ids.keys());
        let last = -1, km = 0;
        const order = [];
        while (remaining.size) {
          const distances = last < 0 ? fromOrigin : legs[last];
          const next = [...remaining].reduce((a, b) => distances[a] <= distances[b] ? a : b);
          km += distances[next];
          order.push(ids[next]);
          remaining.delete(next);
          last = next;
        }
        result = { ids: order, km: km + fromOrigin[last], exact: false };
      }
    }
    if (routes.size < 4096) routes.set(key, result);
    return result;
  };
}

// Each line requests one presentation from one branch. Choices retain stock for
// every branch, even when the compact table shows only the nearest one.
export function optimizePlans(lines, coordinates) {
  const stores = new Map();
  const uses = new Map();
  for (const line of lines) {
    for (const sku of new Set(line.choices.map(c => c.sku))) uses.set(sku, (uses.get(sku) ?? 0) + 1);
  }
  const items = lines.filter(l => l.choices.length).map(line => {
    // Within a branch a more expensive SKU cannot improve either objective,
    // unless another line competes for the cheaper SKU's stock.
    const best = new Map();
    for (const c of line.choices) {
      stores.set(c.store.id, c.store);
      const key = c.store.id + ':' + (uses.get(c.sku) > 1 ? c.sku : '*');
      const old = best.get(key);
      if (!old || c.cost < old.cost) best.set(key, c);
    }
    return { ...line, choices: [...best.values()].sort((a, b) =>
      a.cost - b.cost || (a.store.distanceKm ?? Infinity) - (b.store.distanceKm ?? Infinity)) };
  }).sort((a, b) => a.choices.length - b.choices.length);
  if (!items.length) return { plans: [], searchComplete: true };
  const minRemaining = Array(items.length + 1).fill(0);
  for (let i = items.length - 1; i >= 0; i--) minRemaining[i] = minRemaining[i + 1] + items[i].choices[0].cost;
  const tour = routeFinder(stores, coordinates);
  const used = new Map(), stops = new Set(), picked = [];
  let fewest, cheapest, nodes = 0, exhausted = false, distancesComplete = true;
  const deadline = performance.now() + 1800;
  function record(cost) {
    if (!picked.length) return;
    if (fewest && picked.length === fewest.picks.length && stops.size > fewest.route.ids.length &&
        rank([cost, stops.size], [cheapest.cost, cheapest.route.ids.length]) > 0) return;
    const route = tour(stops);
    distancesComplete &&= route.exact;
    const coverage = -picked.length;
    const distance = route.km ?? Infinity;
    const few = [coverage, stops.size, distance, cost];
    const cheap = [coverage, cost, stops.size, distance];
    const result = { picks: [...picked], route, cost };
    if (!fewest || rank(few, fewest.rank) < 0) fewest = { ...result, rank: few };
    if (!cheapest || rank(cheap, cheapest.rank) < 0) cheapest = { ...result, rank: cheap };
  }
  function visit(i, cost) {
    if (exhausted) return;
    if (++nodes > 250000 || (nodes % 128 === 0 && performance.now() > deadline)) { exhausted = true; return; }
    if (i === items.length) { record(cost); return; }
    const maxCoverage = picked.length + items.length - i;
    if (fewest && maxCoverage < fewest.picks.length) return;
    if (fewest && maxCoverage === fewest.picks.length && stops.size > fewest.route.ids.length &&
        rank([cost + minRemaining[i], stops.size], [cheapest.cost, cheapest.route.ids.length]) > 0) return;
    const line = items[i];
    for (const choice of line.choices) {
      const id = choice.store.id;
      const key = id + ':' + choice.sku;
      const already = used.get(key) ?? 0;
      if (already + line.quantity > choice.store.quantity) continue;
      const newStop = !stops.has(id);
      stops.add(id);
      used.set(key, already + line.quantity);
      picked.push(choice);
      visit(i + 1, cost + choice.cost);
      picked.pop();
      used.set(key, already);
      if (newStop) stops.delete(id);
      if (exhausted) break;
    }
    // If shared stock prevents a complete basket, maximize the number of
    // whole lines filled before comparing trips for that available portion.
    if (!fewest || maxCoverage - 1 >= fewest.picks.length) visit(i + 1, cost);
  }
  visit(0, 0);
  function summarize(result, objective) {
    const assigned = new Set(result.picks.map(c => c.table));
    const labels = { both: 'Menos lojas e menor preço estimado', fewest_stores: 'Menos lojas', lowest_price: 'Menor preço estimado' };
    return { objective, label: labels[objective], stopCount: result.route.ids.length, roundTripKm: result.route.km,
      totalBRL: Number.isFinite(result.cost) ? result.cost / 100 : null,
      unfilled: lines.filter(line => !assigned.has(line.label)).map(line => line.label),
      stops: result.route.ids.map(id => {
        const { quantity: _stock, ...store } = stores.get(id);
        return { ...store, pickups: result.picks.filter(c => c.store.id === id).map(c => ({
          table: c.table, option: c.option, sku: c.sku, name: c.name, type: c.type,
          packs: c.packs, unitPriceBRL: c.unitPriceBRL, reportedStock: c.store.quantity })) };
      }) };
  }
  const plans = [];
  if (fewest) {
    const same = fewest.picks.every((choice, i) => choice === cheapest.picks[i]);
    plans.push(summarize(fewest, same && Number.isFinite(cheapest.cost) ? 'both' : 'fewest_stores'));
    if (!same && Number.isFinite(cheapest.cost)) plans.push(summarize(cheapest, 'lowest_price'));
  }
  return { plans, searchComplete: !exhausted && distancesComplete };
}
