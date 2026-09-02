import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preprocess_crop_history,
  special_macro_speaker,
  special_macro_message,
  compute_macro,
  compile_handlebars,
  evaluate_prompt,
  create_summary_prompt,
  default_summary_macros
} from '../macros.js';

test('macros.js: preprocess_crop_history converts arguments into dynamic names', () => {
  const prompt = "Context: {{crop_history 5}} and {{#if crop_history 3}}test{{/if}}";
  const processed = preprocess_crop_history(prompt);
  assert.equal(processed, "Context: {{crop_history_5}} and {{#if crop_history_3}}test{{/if}}");
});

test('macros.js: special_macro_speaker extracts character name or user fallback', () => {
  const mockCtx = {
    chat: [
      { name: 'Alice', is_user: false },
      { name: '', is_user: true }
    ],
    name1: 'Bob',
    name2: 'Alice'
  };
  const res1 = special_macro_speaker(0, mockCtx);
  assert.deepEqual(res1, [{ content: 'Alice' }]);
  const res2 = special_macro_speaker(1, mockCtx);
  assert.deepEqual(res2, [{ content: 'Bob' }]);
});

test('macros.js: compute_macro dynamic crop_history range calculation', async () => {
  const mockCtx = {
    chat: [
      { name: 'Alice', mes: 'Hello', is_user: false },
      { name: 'Bob', mes: 'Hi there', is_user: true },
      { name: 'Alice', mes: 'How are you?', is_user: false }
    ],
    name1: 'Bob',
    name2: 'Alice'
  };
  // crop_history_2 on index 2 should extract messages from index 0 to 1
  const result = await compute_macro(2, 'crop_history_2', false, default_summary_macros, mockCtx);
  assert.ok(Array.isArray(result));
  assert.equal(result.length, 1);
  assert.ok(result[0].content.includes('Alice: Hello'));
  assert.ok(result[0].content.includes('Bob: Hi there'));
});

test('macros.js: evaluate_prompt parses macros and separates assistant prefill', () => {
  const macros = {
    speaker: [{ content: 'Alice' }],
    message: [{ content: 'Good morning' }]
  };
  const template = "Speaker is {{speaker}}, message: {{message}}";
  const messages = evaluate_prompt(template, macros, 'system', 'Summary:');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, 'Speaker is Alice, message: Good morning');
  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content, 'Summary:');
});

test('macros.js: create_summary_prompt builds complete prompt messages', async () => {
  const mockCtx = {
    chat: [
      { name: 'Alice', mes: 'It is a sunny day.', is_user: false }
    ],
    name1: 'Bob',
    name2: 'Alice'
  };
  const promptTemplate = "Summarize message from {{speaker}}: {{message}}";
  const messages = await create_summary_prompt(0, promptTemplate, {
    ctx: mockCtx,
    prompt_role: 0
  });
  assert.ok(Array.isArray(messages));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, 'system');
  assert.equal(messages[0].content, 'Summarize message from Alice: It is a sunny day.');
});
