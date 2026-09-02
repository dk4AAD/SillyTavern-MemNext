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
import { saveChatDebounced, count_tokens, get_chat_context_size, get_long_token_limit, get_short_token_limit } from "./utils.js";
import { get_settings, chat_enabled, character_enabled, get_character_key } from "./state.js";
import { MODULE_NAME, update_context_budget_displays } from "./ui.js";
import { summarize_text, summaryQueue } from "./summarization.js";
import { generic_memories_macro, default_short_to_long_prompt, default_long_compaction_prompt, default_long_template, default_short_template } from "./macros.js";
export
// Data validation and access helpers
function get_data(message, key) {
  if (!message || typeof message !== 'object') return null;
  if (!message.extra || typeof message.extra !== 'object') return null;
  const data = message.extra[MODULE_NAME];
  if (!data || typeof data !== 'object') return null;
  return data[key] !== undefined ? data[key] : null;
}
export function set_data(message, key, value) {
  if (!message || typeof message !== 'object') return;
  if (!message.extra || typeof message.extra !== 'object') message.extra = {};
  if (!message.extra[MODULE_NAME] || typeof message.extra[MODULE_NAME] !== 'object') {
    message.extra[MODULE_NAME] = {};
  }
  message.extra[MODULE_NAME][key] = value;
}
export function get_memory(message) {
  return get_data(message, 'memory');
}
export function get_chat_long_term_memory() {
  if (!chat_metadata || typeof chat_metadata !== 'object') return '';
  const memData = chat_metadata[MODULE_NAME];
  if (!memData || typeof memData !== 'object') return '';
  return typeof memData.long_term_memory === 'string' ? memData.long_term_memory : '';
}
export function set_chat_long_term_memory(text) {
  if (!chat_metadata || typeof chat_metadata !== 'object') return;
  if (!chat_metadata[MODULE_NAME] || typeof chat_metadata[MODULE_NAME] !== 'object') {
    chat_metadata[MODULE_NAME] = {};
  }
  chat_metadata[MODULE_NAME].long_term_memory = String(text ?? '');
  saveMetadataDebounced();
}
export
// Exclusion checking
function check_message_exclusion(message) {
  if (!message || typeof message !== 'object') return false;
  if (get_data(message, 'exclude')) return false;
  if (!get_settings('include_user_messages') && message.is_user) return false;
  if (!get_settings('include_system_messages') && message.is_system) return false;
  if (!get_settings('include_narrator_messages') && message.extra?.type === system_message_types.NARRATOR) return false;
  const char_key = get_character_key(message);
  if (!character_enabled(char_key)) return false;
  const token_size = count_tokens(message.mes || '');
  if (token_size < (Number(get_settings('message_length_threshold')) || 0)) {
    return false;
  }
  return true;
}

// Truncation threshold calculation
export let INJECTION_THRESHOLD_INDEX = null;
export let is_filling_up = false;
export async function refresh_memory() {
  if (is_filling_up) return;
  is_filling_up = true;
  try {
    await fillup();
  } finally {
    is_filling_up = false;
  }
}
export async function fillup() {
  const ctx = getContext();
  if (!ctx) return;
  if (!chat_enabled()) {
    ctx.setExtensionPrompt(`${MODULE_NAME}_long`, "");
    ctx.setExtensionPrompt(`${MODULE_NAME}_short`, "");
    return;
  }
  const chat = ctx.chat;
  if (!Array.isArray(chat) || chat.length === 0) return;
  let long_budget = get_long_token_limit();
  let short_budget = get_short_token_limit();
  let reserve_percent = Number(get_settings('compaction_threshold_percent')) || 15;
  let total_context = get_chat_context_size();
  let system_text = (ctx.characters?.[ctx.characterId]?.description || '') + (ctx.characters?.[ctx.characterId]?.personality || '') + (ctx.characters?.[ctx.characterId]?.scenario || '') + (ctx.characters?.[ctx.characterId]?.mes_example || '');
  let system_estimate = count_tokens(system_text);
  let OC = system_estimate + long_budget + short_budget;
  let CC = Math.floor(total_context * (1 - reserve_percent / 100)) - OC;
  if (CC < 100) CC = 100;
  let meta = chat_metadata.memnext || {};
  if (meta.iti !== undefined && meta.iti !== null) {
    let raw_sum = 0;
    for (let i = chat.length - 1; i > meta.iti; i--) {
      if (chat[i]) raw_sum += count_tokens(chat[i].mes || '');
    }
    if (raw_sum <= CC) {
      let messages_to_keep = Number(get_settings('messages_to_keep')) || 5;
      let kept_sum = 0;
      let start_kept = Math.max(0, chat.length - messages_to_keep);
      for (let i = chat.length - 1; i >= start_kept; i--) {
        if (chat[i]) kept_sum += count_tokens(chat[i].mes || '');
      }
      let threshold_pct = Number(get_settings('kept_messages_context_threshold')) || 30;
      if (kept_sum <= threshold_pct / 100 * CC) {
        INJECTION_THRESHOLD_INDEX = meta.iti;
        const position = Number(get_settings('injection_position')) || extension_prompt_types.IN_PROMPT;
        const role = Number(get_settings('injection_role')) || extension_prompt_roles.SYSTEM;
        ctx.setExtensionPrompt(`${MODULE_NAME}_long`, meta.long_injection || "", position, 0, false, role);
        ctx.setExtensionPrompt(`${MODULE_NAME}_short`, meta.short_injection || "", position, 0, false, role);
        update_context_budget_displays();
        return; // KV CACHE FROZEN!
      }
    }
  }
  let result = await try_first_to_keep(CC);
  if (!result) {
    result = await try_for_cc(CC);
  }
  if (result) {
    let [long_summary, short_indexes, iti] = result;
    INJECTION_THRESHOLD_INDEX = iti;
    let long_injection = "";
    if (long_summary) {
      let template = get_settings('long_template') || default_long_template;
      long_injection = template.replace(new RegExp(`\\{\\{${generic_memories_macro}\\}\\}`, 'g'), long_summary);
    }
    let short_injection = "";
    if (short_indexes && short_indexes.length > 0) {
      const sep = get_settings('summary_injection_separator') || "\n* ";
      let summaries = short_indexes.map(idx => get_memory(chat[idx])).filter(Boolean);
      if (summaries.length > 0) {
        let joined = summaries.join(sep);
        let template = get_settings('short_template') || default_short_template;
        short_injection = template.replace(new RegExp(`\\{\\{${generic_memories_macro}\\}\\}`, 'g'), joined);
      }
    }
    const position = Number(get_settings('injection_position')) || extension_prompt_types.IN_PROMPT;
    const role = Number(get_settings('injection_role')) || extension_prompt_roles.SYSTEM;
    ctx.setExtensionPrompt(`${MODULE_NAME}_long`, long_injection, position, 0, false, role);
    ctx.setExtensionPrompt(`${MODULE_NAME}_short`, short_injection, position, 0, false, role);
    chat_metadata.memnext = chat_metadata.memnext || {};
    chat_metadata.memnext.iti = iti;
    chat_metadata.memnext.long_injection = long_injection;
    chat_metadata.memnext.short_injection = short_injection;
    saveChatDebounced();
  }
  update_context_budget_displays();
}
export async function try_first_to_keep(CC) {
  const ctx = getContext();
  const chat = ctx.chat;
  let messages_to_keep = Number(get_settings('messages_to_keep')) || 5;
  let threshold_pct = Number(get_settings('kept_messages_context_threshold')) || 30;
  let sum = 0;
  let start_idx = Math.max(0, chat.length - messages_to_keep);
  for (let i = chat.length - 1; i >= start_idx; i--) {
    if (!chat[i]) continue;
    sum += count_tokens(chat[i].mes || '');
  }
  if (sum > threshold_pct / 100 * CC) {
    let history_calc_message = Math.max(0, start_idx - 1);
    return await calculate_memo(history_calc_message);
  }
  return null;
}
export async function try_for_cc(CC) {
  const ctx = getContext();
  const chat = ctx.chat;
  let sum = 0;
  for (let i = chat.length - 1; i >= 0; i--) {
    if (!chat[i]) continue;
    sum += count_tokens(chat[i].mes || '');
    let long_history = get_data(chat[i], 'long_term_history');
    if (long_history) {
      if (sum <= CC) {
        return [long_history, null, i];
      }
    }
    if (sum > CC) {
      return await calculate_memo(i);
    }
  }
  return [null, null, null];
}
export async function calculate_memo(history_calc_message) {
  const ctx = getContext();
  const chat = ctx.chat;
  let short_history_size = 0;
  let i = history_calc_message;
  let long_term_history = "";
  let compact_start = 0;
  for (; i >= 0; i--) {
    if (!chat[i]) continue;
    let lh = get_data(chat[i], 'long_term_history');
    if (lh) {
      long_term_history = lh;
      compact_start = i + 1;
      break;
    }
    let mem = get_memory(chat[i]);
    if (mem) {
      short_history_size += count_tokens(mem);
    }
  }
  let short_budget = get_short_token_limit();
  if (short_history_size <= short_budget) {
    let short_indexes = [];
    for (let j = compact_start; j <= history_calc_message; j++) {
      if (chat[j]) short_indexes.push(j);
    }
    let current_size = short_history_size;
    let iti = history_calc_message;
    let messages_to_keep = Number(get_settings('messages_to_keep')) || 5;
    let max_iti = chat.length - messages_to_keep - 1;
    for (let j = history_calc_message + 1; j <= max_iti; j++) {
      let mem = get_memory(chat[j]);
      if (mem) {
        let sz = count_tokens(mem);
        if (current_size + sz <= short_budget) {
          current_size += sz;
          short_indexes.push(j);
          iti = j;
        } else {
          break;
        }
      }
    }
    return [long_term_history, short_indexes, iti];
  } else {
    let new_long = await compact_history(compact_start, history_calc_message, long_term_history);
    let short_indexes = [];
    let current_size = 0;
    let iti = history_calc_message;
    let messages_to_keep = Number(get_settings('messages_to_keep')) || 5;
    let max_iti = chat.length - messages_to_keep - 1;
    for (let j = history_calc_message + 1; j <= max_iti; j++) {
      let mem = get_memory(chat[j]);
      if (mem) {
        let sz = count_tokens(mem);
        if (current_size + sz <= short_budget) {
          current_size += sz;
          short_indexes.push(j);
          iti = j;
        } else {
          break;
        }
      }
    }
    return [new_long, short_indexes, iti];
  }
}
export async function compact_history(compact_start, history_calc_message, old_history) {
  const ctx = getContext();
  const chat = ctx.chat;
  let summaries = [];
  for (let i = compact_start; i <= history_calc_message; i++) {
    let mem = get_memory(chat[i]);
    if (mem) summaries.push(mem);
  }
  let long_budget = get_long_token_limit();
  let chunks = [];
  let current_chunk = [];
  let current_size = 0;
  for (let s of summaries) {
    let sz = count_tokens(s);
    if (current_size + sz > long_budget && current_chunk.length > 0) {
      chunks.push(current_chunk);
      current_chunk = [s];
      current_size = sz;
    } else {
      current_chunk.push(s);
      current_size += sz;
    }
  }
  if (current_chunk.length > 0) chunks.push(current_chunk);
  let chunk_results = [];
  let prompt_template = get_settings('short_to_long_prompt') || default_short_to_long_prompt;
  summaryQueue.show_progress(0, chunks.length);
  let old_size = old_history ? count_tokens(old_history) : 0;
  for (let i = 0; i < chunks.length; i++) {
    let combined = chunks[i].join('\n');
    let compiled = prompt_template.replace(/{{existing_long_memory}}/g, old_history || '').replace(/{{new_events}}/g, combined).replace(/{{long_term_memory_size}}/g, old_size);
    const payload = [{
      role: 'system',
      content: compiled
    }];
    let res = await summarize_text(payload);
    chunk_results.push(res);
    summaryQueue.show_progress(i + 1, chunks.length);
  }
  summaryQueue.hide_progress();
  let combined_new = chunk_results.join('\n');
  let final_long = "";
  let long_compaction_template = get_settings('long_compaction_prompt') || default_long_compaction_prompt;
  if (old_history) {
    let combined_all = old_history + "\n" + combined_new;
    if (count_tokens(combined_all) > long_budget) {
      let size = count_tokens(combined_all);
      let compiled = long_compaction_template.replace(/{{long_memory}}/g, combined_all).replace(/{{long_term_memory_size}}/g, size);
      summaryQueue.show_progress(0, 1);
      final_long = await summarize_text([{
        role: 'system',
        content: compiled
      }]);
      summaryQueue.show_progress(1, 1);
      summaryQueue.hide_progress();
    } else {
      final_long = combined_all;
    }
  } else {
    if (count_tokens(combined_new) > long_budget) {
      let size = count_tokens(combined_new);
      let compiled = long_compaction_template.replace(/{{long_memory}}/g, combined_new).replace(/{{long_term_memory_size}}/g, size);
      summaryQueue.show_progress(0, 1);
      final_long = await summarize_text([{
        role: 'system',
        content: compiled
      }]);
      summaryQueue.show_progress(1, 1);
      summaryQueue.hide_progress();
    } else {
      final_long = combined_new;
    }
  }
  for (let i = compact_start; i <= history_calc_message; i++) {
    if (chat[i]) {
      set_data(chat[i], 'long_term_history', final_long);
    }
  }
  saveChatDebounced();
  return final_long;
}

// Generate Interceptor (Truncate Raw Chat Beyond Threshold)