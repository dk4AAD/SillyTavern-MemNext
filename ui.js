/* eslint-disable */
import { getRegexScripts, runRegexScript } from '../../../../scripts/extensions/regex/engine.js';
import { getStringHash, debounce, copyText, trimToEndSentence, download, parseJsonFile, stringToRange, waitUntilCondition } from '../../../utils.js';
import { animation_duration, scrollChatToBottom, saveSettingsDebounced, getCharacterCardFields, messageFormatting, generateRaw, createRawPrompt, getMaxContextSize, streamingProcessor, amount_gen, system_message_types, extension_prompt_roles, extension_prompt_types, CONNECT_API_MAP, main_api, online_status, chat_metadata } from '../../../../script.js';
import { getContext, extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { formatInstructModePrompt } from '../../../instruct-mode.js';
import { selected_group, openGroupId } from '../../../group-chats.js';
import { loadMovingUIState, power_user } from '../../../power-user.js';
import { dragElement } from '../../../RossAscends-mods.js';
import { debounce_timeout } from '../../../constants.js';
import { MacrosParser } from '../../../macros.js';
import { itemizedPrompts } from '../../../../scripts/itemized-prompts.js';
import { t, translate } from '../../../i18n.js';
import { toast, saveChatDebounced, get_chat_context_size, get_long_token_limit, get_short_token_limit, escape_string } from "./utils.js";
import { default_settings, settings_ui_map, get_settings, set_settings, chat_enabled, toggle_chat_enabled, load_profile, export_profile, import_profile, rename_profile, new_profile, delete_profile, toggle_character_profile, toggle_chat_profile, get_connection_profiles } from "./state.js";
import { get_data, set_data, get_memory, set_chat_long_term_memory, check_message_exclusion, refresh_memory } from "./memory.js";
import { summarize_message, summaryQueue } from "./summarization.js";
export const MODULE_NAME = 'memnext';
export const MODULE_NAME_FANCY = 'MemNext';
export const PROGRESS_BAR_ID = `${MODULE_NAME}_progress_bar`;

// CSS classes
export const css_message_div = `${MODULE_NAME}_display`;
export const css_short_memory = `${MODULE_NAME}_short_memory`;
export const css_long_memory = `${MODULE_NAME}_long_memory`;
export const css_exclude_memory = `${MODULE_NAME}_exclude_memory`;
export const css_lagging_memory = `${MODULE_NAME}_lagging_memory`;
export const css_removed_message = `${MODULE_NAME}_removed_message`;
export const summary_div_class = `${MODULE_NAME}_text`;
export const summary_reasoning_class = `${MODULE_NAME}_reasoning`;
export const css_button_separator = `${MODULE_NAME}_button_separator`;
export const css_edit_textarea = `${MODULE_NAME}_edit_textarea`;
export const settings_div_id = `${MODULE_NAME}_settings`;
export const settings_content_class = `${MODULE_NAME}_settings_content`;
export const group_member_enable_button = `${MODULE_NAME}_group_member_enable`;
export const group_member_enable_button_highlight = `${MODULE_NAME}_group_member_enabled`;

// Macros for memory injection
export
// Message button classes
const summarize_button_class = `${MODULE_NAME}_summarize_button`;
export const edit_button_class = `${MODULE_NAME}_edit_button`;
export const forget_button_class = `${MODULE_NAME}_forget_button`;

// Default prompt templates
export
// UI Rendering & Message Visuals
function get_message_div(index) {
  const div = $(`div[mesid="${index}"]`);
  return div.length > 0 ? div : null;
}
export function update_message_visuals(i, in_progress = false, custom_text = null) {
  const div = get_message_div(i);
  if (!div) return;
  div.find(`div.${summary_div_class}`).remove();
  div.find(`.mes_text`).removeClass(css_removed_message);
  if (!get_settings('display_memories') || !chat_enabled()) return;
  const ctx = getContext();
  const message = ctx?.chat?.[i];
  if (!message) return;
  const memory_text = custom_text || get_memory(message);
  const include = get_data(message, 'include');
  const lagging = get_data(message, 'lagging');
  if (get_settings('exclude_messages_after_threshold') && !lagging) {
    div.find(`.mes_text`).addClass(css_removed_message);
  }
  if (!memory_text) return;
  let style_class = css_message_div;
  if (include === 'short') {
    style_class += ` ${css_short_memory}`;
  } else if (include === 'long') {
    style_class += ` ${css_long_memory}`;
  }
  if (lagging) {
    style_class += ` ${css_lagging_memory}`;
  }
  const summary_element = $(`<div class="${summary_div_class} ${style_class}"><i class="fa-solid fa-quote-left" style="margin-right: 5px; opacity: 0.6;"></i><span></span></div>`);
  summary_element.find('span').text(memory_text);
  div.find('.mes_block').append(summary_element);
}
export function update_all_message_visuals() {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat)) return;
  for (let i = 0; i < chat.length; i++) {
    update_message_visuals(i);
  }
}
export function update_context_budget_displays() {
  const context_size = get_chat_context_size();
  const long_tokens = get_long_token_limit();
  const short_tokens = get_short_token_limit();
  const threshold_percent = Number(get_settings('compaction_threshold_percent')) || 15;
  const threshold_tokens = Math.floor(context_size * (threshold_percent / 100));
  $(`.${settings_content_class} #long_term_context_limit_display`).text(long_tokens);
  $(`.${settings_content_class} #short_term_context_limit_display`).text(short_tokens);
  $(`.${settings_content_class} #compaction_threshold_tokens_display`).text(threshold_tokens);
}

// Auto-summarize chat
export
// UI Initialization & Binding
let promptInterface1;
export let promptInterface2;
export let promptInterface3;
export let memoryEditInterface;
export function initialize_settings_ui() {
  const bind_input = (id, key, type) => {
    const $el = $(`.${settings_content_class} #${id}`);
    if ($el.length === 0) return;
    settings_ui_map[key] = [$el, type];
    if (type === 'boolean') {
      $el.prop('checked', Boolean(get_settings(key)));
      $el.on('change', function () {
        set_settings(key, $(this).prop('checked'));
        refresh_memory();
      });
    } else if (type === 'number') {
      $el.val(get_settings(key));
      $el.on('change', function () {
        set_settings(key, Number($(this).val()));
        refresh_memory();
      });
    } else {
      $el.val(get_settings(key));
      $el.on('change', function () {
        set_settings(key, $(this).val());
        refresh_memory();
      });
    }
  };

  // Bind settings
  bind_input('auto_summarize', 'auto_summarize', 'boolean');
  bind_input('auto_summarize_on_edit', 'auto_summarize_on_edit', 'boolean');
  bind_input('auto_summarize_on_swipe', 'auto_summarize_on_swipe', 'boolean');
  bind_input('auto_summarize_on_continue', 'auto_summarize_on_continue', 'boolean');
  bind_input('block_chat', 'block_chat', 'boolean');
  bind_input('auto_summarize_progress', 'auto_summarize_progress', 'boolean');
  bind_input('auto_summarize_on_send', 'auto_summarize_on_send', 'boolean');
  bind_input('auto_summarize_block_generation', 'auto_summarize_block_generation', 'boolean');
  bind_input('exclude_messages_after_threshold', 'exclude_messages_after_threshold', 'boolean');
  bind_input('keep_last_user_message', 'keep_last_user_message', 'boolean');
  bind_input('include_user_messages', 'include_user_messages', 'boolean');
  bind_input('include_system_messages', 'include_system_messages', 'boolean');
  bind_input('include_narrator_messages', 'include_narrator_messages', 'boolean');
  bind_input('debug_mode', 'debug_mode', 'boolean');
  bind_input('display_memories', 'display_memories', 'boolean');
  bind_input('default_chat_enabled', 'default_chat_enabled', 'boolean');
  bind_input('use_global_toggle_state', 'use_global_toggle_state', 'boolean');
  bind_input('summarization_time_delay_skip_first', 'summarization_time_delay_skip_first', 'boolean');
  bind_input('parallel_summaries_count', 'parallel_summaries_count', 'number');
  bind_input('summarization_time_delay', 'summarization_time_delay', 'number');
  bind_input('summarization_delay', 'summarization_delay', 'number');
  bind_input('auto_summarize_batch_size', 'auto_summarize_batch_size', 'number');
  bind_input('auto_summarize_message_limit', 'auto_summarize_message_limit', 'number');
  bind_input('long_term_context_limit', 'long_term_context_limit', 'number');
  bind_input('short_term_context_limit', 'short_term_context_limit', 'number');
  bind_input('compaction_threshold_percent', 'compaction_threshold_percent', 'number');
  bind_input('messages_to_keep', 'messages_to_keep', 'number');
  bind_input('kept_messages_context_threshold', 'kept_messages_context_threshold', 'number');
  bind_input('message_length_threshold', 'message_length_threshold', 'number');
  bind_input('injection_threshold_update_trigger_messages', 'injection_threshold_update_trigger_messages', 'number');
  bind_input('injection_threshold_update_trigger_summaries', 'injection_threshold_update_trigger_summaries', 'number');
  bind_input('injection_threshold_update_trigger_context', 'injection_threshold_update_trigger_context', 'number');
  bind_input('summary_injection_separator', 'summary_injection_separator', 'text');
  bind_input('summary_injection_threshold_type', 'summary_injection_threshold_type', 'text');
  bind_input('injection_position', 'injection_position', 'number');
  bind_input('injection_role', 'injection_role', 'number');

  // Prompt Edit buttons
  $(`.${settings_content_class} #edit_message_summary_prompt`).on('click', () => promptInterface1.show());
  $(`.${settings_content_class} #edit_short_to_long_prompt`).on('click', () => promptInterface2.show());
  $(`.${settings_content_class} #edit_long_compaction_prompt`).on('click', () => promptInterface3.show());

  // Top action buttons
  $(`.${settings_content_class} #toggle_chat_memory`).on('click', toggle_chat_enabled);
  $(`.${settings_content_class} #edit_memory_state`).on('click', () => memoryEditInterface.show());
  $(`.${settings_content_class} #refresh_memory`).on('click', () => {
    refresh_memory();
    toast("Memories refreshed.", "info");
  });
  $(`.${settings_content_class} #stop_summarization`).on('click', () => {
    summaryQueue.clear();
    toast("Summarization stopped.", "warning");
  });
  $(`.${settings_content_class} #summarize_all_messages`).on('click', async () => {
    const ctx = getContext();
    const chat = ctx?.chat || [];
    for (let i = 0; i < chat.length; i++) {
      if (!get_memory(chat[i]) && check_message_exclusion(chat[i])) {
        summaryQueue.add(i);
      }
    }
    toast(`Queued ${summaryQueue.tasks.length} messages for summarization.`, "info");
    await summaryQueue.run();
  });
  $(`.${settings_content_class} #clear_long_term_memory`).on('click', () => {
    set_chat_long_term_memory("");
    refresh_memory();
    toast("Long-term memory cleared for this chat.", "info");
  });
  $(`.${settings_content_class} #revert_settings`).on('click', () => {
    const profile = get_settings('profile');
    if (extension_settings[MODULE_NAME]?.profiles?.[profile]) {
      extension_settings[MODULE_NAME].profiles[profile] = structuredClone(default_settings);
      refresh_settings();
      refresh_memory();
      toast("Profile reverted to default.", "success");
    }
  });

  // Profile Management Bindings
  bind_input('profile', 'profile', 'text');
  bind_input('notify_on_profile_switch', 'notify_on_profile_switch', 'boolean');
  $(`.${settings_content_class} #profile`).off('change').on('change', function () {
    load_profile($(this).val());
  });
  $(`.${settings_content_class} #save_profile`).on('click', () => save_profile());
  $(`.${settings_content_class} #restore_profile`).on('click', () => load_profile());
  $(`.${settings_content_class} #rename_profile`).on('click', () => rename_profile());
  $(`.${settings_content_class} #new_profile`).on('click', () => new_profile());
  $(`.${settings_content_class} #delete_profile`).on('click', () => delete_profile());
  $(`.${settings_content_class} #export_profile`).on('click', () => export_profile());
  $(`.${settings_content_class} #import_profile`).on('click', e => {
    $(e.target).parent().find("#import_file").click();
  });
  $(`.${settings_content_class} #import_file`).on('change', async e => await import_profile(e));
  $(`.${settings_content_class} #character_profile`).on('click', () => toggle_character_profile());
  $(`.${settings_content_class} #chat_profile`).on('click', () => toggle_chat_profile());
  update_connection_profile_dropdown();
  refresh_settings();
}
export function update_connection_profile_dropdown() {
  const $dropdown = $(`.${settings_content_class} #connection_profile`).empty();
  $dropdown.append(`<option value="">Current Tavern Connection</option>`);
  const profiles = get_connection_profiles();
  for (const p of profiles) {
    $dropdown.append(`<option value="${p.id}">${escape_string(p.name)}</option>`);
  }
  $dropdown.val(get_settings('connection_profile') || '');
  $dropdown.on('change', function () {
    set_settings('connection_profile', $(this).val());
  });
}
export function refresh_settings() {
  for (const [key, [element, type]] of Object.entries(settings_ui_map)) {
    if (!element || element.length === 0) continue;
    const val = get_settings(key);
    if (type === 'boolean') {
      element.prop('checked', Boolean(val));
    } else {
      element.val(val);
    }
  }
  const enabled = chat_enabled();
  $(`.${settings_content_class} #toggle_chat_memory span`).text(enabled ? t`Memory: Enabled` : t`Memory: Disabled`);
  $(`.${settings_content_class} #toggle_chat_memory`).toggleClass('button_highlight', enabled);
  update_context_budget_displays();
}

// In-chat Message Buttons
export function initialize_message_buttons() {
  const message_buttons_template = `
<div class="${css_button_separator}"></div>
<div class="mes_button fa-solid fa-quote-left ${summarize_button_class}" title="Summarize message (MemNext)"></div>
<div class="mes_button fa-solid fa-pencil ${edit_button_class}" title="Edit summary (MemNext)"></div>
<div class="mes_button fa-solid fa-trash ${forget_button_class}" title="Delete summary (MemNext)"></div>
`;

  // Hook dynamically added message extra buttons
  $(document).on('click', `.${summarize_button_class}`, async function () {
    const mes_id = Number($(this).closest('.mes').attr('mesid'));
    if (!isNaN(mes_id)) {
      await summarize_message(mes_id);
      refresh_memory();
      saveChatDebounced();
    }
  });
  $(document).on('click', `.${forget_button_class}`, function () {
    const mes_id = Number($(this).closest('.mes').attr('mesid'));
    if (!isNaN(mes_id)) {
      const ctx = getContext();
      const msg = ctx?.chat?.[mes_id];
      if (msg) {
        set_data(msg, 'memory', null);
        update_message_visuals(mes_id);
        refresh_memory();
        saveChatDebounced();
      }
    }
  });
  $(document).on('click', `.${edit_button_class}`, function () {
    const mes_div = $(this).closest('.mes');
    const mes_id = Number(mes_div.attr('mesid'));
    if (isNaN(mes_id)) return;
    const ctx = getContext();
    const msg = ctx?.chat?.[mes_id];
    if (!msg) return;
    const current_mem = get_memory(msg) || '';
    const $edit_box = $(`<textarea class="${css_edit_textarea} text_pole"></textarea>`).val(current_mem);
    const summary_div = mes_div.find(`div.${summary_div_class}`);
    if (summary_div.length > 0) {
      summary_div.replaceWith($edit_box);
    } else {
      mes_div.find('.mes_block').append($edit_box);
    }
    $edit_box.focus();
    $edit_box.on('blur', function () {
      const new_text = $(this).val().trim();
      set_data(msg, 'memory', new_text || null);
      set_data(msg, 'edited', true);
      $edit_box.remove();
      update_message_visuals(mes_id);
      refresh_memory();
      saveChatDebounced();
    });
  });

  // Inject buttons into the message template
  $('#message_template .mes_buttons .extraMesButtons').prepend(message_buttons_template);

  // Also inject into any already rendered messages
  $('#chat .mes').each(function () {
    const $buttons = $(this).find('.extraMesButtons');
    if ($buttons.length > 0 && $buttons.find(`.${summarize_button_class}`).length === 0) {
      $buttons.prepend(message_buttons_template);
    }
  });
}

// Slash commands
export
// Popout logic
let POPOUT_VISIBLE = false;
export let $popout = null;
export let $settings_element = null;
export let $original_settings_parent = null;
export function initialize_popout() {
  $settings_element = $(`#${settings_div_id}`).find(`.inline-drawer-content .${settings_content_class}`);
  $original_settings_parent = $settings_element.parent();
  $popout = $($('#zoomed_avatar_template').html());
  $popout.attr('id', 'memnextExtensionPopout').removeClass('zoomed_avatar').addClass('draggable').empty();
  const controlBarHtml = `<div class="panelControlBar flex-container" id="memnextExtensionPopoutheader">
    <div class="fa-solid fa-grip drag-grabber hoverglow"></div>
    <div class="fa-solid fa-circle-xmark hoverglow dragClose"></div>
    </div>`;
  $popout.append(controlBarHtml);
  if (typeof loadMovingUIState === 'function') loadMovingUIState();
  if (typeof dragElement === 'function') dragElement($popout);
  $(`.${settings_content_class} #memnext_popout_button`).on('click', e => {
    e.stopPropagation();
    if (POPOUT_VISIBLE) {
      close_popout();
    } else {
      open_popout();
    }
  });
  $(document).on('keydown', async function (event) {
    if (event.key === 'Escape' && POPOUT_VISIBLE) {
      close_popout();
    }
  });
}
export function open_popout() {
  $('body').append($popout);
  if (typeof loadMovingUIState === 'function') loadMovingUIState();
  if (typeof dragElement === 'function') dragElement($popout);
  $popout.find('.dragClose').off('click').on('click', function () {
    close_popout();
  });
  $settings_element.appendTo($popout);
  $popout.fadeIn(animation_duration);
  POPOUT_VISIBLE = true;
}
export function close_popout() {
  $popout.fadeOut(animation_duration, () => {
    $settings_element.appendTo($original_settings_parent);
    $popout.remove();
  });
  POPOUT_VISIBLE = false;
}

// Entry Point