import { createInterface } from 'node:readline/promises';
import { alternativeNames, medicationIntent, nameChoices, namePrompt } from '../api/medication-catalog.js';
import { fold } from '../api/medications.js';

// JSON and piped commands must never wait for stdin. Human prompts go to
// stderr so callers can still parse the command's usual JSON output.
export async function confirmCliNames(queries, {
  json = false, choicesFor = nameChoices,
  suggest = async query => (await medicationIntent(query)).suggestions,
  interactive = !json && process.stdin.isTTY && process.stdout.isTTY,
  ask, write = text => process.stderr.write(text + '\n'),
} = {}) {
  const names = [...queries];
  let reader;
  try {
    for (const [index, query] of names.entries()) {
      if (/^\d+$/.test(query)) continue;
      const choices = await choicesFor(query);
      if (!choices.length) continue;
      const question = namePrompt(choices);
      const pending = {status:'needs_name_confirmation', query, index, choices, question};
      if (!interactive) {
        write(question);
        return {pending};
      }
      if (!ask) {
        reader = createInterface({input:process.stdin, output:process.stderr});
        ask = text => reader.question(text);
      }
      const options = choices.length === 1 ? ' (sim/não)' :
        ' ' + choices.map((name, i) => (i + 1) + '. ' + name).join(' · ');
      for (;;) {
        const reply = fold(await ask(question + options + ' ')).trim();
        if (!reply || reply === 'nao') {
          const alternatives = alternativeNames(await suggest(query, 50), query, choices);
          if (alternatives.length) write('Outras sugestões: ' + alternatives.join(', '));
          else write('Pode escrever o nome de outra forma?');
          return {pending:{...pending, alternatives}};
        }
        const selected = choices.length === 1 && reply === 'sim' ? choices[0] :
          choices.find((term, i) => fold(term) === reply || String(i + 1) === reply);
        if (selected) {
          names[index] = selected;
          break;
        }
        write(choices.length === 1 ? 'Responda sim ou não.' : 'Escolha um dos nomes ou o número correspondente.');
      }
    }
    return {names};
  } finally {
    reader?.close();
  }
}
