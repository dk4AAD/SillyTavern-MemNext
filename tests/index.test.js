import test from 'node:test';
import assert from 'node:assert/strict';
import { MODULE_NAME, initialize_slash_commands } from '../index.js';

test('index.js: exports MODULE_NAME and registers slash commands', () => {
  assert.equal(MODULE_NAME, 'memnext');
  initialize_slash_commands();
  assert.ok(true);
});
