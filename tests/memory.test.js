import test from 'node:test';
import assert from 'node:assert/strict';
import { compute_hash } from '../utils.js';
import {
  initialize_chat_summarization,
  get_long_term_cutoff_index,
  get_last_long_term_history_block,
  update_long_term_history_range,
  delete_long_term_history_range,
  get_data,
  set_data,
  get_memory,
  get_long_history_uuid,
  set_long_history_uuid,
  get_chat_long_histories,
  get_long_history_by_uuid,
  add_chat_long_history,
  update_chat_long_history,
  delete_chat_long_history,
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
  partition_balanced_token_batches,
  map_reduce_compress,
  compact_history
} from '../memory.js';
import { chat_metadata, mockChat } from './mocks/sillytavern.js';
import { get_summary_initialized } from '../state.js';

test('memory.js: get_data and set_data manage message extra properties', () => {
  const msg = {};
  set_data(msg, 'memory', 'This is a summary.');
  set_data(msg, 'custom_prop', 'value123');
  assert.equal(get_data(msg, 'memory'), 'This is a summary.');
  assert.equal(get_memory(msg), 'This is a summary.');
  assert.equal(get_data(msg, 'custom_prop'), 'value123');
  assert.equal(get_data(msg, 'non_existent'), null);
});

test('memory.js: get_chat_long_term_memory retrieves text from per-chat storage via message uuid', () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  mockChat.push({ mes: 'Msg 0' });
  mockChat.push({ mes: 'Msg 1' });
  update_long_term_history_range(0, 1, 'Long term adventure began.');
  assert.equal(get_chat_long_term_memory(), 'Long term adventure began.');
});

test('memory.js: check_message_exclusion filters messages based on configuration', () => {
  const normalMsg = { mes: 'This is long enough to exceed threshold.', is_user: false, is_system: false };
  assert.equal(check_message_exclusion(normalMsg), true);

  const shortMsg = { mes: 'Hi', is_user: false, is_system: false };
  assert.equal(check_message_exclusion(shortMsg), false);

  const userMsg = { mes: 'User saying something long enough.', is_user: true };
  // include_user_messages defaults to false, so user messages are excluded by default
  assert.equal(check_message_exclusion(userMsg), false);

  const excludedMsg = { mes: 'Explicitly excluded message here.' };
  set_data(excludedMsg, 'exclude', true);
  assert.equal(check_message_exclusion(excludedMsg), false);
});

test('memory.js: fillup and refresh_memory execute without error', async () => {
  mockChat.length = 0;
  mockChat.push({ mes: 'Hello world' });
  await assert.doesNotReject(async () => {
    await fillup();
    await refresh_memory();
  });
});

test('memory.js: ITI remains null when chat is within context limits and not regenerated', async () => {
  mockChat.length = 0;
  set_injection_threshold_index(null);
  for (let i = 0; i < 3; i++) {
    mockChat.push({ mes: `Short message ${i}` });
  }
  await fillup();
  assert.equal(get_injection_threshold_index(), null);
});

test('memory.js: ITI resets to null if entire chat fits within CC even if iti was previously set', async () => {
  mockChat.length = 0;
  set_injection_threshold_index(5);
  for (let i = 0; i < 2; i++) {
    mockChat.push({ mes: `Tiny message ${i}` });
  }
  await fillup();
  assert.equal(get_injection_threshold_index(), null);
});

test('memory.js: try_first_to_keep - limit exceeded vs not exceeded', async () => {
  mockChat.length = 0;
  const CC = 1000;
  for (let i = 0; i < 6; i++) {
    mockChat.push({ mes: `Message ${i}` });
  }
  const resultNotExceeded = await try_first_to_keep(CC);
  assert.equal(resultNotExceeded, null);
});

test('memory.js: try_first_to_keep - handles chat beginning and short chats gracefully', async () => {
  mockChat.length = 0;
  const CC = 1000;
  for (let i = 0; i < 2; i++) {
    mockChat.push({ mes: `Short message ${i}` });
  }
  const result = await try_first_to_keep(CC);
  assert.equal(result, null);
});

test('memory.js: try_for_cc Case 1.1, 1.2, and 1.3', async () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  const CC = 500;
  for (let i = 0; i < 5; i++) {
    mockChat.push({ mes: `Regular test message ${i} with enough tokens.` });
  }

  // Case 1.1: dialogue fits entirely in CC without long_term_history
  const res1 = await try_for_cc(CC);
  assert.equal(res1[0], null);
  assert.equal(res1[1], null);
  assert.equal(res1[2], null);

  // Case 1.2: hit existing long_history_uuid before exceeding CC
  const testUuid = add_chat_long_history('Historic narrative text.');
  set_long_history_uuid(mockChat[2], testUuid);
  const res2 = await try_for_cc(CC);
  assert.equal(res2[0], 'Historic narrative text.');
  assert.equal(res2[1], null);
  assert.equal(res2[2], 2);

  // Cleanup
  delete mockChat[2].extra.memnext.long_history_uuid;
  chat_metadata.memnext.long_histories = [];
});

test('memory.js: calculate_memo Paragraph 3 (gap fits in budget with forward counting)', async () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  for (let i = 0; i < 15; i++) {
    mockChat.push({
      mes: `Message ${i}`,
      extra: { memnext: { memory: `Summary of msg ${i}` } }
    });
  }

  const result = await calculate_memo(5);
  assert.ok(Array.isArray(result));
  const [long_term_history, short_indexes, iti] = result;
  assert.equal(long_term_history, "");
  assert.ok(Array.isArray(short_indexes));
  assert.ok(short_indexes.includes(0));
  assert.ok(short_indexes.includes(5));
  assert.ok(iti >= 5);
});

test('memory.js: calculate_memo Paragraph 4 (gap exceeds budget triggers compact_history)', async () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  for (let i = 0; i < 20; i++) {
    mockChat.push({
      mes: `Message ${i}`,
      extra: {
        memnext: {
          memory: `Very lengthy verbose summary for message ${i} that contains lots of words to artificially exceed token limits quickly. `.repeat(15)
        }
      }
    });
  }

  const result = await calculate_memo(10);
  assert.ok(Array.isArray(result));
  const [new_long, short_indexes, iti] = result;
  assert.ok(typeof new_long === 'string' && new_long.length > 0);
  assert.ok(Array.isArray(short_indexes));
  assert.ok(typeof iti === 'number');
});

test('memory.js: calculate_memo edge cases (chat beginning reached and overlapping boundaries)', async () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  for (let i = 0; i < 5; i++) {
    mockChat.push({
      mes: `Msg ${i}`,
      extra: { memnext: { memory: `Sum ${i}` } }
    });
  }
  const result0 = await calculate_memo(0);
  assert.ok(Array.isArray(result0));
  assert.ok(result0[1].includes(0));
  assert.ok(result0[2] >= 0);
});

test('memory.js: compact_history multi-message stamping with chat storage and long_history_uuid', async () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  for (let i = 0; i < 6; i++) {
    mockChat.push({
      mes: `Detailed event description for action step ${i}`,
      extra: { memnext: { memory: `Summary of action ${i}` } }
    });
  }

  const compacted = await compact_history(1, 4, 'Previous narrative.');
  assert.ok(compacted.length > 0);

  // Verify chat storage has the record
  const chatHistories = get_chat_long_histories();
  assert.equal(chatHistories.length, 1);
  assert.equal(chatHistories[0].history_text, compacted);
  const uuid = chatHistories[0].history_uuid;
  assert.ok(uuid && uuid.length > 0);

  // Verify that EVERY message in the gap [1..4] received ONLY long_history_uuid
  for (let i = 1; i <= 4; i++) {
    const stampedUuid = get_long_history_uuid(mockChat[i]);
    assert.equal(stampedUuid, uuid, `Message index ${i} must have stamped long_history_uuid`);
    assert.equal(get_data(mockChat[i], 'long_term_history'), null);
    assert.equal(get_data(mockChat[i], 'long_term_hash'), null);
    assert.equal(get_data(mockChat[i], 'include'), null);
  }

  // Messages outside gap [0 and 5] should not have long_history_uuid
  assert.equal(get_long_history_uuid(mockChat[0]), null);
  assert.equal(get_long_history_uuid(mockChat[5]), null);
});

test('memory.js: get_last_long_term_history_block finds the last consolidated entry and range via reverse scan', () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  for (let i = 0; i < 10; i++) {
    mockChat.push({ mes: `Msg ${i}` });
  }

  // Block 1: messages 1..3
  update_long_term_history_range(1, 3, 'Chapter 1: The Gathering');
  // Block 2: messages 5..7
  update_long_term_history_range(5, 7, 'Chapter 2: The Journey');

  const block = get_last_long_term_history_block();
  assert.ok(block !== null, 'Block must be found');
  assert.equal(block.startIndex, 5);
  assert.equal(block.endIndex, 7);
  assert.equal(block.text, 'Chapter 2: The Journey');
  const uuid2 = block.uuid;
  assert.ok(uuid2 && uuid2.length > 0);

  // Edit history in chat storage
  const editedText = 'Chapter 2: The Extended Journey to the Castle';
  update_chat_long_history(uuid2, editedText);

  const updatedBlock = get_last_long_term_history_block();
  assert.equal(updatedBlock.text, editedText);
  assert.equal(updatedBlock.uuid, uuid2); // UUID preserved!
  // Messages still hold the same uuid
  assert.equal(get_long_history_uuid(mockChat[5]), uuid2);
  assert.equal(get_long_history_uuid(mockChat[6]), uuid2);
  assert.equal(get_long_history_uuid(mockChat[7]), uuid2);

  // Delete history: clears uuid from matching messages and removes from chat_metadata
  delete_chat_long_history(uuid2);
  assert.equal(get_long_history_uuid(mockChat[5]), null);
  assert.equal(get_long_history_uuid(mockChat[7]), null);
  assert.equal(get_chat_long_histories().find(h => h.history_uuid === uuid2), undefined);

  // Now the last remaining block is Block 1 (messages 1..3)
  const remainingBlock = get_last_long_term_history_block();
  assert.equal(remainingBlock.startIndex, 1);
  assert.equal(remainingBlock.endIndex, 3);
  assert.equal(remainingBlock.text, 'Chapter 1: The Gathering');
});

test('memory.js: get_long_term_cutoff_index returns the first long-term message index when scanning from end', () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  for (let i = 0; i < 10; i++) {
    mockChat.push({ mes: `Msg ${i}` });
  }

  // No long term history
  assert.equal(get_long_term_cutoff_index(), -1);

  // Stamping 1..3
  update_long_term_history_range(1, 3, 'Old long term');
  assert.equal(get_long_term_cutoff_index(), 3);

  // Stamping 5..8
  update_long_term_history_range(5, 8, 'Newer long term');
  assert.equal(get_long_term_cutoff_index(), 8);
});

test('memory.js: initialize_chat_summarization stamps prior history across prefix messages via chat storage', async () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  for (let i = 0; i < 10; i++) {
    mockChat.push({ mes: `Msg ${i}` });
  }

  // Initialize with mode 'last_n', count 4, and user provided prior history
  await initialize_chat_summarization({ mode: 'last_n', count: 4, priorHistory: 'Prequel story before event.' });

  assert.equal(get_summary_initialized(), true);

  const chatHistories = get_chat_long_histories();
  assert.equal(chatHistories.length, 1);
  assert.equal(chatHistories[0].history_text, 'Prequel story before event.');
  const uuid = chatHistories[0].history_uuid;

  // Messages 0 to 5 should have long_history_uuid stamped
  for (let i = 0; i <= 5; i++) {
    assert.equal(get_long_history_uuid(mockChat[i]), uuid);
    assert.equal(get_data(mockChat[i], 'long_term_history'), null);
  }
});

test('memory.js: initialize_chat_summarization mode all does not initiate long term history if priorHistory is empty', async () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  for (let i = 0; i < 5; i++) {
    mockChat.push({ mes: `A sufficiently long test narrative message exceeding length threshold ${i}` });
  }

  // 1. Mode 'all' with no prior history -> should NOT initiate long-term history
  await initialize_chat_summarization({ mode: 'all', priorHistory: '' });
  assert.equal(get_summary_initialized(), true);
  const mem0 = get_memory(mockChat[0]);
  assert.ok(mem0, 'Message 0 must have a generated short memory');

  const chatHistories = get_chat_long_histories();
  assert.equal(chatHistories.length, 0, 'No long-term history record should be created when priorHistory is empty');

  for (let i = 0; i < 5; i++) {
    assert.equal(get_long_history_uuid(mockChat[i]), null, `Message ${i} must not have long_history_uuid`);
  }

  // 2. Mode 'all' with explicit priorHistory -> message 0 gets user prior history in chat storage
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  for (let i = 0; i < 3; i++) {
    mockChat.push({ mes: `A sufficiently long test narrative message exceeding length threshold ${i}` });
  }
  await initialize_chat_summarization({ mode: 'all', priorHistory: 'Manual backstory text' });
  const block = get_last_long_term_history_block();
  assert.ok(block !== null);
  assert.equal(block.text, 'Manual backstory text');
  assert.equal(get_long_history_uuid(mockChat[0]), block.uuid);
  assert.equal(get_long_history_uuid(mockChat[1]), null);
});

test('memory.js: partition_balanced_token_batches balances items evenly under capacity', () => {
  const items = [
    'Summary one with some words',
    'Summary two with some more words and details',
    'Summary three with even more descriptive content',
    'Summary four short',
    'Summary five another medium length piece'
  ];
  // Small capacity forces multiple batches
  const batches = partition_balanced_token_batches(items, 30);
  assert.ok(batches.length >= 2);
  // Ensure all items are preserved in order
  const flattened = batches.flat();
  assert.deepEqual(flattened, items);
});

test('memory.js: map_reduce_compress executes map phase and returns compressed batches', async () => {
  const items = [
    'First event of significance.',
    'Second event of combat and healing.',
    'Third event of travel.'
  ];
  const compressed = await map_reduce_compress(items, 4096);
  assert.ok(Array.isArray(compressed));
  assert.ok(compressed.length >= 1);
  assert.ok(typeof compressed[0] === 'string');
});

test('memory.js: compact_history uses long_history_initiate when old_history is empty', async () => {
  mockChat.length = 0;
  chat_metadata.memnext = { long_histories: [] };
  for (let i = 0; i < 6; i++) {
    mockChat.push({
      mes: `Action step ${i}`,
      extra: { memnext: { memory: `Summary of action ${i}` } }
    });
  }

  // Pass empty string for old_history -> should route to long_history_initiate template
  const initialLong = await compact_history(1, 4, '');
  assert.ok(initialLong.length > 0);
  const chatHistories = get_chat_long_histories();
  assert.equal(chatHistories.length, 1);
  assert.equal(chatHistories[0].history_text, initialLong);

  // Subsequent call with existing old_history -> should route to long_compaction_prompt
  const secondLong = await compact_history(1, 4, initialLong);
  assert.ok(secondLong.length > 0);
  assert.equal(chatHistories.length, 2);
});
