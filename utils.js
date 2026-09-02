/* eslint-disable */
import { getRegexScripts } from '../../../../scripts/extensions/regex/engine.js';
import { debounce } from '../../../utils.js';
import { getMaxContextSize, system_message_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { debounce_timeout } from '../../../constants.js';
import { itemizedPrompts } from '../../../../scripts/itemized-prompts.js';
import { translate } from '../../../i18n.js';
import { MODULE_NAME_FANCY, settings_content_class } from './constants.js';
import { get_settings } from './state.js';

// Logging helpers
export function log(...args) {
  console.log(`[${MODULE_NAME_FANCY}]`, ...args);
}

export function debug(...args) {
  if (get_settings('debug_mode')) {
    log("[DEBUG]", ...args);
  }
}

export function error(...args) {
  console.error(`[${MODULE_NAME_FANCY}]`, ...args);
  if (typeof toastr !== 'undefined' && toastr?.error) {
    toastr.error(args.join(' '), MODULE_NAME_FANCY);
  }
}

export function toast(message, type = "info") {
  if (typeof toastr !== 'undefined' && toastr?.[type]) {
    toastr[type](message, MODULE_NAME_FANCY);
  }
}

export const toast_debounced = debounce(toast, 500);

export const saveChatDebounced = debounce(() => {
  const ctx = getContext();
  if (ctx && typeof ctx.saveChat === 'function') {
    ctx.saveChat();
  }
}, debounce_timeout?.relaxed || 1000);

// Token counting and context utilities
export function count_tokens(text, padding = 0) {
  if (typeof text !== 'string' || !text) return 0;
  const ctx = getContext();
  if (ctx && typeof ctx.getTokenCount === 'function') {
    return ctx.getTokenCount(text, padding);
  }
  // Fallback estimation if getTokenCount is unavailable
  return Math.ceil(text.length / 4);
}

export function get_chat_context_size() {
  return getMaxContextSize() || 4096;
}

export function get_long_token_limit() {
  const limit_percent = Number(get_settings('long_term_context_limit')) || 20;
  const context_size = get_chat_context_size();
  return Math.floor(context_size * (limit_percent / 100));
}

export function get_short_token_limit() {
  const limit_percent = Number(get_settings('short_term_context_limit')) || 15;
  const context_size = get_chat_context_size();
  return Math.floor(context_size * (limit_percent / 100));
}

export function get_last_char_message_index() {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat)) return undefined;
  for (let i = chat.length - 1; i >= 0; i--) {
    const msg = chat[i];
    if (!msg || msg.is_user || msg.is_system || msg.extra?.type === system_message_types.NARRATOR) continue;
    return i;
  }
  return undefined;
}

export function get_last_prompt_size() {
  const last_index = get_last_char_message_index();
  if (last_index === undefined) return 0;
  if (typeof itemizedPrompts !== 'undefined' && Array.isArray(itemizedPrompts)) {
    for (let i = 0; i < itemizedPrompts.length; i++) {
      const item = itemizedPrompts[i];
      if (item && item.mesId === last_index) {
        let raw = item.rawPrompt;
        if (raw !== undefined) {
          if (Array.isArray(raw)) raw = raw.map(x => x?.content || '').join('\n');
          return count_tokens(raw);
        }
      }
    }
  }
  return 0;
}

export function get_free_context_space() {
  const total = get_chat_context_size();
  const prompt_size = get_last_prompt_size();
  return Math.max(0, total - prompt_size);
}

export function get_free_context_percent() {
  const total = get_chat_context_size();
  if (total <= 0) return 100;
  return Math.round(get_free_context_space() / total * 100);
}

// Data validation and access helpers
export function get_current_character_identifier() {
  const context = getContext();
  if (!context) return null;
  if (context.groupId) return context.groupId;
  const index = context.characterId;
  if (index === undefined || index === null) return null;
  return context.characters?.[index]?.avatar || null;
}

export function clean_string_for_html(text) {
  return String(text ?? "").replace(/["&'<>]/g, function (match) {
    switch (match) {
      case "\"":
        return "&quot;";
      case "&":
        return "&amp;";
      case "'":
        return "&#39;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
    }
  });
}

export function escape_string(text) {
  return String(text ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

export function unescape_string(text) {
  return String(text ?? '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t').replace(/\\\\/g, '\\');
}

// Regex helpers
export function get_regex_script(name) {
  const scripts = typeof getRegexScripts === 'function' ? getRegexScripts() : [];
  for (let script of scripts) {
    if (script.scriptName === name) {
      return script;
    }
  }
  debug(`No regex script found: "${name}"`);
}

export function regex(string, re) {
  let matches = [...string.matchAll(re)];
  return matches.flatMap(m => m.slice(1).filter(Boolean));
}

// UI text helpers
export function add_i18n($element = null) {
  if (typeof $ === 'undefined') return;
  if ($element === null) {
    $element = $(`.${settings_content_class}`);
  }
  $element.each(function () {
    let $this = $(this);
    $this.find('*').each(function () {
      let $el = $(this);
      if ($el.attr('title')) $el.attr('title', translate($el.attr('title')));
      if ($el.attr('placeholder')) $el.attr('placeholder', translate($el.attr('placeholder')));
      if (!this.childNodes) return;
      for (let child of this.childNodes) {
        let text = child.nodeValue;
        if (!text?.trim()) continue;
        child.nodeValue = text?.replace(text?.trim(), translate(text?.trim()));
      }
    });
  });
}

export function refresh_select2_element(element, selected, options, placeholder = "", callback) {
  if (typeof $ === 'undefined') return;
  let $select = element;
  let id;
  if (typeof element === "string") {
    $select = $(`#${element}`);
    id = element;
  } else {
    id = element.attr('id');
  }
  let $dropdown = $(`#select2-${id}-results`);
  if ($dropdown.length > 0) return;
  $select.empty();
  for (let { id: optId, name } of options) {
    name = clean_string_for_html(name);
    let option = $(`<option value="${optId}">${name}</option>`);
    $select.append(option);
  }
  let $widget = $(`.${settings_content_class} ul#select2-${id}-container`);
  if ($widget.length === 0 && typeof $select.select2 === 'function') {
    $select.select2({
      width: '100%',
      placeholder: placeholder,
      allowClear: true,
      closeOnSelect: false,
      dropdownParent: $select.parent()
    });
    $select.on('change', () => {
      let values = [];
      for (let value of $select.select2('data')) {
        values.push(value.text);
      }
      if (typeof callback === 'function') {
        callback(values);
      }
    });
  }
  $select.val(selected);
  if (typeof $select.trigger === 'function') {
    $select.trigger('change.select2');
  }
}

export async function display_text_modal(title, text = "") {
  let ctx = getContext();
  if (!ctx || !ctx.Popup) return;
  text = String(text).replace(/\n/g, '<br>');
  let html = `<h3>${title}</h3><div style="text-align: left; overflow: auto;">${text}</div>`;
  let popup = new ctx.Popup(html, ctx.POPUP_TYPE.TEXT, '', {
    okButton: 'Close',
    allowVerticalScrolling: true,
    wider: true
  });
  await popup.show();
}

export function assign_and_prune(target, source) {
  for (let key in target) delete target[key];
  Object.assign(target, source);
}

export function assign_defaults(target, defaults) {
  for (let key in defaults) {
    if (target[key] === undefined) target[key] = defaults[key];
  }
}
