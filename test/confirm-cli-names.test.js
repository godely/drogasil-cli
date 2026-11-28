import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmCliNames} from '../src/commands/confirm-names.js';
const choicesFor = async name => ({
  predniso:['prednisona','prednisolona'], morfi:['morfina'],
})[name] ?? [];

test('non-interactive batch pauses at the uncertain item and requires no terminal', async () => {
  const messages = [];
  const result = await confirmCliNames(['123','predniso','pomada'], {
    choicesFor, json:true, write:s=>messages.push(s), ask:assert.fail,
  });
  assert.equal(result.pending.index,1);
  assert.deepEqual(messages,['Você quis dizer prednisona ou prednisolona?']);
});

test('a bare yes cannot choose between medications, and a later yes confirms one name', async () => {
  const answers = ['sim','2','sim'];
  const result = await confirmCliNames(['predniso','morfi','123'], {
    choicesFor, interactive:true, ask:async()=>answers.shift(), write:()=>{},
  });
  assert.deepEqual(result.names,['prednisolona','morfina','123']);
});

test('declining a single suggestion offers other terms without selecting a replacement', async () => {
  const result = await confirmCliNames(['morfi'], {
    choicesFor, interactive:true, ask:async()=>'não', suggest:async()=>['morfi','Morfina','morfina 10mg','morfina gotas','outro'],
    write:()=>{},
  });
  assert.deepEqual(result.pending.alternatives,['outro']);
  assert.equal(result.names,undefined);
});

test('a declined dose rejects other presentations of that name and keeps distinct documented terms', async () => {
  const {alternativeNames} = await import('../src/api/medication-catalog.js');
  const terms = ['loratadina','loratadina comprimidos','loratadina 5 mg','desloratadina','Desloratadina'];
  assert.deepEqual(alternativeNames(terms,'loratadnia 10 mg',['loratadina 10 mg']),['desloratadina']);
  assert.deepEqual(alternativeNames(terms.slice(0,3),'loratadnia',['loratadina']),[]);
});

test('explicit codes and free text remain unchanged without a prompt', async () => {
  const result = await confirmCliNames(['123','protetor solar'], {
    choicesFor:async name=>{ assert.equal(name,'protetor solar'); return []; },
    interactive:true, ask:assert.fail, write:assert.fail,
  });
  assert.deepEqual(result.names,['123','protetor solar']);
});
