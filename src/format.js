// Output helpers. Every command supports --json (raw API shape) and a
// human-readable default.

export function printJson(value) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

/**
 * Render rows as an aligned plain-text table.
 * @param {string[]} headers
 * @param {Array<Array<string|number|null|undefined>>} rows
 */
export function table(headers, rows) {
  const cells = [headers, ...rows].map((r) => r.map((c) => (c == null ? '' : String(c))));
  const widths = headers.map((_, i) => Math.max(...cells.map((r) => r[i].length)));
  const line = (r) => r.map((c, i) => c.padEnd(widths[i])).join('  ').trimEnd();
  return [line(cells[0]), ...cells.slice(1).map(line)].join('\n');
}

/** Brazilian currency layout: "R$ 1.779,43". */
export function formatPrice(value) {
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const [int, frac] = Math.abs(n).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${n < 0 ? '-' : ''}R$ ${grouped},${frac}`;
}

export function formatKm(value) {
  if (value == null) return '';
  return `${Number(value).toFixed(3)} km`;
}

/** "AV CONSELHEIRO ..., 322 - ESPINHEIRO, RECIFE - PE" */
export function formatAddress(address) {
  if (!address) return '';
  const { addressLocal = address.street, addressNumber = address.number, district, city, sgState = address.state } = address;
  const street = [addressLocal, addressNumber].filter(Boolean).join(', ');
  const place = [district, city].filter(Boolean).join(', ');
  return [street, place, sgState].filter(Boolean).join(' - ');
}

/** Derive 24h status from hours; `flag24hours` from the API is unreliable. */
export function is24h(service) {
  if (!service) return false;
  const open = service.hourOpenNormaly ?? '';
  const close = service.hourEndNormaly ?? '';
  return /^00:0[01]/.test(open) && /^23:59/.test(close);
}

/** "07:00:00" -> "07:00"; the API includes seconds. */
function hhmm(value) {
  return value ? String(value).slice(0, 5) : '?';
}

export function formatHours(service) {
  if (!service) return '';
  if (is24h(service)) return '24h';
  return `${hhmm(service.hourOpenNormaly)}-${hhmm(service.hourEndNormaly)}`;
}

export function optionError(message, json, terminalMessage = message) {
  if (json) printJson({ error: message });
  else process.stderr.write(terminalMessage + '\n');
  return 1;
}
