import test from 'node:test';
import assert from 'node:assert/strict';
import {
  init_interfaces,
  promptInterface1,
  promptInterface2,
  promptInterface3,
  promptInterfaceLongTemplate,
  promptInterfaceShortTemplate,
  memoryEditInterface,
  PromptEditInterface,
  MemoryEditInterface,
  SummaryPromptEditInterface,
  update_message_visuals,
  update_context_budget_displays,
  update_save_icon_highlight,
  open_edit_memory_input,
  is_message_excluded_from_context
} from '../ui.js';
import { set_injection_threshold_index } from '../memory.js';
import { chat_metadata, mockChat } from './mocks/sillytavern.js';

test('ui.js: init_interfaces instantiates all modal dialogs including injection templates', () => {
  init_interfaces();
  assert.ok(promptInterface1 instanceof SummaryPromptEditInterface);
  assert.ok(promptInterface2 instanceof PromptEditInterface);
  assert.ok(promptInterface3 instanceof PromptEditInterface);
  assert.ok(promptInterfaceLongTemplate instanceof PromptEditInterface);
  assert.ok(promptInterfaceShortTemplate instanceof PromptEditInterface);
  assert.equal(promptInterfaceLongTemplate.setting_key, 'long_template');
  assert.equal(promptInterfaceShortTemplate.setting_key, 'short_template');
  assert.deepEqual(promptInterfaceLongTemplate.macros, [{ name: 'memnext_long', desc: 'The consolidated long-term memory narrative.' }]);
  assert.deepEqual(promptInterfaceShortTemplate.macros, [{ name: 'memnext_short', desc: 'The active short-term rolling summaries joined by the separator.' }]);
  assert.ok(memoryEditInterface instanceof MemoryEditInterface);
});

test('ui.js: SummaryPromptEditInterface handles macro name uniqueness and ID sanitization', () => {
  const iface = new SummaryPromptEditInterface();
  const name1 = iface.get_unique_name('history');
  assert.equal(name1, 'history_2');
  assert.ok(iface.list_macros().includes('message'));
  assert.ok(iface.list_macros().includes('speaker'));

  // get_id must produce valid CSS ID without spaces
  const idWithSpaces = iface.get_id('New Macro');
  assert.equal(idWithSpaces, 'summary_macro_definition_New_Macro');
  assert.ok(!idWithSpaces.includes(' '));
});

test('ui.js: SummaryPromptEditInterface allows macro deletion', () => {
  const iface = new SummaryPromptEditInterface();
  assert.ok(iface.get_macro('crop_history'));
  // User can delete existing macros
  delete iface.macros['crop_history'];
  assert.equal(iface.get_macro('crop_history'), undefined);

  // User can add and delete custom macros
  iface.macros['custom_test'] = { name: 'custom_test', enabled: true };
  assert.ok(iface.get_macro('custom_test'));
  delete iface.macros['custom_test'];
  assert.equal(iface.get_macro('custom_test'), undefined);
});

test('ui.js: is_message_excluded_from_context only excludes when ITI is active', () => {
  mockChat.length = 0;
  mockChat.push(
    { mes: 'First message', is_user: false },
    { mes: 'Second message', is_user: false },
    { mes: 'Third message', is_user: true }
  );

  // Initially ITI is null: no messages should be excluded, Tavern handles context
  set_injection_threshold_index(null);
  if (chat_metadata.memnext) chat_metadata.memnext.iti = null;
  assert.equal(is_message_excluded_from_context(0), false);
  assert.equal(is_message_excluded_from_context(1), false);
  assert.equal(is_message_excluded_from_context(2), false);

  // When ITI is set to 0, message 0 is excluded
  set_injection_threshold_index(0);
  assert.equal(is_message_excluded_from_context(0), true);
  // Message 1 is above ITI, so it is NOT excluded
  assert.equal(is_message_excluded_from_context(1), false);
  // Message 2 is last user message and above ITI, so NOT excluded
  assert.equal(is_message_excluded_from_context(2), false);

  // Reset ITI back to null
  set_injection_threshold_index(null);
  assert.equal(is_message_excluded_from_context(0), false);
});

test('ui.js: Visual, save highlight, and budget display helpers execute safely without DOM', () => {
  update_message_visuals(0);
  update_context_budget_displays();
  update_save_icon_highlight();
  open_edit_memory_input(0);
  assert.ok(true);
});
