/* eslint-disable */
import { getRegexScripts } from '../../../../scripts/extensions/regex/engine.js';
import { debounce } from '../../../utils.js';
import { getMaxContextSize, system_message_types } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { debounce_timeout } from '../../../constants.js';
import { itemizedPrompts } from '../../../../scripts/itemized-prompts.js';
import { translate } from '../../../i18n.js';
import { MODULE_NAME_FANCY, settings_content_class, default_short_to_long_prompt, default_long_history_initiate_prompt, default_long_compaction_prompt } from './constants.js';
import { get_settings, get_active_connection_profile } from './state.js';

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

export function get_max_sum_context() {
  const profile = get_active_connection_profile();
  if (profile?.preset) {
    const context = getContext();
    const presetName = profile.preset;
    if (context?.getPresetManager) {
      if (profile.mode === 'cc' || profile.api === 'openai') {
        const preset = context.getPresetManager('openai')?.getCompletionPresetByName(presetName);
        if (preset && typeof preset.openai_max_context === 'number' && preset.openai_max_context > 0) {
          return preset.openai_max_context;
        }
      } else {
        const preset = context.getPresetManager('textgenerationwebui')?.getPresetSettings(presetName);
        if (preset && typeof preset.max_context === 'number' && preset.max_context > 0) {
          return preset.max_context;
        }
      }
    }
  }
  return 4096;
}

export function get_max_long_token_limit() {
  const max_sum_context = get_max_sum_context();
  const initiate_prompt = get_settings('long_history_initiate') || default_long_history_initiate_prompt;
  const long_prompt = get_settings('long_compaction_prompt') || default_long_compaction_prompt;
  const short_prompt = get_settings('short_to_long_prompt') || default_short_to_long_prompt;
  const overhead = Math.max(count_tokens(initiate_prompt), count_tokens(long_prompt), count_tokens(short_prompt));
  return Math.max(100, Math.floor(max_sum_context / 3) - overhead);
}

export function get_long_token_limit() {
  const limit_percent = Number(get_settings('long_term_context_limit')) || 20;
  const context_size = get_chat_context_size();
  const configured_tokens = Math.floor(context_size * (limit_percent / 100));
  const max_long_tokens = get_max_long_token_limit();

  return Math.min(configured_tokens, max_long_tokens);
}

export function get_short_token_limit() {
  const limit_percent = Number(get_settings('short_term_context_limit')) || 15;
  const context_size = get_chat_context_size();
  const configured_tokens = Math.floor(context_size * (limit_percent / 100));

  const max_sum_context = get_max_sum_context();
  const long_prompt = get_settings('long_compaction_prompt') || default_long_compaction_prompt;
  const short_prompt = get_settings('short_to_long_prompt') || default_short_to_long_prompt;
  const overhead = Math.max(count_tokens(long_prompt), count_tokens(short_prompt));
  const max_short_tokens = Math.max(100, Math.floor(max_sum_context / 2) - overhead);

  return Math.min(configured_tokens, max_short_tokens);
}

export function get_chat_cache_capacity(context_size = null, ctx = null) {
  if (!context_size) context_size = get_chat_context_size();
  if (!ctx) ctx = getContext();
  const long_budget = get_long_token_limit();
  const short_budget = get_short_token_limit();
  const char = ctx?.characters?.[ctx?.characterId];
  const system_text = (char?.description || '') +
    (char?.personality || '') +
    (char?.scenario || '') +
    (char?.mes_example || '');
  const system_estimate = count_tokens(system_text);
  const OC = system_estimate + long_budget + short_budget;
  const cc_max = Math.max(100, context_size - OC);
  return {
    context_size,
    system_estimate,
    long_budget,
    short_budget,
    OC,
    cc_max
  };
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
  if (typeof $ === 'undefined' || !element) return;
  let $select = element;
  let id;
  if (typeof element === "string") {
    if (!element) return;
    $select = $(`#${element}`);
    id = element;
  } else {
    id = element.attr ? element.attr('id') : element.id;
    if (!id) {
      id = `memnext_select2_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      if (typeof element.attr === 'function') {
        element.attr('id', id);
      } else {
        element.id = id;
      }
    }
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

/**
 * Intercepts empty string queries to document.getElementById to silence
 * harmless browser console warnings (e.g. Firefox "Empty string passed to getElementById().")
 * and strictly conform to WHATWG DOM specs by returning null.
 */
export function guard_get_element_by_id() {
  if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
  try {
    const raw = document.getElementById;
    if (!raw.__memnext_guarded__) {
      const bound = raw.bind(document);
      const guarded = function (elementId) {
        if (!elementId || elementId === '') {
          return null;
        }
        return bound(elementId);
      };
      guarded.__memnext_guarded__ = true;
      document.getElementById = guarded;
    }
  } catch (e) {
    console.debug('[MemNext] Could not install getElementById guard:', e);
  }
}

/**
 * 53-bit cyrb53 hash function matching SillyTavern's getStringHash.
 * Fast, non-cryptographic, with excellent avalanche and low collision probability.
 * @param {string} str Input string
 * @param {number} seed Seed (default 0)
 * @returns {number} 53-bit integer hash
 */
export function getStringHash(str, seed = 0) {
  if (typeof str !== 'string' || !str) {
    return 0;
  }
  let h1 = 0xdeadbeef ^ seed,
      h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Computes a fast, distinguishing hexadecimal string hash of a text.
 * @param {string} text Text to hash
 * @returns {string} Hexadecimal hash string (e.g. '1b3df5a8e024c')
 */
export function compute_hash(text) {
  if (typeof text !== 'string' || !text) return '';
  return getStringHash(text).toString(16);
}

export function trim_to_end_sentence(input) {
  if (!input) return '';
  const punctuation = new Set(['.', '!', '?', '*', '"', ')', '}', '`', ']', '$', '。', '！', '？', '”', '）', '】', '’', '」', '_']);
  const characters = Array.from(input);
  let last = -1;

  for (let i = characters.length - 1; i >= 0; i--) {
    const char = characters[i];
    if (punctuation.has(char) || /(\p{Emoji_Presentation}|\p{Extended_Pictographic})/gu.test(char)) {
      if (i > 0 && /[\s\n]/.test(characters[i - 1])) {
        last = i - 1;
      } else {
        last = i;
      }
      break;
    }
  }

  if (last === -1) {
    return input.trimEnd();
  }

  return characters.slice(0, last + 1).join('').trimEnd();
}
