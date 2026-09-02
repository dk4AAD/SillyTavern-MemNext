import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MODULE_NAME,
  MODULE_NAME_FANCY,
  PROGRESS_BAR_ID,
  css_message_div,
  css_short_memory,
  css_long_memory,
  long_memory_macro,
  short_memory_macro,
  generic_memories_macro,
  IGNORE_SYMBOL
} from '../constants.js';

test('constants.js: exports expected values', () => {
  assert.equal(MODULE_NAME, 'memnext');
  assert.equal(MODULE_NAME_FANCY, 'MemNext');
  assert.equal(PROGRESS_BAR_ID, 'memnext_progress_bar');
  assert.equal(css_message_div, 'memnext_display');
  assert.equal(css_short_memory, 'memnext_short_memory');
  assert.equal(css_long_memory, 'memnext_long_memory');
  assert.equal(long_memory_macro, 'memnext-long-term-memory');
  assert.equal(short_memory_macro, 'memnext-short-term-memory');
  assert.equal(generic_memories_macro, 'memnext-memories');
  assert.equal(typeof IGNORE_SYMBOL, 'symbol');
});
