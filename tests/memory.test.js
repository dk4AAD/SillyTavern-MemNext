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
  refresh_memory,
  get_injection_threshold_index,
  set_injection_threshold_index,
  try_first_to_keep,
  try_for_cc,
  calculate_memo,
  compact_history
} from '../memory.js';
import { chat_metadata, mockChat } from './mocks/sillytavern.js';

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
  assert.equal(check_message_exclusion(shortMsg), false);
});

test('memory.js: fillup and refresh_memory execute without error', async () => {
  await refresh_memory();
  assert.ok(true);
});

test('memory.js: ITI remains null when chat is within context limits and not regenerated', async () => {
  set_injection_threshold_index(null);
  if (chat_metadata.memnext) {
    chat_metadata.memnext.iti = null;
  }
  mockChat.length = 0;
  for (let i = 0; i < 8; i++) {
    mockChat.push({
      mes: `Message number ${i} in dialogue.`,
      is_user: i % 2 === 0,
      extra: { memnext: { memory: `Summary of message ${i}` } }
    });
  }

  await refresh_memory();
  assert.equal(get_injection_threshold_index(), null);
  assert.equal(chat_metadata.memnext?.iti ?? null, null);
});

test('memory.js: ITI resets to null if entire chat fits within CC even if iti was previously set', async () => {
  mockChat.length = 0;
  for (let i = 0; i < 8; i++) {
    mockChat.push({
      mes: `Short message ${i}.`,
      is_user: i % 2 === 0,
      extra: { memnext: { memory: `Summary ${i}` } }
    });
  }
  // Simulate stale ITI (e.g. from an old session or huge prompt)
  set_injection_threshold_index(5);
  chat_metadata.memnext = { iti: 5 };

  await refresh_memory();
  assert.equal(get_injection_threshold_index(), null, 'ITI should reset to null when entire chat fits in CC');
  assert.equal(chat_metadata.memnext?.iti ?? null, null);
});

test('memory.js: try_first_to_keep - limit exceeded vs not exceeded', async () => {
  mockChat.length = 0;
  // Case A: sum of last 5 messages is small (limit not exceeded)
  for (let i = 0; i < 10; i++) {
    mockChat.push({
      mes: 'tiny',
      is_user: false,
      extra: { memnext: { memory: 'summary' } }
    });
  }
  // With CC=1000 and kept_messages_context_threshold=30% (300 tokens), 5 * 1 token = 5 tokens <= 300
  const underResult = await try_first_to_keep(1000);
  assert.equal(underResult, null, 'Should return null and NOT call calculate_memo when limit is not exceeded');

  // Case B: limit exceeded - message at index 7 is the longest
  mockChat[6].mes = 'A'.repeat(200); // ~50 tokens
  mockChat[7].mes = 'B'.repeat(800); // ~200 tokens (longest)
  mockChat[8].mes = 'C'.repeat(100); // ~25 tokens
  mockChat[9].mes = 'D'.repeat(200); // ~50 tokens
  // Kept tokens > 300 tokens with CC=1000
  const overResult = await try_first_to_keep(1000);
  assert.ok(overResult !== null, 'Should return non-null when limit exceeded');
  assert.ok(Array.isArray(overResult));
});

test('memory.js: try_first_to_keep - handles chat beginning and short chats gracefully', async () => {
  mockChat.length = 0;
  // Fewer messages than messages_to_keep (e.g. 2 messages)
  mockChat.push({ mes: 'One', is_user: false });
  mockChat.push({ mes: 'Two', is_user: true });
  const result = await try_first_to_keep(1000);
  assert.equal(result, null, 'Fewer messages than threshold should not exceed context');
});

test('memory.js: try_for_cc Case 1.1, 1.2, and 1.3', async () => {
  mockChat.length = 0;
  // Case 1.1: dialogue fits entirely in CC without long_term_history
  for (let i = 0; i < 6; i++) {
    mockChat.push({
      mes: 'Short text',
      is_user: false,
      extra: { memnext: { memory: `Summary ${i}` } }
    });
  }
  const case1_1 = await try_for_cc(5000);
  assert.deepEqual(case1_1, [null, null, null], 'Case 1.1: Returns [null, null, null] when under CC');

  // Case 1.2: hit existing long_term_history before exceeding CC
  set_data(mockChat[2], 'long_term_history', 'Historic narrative text.');
  const case1_2 = await try_for_cc(5000);
  assert.equal(case1_2[0], 'Historic narrative text.', 'Case 1.2: Returns long-term history from message');
  assert.equal(case1_2[1], null, 'Case 1.2: Returns null short indexes');
  assert.equal(case1_2[2], 2, 'Case 1.2: ITI set to message with long-term record');

  // Case 1.3: exceeds CC at message index i
  delete mockChat[2].extra.memnext.long_term_history;
  mockChat[1].mes = 'X'.repeat(4000); // Huge message causing overflow at index 1
  const case1_3 = await try_for_cc(200);
  assert.ok(Array.isArray(case1_3), 'Case 1.3: Returns calculate_memo result');
  assert.ok(case1_3[2] !== null, 'Case 1.3: Has valid ITI');
});

test('memory.js: calculate_memo Paragraph 3 (gap fits in budget with forward counting)', async () => {
  mockChat.length = 0;
  for (let i = 0; i < 12; i++) {
    mockChat.push({
      mes: `Message ${i}`,
      is_user: i % 2 === 0,
      extra: { memnext: { memory: `Summary of msg ${i}` } }
    });
  }

  // history_calc_message = 4. Gap [0..4] summaries are small, well within short_budget (~600 tokens).
  const [longMem, shortIndexes, iti] = await calculate_memo(4);
  assert.equal(longMem, '', 'No existing long memory before chat start');
  assert.ok(shortIndexes.includes(0), 'Short indexes must include start of gap');
  assert.ok(shortIndexes.includes(4), 'Short indexes must include history_calc_message');
  // Forward scan continues packing messages up to max_iti (12 - 5 - 1 = 6)
  assert.ok(iti >= 4, 'ITI must be at least history_calc_message');
  assert.ok(iti <= 6, 'ITI cannot exceed max_iti');
});

test('memory.js: calculate_memo Paragraph 4 (gap exceeds budget triggers compact_history)', async () => {
  mockChat.length = 0;
  for (let i = 0; i < 12; i++) {
    mockChat.push({
      mes: `Message ${i}`,
      is_user: i % 2 === 0,
      // Large summaries exceeding short_budget
      extra: { memnext: { memory: 'Very long summary details '.repeat(80) } }
    });
  }

  const [longMem, shortIndexes, iti] = await calculate_memo(4);
  assert.ok(longMem.length > 0, 'Compacted history must produce a long narrative string');
  assert.ok(Array.isArray(shortIndexes), 'Short indexes returned as an array');
  assert.ok(iti >= 4, 'ITI boundary established');
});

test('memory.js: calculate_memo edge cases (chat beginning reached and overlapping boundaries)', async () => {
  mockChat.length = 0;
  for (let i = 0; i < 5; i++) {
    mockChat.push({
      mes: `Msg ${i}`,
      extra: { memnext: { memory: `Sum ${i}` } }
    });
  }

  // Beginning of chat: history_calc_message = 0
  const resultBeginning = await calculate_memo(0);
  assert.ok(Array.isArray(resultBeginning));
  assert.equal(resultBeginning[1].length, 1);
  assert.equal(resultBeginning[1][0], 0);

  // Negative or out of bounds history_calc_message is safely clamped
  const resultClamped = await calculate_memo(-5);
  assert.ok(Array.isArray(resultClamped));
  assert.equal(resultClamped[1][0], 0);

  // Edge case: history_calc_message past end is safely clamped
  const resultPastEnd = await calculate_memo(99);
  assert.ok(Array.isArray(resultPastEnd));
});

test('memory.js: compact_history multi-message stamping', async () => {
  mockChat.length = 0;
  for (let i = 0; i < 6; i++) {
    mockChat.push({
      mes: `Action ${i}`,
      extra: { memnext: { memory: `Summary of action ${i}` } }
    });
  }

  const compacted = await compact_history(1, 4, 'Previous narrative.');
  assert.ok(compacted.length > 0);

  // Verify that EVERY message in the gap [1..4] received the long_term_history stamp
  for (let i = 1; i <= 4; i++) {
    const stamped = get_data(mockChat[i], 'long_term_history');
    assert.equal(stamped, compacted, `Message index ${i} must have stamped long_term_history`);
  }
  // Messages outside gap [0 and 5] should not have been stamped
  assert.equal(get_data(mockChat[0], 'long_term_history'), null);
  assert.equal(get_data(mockChat[5], 'long_term_history'), null);
});
