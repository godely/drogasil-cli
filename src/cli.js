import { parseArgs } from 'node:util';
import { HttpError, NetworkError, GraphQLError } from './api/index.js';

const COMMANDS = {
  compare: () => import('./commands/compare.js'),
  search: () => import('./commands/search.js'),
  product: () => import('./commands/product.js'),
  stock: () => import('./commands/stock.js'),
  stores: () => import('./commands/stores.js'),
};

const USAGE = `drogasil - read-only CLI for drogasil.com.br

Usage:
  drogasil compare <medication name and strength | SKU> [--cep CEP | --lat LAT --lon LON] [--json]
  drogasil search <query> [--limit N] [--page N] [--json]
  drogasil product <sku> [<sku>...] [--json]
  drogasil stock <sku> (--lat LAT --lon LON | --cep CEP [--max-branches N]) [--min-qty N | --all] [--json]
  drogasil stores [--json]

Options:
  --json          Print the raw API response instead of a table
  -h, --help      Show this help

Exit codes:
  0 success   1 usage error   2 network, HTTP or API error   3 nothing found

Environment:
  DROGASIL_MIN_INTERVAL_MS  Minimum gap between requests (default 250)
  DROGASIL_TIMEOUT_MS       Per-request timeout (default 15000)
  DROGASIL_USER_AGENT       Override the User-Agent (see README)
  DROGASIL_ALGOLIA_KEY      Override the public Algolia search key
  DROGASIL_ALGOLIA_APP      Override the Algolia application id
`;

// Keep an HTML block page or a huge error payload from flooding the terminal.
const MAX_BODY_CHARS = 2000;

/**
 * parseArgs refuses `--lat -23.55` because the value starts with a dash, and
 * every coordinate in Brazil is negative. Rewrite `--opt -N` to `--opt=-N`
 * when the next token is a negative number.
 * @param {string[]} args
 */
export function joinNegativeNumbers(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = args[i + 1];
    if (/^--[a-z][\w-]*$/i.test(a) && next != null && /^-\d+(\.\d+)?$/.test(next)) {
      out.push(`${a}=${next}`);
      i++;
    } else {
      out.push(a);
    }
  }
  return out;
}

/**
 * Entry point. Returns the process exit code.
 * @param {string[]} argv
 */
export async function main(argv) {
  const [name, ...rest] = argv;

  if (!name) {
    process.stderr.write(USAGE);
    return 1;
  }
  if (name === '-h' || name === '--help' || name === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  const load = COMMANDS[name];
  if (!load) {
    process.stderr.write(`drogasil: unknown command "${name}"\n\n${USAGE}`);
    return 1;
  }

  const mod = await load();
  let parsed;
  try {
    parsed = parseArgs({
      args: joinNegativeNumbers(rest),
      options: { json: { type: 'boolean', default: false }, help: { type: 'boolean', short: 'h' }, ...mod.options },
      allowPositionals: true,
    });
  } catch (err) {
    if (typeof err?.code === 'string' && err.code.startsWith('ERR_PARSE_ARGS')) {
      process.stderr.write(`drogasil: ${err.message}\n\n${mod.usage}\n`);
      return 1;
    }
    throw err;
  }
  const { values, positionals } = parsed;

  if (values.help) {
    process.stdout.write(mod.usage + '\n');
    return 0;
  }

  try {
    return (await mod.run(positionals, values)) ?? 0;
  } catch (err) {
    if (err instanceof NetworkError) {
      process.stderr.write(`drogasil: ${err.message}\n`);
      return 2;
    }
    if (err instanceof HttpError) {
      process.stderr.write(`drogasil: ${err.message}\n`);
      if (err.body) {
        const body = typeof err.body === 'string' ? err.body : JSON.stringify(err.body);
        process.stderr.write(body.length > MAX_BODY_CHARS ? `${body.slice(0, MAX_BODY_CHARS)}…\n` : `${body}\n`);
      }
      return 2;
    }
    if (err instanceof GraphQLError) {
      process.stderr.write(`drogasil: API error: ${err.message}\n`);
      return 2;
    }
    throw err;
  }
}
