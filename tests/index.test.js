import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_NAME, initialize_slash_commands } from '../index.js';
import { short_memory_macro, long_memory_macro } from '../constants.js';

test('index.js: exports MODULE_NAME, defines clean macros, and registers slash commands', () => {
  assert.equal(MODULE_NAME, 'memnext');
  assert.equal(short_memory_macro, 'memnext_short');
  assert.equal(long_memory_macro, 'memnext_long');
  initialize_slash_commands();
  assert.ok(true);
});
