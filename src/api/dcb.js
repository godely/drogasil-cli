import { readFileSync } from 'node:fs';

// The packaged index contains lowercase, accent-folded official names.
export const dcbNames = new Set(readFileSync(new URL('../data/dcb-names.txt', import.meta.url), 'utf8').trimEnd().split('\n'));
