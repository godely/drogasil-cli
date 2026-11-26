#!/usr/bin/env node
import { main } from '../src/cli.js';

// `stores` writes ~2300 rows; calling process.exit() would truncate a piped
// stdout mid-flush, so set exitCode and let the event loop drain instead.
// When the reader goes away early (`drogasil stores | head`), exit quietly.
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0);
  throw err;
});

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code ?? 0;
  },
  (err) => {
    process.stderr.write(`drogasil: ${err?.message ?? err}\n`);
    process.exitCode = 1;
  },
);
