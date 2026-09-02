import test from 'node:test';
import assert from 'node:assert/strict';
import {
  get_data,
  set_data,
  get_memory,
  get_chat_long_term_memory,
  set_chat_long_term_memory,
  check_message_exclusion,
  fillup,
  refresh_memory
} from '../memory.js';
import { chat_metadata } from './mocks/sillytavern.js';

test('memory.js: get_data and set_data manage message extra properties', () => {
  const msg = {};
  set_data(msg, 'memory', 'This is a summary.');
  set_data(msg, 'include', 'short');
  assert.equal(get_data(msg, 'memory'), 'This is a summary.');
  assert.equal(get_memory(msg), 'This is a summary.');
  assert.equal(get_data(msg, 'include'), 'short');
  assert.equal(get_data(msg, 'non_existent'), null);
});

test('memory.js: get_chat_long_term_memory and set_chat_long_term_memory', () => {
  set_chat_long_term_memory('Long term adventure began.');
  assert.equal(get_chat_long_term_memory(), 'Long term adventure began.');
  assert.equal(chat_metadata.memnext.long_term_memory, 'Long term adventure began.');
});

test('memory.js: check_message_exclusion filters messages based on configuration', () => {
  const normalMsg = { mes: 'This is long enough to exceed threshold.', is_user: false, is_system: false };
  assert.equal(check_message_exclusion(normalMsg), true);

  const excludedMsg = { mes: 'Short', is_user: false, is_system: false, extra: { memnext: { exclude: true } } };
  assert.equal(check_message_exclusion(excludedMsg), false);

  const shortMsg = { mes: 'Hi', is_user: false, is_system: false };
  // Default threshold is 10 tokens
  assert.equal(check_message_exclusion(shortMsg), false);
});

test('memory.js: fillup and refresh_memory execute without error', async () => {
  await refresh_memory();
  assert.ok(true);
});
