import { test } from 'node:test';
import assert from 'node:assert/strict';
import capacities from '../../shared/model-capacities.json' with { type: 'json' };
import { modelOf, MODELS } from '../../shared/ask-models.mjs';
import { modelOutputLimit, claudeThinking } from '../src/model-capacity.mjs';
import { citations, normalizeHistory } from '../src/ai.mjs';

test('all offered Workers AI models have a sourced context window without invented output maxima', () => {
  assert.match(capacities.commit, /^[0-9a-f]{40}$/);
  for (const model of MODELS.filter(model => model.id.startsWith('@cf/'))) {
    const source = capacities.models[model.id];
    assert.ok(source.contextWindow > 0, model.id);
    assert.match(source.sourceBlob, /^[0-9a-f]{40}$/);
    assert.ok(source.maxOutput === null || source.maxOutput > 0);
  }
});

test('published native output limits and remaining context are separate from request ceilings', () => {
  assert.equal(modelOutputLimit(modelOf('claude-opus-5-5'), { messages: [] }), 128000);
  const llama = modelOf('@cf/meta/llama-3.3-70b-instruct-fp8-fast');
  const short = modelOutputLimit(llama, { messages: [{ role: 'user', content: 'Existing question' }] });
  const longer = modelOutputLimit(llama, { messages: [{ role: 'user', content: 'Existing material. '.repeat(1000) }] });
  assert.ok(short > 12000 && short < 24000);
  assert.ok(longer < short);
  assert.equal(modelOutputLimit(llama, { text: 'x'.repeat(80000) }), 0);
  assert.equal(modelOutputLimit({ ...llama, id: 'unpublished/model', maxOutput: null }, {}), null, 'unpublished limits stay unknown');
});

test('Opus 5.5 gets adaptive/high settings even when an earlier catalog omitted its thinking flag', () => {
  assert.deepEqual(claudeThinking({ ...modelOf('claude-opus-5-5'), thinking: false }), { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
  assert.deepEqual(claudeThinking(modelOf('claude-sonnet-5-5')), { thinking: { type: 'adaptive' }, output_config: { effort: 'high' } });
});

test('large citation IDs remain mapped and old answer citations cannot leak into the next question', () => {
  assert.deepEqual(citations('Sources [100, 2] and [123], again [100], invalid [999].', 123), [100, 2, 123]);
  assert.equal(normalizeHistory([{ role: 'user', content: 'A question' }, { role: 'assistant', content: 'Existing answer [123].' }])[1].content, 'Existing answer.');
});
