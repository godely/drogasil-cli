import { confirmCliNames } from './confirm-names.js';
import { getMedicationInfo } from '../api/medication-info.js';
import { infoExitCode, renderInfoResult } from './info-result.js';
import { printJson } from '../format.js';

export const usage = 'Usage: drogasil info "<medication or SKU>" ["<another medication>" ...] [--brazil] [--json]';
export const options = { brazil: { type: 'boolean' } };
export async function run(queries, values) {
  if (!queries.length) { process.stderr.write(usage + '\n'); return 1; }
  const {names, pending} = await confirmCliNames(queries, {json:values.json});
  if (pending) {
    if (values.json) printJson({...pending, results:[]});
    return 3;
  }
  const info = await getMedicationInfo(names, { scope: values.brazil ? 'brazil' : 'catalog' });
  if (values.json) printJson(info);
  else for (const result of info.results) console.log(renderInfoResult(result, 'Drogasil'));
  return infoExitCode(info.results);
}
