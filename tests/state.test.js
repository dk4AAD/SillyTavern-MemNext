import test from 'node:test';
import { mockChat, mockCharacters, mockContext } from './mocks/sillytavern.js';
import assert from 'node:assert/strict';
import {
  get_summary_initialized,
  set_summary_initialized,
  is_chat_loaded,
  initialize_settings,
  get_settings,
  set_settings,
  chat_enabled,
  set_chat_enabled,
  toggle_chat_enabled,
  character_enabled,
  get_character_key,
  load_profile,
  save_profile,
  new_profile,
  get_connection_profiles,
  default_settings,
  detect_settings_difference,
  check_objects_different
} from '../state.js';

test('state.js: initialize_settings establishes default profile', () => {
  initialize_settings();
  assert.equal(get_settings('profile'), 'Default');
  assert.equal(get_settings('auto_summarize'), true);
  assert.equal(get_settings('long_term_context_limit'), 20);
  assert.equal(get_settings('disable_plugin'), false);
  assert.equal(default_settings.auto_summarize_on_send, undefined);
  assert.equal(default_settings.summarization_delay, undefined);
  assert.equal(default_settings.auto_summarize_batch_size, undefined);
});

test('state.js: get_settings and set_settings persist values', () => {
  set_settings('auto_summarize', false);
  assert.equal(get_settings('auto_summarize'), false);
  set_settings('auto_summarize', true);
  assert.equal(get_settings('auto_summarize'), true);
});

test('state.js: chat_enabled toggles and sets state', () => {
  set_chat_enabled(true);
  assert.equal(chat_enabled(), true);
  toggle_chat_enabled();
  assert.equal(chat_enabled(), false);
  toggle_chat_enabled();
  assert.equal(chat_enabled(), true);
});

test('state.js: disable_plugin forces chat_enabled to return false', () => {
  set_chat_enabled(true);
  assert.equal(chat_enabled(), true);
  set_settings('disable_plugin', true);
  assert.equal(chat_enabled(), false);
  set_settings('disable_plugin', false);
  assert.equal(chat_enabled(), true);
});

test('state.js: character identification and group enable check', () => {
  const msg = { avatar: 'char.png', original_avatar: 'orig_char.png' };
  assert.equal(get_character_key(msg), 'orig_char.png');
  assert.equal(character_enabled('orig_char.png'), true);
});

test('state.js: profile management (new_profile, save_profile, load_profile, silent save)', () => {
  new_profile();
  assert.equal(get_settings('profile'), 'New Profile');
  set_settings('long_term_context_limit', 35);
  save_profile('New Profile', true);
  assert.equal(get_settings('long_term_context_limit'), 35);

  load_profile('Default');
  assert.equal(get_settings('profile'), 'Default');
  assert.equal(get_settings('long_term_context_limit'), 20);
});

test('state.js: detect_settings_difference identifies unsaved changes', () => {
  load_profile('Default');
  save_profile('Default');
  assert.equal(detect_settings_difference('Default'), false);

  // Modify a setting without saving profile
  set_settings('long_term_context_limit', 45);
  assert.equal(detect_settings_difference('Default'), true);

  // Save profile and verify difference is cleared
  save_profile('Default');
  assert.equal(detect_settings_difference('Default'), false);
});

test('state.js: check_objects_different works recursively', () => {
  assert.equal(check_objects_different({ a: 1, b: [2] }, { a: 1, b: [2] }), false);
  assert.equal(check_objects_different({ a: 1, b: [2] }, { a: 1, b: [3] }), true);
  assert.equal(check_objects_different('same', 'same'), false);
  assert.equal(check_objects_different('diff1', 'diff2'), true);
});

test('state.js: get_connection_profiles returns available mock profiles', () => {
  const profiles = get_connection_profiles();
  assert.ok(Array.isArray(profiles));
});


test('state.js: summary_initialized and is_chat_loaded helpers', () => {
  assert.equal(get_summary_initialized(), false);
  set_summary_initialized(true);
  assert.equal(get_summary_initialized(), true);
  set_summary_initialized(false);
  assert.equal(get_summary_initialized(), false);

  mockContext.characterId = null;
  mockContext.groupId = null;
  assert.equal(is_chat_loaded(), false);

  mockContext.characterId = 0;
  assert.equal(is_chat_loaded(), true);
});

