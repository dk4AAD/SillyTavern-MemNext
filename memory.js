/* eslint-disable */
import { system_message_types, extension_prompt_roles, extension_prompt_types, chat_metadata } from '../../../../script.js';
import { getContext, saveMetadataDebounced } from '../../../extensions.js';
import { MODULE_NAME, long_memory_macro, short_memory_macro, generic_memories_macro } from './constants.js';
import { log, saveChatDebounced, count_tokens, get_chat_context_size,
  get_max_sum_context, get_long_token_limit, get_short_token_limit, get_chat_cache_capacity, compute_hash } from "./utils.js";
import { get_settings, chat_enabled, character_enabled, get_character_key, get_summary_initialized, set_summary_initialized, is_chat_loaded } from "./state.js";
import { summarize_text, summaryQueue } from "./summarization.js";
import { default_short_to_long_prompt, default_long_history_initiate_prompt, default_long_compaction_prompt, default_long_template, default_short_template, create_summary_prompt } from "./macros.js";

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

export function generate_uuid() {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

export function get_chat_long_histories() {
  if (!chat_metadata || typeof chat_metadata !== 'object') return [];
  if (!chat_metadata[MODULE_NAME] || typeof chat_metadata[MODULE_NAME] !== 'object') return [];
  if (!Array.isArray(chat_metadata[MODULE_NAME].long_histories)) return [];
  return chat_metadata[MODULE_NAME].long_histories;
}

export function get_long_history_by_uuid(uuid) {
  if (!uuid) return null;
  const list = get_chat_long_histories();
  const found = list.find(item => item && item.history_uuid === uuid);
  return found ? found.history_text : null;
}

export function add_chat_long_history(text) {
  const uuid = generate_uuid();
  if (!chat_metadata || typeof chat_metadata !== 'object') return uuid;
  if (!chat_metadata[MODULE_NAME] || typeof chat_metadata[MODULE_NAME] !== 'object') {
    chat_metadata[MODULE_NAME] = {};
  }
  if (!Array.isArray(chat_metadata[MODULE_NAME].long_histories)) {
    chat_metadata[MODULE_NAME].long_histories = [];
  }
  chat_metadata[MODULE_NAME].long_histories.push({
    history_text: text || '',
    history_uuid: uuid
  });
  if (typeof saveMetadataDebounced === 'function') {
    saveMetadataDebounced();
  }
  return uuid;
}

export function update_chat_long_history(uuid, newText) {
  if (!uuid) return;
  const list = get_chat_long_histories();
  const found = list.find(item => item && item.history_uuid === uuid);
  if (found) {
    found.history_text = (newText || '').trim();
    if (typeof saveMetadataDebounced === 'function') {
      saveMetadataDebounced();
    }
  }
}

export function delete_chat_long_history(uuid) {
  if (!uuid) return;
  if (chat_metadata?.[MODULE_NAME]?.long_histories) {
    chat_metadata[MODULE_NAME].long_histories = chat_metadata[MODULE_NAME].long_histories.filter(
      item => item && item.history_uuid !== uuid
    );
    if (typeof saveMetadataDebounced === 'function') {
      saveMetadataDebounced();
    }
  }

  const ctx = getContext();
  const chat = ctx?.chat;
  if (Array.isArray(chat)) {
    for (let i = 0; i < chat.length; i++) {
      if (chat[i] && get_data(chat[i], 'long_history_uuid') === uuid) {
        set_data(chat[i], 'long_history_uuid', null);
      }
    }
    saveChatDebounced();
  }

  if (get_long_term_cutoff_index() === -1) {
    set_injection_threshold_index(null);
    if (chat_metadata?.[MODULE_NAME]) {
      chat_metadata[MODULE_NAME].iti = null;
      chat_metadata[MODULE_NAME].long_injection = "";
      chat_metadata[MODULE_NAME].short_injection = "";
    }
    saveChatDebounced();
  }
}

export function get_long_history_uuid(message) {
  return get_data(message, 'long_history_uuid');
}

export function set_long_history_uuid(message, uuid) {
  set_data(message, 'long_history_uuid', uuid);
}

export function get_long_term_hash(_message) {
  return null;
}

export function set_long_term_hash(_message, _hash) {}

export function get_chat_long_term_memory() {
  const block = get_last_long_term_history_block();
  return block ? block.text : '';
}

export function set_chat_long_term_memory(_text) {}

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
      let summaries = short_indexes.map(idx => get_memory(chat[idx])).filter(Boolean);
      if (summaries.length > 0) {
        let joined = summaries.join('\n');
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
    let uuid = get_data(chat[i], 'long_history_uuid');
    if (uuid) {
      let long_history = get_long_history_by_uuid(uuid);
      if (long_history) {
        if (sum <= CC) {
          return [long_history, null, i];
        }
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
    let uuid = get_data(chat[i], 'long_history_uuid');
    if (uuid) {
      let lh = get_long_history_by_uuid(uuid);
      if (lh) {
        long_term_history = lh;
        compact_start = i + 1;
        break;
      }
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

export function partition_balanced_token_batches(items, max_capacity) {
  if (!Array.isArray(items) || items.length === 0) return [];
  if (items.length === 1) return [[items[0]]];

  const item_tokens = items.map(s => count_tokens(s) + 1);
  const total_tokens = item_tokens.reduce((acc, t) => acc + t, 0);

  if (total_tokens <= max_capacity) {
    return [items.slice()];
  }

  let num_batches = Math.ceil(total_tokens / max_capacity);
  num_batches = Math.min(items.length, Math.max(1, num_batches));
  const target_tokens = Math.ceil(total_tokens / num_batches);

  const batches = [];
  let current_batch = [];
  let current_tokens = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const tok = item_tokens[i];
    const remaining_items = items.length - i;
    const remaining_batches = num_batches - batches.length;

    const would_exceed = (current_tokens + tok > max_capacity);
    const reached_target = (current_tokens >= target_tokens && remaining_items >= remaining_batches);

    if (current_batch.length > 0 && (would_exceed || (reached_target && remaining_batches > 1))) {
      batches.push(current_batch);
      current_batch = [item];
      current_tokens = tok;
    } else {
      current_batch.push(item);
      current_tokens += tok;
    }
  }

  if (current_batch.length > 0) {
    batches.push(current_batch);
  }

  return batches;
}

export async function map_reduce_compress(items, max_sum_context, depth = 0) {
  if (!items || items.length === 0) return [];
  if (items.length === 1 && depth > 0) return items;

  // 5.1 BATCH CALCULATION
  const short_recomp_template = get_settings('short_to_long_prompt') || default_short_to_long_prompt;
  const long_history_size = get_long_token_limit();
  const N = Math.floor(long_history_size / 1.4);
  const dummy_prompt = short_recomp_template
    .replace(/{{short_memory_list}}/g, '')
    .replace(/{{long_history_size}}/g, N);
  const compact_prompt_tokens = count_tokens(dummy_prompt);
  const BATCH_CAPACITY = Math.max(100, max_sum_context - compact_prompt_tokens - long_history_size);

  const batches = partition_balanced_token_batches(items, BATCH_CAPACITY);

  log(`[Compaction Map Phase] Depth: ${depth}, Input items: ${items.length}, max_sum_context: ${max_sum_context}, BATCH_CAPACITY: ${BATCH_CAPACITY} tokens, Target words per batch (N): ${N}. Partitioned into ${batches.length} batch(es).`);

  if (summaryQueue && typeof summaryQueue.add_extra_total === 'function') {
    summaryQueue.add_extra_total(batches.length, "Compacting memory (short re-compaction)...");
  }

  // 5.2 MAP PHASE (Compression)
  const compressed_batches = [];
  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const compiled = short_recomp_template
      .replace(/{{short_memory_list}}/g, batch.join('\n'))
      .replace(/{{long_history_size}}/g, N);
    const prompt_tokens = count_tokens(compiled);
    log(`[Compaction Map Batch ${b + 1}/${batches.length} (Depth ${depth})] Estimated prompt tokens: ${prompt_tokens} (from ${batch.length} summaries, target words N: ${N}):\n--- PROMPT START ---\n${compiled}\n--- PROMPT END ---`);
    const res = await summarize_text([{ role: 'system', content: compiled }]);
    const res_tokens = count_tokens(res);
    log(`[Compaction Map Batch ${b + 1}/${batches.length} (Depth ${depth})] Response tokens: ${res_tokens}:\n--- RESPONSE START ---\n${res}\n--- RESPONSE END ---`);
    compressed_batches.push(res);
    if (summaryQueue && typeof summaryQueue.step_progress === 'function') {
      summaryQueue.step_progress("Compacting memory (short re-compaction)...");
    }
  }

  // 5.3 REDUCE PHASE (Recursion Check)
  const total_tokens = count_tokens(compressed_batches.join('\n'));
  const half_max = Math.floor(max_sum_context / 2);
  log(`[Compaction Reduce Check (Depth ${depth})] Compressed batches total tokens: ${total_tokens} (half_max ceiling: ${half_max} tokens, batches count: ${compressed_batches.length})`);
  if (total_tokens <= half_max || compressed_batches.length === 1 || depth >= 5) {
    return compressed_batches;
  }

  // Recursion
  return await map_reduce_compress(compressed_batches, max_sum_context, depth + 1);
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

  if (summaries.length === 0) return old_history || "";

  const max_sum_context = get_max_sum_context();

  // 5.1 - 5.3: Map-Reduce compression
  const final_compressed = await map_reduce_compress(summaries, max_sum_context);

  // 5.4 FINAL MERGE
  const new_history_chunk = final_compressed.join('\n');
  const long_budget = get_long_token_limit();
  const target_words = Math.floor(long_budget / 1.4);

  const is_initiate = !old_history || !old_history.trim();
  let compiled_prompt = '';
  let stage_label = '';

  if (is_initiate) {
    stage_label = 'Long-Term History Initiation';
    const initiate_template = get_settings('long_history_initiate') || default_long_history_initiate_prompt;
    compiled_prompt = initiate_template
      .replace(/{{new_history_chunks}}/g, new_history_chunk)
      .replace(/{{new_history_chunk}}/g, new_history_chunk)
      .replace(/{{long_term_memory_size}}/g, target_words);
    log(`[Compaction ${stage_label}] Existing long-term history is empty. Using long_history_initiate template.`);
  } else {
    stage_label = 'Final Long Merge';
    const long_compaction_template = get_settings('long_compaction_prompt') || default_long_compaction_prompt;
    compiled_prompt = long_compaction_template
      .replace(/{{long_memory}}/g, old_history || '')
      .replace(/{{existing_long_memory}}/g, old_history || '')
      .replace(/{{new_history_chunk}}/g, new_history_chunk)
      .replace(/{{long_term_memory_size}}/g, target_words);
    log(`[Compaction ${stage_label}] Existing long-term history found (${count_tokens(old_history)} tokens). Using long_compaction_prompt template.`);
  }

  const prompt_tokens = count_tokens(compiled_prompt);
  log(`[Compaction ${stage_label}] Estimated prompt tokens: ${prompt_tokens} (long_budget: ${long_budget} tokens, target_words: ${target_words}, new_history_chunk tokens: ${count_tokens(new_history_chunk)}):\n--- PROMPT START ---\n${compiled_prompt}\n--- PROMPT END ---`);

  if (summaryQueue && typeof summaryQueue.add_extra_total === 'function') {
    summaryQueue.add_extra_total(1, "Compacting long-term memory...");
  }
  const final_long = await summarize_text([{
    role: 'system',
    content: compiled_prompt
  }]);
  log(`[Compaction ${stage_label}] Response tokens: ${count_tokens(final_long)}:\n--- RESPONSE START ---\n${final_long}\n--- RESPONSE END ---`);
  if (summaryQueue && typeof summaryQueue.step_progress === 'function') {
    summaryQueue.step_progress("Compacting long-term memory...");
  }

  if (summaryQueue && typeof summaryQueue.finish_compaction_progress === 'function') {
    await summaryQueue.finish_compaction_progress();
  }

  // 5.5 HISTORY UPDATES
  const uuid = add_chat_long_history(final_long);
  for (let i = compact_start; i <= history_calc_message; i++) {
    if (chat[i]) {
      set_data(chat[i], 'long_history_uuid', uuid);
    }
  }
  saveChatDebounced();
  return final_long;
}

export function get_last_long_term_history_block() {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return null;

  // Search messages from chat end to chat beginning, taking the first long history uuid found
  let targetUuid = null;
  let targetEndIndex = -1;
  for (let i = chat.length - 1; i >= 0; i--) {
    const uuid = get_data(chat[i], 'long_history_uuid');
    if (uuid) {
      targetUuid = uuid;
      targetEndIndex = i;
      break;
    }
  }

  if (!targetUuid) return null;

  const historyText = get_long_history_by_uuid(targetUuid);
  if (!historyText) return null;

  // Find range of messages sharing this long_history_uuid
  let startIndex = targetEndIndex;
  for (let i = targetEndIndex; i >= 0; i--) {
    if (get_data(chat[i], 'long_history_uuid') === targetUuid) {
      startIndex = i;
    }
  }

  return {
    uuid: targetUuid,
    text: historyText,
    startIndex: startIndex,
    endIndex: targetEndIndex
  };
}

export function update_long_term_history_range(startIndex, endIndex, text) {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return;

  const cleanText = (text || '').trim();
  if (!cleanText) {
    for (let i = startIndex; i <= endIndex; i++) {
      if (chat[i]) {
        set_data(chat[i], 'long_history_uuid', null);
      }
    }
  } else {
    let existingUuid = null;
    for (let i = startIndex; i <= endIndex; i++) {
      if (chat[i]) {
        existingUuid = get_data(chat[i], 'long_history_uuid');
        if (existingUuid) break;
      }
    }
    if (existingUuid && get_long_history_by_uuid(existingUuid)) {
      update_chat_long_history(existingUuid, cleanText);
    } else {
      const uuid = add_chat_long_history(cleanText);
      for (let i = startIndex; i <= endIndex; i++) {
        if (chat[i]) set_data(chat[i], 'long_history_uuid', uuid);
      }
    }
  }
  saveChatDebounced();
}

export function delete_long_term_history_range(startIndex, endIndex) {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat)) return;
  for (let i = startIndex; i <= endIndex; i++) {
    if (chat[i]) {
      const uuid = get_data(chat[i], 'long_history_uuid');
      if (uuid) {
        delete_chat_long_history(uuid);
        return;
      }
    }
  }
}

export function get_long_term_cutoff_index() {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return -1;

  for (let i = chat.length - 1; i >= 0; i--) {
    const uuid = get_data(chat[i], 'long_history_uuid');
    if (chat[i] && uuid && get_long_history_by_uuid(uuid)) {
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

  try {
    if (unsummarized.length > 0) {
      if (summaryQueue && typeof summaryQueue.add === 'function' && typeof summaryQueue.run === 'function') {
        for (let idx of unsummarized) {
          summaryQueue.add(idx);
        }
        await summaryQueue.run();
      } else {
        for (let idx of unsummarized) {
          const prompt = await create_summary_prompt(idx);
          if (prompt && prompt.length > 0) {
            const res = await summarize_text(prompt);
            if (res) {
              set_data(chat[idx], 'memory', res);
              set_data(chat[idx], 'hash', compute_hash(res));
            }
          }
        }
      }
    }

    // Prior history handling
    const cleanPrior = (priorHistory || '').trim();
    if (cleanPrior && chatLength > 0) {
      const historyEnd = Math.max(0, compactStart - 1);
      const uuid = add_chat_long_history(cleanPrior);
      for (let i = 0; i <= historyEnd; i++) {
        if (chat[i]) {
          set_data(chat[i], 'long_history_uuid', uuid);
        }
      }
    }
  } finally {
    if (summaryQueue && typeof summaryQueue.finish_compaction_progress === 'function') {
      await summaryQueue.finish_compaction_progress();
    } else if (summaryQueue && typeof summaryQueue.hide_progress === 'function') {
      await summaryQueue.hide_progress();
    }
    set_summary_initialized(true);
    saveChatDebounced();
    notify_memory_refresh_visuals();
  }
}
