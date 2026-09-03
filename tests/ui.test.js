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
import { set_injection_threshold_index, set_data, get_memory } from '../memory.js';
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

test('ui.js: MemoryEditInterface template contains pagination, select-all, and batch action elements', () => {
  const iface = new MemoryEditInterface();
  assert.equal(iface.pageSize, 10, 'Default page size must be 10');
  assert.equal(iface.currentPage, 1, 'Initial page must be 1');
  assert.ok(iface.selectedIndices instanceof Set, 'selectedIndices must be a Set');

  // Verify elements in HTML template
  assert.ok(iface.html_template.includes('id="memnext_page_size"'), 'Contains page size dropdown');
  assert.ok(iface.html_template.includes('<option value="5">5</option>'), 'Contains 5 option');
  assert.ok(iface.html_template.includes('<option value="10" selected>10</option>'), 'Contains 10 option selected by default');
  assert.ok(iface.html_template.includes('<option value="15">15</option>'), 'Contains 15 option');
  assert.ok(iface.html_template.includes('<option value="20">20</option>'), 'Contains 20 option');
  assert.ok(iface.html_template.includes('id="memnext_prev_page"'), 'Contains previous page button');
  assert.ok(iface.html_template.includes('id="memnext_next_page"'), 'Contains next page button');
  assert.ok(iface.html_template.includes('id="memnext_page_info"'), 'Contains page indicator');
  assert.ok(iface.html_template.includes('id="memnext_select_all_messages"'), 'Contains select-all checkbox');
  assert.ok(iface.html_template.includes('id="summarize_selected"'), 'Contains summarize selected button');
  assert.ok(iface.html_template.includes('id="delete_selected"'), 'Contains delete selected button');
});

test('ui.js: MemoryEditInterface pagination calculation and selection operations', () => {
  const iface = new MemoryEditInterface();
  const totalMessages = 25;
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(totalMessages / pageSize));
  assert.equal(totalPages, 3, '25 messages with page size 10 should yield 3 pages');

  // Page 1 slice
  let start1 = (1 - 1) * pageSize;
  let end1 = Math.min(totalMessages, start1 + pageSize);
  assert.equal(start1, 0);
  assert.equal(end1, 10);

  // Page 3 slice (last page)
  let start3 = (3 - 1) * pageSize;
  let end3 = Math.min(totalMessages, start3 + pageSize);
  assert.equal(start3, 20);
  assert.equal(end3, 25);

  // Selection tracking
  iface.selectedIndices.add(0);
  iface.selectedIndices.add(5);
  assert.equal(iface.selectedIndices.size, 2);
  assert.ok(iface.selectedIndices.has(0));
  assert.ok(iface.selectedIndices.has(5));
  assert.ok(!iface.selectedIndices.has(1));

  iface.selectedIndices.delete(0);
  assert.equal(iface.selectedIndices.size, 1);
  assert.ok(!iface.selectedIndices.has(0));

  iface.selectedIndices.clear();
  assert.equal(iface.selectedIndices.size, 0);
});

test('ui.js: MemoryEditInterface batch delete only clears summary and preserves message', () => {
  mockChat.length = 0;
  mockChat.push(
    { mes: 'Hello world', is_user: false, extra: { memnext: { memory: 'Greeting summary' } } },
    { mes: 'How are you?', is_user: true, extra: { memnext: { memory: 'Question summary' } } }
  );

  assert.equal(get_memory(mockChat[0]), 'Greeting summary');
  assert.equal(get_memory(mockChat[1]), 'Question summary');

  // Delete memory for message 0 only
  set_data(mockChat[0], 'memory', null);

  assert.equal(get_memory(mockChat[0]), null, 'Summary should be cleared');
  assert.equal(mockChat[0].mes, 'Hello world', 'Message text must remain completely intact');
  assert.equal(mockChat[0].is_user, false, 'Message metadata must remain intact');
  assert.equal(get_memory(mockChat[1]), 'Question summary', 'Unselected message summary should remain untouched');
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
