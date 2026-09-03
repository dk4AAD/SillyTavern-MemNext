/* eslint-disable */
import { animation_duration, extension_prompt_roles } from '../../../../script.js';
import { getContext, extension_settings } from '../../../extensions.js';
import { getRegexScripts } from '../../../../scripts/extensions/regex/engine.js';
import { loadMovingUIState } from '../../../power-user.js';
import { dragElement } from '../../../RossAscends-mods.js';
import { t } from '../../../i18n.js';
import {
  MODULE_NAME,
  settings_div_id,
  settings_content_class,
  summary_div_class,
  css_message_div,
  css_short_memory,
  css_long_memory,
  css_lagging_memory,
  css_removed_message,
  css_edit_textarea,
  css_button_separator,
  summarize_button_class,
  edit_button_class,
  forget_button_class
} from './constants.js';
import {
  toast,
  saveChatDebounced,
  get_chat_context_size,
  get_long_token_limit,
  get_short_token_limit,
  get_chat_cache_capacity,
  escape_string,
  unescape_string,
  clean_string_for_html,
  get_regex_script,
  add_i18n,
  refresh_select2_element,
  display_text_modal,
  assign_and_prune,
  assign_defaults,
  debug,
  error,
  log
} from './utils.js';
import {
  default_settings,
  settings_ui_map,
  get_settings,
  set_settings,
  chat_enabled,
  toggle_chat_enabled,
  load_profile,
  save_profile,
  export_profile,
  import_profile,
  rename_profile,
  new_profile,
  delete_profile,
  toggle_character_profile,
  toggle_chat_profile,
  get_connection_profiles,
  get_summary_connection_profile,
  set_ui_refresh_callback,
  detect_settings_difference
} from './state.js';
import {
  get_data,
  set_data,
  get_memory,
  get_chat_long_term_memory,
  set_chat_long_term_memory,
  check_message_exclusion,
  refresh_memory,
  set_budget_refresh_callback,
  set_memory_refresh_visuals_callback,
  get_injection_threshold_index
} from './memory.js';
import {
  summarize_message,
  summaryQueue,
  get_connection_profile_api,
  set_message_visuals_callback,
  set_all_visuals_callback
} from './summarization.js';
import {
  default_short_to_long_prompt,
  default_long_compaction_prompt,
  default_long_template,
  default_short_template,
  default_summary_macros,
  default_macro_settings,
  create_summary_prompt,
  compute_macro,
  evaluate_script
} from './macros.js';

// Hook up reactive callbacks
set_ui_refresh_callback(() => refresh_settings());
set_budget_refresh_callback(() => update_context_budget_displays());
set_message_visuals_callback((i, in_progress, custom_text) => update_message_visuals(i, in_progress, custom_text));
set_all_visuals_callback(() => update_all_message_visuals());
set_memory_refresh_visuals_callback(() => update_all_message_visuals());

// Message Visuals in Chat
function get_message_div(index) {
  if (typeof $ === 'undefined') return null;
  let div = $(`#chat .mes[mesid="${index}"]`);
  if (div.length > 0) return div;
  div = $(`.mes[mesid="${index}"]`);
  if (div.length > 0) return div;
  div = $(`div[mesid="${index}"]`);
  return div.length > 0 ? div : null;
}

export function is_message_excluded_from_context(i) {
  if (!chat_enabled()) return false;

  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || !chat[i]) return false;

  const iti = get_injection_threshold_index();
  if (iti === null || iti === undefined || iti < 0) {
    // No threshold calculated yet - Tavern handles all messages naturally
    return false;
  }

  return i <= iti;
}

export function open_edit_memory_input(index) {
  const ctx = getContext();
  const message = ctx?.chat?.[index];
  if (!message) return;
  const memory = (get_memory(message) || '').trim();

  const $message_div = get_message_div(index);
  if (!$message_div) return;
  const $message_text_div = $message_div.find('.mes_text');
  const $memory_div = $message_div.find(`div.${summary_div_class}`);

  const $textarea = $(`<textarea class="${css_message_div} ${css_edit_textarea} text_pole" rows="1"></textarea>`);
  $memory_div.hide();
  if ($message_text_div.length > 0) {
    $message_text_div.after($textarea);
  } else {
    $message_div.find('.mes_block').append($textarea);
  }
  $textarea.focus().val(memory);
  try {
    $textarea.height($textarea[0].scrollHeight - 6);
  } catch {}

  function confirm_edit() {
    const new_memory = $textarea.val().trim();
    $textarea.remove();
    if (new_memory !== memory) {
      set_data(message, 'memory', new_memory || null);
      set_data(message, 'edited', true);
      refresh_memory();
      saveChatDebounced();
    }
    update_message_visuals(index);
  }

  function cancel_edit() {
    $textarea.remove();
    $memory_div.show();
  }

  $textarea.on('blur', confirm_edit);
  $textarea.on('keydown', function (event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      confirm_edit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancel_edit();
    }
  });
}

export function update_message_visuals(i, in_progress = false, custom_text = null) {
  const div = get_message_div(i);
  if (!div || div.length === 0) return;
  div.find(`div.${summary_div_class}`).remove();

  // Control message exclusion visuals
  const is_excluded = is_message_excluded_from_context(i);
  if (is_excluded) {
    div.find(`.mes_text`).addClass(css_removed_message);
  } else {
    div.find(`.mes_text`).removeClass(css_removed_message);
  }

  if (!get_settings('display_memories') || !chat_enabled()) return;
  const ctx = getContext();
  const message = ctx?.chat?.[i];
  if (!message) return;

  const memory_text = custom_text || get_memory(message);
  if (!memory_text) return;

  const include = get_data(message, 'include');
  const iti = get_injection_threshold_index();
  const lagging = iti === null || iti === undefined ? true : (i > iti);

  // Default to short memory (fancy green styling)
  let style_class = css_short_memory;
  if (include === 'long') {
    style_class = css_long_memory;
  }
  if (lagging) {
    style_class += ` ${css_lagging_memory}`;
  }

  const summary_element = $(`<div class="${summary_div_class} ${css_message_div} ${style_class}" title="Click to edit summary"><i class="fa-solid fa-quote-left memnext_summary_icon"></i><span class="memnext_summary_text"></span></div>`);
  summary_element.find('.memnext_summary_text').text(memory_text);

  summary_element.on('click', function (e) {
    e.stopPropagation();
    open_edit_memory_input(i);
  });

  // Display directly under the message text, before the message buttons
  const mes_text = div.find('.mes_text');
  if (mes_text.length > 0) {
    mes_text.after(summary_element);
  } else {
    div.find('.mes_block').append(summary_element);
  }
}

export function update_all_message_visuals() {
  if (typeof $ === 'undefined') return;
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return;
  for (let i = 0; i < chat.length; i++) {
    update_message_visuals(i);
  }
}

export function update_context_budget_displays() {
  if (typeof $ === 'undefined') return;
  const context_size = get_chat_context_size();
  const long_tokens = get_long_token_limit();
  const short_tokens = get_short_token_limit();
  const { cc_max } = get_chat_cache_capacity(context_size);
  const threshold_percent = Number(get_settings('compaction_threshold_percent')) || 15;
  const threshold_tokens = Math.floor(cc_max * (threshold_percent / 100));

  $(`.${settings_content_class} #long_term_context_limit_display`).text(long_tokens);
  $(`.${settings_content_class} #short_term_context_limit_display`).text(short_tokens);
  $(`.${settings_content_class} #compaction_threshold_tokens_display`).text(threshold_tokens);
}

// Highlight save icon when active settings differ from saved profile
export function update_save_icon_highlight() {
  if (typeof $ === 'undefined') return;
  const isDirty = detect_settings_difference();
  const $saveBtn = $(`.${settings_content_class} #save_profile`);
  if (isDirty) {
    $saveBtn.addClass('button_highlight');
  } else {
    $saveBtn.removeClass('button_highlight');
  }
}

// UI Initialization & Binding
export let promptInterface1 = null;
export let promptInterface2 = null;
export let promptInterface3 = null;
export let promptInterfaceLongTemplate = null;
export let promptInterfaceShortTemplate = null;
export let memoryEditInterface = null;

export function initialize_settings_ui() {
  if (typeof $ === 'undefined') return;
  const bind_input = (id, key, type) => {
    const $el = $(`.${settings_content_class} #${id}`);
    if ($el.length === 0) return;
    settings_ui_map[key] = [$el, type];
    if (type === 'boolean') {
      $el.prop('checked', Boolean(get_settings(key)));
      $el.off('change.memnext').on('change.memnext', function () {
        set_settings(key, $(this).prop('checked'));
        if (key === 'disable_plugin') {
          $(`.${settings_content_class} #memnext_profile_options`).toggle(!$(this).prop('checked'));
        }
        refresh_memory();
        update_save_icon_highlight();
      });
    } else if (type === 'number') {
      $el.val(get_settings(key));
      $el.off('change.memnext input.memnext').on('change.memnext input.memnext', function () {
        set_settings(key, Number($(this).val()));
        refresh_memory();
        update_save_icon_highlight();
      });
    } else {
      $el.val(get_settings(key));
      $el.off('change.memnext input.memnext').on('change.memnext input.memnext', function () {
        set_settings(key, $(this).val());
        refresh_memory();
        update_save_icon_highlight();
      });
    }
  };

  bind_input('disable_plugin', 'disable_plugin', 'boolean');
  bind_input('auto_summarize', 'auto_summarize', 'boolean');
  bind_input('auto_summarize_on_edit', 'auto_summarize_on_edit', 'boolean');
  bind_input('auto_summarize_on_swipe', 'auto_summarize_on_swipe', 'boolean');
  bind_input('auto_summarize_on_continue', 'auto_summarize_on_continue', 'boolean');
  bind_input('block_chat', 'block_chat', 'boolean');
  bind_input('auto_summarize_progress', 'auto_summarize_progress', 'boolean');
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
  bind_input('auto_summarize_message_limit', 'auto_summarize_message_limit', 'number');
  bind_input('long_term_context_limit', 'long_term_context_limit', 'number');
  bind_input('short_term_context_limit', 'short_term_context_limit', 'number');
  bind_input('compaction_threshold_percent', 'compaction_threshold_percent', 'number');
  bind_input('messages_to_keep', 'messages_to_keep', 'number');
  bind_input('kept_messages_context_threshold', 'kept_messages_context_threshold', 'number');
  bind_input('message_length_threshold', 'message_length_threshold', 'number');
  bind_input('summary_injection_separator', 'summary_injection_separator', 'text');
  bind_input('injection_position', 'injection_position', 'number');
  bind_input('injection_role', 'injection_role', 'number');

  // Prompt Edit buttons
  $(`.${settings_content_class} #edit_message_summary_prompt`).on('click', () => promptInterface1?.show());
  $(`.${settings_content_class} #edit_short_to_long_prompt`).on('click', () => promptInterface2?.show());
  $(`.${settings_content_class} #edit_long_compaction_prompt`).on('click', () => promptInterface3?.show());
  $(`.${settings_content_class} #edit_long_template`).on('click', () => promptInterfaceLongTemplate?.show());
  $(`.${settings_content_class} #edit_short_template`).on('click', () => promptInterfaceShortTemplate?.show());

  // Top action buttons
  $(`.${settings_content_class} #toggle_chat_memory`).on('click', toggle_chat_enabled);
  $(`.${settings_content_class} #edit_memory_state`).on('click', () => memoryEditInterface?.show());
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
    if (summaryQueue.tasks.length > 0) {
      toast(`Queued ${summaryQueue.tasks.length} messages for summarization.`, "info");
      await summaryQueue.run();
    } else {
      toast("All eligible messages already have summaries. Running memory compaction...", "info");
      await refresh_memory();
    }
    update_all_message_visuals();
    toast("Full chat summarization and memory update complete.", "success");
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
  $(`.${settings_content_class} #save_profile`).off('click').on('click', () => {
    save_profile();
    update_save_icon_highlight();
  });
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
  initialize_chat_menu_buttons();
}

export function update_connection_profile_dropdown() {
  if (typeof $ === 'undefined') return;
  const $dropdown = $(`.${settings_content_class} #connection_profile`).empty();
  $dropdown.append(`<option value="">Current Tavern Connection</option>`);
  const profiles = get_connection_profiles();
  for (const p of profiles) {
    $dropdown.append(`<option value="${p.id}">${escape_string(p.name)}</option>`);
  }
  $dropdown.val(get_settings('connection_profile') || '');
  $dropdown.on('change', function () {
    set_settings('connection_profile', $(this).val());
    update_save_icon_highlight();
  });
}

export function refresh_settings() {
  if (typeof $ === 'undefined') return;
  for (const [key, [element, type]] of Object.entries(settings_ui_map)) {
    if (!element || element.length === 0) continue;
    const val = get_settings(key);
    if (type === 'boolean') {
      element.prop('checked', Boolean(val));
    } else {
      element.val(val);
    }
  }
  const is_disabled = Boolean(get_settings('disable_plugin'));
  $(`.${settings_content_class} #memnext_profile_options`).toggle(!is_disabled);

  const enabled = chat_enabled();
  $(`.${settings_content_class} #toggle_chat_memory span`).text(enabled ? (t ? t`Memory: Enabled` : `Memory: Enabled`) : (t ? t`Memory: Disabled` : `Memory: Disabled`));
  $(`.${settings_content_class} #toggle_chat_memory`).toggleClass('button_highlight', enabled);
  update_context_budget_displays();
  update_save_icon_highlight();
}

export function initialize_chat_menu_buttons() {
  if (typeof $ === 'undefined') return;
  const $extensions_menu = $('#extensionsMenu');
  if (!$extensions_menu.length) return;
  if ($extensions_menu.find('#memnext_toggle_display_btn').length > 0) return;

  const $btn = $(`
    <div id="memnext_toggle_display_btn" class="list-group-item flex-container flexGap5 interactable" title="Toggle MemNext summaries display in chat" tabindex="0">
      <i class="fa-solid fa-eye"></i>
      <span>Toggle Memories Display</span>
    </div>
  `);

  $btn.on('click', () => {
    const current = get_settings('display_memories');
    set_settings('display_memories', !current);
    save_profile(get_settings('profile'), true);
    $(`.${settings_content_class} #display_memories`).prop('checked', !current);
    update_all_message_visuals();
  });

  $extensions_menu.append($btn);
}

// In-chat Message Buttons
export function initialize_message_buttons() {
  if (typeof $ === 'undefined') return;
  const message_buttons_template = `
<div class="${css_button_separator}"></div>
<div class="mes_button fa-solid fa-quote-left ${summarize_button_class}" title="Summarize message (MemNext)"></div>
<div class="mes_button fa-solid fa-pencil ${edit_button_class}" title="Edit summary (MemNext)"></div>
<div class="mes_button fa-solid fa-trash ${forget_button_class}" title="Delete summary (MemNext)"></div>
`;

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
    open_edit_memory_input(mes_id);
  });

  $('#message_template .mes_buttons .extraMesButtons').prepend(message_buttons_template);
  $('#chat .mes').each(function () {
    const $buttons = $(this).find('.extraMesButtons');
    if ($buttons.length > 0 && $buttons.find(`.${summarize_button_class}`).length === 0) {
      $buttons.prepend(message_buttons_template);
    }
  });
}

// Popout logic
let POPOUT_VISIBLE = false;
export let $popout = null;
export let $settings_element = null;
export let $original_settings_parent = null;

export function initialize_popout() {
  if (typeof $ === 'undefined') return;
  $settings_element = $(`#${settings_div_id}`).find(`.inline-drawer-content .${settings_content_class}`);
  $original_settings_parent = $settings_element.parent();
  const avatarTemplate = $('#zoomed_avatar_template');
  if (avatarTemplate.length === 0) return;
  $popout = $(avatarTemplate.html());
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
  if (!$popout) return;
  $('body').append($popout);
  if (typeof loadMovingUIState === 'function') loadMovingUIState();
  if (typeof dragElement === 'function') dragElement($popout);
  $popout.find('.dragClose').off('click').on('click', function () {
    close_popout();
  });
  $settings_element.appendTo($popout);
  $popout.fadeIn(animation_duration || 200);
  POPOUT_VISIBLE = true;
}

export function close_popout() {
  if (!$popout) return;
  $popout.fadeOut(animation_duration || 200, () => {
    $settings_element.appendTo($original_settings_parent);
    $popout.remove();
  });
  POPOUT_VISIBLE = false;
}

// PromptEditInterface
export class PromptEditInterface {
  constructor(config) {
    this.setting_key = config.setting_key;
    this.title = config.title;
    this.description = config.description;
    this.default_prompt = config.default_prompt;
    this.macros = config.macros || [];
    this.ctx = getContext();

    let macros_html = "";
    if (this.macros.length > 0) {
      macros_html = `<div style="flex: 1; border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px; padding: 10px; overflow-y: auto; background-color: var(--SmartThemeBlurTintColor);">
                <h4 style="margin-top: 0; margin-bottom: 10px;">Available Macros</h4>`;
      for (let m of this.macros) {
        macros_html += `<div style="margin-bottom: 10px;">
                    <div style="font-family: monospace; font-weight: bold; margin-bottom: 3px;">{{${m.name}}}</div>
                    <div style="font-size: 0.9em; opacity: 0.9;">${m.desc}</div>
                </div>`;
      }
      macros_html += `</div>`;
    }

    this.html_template = `
<div id="memnext_prompt_interface" style="height: 100%; display: flex; flex-direction: column;">
    <div class="flex-container justifyspacebetween alignitemscenter" style="margin-bottom: 10px;">
        <h3 class="margin0">${this.title}</h3>
        <i class="fa-solid fa-info-circle" title="${this.description}"></i>
        <button id="restore_default" class="menu_button fa-solid fa-recycle red_button" title="Restore default prompt" style="margin-left: auto;"></button>
    </div>
    <div style="flex: 1; display: flex; gap: 10px; margin-bottom: 10px;">
        <div style="${this.macros.length > 0 ? 'flex: 2;' : 'flex: 1;'}">
            <textarea id="prompt_text" class="text_pole" style="width: 100%; height: 100%; box-sizing: border-box; resize: none; font-family: monospace;"></textarea>
        </div>
        ${macros_html}
    </div>
</div>
`;
  }

  async show() {
    if (!this.ctx?.Popup) return;
    const popup = new this.ctx.Popup(this.html_template, this.ctx.POPUP_TYPE.TEXT, '', {
      wider: true,
      okButton: 'Save',
      cancelButton: 'Cancel'
    });
    const $content = $(popup.content);
    $content.closest('dialog').css('min-width', '70%');
    const $textarea = $content.find('#prompt_text');
    const $restore = $content.find('#restore_default');
    $textarea.val(get_settings(this.setting_key) || this.default_prompt);
    $restore.on('click', () => {
      $textarea.val(this.default_prompt);
    });
    const result = await popup.show();
    if (result) {
      set_settings(this.setting_key, $textarea.val());
      update_save_icon_highlight();
      toast(`${this.title} saved.`, "success");
    }
  }
}

// MemoryEditInterface
export class MemoryEditInterface {
  ctx = getContext();
  pageSize = 10;
  currentPage = 1;
  selectedIndices = new Set();
  activeTab = 'short_term';

  constructor() {
    this.html_template = `
<div id="memnext_memory_state_interface" style="height: 100%; display: flex; flex-direction: column;">
    <div class="flex-container alignitemscenter" style="gap: 10px; margin-bottom: 10px; border-bottom: 1px solid var(--SmartThemeBorderColor); padding-bottom: 8px;">
        <button id="tab_btn_short_term" class="menu_button tab_button active"><i class="fa-solid fa-clock-rotate-left"></i> Short-Term Memory</button>
        <button id="tab_btn_long_term" class="menu_button tab_button"><i class="fa-solid fa-book-bookmark"></i> Long-Term Memory</button>
        <button id="refresh_table" class="menu_button fa-solid fa-sync margin0" title="Refresh Table" style="margin-left: auto;"></button>
    </div>

    <!-- Tab 1: Short-Term Memory -->
    <div id="memnext_tab_short_term" class="memnext_tab_content" style="flex: 1; display: flex; flex-direction: column; overflow: hidden;">
        <div class="flex-container justifyspacebetween alignitemscenter" style="gap: 10px; margin-bottom: 5px;">
            <div class="flex-container alignitemscenter" style="gap: 10px; margin-left: auto;">
                <label class="flex-container alignitemscenter" style="gap: 5px; margin: 0; font-size: 0.9em;" title="Number of messages to display per page">
                    <span>Display on page:</span>
                    <select id="memnext_page_size" class="text_pole widthUnset inline_setting" style="margin: 0; padding: 2px 6px;">
                        <option value="5">5</option>
                        <option value="10" selected>10</option>
                        <option value="15">15</option>
                        <option value="20">20</option>
                    </select>
                </label>
                <div class="flex-container alignitemscenter" style="gap: 5px;">
                    <button id="memnext_prev_page" class="menu_button fa-solid fa-chevron-left margin0" title="Previous Page"></button>
                    <span id="memnext_page_info" style="font-size: 0.9em; min-width: 90px; text-align: center;">Page 1 / 1</span>
                    <button id="memnext_next_page" class="menu_button fa-solid fa-chevron-right margin0" title="Next Page"></button>
                </div>
            </div>
        </div>
        <hr style="margin: 5px 0;">
        <div id="progress_bar"></div>
        <div style="flex: 1; overflow-y: auto;">
            <table cellspacing="0" style="width: 100%;">
                <thead>
                    <tr>
                        <th class="checkbox_col"><input type="checkbox" id="memnext_select_all_messages" title="Select all on this page"></th>
                        <th title="Message ID"><i class="fa-solid fa-hashtag"></i></th>
                        <th title="Sender"><i class="fa-solid fa-comment"></i></th>
                        <th title="Summary Text">Summary</th>
                        <th class="actions">Actions</th>
                    </tr>
                </thead>
                <tbody></tbody>
            </table>
        </div>
        <hr style="margin: 5px 0;">
        <div class="flex-container alignitemscenter" style="gap: 10px; flex-wrap: wrap;">
            <button id="bulk_summarize_all" class="menu_button"><i class="fa-solid fa-quote-left"></i> Summarize All Empty</button>
            <button id="summarize_selected" class="menu_button" disabled><i class="fa-solid fa-list-check"></i> Summarize Selected</button>
            <button id="delete_selected" class="menu_button red_button" disabled><i class="fa-solid fa-trash"></i> Delete Selected</button>
        </div>
    </div>

    <!-- Tab 2: Long-Term Memory -->
    <div id="memnext_tab_long_term" class="memnext_tab_content" style="flex: 1; display: none; flex-direction: column; overflow: hidden;">
        <div class="flex-container justifyspacebetween alignitemscenter" style="margin-bottom: 5px;">
            <h4 class="margin0">Long-Term Memory</h4>
        </div>
        <hr style="margin: 5px 0;">
        <div id="long_term_memory_container" style="flex: 1; display: flex; flex-direction: column; overflow-y: auto;">
            <div id="long_term_placeholder" style="opacity: 0.8; font-style: italic; padding: 12px;">
                No long-term memory consolidated yet.
            </div>
        </div>
    </div>
</div>
`;
  }

  async show() {
    if (!this.ctx?.Popup) return;
    const popup = new this.ctx.Popup(this.html_template, this.ctx.POPUP_TYPE.TEXT, '', {
      wider: true
    });
    const $content = $(popup.content);
    $content.closest('dialog').css('min-width', '80%');

    this.pageSize = 10;
    this.currentPage = 1;
    this.selectedIndices = new Set();
    this.activeTab = 'short_term';

    const $tabBtnShort = $content.find('#tab_btn_short_term');
    const $tabBtnLong = $content.find('#tab_btn_long_term');
    const $tabContentShort = $content.find('#memnext_tab_short_term');
    const $tabContentLong = $content.find('#memnext_tab_long_term');
    const $ltContainer = $content.find('#long_term_memory_container');

    const switchTab = (tab) => {
      this.activeTab = tab;
      if (tab === 'short_term') {
        $tabBtnShort.addClass('active');
        $tabBtnLong.removeClass('active');
        $tabContentShort.show().css('display', 'flex');
        $tabContentLong.hide();
      } else {
        $tabBtnLong.addClass('active');
        $tabBtnShort.removeClass('active');
        $tabContentLong.show().css('display', 'flex');
        $tabContentShort.hide();
        populateLongTerm();
      }
    };

    $tabBtnShort.on('click', () => switchTab('short_term'));
    $tabBtnLong.on('click', () => switchTab('long_term'));

    const populateLongTerm = () => {
      const longMem = get_chat_long_term_memory();
      if (longMem && longMem.trim().length > 0) {
        $ltContainer.html(`<div style="padding: 12px; white-space: pre-wrap; font-family: monospace; background: var(--SmartThemeBlurTintColor); border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px; flex: 1; overflow-y: auto;">${escape_string(longMem)}</div>`);
      } else {
        $ltContainer.html(`<div id="long_term_placeholder" style="opacity: 0.8; font-style: italic; padding: 12px;">No long-term memory consolidated yet.</div>`);
      }
    };

    const $tbody = $content.find('tbody');
    const $selectAll = $content.find('#memnext_select_all_messages');
    const $pageSize = $content.find('#memnext_page_size');
    const $prevBtn = $content.find('#memnext_prev_page');
    const $nextBtn = $content.find('#memnext_next_page');
    const $pageInfo = $content.find('#memnext_page_info');
    const $summarizeSelected = $content.find('#summarize_selected');
    const $deleteSelected = $content.find('#delete_selected');

    $pageSize.val(String(this.pageSize));

    const updateActionButtons = () => {
      const hasSelection = this.selectedIndices.size > 0;
      $summarizeSelected.prop('disabled', !hasSelection);
      $deleteSelected.prop('disabled', !hasSelection);
    };

    const updateSelectAllState = (visibleIndices) => {
      if (!visibleIndices || visibleIndices.length === 0) {
        $selectAll.prop('checked', false).prop('indeterminate', false);
        return;
      }
      const allSelected = visibleIndices.every(idx => this.selectedIndices.has(idx));
      const someSelected = visibleIndices.some(idx => this.selectedIndices.has(idx));
      if (allSelected) {
        $selectAll.prop('checked', true).prop('indeterminate', false);
      } else if (someSelected) {
        $selectAll.prop('checked', false).prop('indeterminate', true);
      } else {
        $selectAll.prop('checked', false).prop('indeterminate', false);
      }
    };

    const populate = () => {
      $tbody.empty();
      const chat = this.ctx?.chat || [];
      const totalMessages = chat.length;
      const totalPages = Math.max(1, Math.ceil(totalMessages / this.pageSize));

      if (this.currentPage > totalPages) this.currentPage = totalPages;
      if (this.currentPage < 1) this.currentPage = 1;

      $pageInfo.text(`Page ${this.currentPage} / ${totalPages}`);
      $prevBtn.prop('disabled', this.currentPage <= 1);
      $nextBtn.prop('disabled', this.currentPage >= totalPages);

      const startIndex = (this.currentPage - 1) * this.pageSize;
      const endIndex = Math.min(totalMessages, startIndex + this.pageSize);
      const visibleIndices = [];

      for (let i = startIndex; i < endIndex; i++) {
        const msg = chat[i];
        if (!msg) continue;
        visibleIndices.push(i);
        const mem = get_memory(msg) || '';
        const sender = msg.name || (msg.is_user ? 'User' : 'Character');
        const isChecked = this.selectedIndices.has(i);

        const $tr = $(`<tr>
                    <td class="checkbox_col">
                        <input type="checkbox" class="memnext_message_checkbox" data-index="${i}" ${isChecked ? 'checked' : ''}>
                    </td>
                    <td>${i}</td>
                    <td><b>${escape_string(sender)}</b></td>
                    <td class="memory_text_cell">
                        <span class="mem_display" style="cursor: pointer;" title="Click or use Edit button to edit summary">${escape_string(mem)}</span>
                    </td>
                    <td class="memory_actions_cell">
                        <button class="menu_button row_edit fa-solid fa-pencil" title="Edit Summary"></button>
                        <button class="menu_button row_summarize fa-solid fa-quote-left" title="Summarize"></button>
                        <button class="menu_button row_clear fa-solid fa-trash red_button" title="Delete"></button>
                    </td>
                </tr>`);

        const startEdit = () => {
          const currentMem = get_memory(msg) || '';
          const $cell = $tr.find('.memory_text_cell');
          const $actions = $tr.find('.memory_actions_cell');
          $actions.find('.row_edit, .row_summarize, .row_clear').prop('disabled', true);

          const $editContainer = $(`
            <div class="inline_edit_container" style="display: flex; gap: 5px; align-items: center; width: 100%;">
                <textarea class="text_pole inline_edit_textarea" style="flex: 1; resize: vertical; min-height: 40px; font-size: 0.9em; box-sizing: border-box;"></textarea>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <button class="menu_button row_save fa-solid fa-check" title="Save (Enter)" style="color: #28a745; margin: 0;"></button>
                    <button class="menu_button row_cancel fa-solid fa-xmark red_button" title="Cancel (Esc)" style="margin: 0;"></button>
                </div>
            </div>
          `);

          $cell.empty().append($editContainer);
          const $textarea = $editContainer.find('textarea');
          $textarea.val(currentMem).focus();

          const saveEdit = async () => {
            const newMem = $textarea.val().trim();
            if (newMem !== currentMem) {
              set_data(msg, 'memory', newMem || null);
              set_data(msg, 'edited', true);
              saveChatDebounced();
              await refresh_memory();
              update_all_message_visuals();
            }
            populate();
          };

          const cancelEdit = () => {
            populate();
          };

          $editContainer.find('.row_save').on('click', saveEdit);
          $editContainer.find('.row_cancel').on('click', cancelEdit);

          $textarea.on('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              saveEdit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              cancelEdit();
            }
          });
        };

        $tr.find('.row_edit').on('click', startEdit);
        $tr.find('.mem_display').on('click', startEdit);

        $tr.find('.memnext_message_checkbox').on('change', (e) => {
          if (e.target.checked) {
            this.selectedIndices.add(i);
          } else {
            this.selectedIndices.delete(i);
          }
          updateSelectAllState(visibleIndices);
          updateActionButtons();
        });

        $tr.find('.row_summarize').on('click', async () => {
          await summarize_message(i);
          populate();
        });

        $tr.find('.row_clear').on('click', () => {
          set_data(msg, 'memory', null);
          populate();
          refresh_memory();
          saveChatDebounced();
        });

        $tbody.append($tr);
      }

      updateSelectAllState(visibleIndices);
      updateActionButtons();
    };

    $selectAll.on('change', () => {
      const chat = this.ctx?.chat || [];
      const totalMessages = chat.length;
      const startIndex = (this.currentPage - 1) * this.pageSize;
      const endIndex = Math.min(totalMessages, startIndex + this.pageSize);
      const visibleIndices = [];
      for (let i = startIndex; i < endIndex; i++) {
        if (chat[i]) visibleIndices.push(i);
      }
      const allSelected = visibleIndices.length > 0 && visibleIndices.every(idx => this.selectedIndices.has(idx));
      if (allSelected) {
        for (let idx of visibleIndices) {
          this.selectedIndices.delete(idx);
        }
      } else {
        for (let idx of visibleIndices) {
          this.selectedIndices.add(idx);
        }
      }
      populate();
    });

    $pageSize.on('change', () => {
      this.pageSize = Number($pageSize.val()) || 10;
      this.currentPage = 1;
      populate();
    });

    $prevBtn.on('click', () => {
      if (this.currentPage > 1) {
        this.currentPage--;
        populate();
      }
    });

    $nextBtn.on('click', () => {
      const chat = this.ctx?.chat || [];
      const totalPages = Math.max(1, Math.ceil(chat.length / this.pageSize));
      if (this.currentPage < totalPages) {
        this.currentPage++;
        populate();
      }
    });

    $content.find('#refresh_table').on('click', () => {
      if (this.activeTab === 'short_term') {
        populate();
      } else {
        populateLongTerm();
      }
    });

    $content.find('#bulk_summarize_all').on('click', async () => {
      const chat = this.ctx?.chat || [];
      for (let i = 0; i < chat.length; i++) {
        if (!get_memory(chat[i]) && check_message_exclusion(chat[i])) {
          summaryQueue.add(i);
        }
      }
      if (summaryQueue.tasks.length > 0) {
        await summaryQueue.run();
      } else {
        await refresh_memory();
      }
      update_all_message_visuals();
      populate();
    });

    $summarizeSelected.on('click', async () => {
      if (this.selectedIndices.size === 0) return;
      const chat = this.ctx?.chat || [];
      const sorted = Array.from(this.selectedIndices).sort((a, b) => a - b);
      for (let idx of sorted) {
        if (chat[idx]) {
          summaryQueue.add(idx);
        }
      }
      this.selectedIndices.clear();
      if (summaryQueue.tasks.length > 0) {
        await summaryQueue.run();
      } else {
        await refresh_memory();
      }
      update_all_message_visuals();
      populate();
    });

    $deleteSelected.on('click', async () => {
      if (this.selectedIndices.size === 0) return;
      const chat = this.ctx?.chat || [];
      for (let idx of this.selectedIndices) {
        const msg = chat[idx];
        if (msg) {
          set_data(msg, 'memory', null);
        }
      }
      this.selectedIndices.clear();
      saveChatDebounced();
      await refresh_memory();
      update_all_message_visuals();
      populate();
    });

    populate();
    await popup.show();
  }
}

// SummaryPromptEditInterface
export class SummaryPromptEditInterface {
  html_template = `
<div id="qvink_summary_prompt_interface" style="height: 100%">
<div class="flex-container justifyspacebetween">
    <div class="flex2 toggle-macro">
        <div class="flex-container justifyspacebetween alignitemscenter">
            <h3>Summary Prompt</h3>
            <i class="fa-solid fa-info-circle" style="margin-right: 1em" title="Customize the prompt used for summarizing messages."></i>
            <button id="preview_summary_prompt" class="menu_button fa-solid fa-eye margin0" title="Preview current summary prompt (the exact text that will be sent to the model)"></button>
            <button id="restore_default_prompt" class="menu_button fa-solid fa-recycle margin0 red_button" title="Restore the default prompt"></button>

            <label class="flex-container alignItemsCenter" title="Role used for the summary prompt" style="margin-left: auto;">
                <span>Role: </span>
                <select id="prompt_role" class="text_pole inline_setting">
                    <option value="0">System</option>
                    <option value="1">User</option>
                    <option value="2">Assistant</option>
                </select>
            </label>
            <button class="menu_button fa-solid fa-list-check margin0 qm-small open_macros" title="Show/hide macro editor"></button>

        </div>
    </div>
    <div class="flex1 qm-large toggle-macro" style="height: 100%">
        <div class="flex-container justifyspacebetween alignitemscenter">
            <h3 class="flex2">Macros <i class="fa-solid fa-info-circle" title="Dynamic macros only available for the summary prompt."></i></h3>
            <button id="add_macro" class="flex1 menu_button" title="Add a new macro">New</button>
            <button class="menu_button fa-solid fa-list-check margin0 qm-small open_macros" title="Show/hide macro editor"></button>
        </div>
    </div>
</div>

<div class="flex-container justifyspacebetween" style="height: calc(100% - 120px);">
    <div class="flex2 toggle-macro">
        <textarea id="prompt" class="" style="height: 100%; overflow-y: auto"></textarea>
    </div>
    <div class="flex1 qm-large toggle-macro" style="height: 100%">
        <div id="macro_definitions" style="height: 100%; overflow-y: auto"></div>
    </div>
</div>

<div class="flex-container justifyspacebetween alignitemscenter">
    <label title="Start the summarization with this prefilled text." class="checkbox_label">
        <span>Prefill</span>
        <input id="prefill" class="text_pole" type="text" placeholder="Start reply with...">
    </label>

    <label title="Include the prefill in displayed memories and injections (no effect with reasoning models)" class="checkbox_label">
        <input id="show_prefill" type="checkbox" />
        <span>Include in Memories</span>
    </label>
</div>

</div>
`;

  macro_definition_template = `
<div class="macro_definition qvink_interface_card">
<div class="inline-drawer">
    <div class="inline-drawer-header flex-container alignitemscenter justifySpaceBetween">
        <div class="flex-container alignitemscenter margin0 flex1" style="gap: 5px; margin-right: 5px;">
            <button class="macro_enable menu_button fa-solid margin0"></button>
            <button class="macro_preview menu_button fa-solid fa-eye margin0" title="Preview the result of this macro"></button>
            <input class="macro_name flex1 text_pole" type="text" placeholder="name">
            <button class="macro_restore menu_button red_button fa-solid fa-recycle margin0" title="Restore default macro"></button>
            <button class="macro_delete menu_button red_button fa-solid fa-trash margin0" title="Delete macro"></button>
        </div>
        <div class="inline-drawer-toggle">
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
    </div>

    <div class="inline-drawer-content">
        <div class="flex-container alignitemscenter justifyCenter">
            <div class="macro_type flex2">
                <label>
                    <input type="radio" value="preset" />
                    <span>Range</span>
                </label>
                <label>
                    <input type="radio" value="custom" />
                    <span>STScript</span>
                </label>
            </div>
        </div>

        <div class="macro_type_range">
            <div title="The range of messages to replace this macro, relative to the message being summarized (which is at 0). For example, setting this to (3, 10) will include from the 3rd to the 10th message back in the chat.">
                <input class="macro_preset_start text_pole widthUnset" type="number" min="0" max="99" />
                <span> - </span>
                <input class="macro_preset_end text_pole widthUnset" type="number" min="0" max="99" />
            </div>

            <label title="Bot messages within the range above will be included" class="checkbox_label">
                <input class="macro_preset_bot_messages" type="checkbox" />
                <span>Bot Messages</span>
            </label>
            <label title="Summaries on bot messages within the range above will be included" class="checkbox_label">
                <input class="macro_preset_bot_summaries" type="checkbox" />
                <span>Bot Summaries</span>
            </label>
            <label title="User messages within the range above will be included" class="checkbox_label">
                <input class="macro_preset_user_messages" type="checkbox" />
                <span>User Messages</span>
            </label>
            <label title="Summaries on user messages within the range above will be included" class="checkbox_label">
                <input class="macro_preset_user_summaries" type="checkbox" />
                <span>User Summaries</span>
            </label>
        </div>

        <div class="macro_type_message">
            <table style="width: 100%;">
                <tr title="Each message will be replaced by the return value of the script when run. Use {{message}} for the text of the message and {{id}} for the ID of the message.">
                    <td><span>STScript</span></td>
                    <td><input class="macro_command text_pole" type="text" placeholder="STScript"></td>
                </tr>
                <tr title="Select regex scripts to run on each message. This will occur before the messages are passed to the above script.">
                    <td><span>Regex</span></td>
                    <td><select multiple="multiple" class="regex_select"></select></td>
                </tr>
            </table>
        </div>

        <div class="macro_type_script">
            <label title="The macro will be replaced by the return value of the script when run. Use {{message}} for the text of the message and {{id}} for the ID of the message." class="checkbox_label">
                <input class="macro_command text_pole" type="text" placeholder="STScript">
            </label>
        </div>

        <div class="macro_type_any flex-container alignitemscenter">
            <label title="[Text Completion]: The result of this macro will be wrapped in your instruct template. [Chat Completion]: The result of this macro will be added as a separate message." class="checkbox_label">
                <input class="macro_instruct_template" type="checkbox">
                <span>Separate Block</span>
            </label>
        </div>

    </div>
</div>
</div>
`;

  ctx = getContext();
  static fa_enabled = "fa-check";
  static fa_disabled = "fa-xmark";
  default_macro_settings = default_macro_settings;

  constructor() {
    this.from_settings();
  }

  async init() {
    this.popup = new this.ctx.Popup(this.html_template, this.ctx.POPUP_TYPE.TEXT, '', {
      wider: true,
      okButton: 'Save',
      cancelButton: 'Cancel'
    });
    this.$content = $(this.popup.content);
    this.$buttons = this.$content.find('.popup-controls');
    this.$preview = this.$content.find('#preview_summary_prompt');
    this.$restore = this.$content.find('#restore_default_prompt');
    this.$definitions = this.$content.find('#macro_definitions');
    this.$add_macro = this.$content.find('#add_macro');
    this.$open_macros = this.$content.find('.open_macros');

    this.$prompt = this.$content.find('#prompt');
    this.$prompt_role = this.$content.find('#prompt_role');
    this.$prefill = this.$content.find('#prefill');
    this.$show_prefill = this.$content.find('#show_prefill');

    this.$content.closest('dialog').css({
      'min-width': '80%',
      'height': '70vh'
    });

    this.$preview.on('click', () => this.preview_prompt());
    this.$add_macro.on('click', () => this.new_macro());
    this.$restore.on('click', () => this.$prompt.val(default_settings["message_summary_prompt"]));
    this.$open_macros.on('click', () => {
      this.$content.find('.toggle-macro').toggle();
    });

    this.$buttons.find('.popup-button-ok').attr('title', 'Save changes to the prompt and macros');
    this.$buttons.find('.popup-button-cancel').attr('title', 'Discard changes to the prompt and macros');

    this.from_settings();
    this.api = await get_connection_profile_api();
    add_i18n(this.$content);
  }

  async show() {
    await this.init();
    this.update_macros();
    let result = await this.popup.show();
    if (result) {
      this.save_settings();
    }
    refresh_settings();
  }

  update_macros(macro = null) {
    if (macro === null) {
      for (let name of this.list_macros()) {
        let m = this.get_macro(name);
        this.create_macro_interface(m);
      }
    } else {
      this.create_macro_interface(macro);
    }
    add_i18n(this.$content);
  }

  create_macro_interface(macro) {
    let id = this.get_id(macro.name);
    let $macro = this.$definitions.find(`#${id}`);

    if ($macro.length > 0) {
      let $template = $(this.macro_definition_template);
      let $drawer_content = $macro.find('.inline-drawer-content');
      $drawer_content.empty();
      $drawer_content.append($template.find('.inline-drawer-content').children());
      let $header_content = $macro.find('.inline-drawer-header');
      $header_content.children().first().remove();
      $header_content.prepend($template.find('.inline-drawer-header').children().first());
    } else {
      $macro = $(this.macro_definition_template).prependTo(this.$definitions);
      $macro.attr('id', id);
    }

    let safe_macro_name = String(macro.name).replace(/[^a-zA-Z0-9_-]/g, '_');
    let radio_group_name = `macro_type_radio_${safe_macro_name}`;
    $macro.find(`.macro_type input`).attr('name', radio_group_name);

    let $range_div = $macro.find(".macro_type_range");
    let $message_div = $macro.find(".macro_type_message");
    let $script_div = $macro.find(".macro_type_script");
    let $macro_type_div = $macro.find('.macro_type');
    let $macro_type_radios = $macro.find(`input[name="${radio_group_name}"]`);
    let $macro_preset_start = $macro.find(".macro_preset_start");
    let $macro_preset_end = $macro.find(".macro_preset_end");
    let $macro_preset_bot_messages = $macro.find(".macro_preset_bot_messages");
    let $macro_preset_bot_summaries = $macro.find(".macro_preset_bot_summaries");
    let $macro_preset_user_messages = $macro.find(".macro_preset_user_messages");
    let $macro_preset_user_summaries = $macro.find(".macro_preset_user_summaries");
    let $macro_command_message = $macro.find(".macro_type_message input.macro_command");
    let $macro_command_script = $macro.find(".macro_type_script input.macro_command");
    let $macro_instruct = $macro.find(".macro_instruct_template");
    let $regex_select = $macro.find(".regex_select");
    let $name = $macro.find("input.macro_name");
    let $enable = $macro.find("button.macro_enable");
    let $preview = $macro.find("button.macro_preview");
    let $delete = $macro.find("button.macro_delete");
    let $restore = $macro.find("button.macro_restore");

    function set_enabled() {
      if (macro.enabled) {
        $enable.removeClass(SummaryPromptEditInterface.fa_disabled);
        $enable.addClass(SummaryPromptEditInterface.fa_enabled);
        $enable.removeClass("red_button");
        $enable.addClass("button_highlight");
        $enable.prop('title', "Enabled");
      } else {
        $enable.removeClass(SummaryPromptEditInterface.fa_enabled);
        $enable.addClass(SummaryPromptEditInterface.fa_disabled);
        $enable.removeClass("button_highlight");
        $enable.addClass("red_button");
        $enable.prop('title', "Disabled");
      }
    }

    function show_settings_div() {
      if (macro.type === "preset") {
        try {
          $range_div.show();
          $message_div.show();
          $macro_command_message.change();
        } catch {}
        $script_div.hide();
      } else if (macro.type === "custom") {
        $range_div.hide();
        $message_div.hide();
        try {
          $script_div.show();
          $macro_command_script.change();
        } catch {}
      }
    }
    show_settings_div();

    $preview.on('click', async () => await this.preview_macro(macro));
    set_enabled();
    $enable.on('click', async () => {
      macro.enabled = !macro.enabled;
      set_enabled();
    });

    if (macro.description) {
      $name.attr('title', macro.description);
    }
    if (macro.type === "special") {
      $macro_type_div.remove();
      $range_div.remove();
      $script_div.remove();
      $macro.find('.inline-drawer-toggle').hide();
      $macro.find('.inline-drawer-content').remove();
    }

    // Both default and custom macros can be deleted
    $delete.on('click', (e) => {
      e.stopPropagation();
      delete this.macros[macro.name];
      $macro.remove();
    });

    if (macro.default) {
      $name.prop('disabled', true);
      $restore.on('click', (e) => {
        e.stopPropagation();
        this.restore_macro_default(macro.name);
      });
    } else {
      $restore.remove();
    }

    $name.val(macro.name);
    $name.on('change', () => {
      let old_name = macro.name;
      let new_name = $name.val();
      if (old_name === new_name) return;
      if (macro.default || macro.type === "special") {
        $name.val(old_name);
        return;
      }
      new_name = this.get_unique_name(new_name);
      macro.name = new_name;
      this.macros[new_name] = macro;
      delete this.macros[old_name];
      $macro.attr('id', this.get_id(new_name));
      $name.val(new_name);
    });

    $macro_type_radios.filter(`[value="${macro.type}"]`).prop('checked', true);
    $macro_type_radios.on('change', () => {
      macro.type = $macro_type_radios.filter(':checked').val();
      show_settings_div();
    });

    $macro_preset_start.val(macro.start ?? this.default_macro_settings.start);
    $macro_preset_start.on('change', () => {
      macro.start = Number($macro_preset_start.val());
    });
    $macro_preset_end.val(macro.end ?? this.default_macro_settings.end);
    $macro_preset_end.on('change', () => {
      macro.end = Number($macro_preset_end.val());
    });

    $macro_preset_bot_messages.prop('checked', macro.bot_messages);
    $macro_preset_bot_messages.on('change', () => {
      macro.bot_messages = $macro_preset_bot_messages.is(':checked');
    });
    $macro_preset_bot_summaries.prop('checked', macro.bot_summaries);
    $macro_preset_bot_summaries.on('change', () => {
      macro.bot_summaries = $macro_preset_bot_summaries.is(':checked');
    });
    $macro_preset_user_messages.prop('checked', macro.user_messages);
    $macro_preset_user_messages.on('change', () => {
      macro.user_messages = $macro_preset_user_messages.is(':checked');
    });
    $macro_preset_user_summaries.prop('checked', macro.user_summaries);
    $macro_preset_user_summaries.on('change', () => {
      macro.user_summaries = $macro_preset_user_summaries.is(':checked');
    });
    $macro_instruct.prop('checked', macro.instruct_template);
    $macro_instruct.on('change', () => {
      macro.instruct_template = $macro_instruct.is(':checked');
    });

    // Ensure regex select has an explicit unique ID before Select2 attachment
    let regex_id = `${id}_regex_select`;
    $regex_select.attr('id', regex_id);

    let options = [];
    let selected = [];
    let regex_scripts = typeof getRegexScripts === 'function' ? getRegexScripts() : [];
    for (let i in regex_scripts) {
      let name = regex_scripts[i].scriptName;
      options.push({
        id: i,
        name: name
      });
      if (macro.regex_scripts?.includes(name)) selected.push(i);
    }
    refresh_select2_element($regex_select, selected, options, t ? t`Select regex scripts` : "Select regex scripts", values => {
      macro.regex_scripts = values;
    });

    $macro_command_message.val(macro.command);
    $macro_command_message.on('change', () => {
      macro.command = $macro_command_message.val();
    });
    $macro_command_script.val(macro.command);
    $macro_command_script.on('change', () => {
      macro.command = $macro_command_script.val();
    });

    return $macro;
  }

  restore_macro_default(name) {
    let macro = this.get_macro(name);
    if (!macro?.default) return;
    let default_macro = default_summary_macros[name];
    if (!default_macro) error(`Attempted to restore default summary macro, but no default was found: "${name}"`);
    assign_and_prune(macro, default_macro);
    assign_defaults(macro, this.default_macro_settings);
    this.update_macros(macro);
  }

  async preview_prompt() {
    let index = (this.ctx?.chat?.length || 1) - 1;
    let text = this.$prompt.val();
    let messages = await create_summary_prompt(index, text, {
      custom_macros: this.macros,
      prompt_role: Number(this.$prompt_role.val()),
      prefill: unescape_string(this.$prefill.val()),
      ctx: this.ctx
    });

    let profile_id = get_summary_connection_profile();
    if (profile_id === undefined) {
      error("Cannot display prompt, no connection profile selected.");
      return;
    }
    let prompt = this.ctx?.ConnectionManagerRequestService?.constructPrompt(messages, profile_id);
    if (typeof prompt === 'string') {
      prompt = clean_string_for_html(prompt);
    } else if (Array.isArray(prompt)) {
      prompt = prompt.map(m => {
        m.content = clean_string_for_html(m.content);
        return m;
      });
      prompt = JSON.stringify(prompt, null, "&emsp;");
    } else {
      prompt = JSON.stringify(messages, null, 2);
    }
    await display_text_modal(t ? t`Summary Prompt Preview (Last Message)` : `Summary Prompt Preview (Last Message)`, prompt);
  }

  async preview_macro(macro) {
    let messages = await compute_macro((this.ctx?.chat?.length || 1) - 1, macro.name, true, this.macros, this.ctx);
    let result = '';
    if (messages && messages.length > 0) {
      result = clean_string_for_html(messages.map(m => m.content || '').join('\n'));
    }
    await display_text_modal((t ? t`Macro Preview:` : `Macro Preview:`) + ` {{${macro.name}}}`, result);
  }

  is_open() {
    if (!this.popup) return false;
    return this.$content.closest('dialog').attr('open');
  }

  from_settings() {
    this.$prompt?.val(get_settings('message_summary_prompt'));
    this.$prompt_role?.val(get_settings('prompt_role'));
    this.$prefill?.val(escape_string(get_settings('prefill')));
    this.$show_prefill?.prop('checked', get_settings('show_prefill'));
    this.macros = Object.assign(structuredClone(default_summary_macros), structuredClone(get_settings('summary_prompt_macros')));

    for (let name of Object.keys(this.macros)) {
      this.macros[name] = Object.assign({}, this.default_macro_settings, this.macros[name]);
      let valid_macros = [];
      for (let regex of this.macros[name].regex_scripts || []) {
        if (get_regex_script(regex)) valid_macros.push(regex);
      }
      this.macros[name].regex_scripts = valid_macros;
    }
  }

  save_settings() {
    set_settings('message_summary_prompt', this.$prompt.val());
    set_settings('prompt_role', Number(this.$prompt_role.val()));
    set_settings('prefill', unescape_string(this.$prefill.val()));
    set_settings('show_prefill', this.$show_prefill.is(':checked'));
    set_settings('summary_prompt_macros', structuredClone(this.macros));
    update_save_icon_highlight();
    update_all_message_visuals();
  }

  get_unique_name(name) {
    while (this.get_macro(name)) {
      let match = name.match(/_(\d+)$/);
      if (match) {
        name = name.slice(0, match.index) + "_" + (Number(match[1]) + 1);
      } else {
        name += "_2";
      }
    }
    return name;
  }

  get_id(name) {
    const clean = String(name || 'unnamed').replace(/[^a-zA-Z0-9_-]/g, '_');
    return `summary_macro_definition_${clean}`;
  }

  list_macros() {
    return Object.keys(this.macros || {});
  }

  get_macro(name) {
    return this.macros?.[name];
  }

  new_macro(name = null) {
    let macro = structuredClone(this.default_macro_settings);
    if (name) macro.name = name;
    macro.name = this.get_unique_name(macro.name);
    this.macros[macro.name] = macro;
    const $macro = this.create_macro_interface(macro);
    if ($macro && typeof $macro.find === 'function') {
      $macro.find('>.inline-drawer >.inline-drawer-content').show();
      $macro.find('>.inline-drawer >.inline-drawer-header .inline-drawer-icon')
        .removeClass('down fa-circle-chevron-down')
        .addClass('up fa-circle-chevron-up');
    }
  }
}

export function init_interfaces() {
  promptInterface1 = new SummaryPromptEditInterface();
  promptInterface2 = new PromptEditInterface({
    setting_key: 'short_to_long_prompt',
    title: 'Short \u2192 Long Compaction Prompt',
    description: 'Template used to consolidate graduating short-term memories into the long-term narrative.',
    default_prompt: default_short_to_long_prompt,
    macros: [
      { name: 'existing_long_memory', desc: 'The existing long-term narrative summary.' },
      { name: 'new_events', desc: 'The block of recent short-term memories graduating to long-term.' },
      { name: 'long_term_memory_size', desc: 'The current token size of the existing long-term memory.' }
    ]
  });
  promptInterface3 = new PromptEditInterface({
    setting_key: 'long_compaction_prompt',
    title: 'Long-Term Compaction Prompt',
    description: 'Template used to re-compact the long-term narrative when it approaches its token limit.',
    default_prompt: default_long_compaction_prompt,
    macros: [
      { name: 'long_memory', desc: 'The combined long-term narrative that needs to be compacted.' },
      { name: 'long_term_memory_size', desc: 'The current token size of the combined long-term memory.' }
    ]
  });
  promptInterfaceLongTemplate = new PromptEditInterface({
    setting_key: 'long_template',
    title: 'Long-Term Injection Template',
    description: 'Template used to frame the consolidated long-term memory narrative before injection into the prompt.',
    default_prompt: default_long_template,
    macros: [
      { name: 'memnext_long', desc: 'The consolidated long-term memory narrative.' }
    ]
  });
  promptInterfaceShortTemplate = new PromptEditInterface({
    setting_key: 'short_template',
    title: 'Short-Term Injection Template',
    description: 'Template used to frame the rolling short-term summaries before injection into the prompt.',
    default_prompt: default_short_template,
    macros: [
      { name: 'memnext_short', desc: 'The active short-term rolling summaries joined by the separator.' }
    ]
  });
  memoryEditInterface = new MemoryEditInterface();
}