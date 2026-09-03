/* eslint-disable */
import { system_message_types, extension_prompt_roles, extension_prompt_types, chat_metadata } from '../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../extensions.js';
import { MODULE_NAME, long_memory_macro, short_memory_macro, generic_memories_macro } from './constants.js';
import { saveChatDebounced, count_tokens, get_chat_context_size, get_long_token_limit, get_short_token_limit, get_chat_cache_capacity, compute_hash } from "./utils.js";
import { get_settings, chat_enabled, character_enabled, get_character_key, get_summary_initialized, set_summary_initialized, is_chat_loaded } from "./state.js";
import { summarize_text, summaryQueue } from "./summarization.js";
import { default_short_to_long_prompt, default_long_compaction_prompt, default_long_template, default_short_template, create_summary_prompt } from "./macros.js";

// Optional callback for UI budget display refresh
var _ui_budget_refresh_callback = null;
export function set_budget_refresh_callback(fn) {
  _ui_budget_refresh_callback = fn;
}

export function notify_budget_refresh() {
  if (typeof _ui_budget_refresh_callback === 'function') {
    _ui_budget_refresh_callback();
  }
}

// Optional callback for visual update on memory refresh
var _memory_refresh_visuals_callback = null;
export function set_memory_refresh_visuals_callback(fn) {
  _memory_refresh_visuals_callback = fn;
}

export function notify_memory_refresh_visuals() {
  if (typeof _memory_refresh_visuals_callback === 'function') {
    _memory_refresh_visuals_callback();
  }
}

// Data validation and access helpers
export function get_data(message, key) {
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

export function get_long_term_hash(message) {
  return get_data(message, 'long_term_hash') || get_data(message, 'long_term_history_hash');
}

export function set_long_term_hash(message, hash) {
  set_data(message, 'long_term_hash', hash);
}

export function get_chat_long_term_memory() {
  const block = get_last_long_term_history_block();
  return block ? block.text : '';
}

export function set_chat_long_term_memory(text) {
  // Legacy stub: long-term history is managed strictly on per-message level
}

// Exclusion checking
export function check_message_exclusion(message) {
  if (!message || typeof message !== 'object') return false;
  if (get_data(message, 'exclude')) return false;
  if (!get_settings('include_user_messages') && message.is_user) return false;
  if (!get_settings('include_system_messages') && message.is_system) return false;
  if (!get_settings('include_narrator_messages') && message.extra?.type === system_message_types?.NARRATOR) return false;
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
export function set_injection_threshold_index(val) {
  INJECTION_THRESHOLD_INDEX = val;
}

export function get_injection_threshold_index() {
  const meta = chat_metadata?.memnext;
  if (meta && meta.iti !== undefined && meta.iti !== null) {
    return meta.iti;
  }
  return INJECTION_THRESHOLD_INDEX;
}

export let is_filling_up = false;
export async function refresh_memory() {
  if (is_filling_up) return;
  is_filling_up = true;
  try {
    await fillup();
  } finally {
    is_filling_up = false;
    notify_memory_refresh_visuals();
  }
}

export async function fillup() {
  const ctx = getContext();
  if (!ctx) return;
  if (!chat_enabled()) {
    if (typeof ctx.setExtensionPrompt === 'function') {
      ctx.setExtensionPrompt(`${MODULE_NAME}_long`, "");
      ctx.setExtensionPrompt(`${MODULE_NAME}_short`, "");
    }
    return;
  }
  const chat = ctx.chat;
  if (!Array.isArray(chat) || chat.length === 0) return;

  let total_context = get_chat_context_size();
  let { cc_max } = get_chat_cache_capacity(total_context, ctx);
  let threshold_percent = Number(get_settings('compaction_threshold_percent')) || 85;
  let CC = Math.floor(cc_max * (threshold_percent / 100));
  if (CC < 100) CC = 100;

  // 1. If entire dialogue fits within CC, NO messages need compaction or exclusion!
  let total_chat_tokens = 0;
  for (let i = 0; i < chat.length; i++) {
    if (chat[i]) total_chat_tokens += count_tokens(chat[i].mes || '');
  }

  if (total_chat_tokens <= CC) {
    INJECTION_THRESHOLD_INDEX = null;
    if (chat_metadata?.memnext) {
      chat_metadata.memnext.iti = null;
      chat_metadata.memnext.long_injection = "";
      chat_metadata.memnext.short_injection = "";
    }
    if (typeof ctx.setExtensionPrompt === 'function') {
      ctx.setExtensionPrompt(`${MODULE_NAME}_long`, "");
      ctx.setExtensionPrompt(`${MODULE_NAME}_short`, "");
    }
    notify_budget_refresh();
    return;
  }

  // 2. Chat has exceeded CC. Check if uncompacted messages fit within available context capacity CC (KV cache freeze)
  let meta = chat_metadata?.memnext || {};
  let raw_start = (meta.iti !== undefined && meta.iti !== null && meta.iti >= 0) ? meta.iti : -1;
  let raw_sum = 0;
  for (let i = chat.length - 1; i > raw_start; i--) {
    if (chat[i]) raw_sum += count_tokens(chat[i].mes || '');
  }

  if (raw_start >= 0 && raw_sum <= CC) {
    let messages_to_keep = Number(get_settings('messages_to_keep')) || 5;
    let kept_sum = 0;
    let start_kept = Math.max(0, chat.length - messages_to_keep);
    for (let i = chat.length - 1; i >= start_kept; i--) {
      if (chat[i]) kept_sum += count_tokens(chat[i].mes || '');
    }
    let threshold_pct = Number(get_settings('kept_messages_context_threshold')) || 30;
    if (kept_sum <= (threshold_pct / 100) * CC) {
      INJECTION_THRESHOLD_INDEX = meta.iti;
      const position = Number(get_settings('injection_position')) || extension_prompt_types?.IN_PROMPT || 0;
      const role = Number(get_settings('injection_role')) || extension_prompt_roles?.SYSTEM || 0;
      if (typeof ctx.setExtensionPrompt === 'function') {
        ctx.setExtensionPrompt(`${MODULE_NAME}_long`, meta.long_injection || "", position, 0, false, role);
        ctx.setExtensionPrompt(`${MODULE_NAME}_short`, meta.short_injection || "", position, 0, false, role);
      }
      notify_budget_refresh();
      return; // KV CACHE FROZEN!
    }
  }

  // 3. Raw chat has exceeded capacity CC; calculate new compaction and threshold
  let result = await try_first_to_keep(CC);
  if (!result) {
    result = await try_for_cc(CC);
  }

  if (result && (result[0] !== null || result[1] !== null || result[2] !== null)) {
    let [long_summary, short_indexes, iti] = result;
    INJECTION_THRESHOLD_INDEX = iti;
    let long_injection = "";
    if (long_summary) {
      let template = get_settings('long_template') || default_long_template;
      long_injection = template.replace(new RegExp(`\\{\\{\\s*(?:${long_memory_macro}|${generic_memories_macro})\\s*\\}\\}`, 'g'), long_summary);
    }
    let short_injection = "";
    if (short_indexes && short_indexes.length > 0) {
      const sep = get_settings('summary_injection_separator') || "\n* ";
      let summaries = short_indexes.map(idx => get_memory(chat[idx])).filter(Boolean);
      if (summaries.length > 0) {
        let joined = summaries.join(sep);
        let template = get_settings('short_template') || default_short_template;
        short_injection = template.replace(new RegExp(`\\{\\{\\s*(?:${short_memory_macro}|${generic_memories_macro})\\s*\\}\\}`, 'g'), joined);
      }
    }
    const position = Number(get_settings('injection_position')) || extension_prompt_types?.IN_PROMPT || 0;
    const role = Number(get_settings('injection_role')) || extension_prompt_roles?.SYSTEM || 0;
    if (typeof ctx.setExtensionPrompt === 'function') {
      ctx.setExtensionPrompt(`${MODULE_NAME}_long`, long_injection, position, 0, false, role);
      ctx.setExtensionPrompt(`${MODULE_NAME}_short`, short_injection, position, 0, false, role);
    }
    if (chat_metadata) {
      chat_metadata.memnext = chat_metadata.memnext || {};
      chat_metadata.memnext.iti = iti;
      chat_metadata.memnext.long_injection = long_injection;
      chat_metadata.memnext.short_injection = short_injection;
    }
    saveChatDebounced();
  } else {
    INJECTION_THRESHOLD_INDEX = null;
    if (chat_metadata?.memnext) {
      chat_metadata.memnext.iti = null;
    }
  }
  notify_budget_refresh();
}

export async function try_first_to_keep(CC) {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return null;

  let messages_to_keep = Number(get_settings('messages_to_keep')) || 5;
  let threshold_pct = Number(get_settings('kept_messages_context_threshold')) || 30;
  let sum = 0;
  let start_idx = Math.max(0, chat.length - messages_to_keep);
  let longest_idx = -1;
  let max_len = -1;

  for (let i = chat.length - 1; i >= start_idx; i--) {
    if (!chat[i]) continue;
    const len = count_tokens(chat[i].mes || '');
    sum += len;
    if (len > max_len) {
      max_len = len;
      longest_idx = i;
    }
  }

  if (sum > (threshold_pct / 100) * CC && longest_idx !== -1) {
    return await calculate_memo(longest_idx);
  }
  return null;
}

export async function try_for_cc(CC) {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return [null, null, null];

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
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return [null, null, null];

  history_calc_message = Math.max(0, Math.min(chat.length - 1, Number(history_calc_message) || 0));

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
  let messages_to_keep = Number(get_settings('messages_to_keep')) || 5;
  let max_iti = Math.max(0, chat.length - messages_to_keep - 1);

  if (short_history_size <= short_budget) {
    let short_indexes = [];
    if (compact_start <= history_calc_message) {
      for (let j = compact_start; j <= history_calc_message; j++) {
        if (chat[j]) short_indexes.push(j);
      }
    }
    let current_size = short_history_size;
    let iti = history_calc_message;

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
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return old_history || "";

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

  // Extend progress bar total counter by the number of short-to-long batches
  if (chunks.length > 0 && summaryQueue && typeof summaryQueue.add_extra_total === 'function') {
    summaryQueue.add_extra_total(chunks.length, "Compacting memory (short to long)...");
  }

  let chunk_results = [];
  let prompt_template = get_settings('short_to_long_prompt') || default_short_to_long_prompt;
  let old_size = old_history ? count_tokens(old_history) : 0;

  for (let i = 0; i < chunks.length; i++) {
    let combined = chunks[i].join('\n');
    let compiled = prompt_template
      .replace(/{{existing_long_memory}}/g, old_history || '')
      .replace(/{{new_events}}/g, combined)
      .replace(/{{long_term_memory_size}}/g, old_size);
    const payload = [{
      role: 'system',
      content: compiled
    }];
    let res = await summarize_text(payload);
    chunk_results.push(res);
    if (summaryQueue && typeof summaryQueue.step_progress === 'function') {
      summaryQueue.step_progress("Compacting memory (short to long)...");
    }
  }

  let combined_new = chunk_results.join('\n');
  let final_long = "";
  let long_compaction_template = get_settings('long_compaction_prompt') || default_long_compaction_prompt;

  if (old_history) {
    let combined_all = old_history + "\n" + combined_new;
    if (count_tokens(combined_all) > long_budget) {
      let size = count_tokens(combined_all);
      let compiled = long_compaction_template
        .replace(/{{long_memory}}/g, combined_all)
        .replace(/{{long_term_memory_size}}/g, size);
      if (summaryQueue && typeof summaryQueue.add_extra_total === 'function') {
        summaryQueue.add_extra_total(1, "Compacting long-term memory...");
      }
      final_long = await summarize_text([{
        role: 'system',
        content: compiled
      }]);
      if (summaryQueue && typeof summaryQueue.step_progress === 'function') {
        summaryQueue.step_progress("Compacting long-term memory...");
      }
    } else {
      final_long = combined_all;
    }
  } else {
    if (count_tokens(combined_new) > long_budget) {
      let size = count_tokens(combined_new);
      let compiled = long_compaction_template
        .replace(/{{long_memory}}/g, combined_new)
        .replace(/{{long_term_memory_size}}/g, size);
      if (summaryQueue && typeof summaryQueue.add_extra_total === 'function') {
        summaryQueue.add_extra_total(1, "Compacting long-term memory...");
      }
      final_long = await summarize_text([{
        role: 'system',
        content: compiled
      }]);
      if (summaryQueue && typeof summaryQueue.step_progress === 'function') {
        summaryQueue.step_progress("Compacting long-term memory...");
      }
    } else {
      final_long = combined_new;
    }
  }

  if (summaryQueue && typeof summaryQueue.finish_compaction_progress === 'function') {
    summaryQueue.finish_compaction_progress();
  }

  const long_hash = compute_hash(final_long);
  for (let i = compact_start; i <= history_calc_message; i++) {
    if (chat[i]) {
      set_data(chat[i], 'long_term_history', final_long);
      set_data(chat[i], 'long_term_hash', long_hash);
      set_data(chat[i], 'include', 'long');
    }
  }
  saveChatDebounced();
  return final_long;
}

export function get_last_long_term_history_block() {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return null;

  let lastBlock = null;
  let currentBlock = null;

  for (let i = 0; i < chat.length; i++) {
    const msg = chat[i];
    if (!msg) continue;
    const historyText = get_data(msg, 'long_term_history');
    if (!historyText || typeof historyText !== 'string' || historyText.trim().length === 0) {
      if (currentBlock) {
        lastBlock = currentBlock;
        currentBlock = null;
      }
      continue;
    }

    const hash = get_long_term_hash(msg) || compute_hash(historyText);

    if (!currentBlock || currentBlock.hash !== hash) {
      if (currentBlock) {
        lastBlock = currentBlock;
      }
      currentBlock = {
        startIndex: i,
        endIndex: i,
        hash: hash,
        text: historyText.trim()
      };
    } else {
      currentBlock.endIndex = i;
    }
  }

  if (currentBlock) {
    lastBlock = currentBlock;
  }

  return lastBlock;
}

export function update_long_term_history_range(startIndex, endIndex, text) {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return;

  const cleanText = (text || '').trim();
  const hash = cleanText ? compute_hash(cleanText) : null;

  for (let i = startIndex; i <= endIndex; i++) {
    if (chat[i]) {
      set_data(chat[i], 'long_term_history', cleanText || null);
      set_data(chat[i], 'long_term_hash', hash);
      set_data(chat[i], 'include', cleanText ? 'long' : null);
    }
  }
  saveChatDebounced();
}

export function delete_long_term_history_range(startIndex, endIndex) {
  update_long_term_history_range(startIndex, endIndex, null);
  if (get_long_term_cutoff_index() === -1) {
    set_injection_threshold_index(null);
    if (chat_metadata?.memnext) {
      chat_metadata.memnext.iti = null;
      chat_metadata.memnext.long_injection = "";
      chat_metadata.memnext.short_injection = "";
    }
    saveChatDebounced();
  }
}

export function get_long_term_cutoff_index() {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return -1;

  for (let i = chat.length - 1; i >= 0; i--) {
    const text = get_data(chat[i], 'long_term_history');
    if (chat[i] && text && typeof text === 'string' && text.trim().length > 0) {
      return i;
    }
  }

  return -1;
}


export async function initialize_chat_summarization({ mode = 'all', count = 0, priorHistory = '' } = {}) {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) {
    set_summary_initialized(true);
    return;
  }

  const chatLength = chat.length;
  let targetCount = mode === 'all' ? chatLength : Math.max(1, Math.min(count, chatLength));
  let compactStart = Math.max(0, chatLength - targetCount);

  // Summarize selected range [compactStart .. chatLength - 1]
  const unsummarized = [];
  for (let i = compactStart; i < chatLength; i++) {
    if (chat[i] && check_message_exclusion(chat[i]) && !get_memory(chat[i])) {
      unsummarized.push(i);
    }
  }

  if (unsummarized.length > 0) {
    if (summaryQueue && typeof summaryQueue.add_extra_total === 'function') {
      summaryQueue.add_extra_total(unsummarized.length, "Initial Chat Summarization...");
    }
    for (let idx of unsummarized) {
      const prompt = create_summary_prompt(idx);
      if (prompt && prompt.length > 0) {
        const res = await summarize_text(prompt);
        if (res) {
          set_data(chat[idx], 'memory', res);
          set_data(chat[idx], 'hash', compute_hash(res));
        }
      }
      if (summaryQueue && typeof summaryQueue.step_progress === 'function') {
        summaryQueue.step_progress("Initial Chat Summarization...");
      }
    }
  }

  // Prior history handling
  const cleanPrior = (priorHistory || '').trim();
  let historyToStamp = cleanPrior;

  if (!historyToStamp && compactStart < chatLength) {
    historyToStamp = get_memory(chat[compactStart]) || '';
  }

  if (historyToStamp && compactStart > 0) {
    update_long_term_history_range(0, compactStart - 1, historyToStamp);
  }

  set_summary_initialized(true);
  saveChatDebounced();
}
