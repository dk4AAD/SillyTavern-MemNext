/* eslint-disable */
import { generateRaw, main_api, amount_gen, chat_metadata } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { getStringHash } from '../../../utils.js';
import { t } from '../../../i18n.js';
import { PROGRESS_BAR_ID } from './constants.js';
import { debug, toast, saveChatDebounced } from './utils.js';
import { get_settings, chat_enabled, get_active_connection_profile, auto_load_profile, notify_ui_refresh } from './state.js';
import { set_data, get_memory, check_message_exclusion, refresh_memory, fillup, INJECTION_THRESHOLD_INDEX, set_injection_threshold_index } from './memory.js';
import { create_summary_prompt } from './macros.js';

// Visual update callback hook to prevent tight UI coupling
let _message_visuals_callback = null;
export function set_message_visuals_callback(fn) {
  _message_visuals_callback = fn;
}

export function update_message_visuals(index, in_progress = false, custom_text = null) {
  if (typeof _message_visuals_callback === 'function') {
    _message_visuals_callback(index, in_progress, custom_text);
  }
}

// SummaryQueue & Concurrency Management
export class SummaryQueue {
  tasks = [];
  active_workers = 0;
  aborted = false;

  constructor() {
    if (typeof $ !== 'undefined') {
      this.progress_bar = $(`<div id="${PROGRESS_BAR_ID}" class="memnext_progress_bar" style="display:none;"><div class="progress_bar_fill"></div></div>`);
    } else {
      this.progress_bar = null;
    }
  }

  init_ui() {
    if (this.progress_bar && typeof $ !== 'undefined') {
      $('#sheld').append(this.progress_bar);
    }
  }

  add(index) {
    if (!this.tasks.includes(index)) {
      this.tasks.push(index);
    }
  }

  clear() {
    this.tasks = [];
    this.aborted = true;
    this.hide_progress();
    this.unblock_chat();
  }

  show_progress(current, total) {
    if (!get_settings('auto_summarize_progress')) return;
    if (!this.progress_bar || typeof $ === 'undefined') return;
    this.progress_bar.show();
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    this.progress_bar.find('.progress_bar_fill').css('width', `${percent}%`);
  }

  hide_progress() {
    if (this.progress_bar) {
      this.progress_bar.hide();
    }
  }

  block_chat() {
    if (get_settings('block_chat') && typeof $ !== 'undefined') {
      $('#send_button').prop('disabled', true);
      $('#send_textarea').prop('disabled', true);
    }
  }

  unblock_chat() {
    if (typeof $ !== 'undefined') {
      $('#send_button').prop('disabled', false);
      $('#send_textarea').prop('disabled', false);
    }
  }

  async run() {
    if (this.tasks.length === 0) return;
    this.aborted = false;
    this.block_chat();
    const total = this.tasks.length;
    let completed = 0;
    this.show_progress(completed, total);

    const concurrency = Math.max(1, Number(get_settings('parallel_summaries_count')) || 1);
    const delay = Number(get_settings('summarization_delay')) || 0;
    const time_delay = Number(get_settings('summarization_time_delay')) || 0;

    const worker = async () => {
      while (this.tasks.length > 0 && !this.aborted) {
        const index = this.tasks.shift();
        if (index === undefined) break;
        try {
          if (delay > 0) {
            await new Promise(r => setTimeout(r, delay));
          }
          await summarize_message(index);
        } catch (e) {
          debug(`Error summarizing message [${index}]:`, e);
        }
        completed++;
        this.show_progress(completed, total);
        if (time_delay > 0 && this.tasks.length > 0) {
          await new Promise(r => setTimeout(r, time_delay * 1000));
        }
      }
    };

    const workers = [];
    for (let w = 0; w < concurrency; w++) {
      workers.push(worker());
    }
    await Promise.allSettled(workers);
    this.hide_progress();
    this.unblock_chat();
    refresh_memory();
    saveChatDebounced();
  }
}

// Instance safely declared AFTER class definition
export const summaryQueue = new SummaryQueue();

export async function summarize_text(messages, profile = null) {
  const ctx = getContext();
  if (!ctx) throw new Error("SillyTavern context not available.");
  const conn_profile = profile || get_active_connection_profile();

  if (ctx.ConnectionManagerRequestService && typeof ctx.ConnectionManagerRequestService.sendRequest === 'function') {
    const response = await ctx.ConnectionManagerRequestService.sendRequest(conn_profile?.id || conn_profile?.name || '', messages);
    if (typeof response === 'string') return response.trim();
    if (response && typeof response === 'object' && response.content) return String(response.content).trim();
  }

  // Fallback: generateRaw
  if (typeof generateRaw === 'function') {
    const prompt_str = Array.isArray(messages) ? messages.map(m => m?.content || '').join('\n\n') : String(messages);
    const result = await generateRaw(prompt_str, main_api, false, false);
    return String(result || '').trim();
  }
  throw new Error("No compatible SillyTavern generation service found.");
}

// Single Message Summarization Flow
export async function summarize_message(index, custom_profile = null) {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || !chat[index]) {
    throw new Error(`Message at index ${index} does not exist.`);
  }
  const message = chat[index];
  debug(`Summarizing message ID [${index}]`);
  update_message_visuals(index, true, t ? t`Summarizing...` : "Summarizing...");

  // Standalone prompt creation decoupled from UI
  const messages_payload = await create_summary_prompt(index);
  try {
    const result = await summarize_text(messages_payload, custom_profile);
    set_data(message, 'memory', result);
    set_data(message, 'hash', typeof getStringHash === 'function' ? getStringHash(message.mes || '') : message.mes);
    set_data(message, 'error', null);
    set_data(message, 'edited', false);
    update_message_visuals(index);
    return result;
  } catch (err) {
    set_data(message, 'error', String(err));
    update_message_visuals(index);
    throw err;
  }
}

// Auto-summarize chat
export async function auto_summarize_chat() {
  if (!chat_enabled() || !get_settings('auto_summarize')) return;
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return;

  const limit = Number(get_settings('auto_summarize_message_limit'));
  const start_index = limit === -1 ? 0 : Math.max(0, chat.length - limit);
  const to_summarize = [];

  for (let i = start_index; i < chat.length; i++) {
    const message = chat[i];
    if (!message) continue;
    if (!check_message_exclusion(message)) continue;
    if (!get_memory(message)) {
      to_summarize.push(i);
    }
  }

  const batch_size = Number(get_settings('auto_summarize_batch_size')) || 1;
  if (to_summarize.length >= batch_size) {
    for (const idx of to_summarize) {
      summaryQueue.add(idx);
    }
    await summaryQueue.run();
  }
}

export async function get_connection_profile_api() {
  return "default";
}

export function get_summary_max_tokens() {
  return amount_gen || 50;
}

// Generate Interceptor (Truncate Raw Chat Beyond Threshold)
export async function memory_intercept_messages(chat, _contextSize, _abort, type) {
  if (!chat_enabled()) return;
  if (!get_settings('exclude_messages_after_threshold')) return;
  await fillup();
  if (!Array.isArray(chat) || chat.length === 0) return;
  const ctx = getContext();
  const IGNORE_SYMBOL = ctx?.symbols?.ignore || Symbol.for('ignore');
  let start = chat.length - 1;
  if (type === 'continue') start--;
  let iti = INJECTION_THRESHOLD_INDEX !== null ? INJECTION_THRESHOLD_INDEX : -1;
  for (let i = start; i >= 0; i--) {
    const message = chat[i];
    if (!message || typeof message !== 'object') continue;
    chat[i] = structuredClone(chat[i]);
    chat[i].extra = chat[i].extra || {};
    chat[i].extra[IGNORE_SYMBOL] = i <= iti;
  }
}

if (typeof globalThis !== 'undefined') {
  globalThis.memnext_intercept_messages = memory_intercept_messages;
}

// Chat event router
export async function on_chat_event(event, data = null) {
  debug(`Handling chat event: ${event}`);
  switch (event) {
    case 'user_message':
    case 'char_message':
      refresh_memory();
      await auto_summarize_chat();
      break;
    case 'message_edited':
      if (get_settings('auto_summarize_on_edit') && data !== null) {
        summaryQueue.add(data);
        await summaryQueue.run();
      }
      if (chat_metadata?.memnext && data <= chat_metadata.memnext.iti) {
        chat_metadata.memnext.iti = null;
      }
      refresh_memory();
      break;
    case 'message_swiped':
      if (get_settings('auto_summarize_on_swipe') && data !== null) {
        summaryQueue.add(data);
        await summaryQueue.run();
      }
      refresh_memory();
      break;
    case 'chat_changed':
      auto_load_profile();
      set_injection_threshold_index(null);
      if (chat_metadata?.memnext) chat_metadata.memnext.iti = null;
      notify_ui_refresh();
      refresh_memory();
      break;
    case 'message_deleted':
      if (chat_metadata?.memnext) chat_metadata.memnext.iti = null;
      refresh_memory();
      break;
    case 'before_message':
      if (get_settings('auto_summarize_on_send')) {
        await auto_summarize_chat();
      }
      break;
  }
}
