import test from 'node:test';
import assert from 'node:assert/strict';
import {
  init_interfaces,
  promptInterface1,
  promptInterface2,
  promptInterface3,
  memoryEditInterface,
  PromptEditInterface,
  MemoryEditInterface,
  SummaryPromptEditInterface,
  update_message_visuals,
  update_context_budget_displays
} from '../ui.js';

test('ui.js: init_interfaces instantiates all modal dialogs', () => {
  init_interfaces();
  assert.ok(promptInterface1 instanceof SummaryPromptEditInterface);
  assert.ok(promptInterface2 instanceof PromptEditInterface);
  assert.ok(promptInterface3 instanceof PromptEditInterface);
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

test('ui.js: Visual and budget display helpers execute safely without DOM', () => {
  update_message_visuals(0);
  update_context_budget_displays();
  assert.ok(true);
});
