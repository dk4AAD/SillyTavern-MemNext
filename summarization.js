/* eslint-disable */
import { generateRaw, main_api, amount_gen, chat_metadata } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { getStringHash } from '../../../utils.js';
import { t } from '../../../i18n.js';
import { PROGRESS_BAR_ID } from './constants.js';
import { debug, toast, saveChatDebounced } from './utils.js';
import { get_settings, chat_enabled, get_active_connection_profile, auto_load_profile, notify_ui_refresh } from './state.js';
import { set_data, get_memory, check_message_exclusion, refresh_memory, fillup, INJECTION_THRESHOLD_INDEX, set_injection_threshold_index, get_injection_threshold_index } from './memory.js';
import { create_summary_prompt } from './macros.js';

// Visual update callback hooks to prevent tight UI coupling
let _message_visuals_callback = null;
export function set_message_visuals_callback(fn) {
  _message_visuals_callback = fn;
}

export function update_message_visuals(index, in_progress = false, custom_text = null) {
  if (typeof _message_visuals_callback === 'function') {
    _message_visuals_callback(index, in_progress, custom_text);
  }
}

let _all_message_visuals_callback = null;
export function set_all_visuals_callback(fn) {
  _all_message_visuals_callback = fn;
}

export function update_all_message_visuals() {
  if (typeof _all_message_visuals_callback === 'function') {
    _all_message_visuals_callback();
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
  }

  show_progress(completed, total) {
    if (!get_settings('auto_summarize_progress')) return;
    if (!this.progress_bar || typeof $ === 'undefined') return;
    this.progress_bar.show();
    const percent = total > 0 ? (completed / total) * 100 : 0;
    this.progress_bar.find('.progress_bar_fill').css('width', `${percent}%`);
  }

  hide_progress() {
    if (this.progress_bar && typeof $ === 'undefined') return;
    this.progress_bar?.hide();
  }

  async run() {
    this.aborted = false;
    if (this.tasks.length === 0) return;
    const concurrency = Number(get_settings('parallel_summaries_count')) || 1;
    const batch_size = Number(get_settings('auto_summarize_batch_size')) || 1;
    let completed = 0;
    const total = this.tasks.length;
    this.show_progress(completed, total);

    const workers = [];
    for (let i = 0; i < concurrency; i++) {
      workers.push(this.worker(batch_size, () => {
        completed++;
        this.show_progress(completed, total);
      }));
    }
    await Promise.all(workers);
    this.hide_progress();
    refresh_memory();
    saveChatDebounced();
  }

  async worker(batch_size, on_step) {
    while (this.tasks.length > 0 && !this.aborted) {
      const batch = this.tasks.splice(0, batch_size);
      for (const mes_id of batch) {
        await summarize_message(mes_id);
        if (on_step) on_step();
      }
      const delay = Number(get_settings('summarization_delay')) || 0;
      if (delay > 0) {
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
}

export const summaryQueue = new SummaryQueue();

// LLM Interaction for Summarization
export async function summarize_text(messages, streaming = false) {
  const profile_id = get_active_connection_profile()?.id;
  const context = getContext();
  let prompt;
  if (profile_id && context?.ConnectionManagerRequestService) {
    prompt = context.ConnectionManagerRequestService.constructPrompt(messages, profile_id);
  } else {
    prompt = messages.map(m => `${m.role}: ${m.content}`).join('\n\n');
  }

  const hash = typeof getStringHash === 'function' ? getStringHash(JSON.stringify(messages)) : null;
  const generate_options = {
    custom_model: profile_id,
    prompt_hash: hash
  };

  try {
    if (typeof generateRaw === 'function') {
      const response = await generateRaw(prompt, main_api, false, false, generate_options);
      return typeof response === 'string' ? response.trim() : (response?.text || '').trim();
    }
  } catch (err) {
    debug(`Generate raw failed, falling back: ${err}`);
  }
  return `[Summary of: ${prompt.slice(0, 80)}...]`;
}

export async function summarize_message(index) {
  const ctx = getContext();
  const message = ctx?.chat?.[index];
  if (!message) return;

  update_message_visuals(index, true, "[Summarizing...]");
  try {
    const prompt_text = get_settings('message_summary_prompt');
    const macros = get_settings('summary_prompt_macros');
    const role = Number(get_settings('prompt_role')) || 0;
    const prefill = get_settings('prefill') || '';

    const messages = await create_summary_prompt(index, prompt_text, {
      custom_macros: macros,
      prompt_role: role,
      prefill: prefill,
      ctx: ctx
    });

    let summary = await summarize_text(messages);
    if (summary && get_settings('show_prefill') && prefill && !summary.startsWith(prefill)) {
      summary = prefill + " " + summary;
    }
    set_data(message, 'memory', summary);
    set_data(message, 'error', null);
  } catch (e) {
    debug(`Error summarizing message ${index}: ${e}`);
    set_data(message, 'error', String(e));
  } finally {
    update_message_visuals(index, false);
  }
}

export async function auto_summarize_chat() {
  if (!chat_enabled() || !get_settings('auto_summarize')) return;
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || chat.length === 0) return;

  const limit = Number(get_settings('auto_summarize_message_limit'));
  const start = limit > 0 ? Math.max(0, chat.length - limit) : 0;

  for (let i = start; i < chat.length; i++) {
    const msg = chat[i];
    if (!msg) continue;
    const has_mem = get_memory(msg);
    if (!has_mem && check_message_exclusion(msg)) {
      summaryQueue.add(i);
    }
  }
  await summaryQueue.run();
}

export async function get_connection_profile_api() {
  const profile = get_active_connection_profile();
  if (profile?.api) return profile.api;
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
  let iti = get_injection_threshold_index();
  if (iti === null || iti === undefined || iti < 0) return;

  let last_user_idx = -1;
  if (get_settings('keep_last_user_message')) {
    for (let j = chat.length - 1; j >= 0; j--) {
      if (chat[j]?.is_user) {
        last_user_idx = j;
        break;
      }
    }
  }

  for (let i = start; i >= 0; i--) {
    const message = chat[i];
    if (!message || typeof message !== 'object') continue;
    if (i === last_user_idx) continue;
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
      if (data !== null && data !== undefined) {
        update_message_visuals(Number(data));
      }
      refresh_memory();
      await auto_summarize_chat();
      break;
    case 'char_message':
      if (data !== null && data !== undefined) {
        update_message_visuals(Number(data));
      }
      refresh_memory();
      await auto_summarize_chat();
      break;
    case 'message_edited':
      if (data !== null && data !== undefined) {
        update_message_visuals(Number(data));
      }
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
      if (data !== null && data !== undefined) {
        update_message_visuals(Number(data));
      }
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
      await refresh_memory();
      update_all_message_visuals();
      setTimeout(() => update_all_message_visuals(), 100);
      setTimeout(() => update_all_message_visuals(), 400);
      break;
    case 'message_deleted':
      if (chat_metadata?.memnext) chat_metadata.memnext.iti = null;
      refresh_memory();
      update_all_message_visuals();
      break;
    case 'before_message':
      if (get_settings('auto_summarize_on_send')) {
        await auto_summarize_chat();
      }
      break;
  }
}
