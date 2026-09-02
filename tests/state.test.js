import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
  default_settings
} from '../state.js';

test('state.js: initialize_settings establishes default profile', () => {
  initialize_settings();
  assert.equal(get_settings('profile'), 'Default');
  assert.equal(get_settings('auto_summarize'), true);
  assert.equal(get_settings('long_term_context_limit'), 20);
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

test('state.js: character identification and group enable check', () => {
  const msg = { avatar: 'char.png', original_avatar: 'orig_char.png' };
  assert.equal(get_character_key(msg), 'orig_char.png');
  assert.equal(character_enabled('orig_char.png'), true);
});

test('state.js: profile management (new_profile, save_profile, load_profile)', () => {
  new_profile();
  assert.equal(get_settings('profile'), 'New Profile');
  set_settings('long_term_context_limit', 35);
  save_profile('New Profile');
  assert.equal(get_settings('long_term_context_limit'), 35);

  load_profile('Default');
  assert.equal(get_settings('profile'), 'Default');
  assert.equal(get_settings('long_term_context_limit'), 20);
});

test('state.js: get_connection_profiles returns available mock profiles', () => {
  const profiles = get_connection_profiles();
  assert.ok(Array.isArray(profiles));
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].id, 'profile-1');
});
