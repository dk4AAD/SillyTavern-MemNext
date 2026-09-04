/* eslint-disable */
import { generateRaw, main_api, amount_gen, chat_metadata } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { getStringHash } from '../../../utils.js';
import { t } from '../../../i18n.js';
import { PROGRESS_BAR_ID } from './constants.js';
import { debug, toast, saveChatDebounced } from './utils.js';
import { get_settings, chat_enabled, get_active_connection_profile, auto_load_profile, notify_ui_refresh, get_summary_initialized } from './state.js';
import { set_data, get_memory, check_message_exclusion, refresh_memory, fillup, INJECTION_THRESHOLD_INDEX, set_injection_threshold_index, get_injection_threshold_index } from './memory.js';
import { create_summary_prompt } from './macros.js';
import { ensure_summary_initialized } from './ui.js';

// Visual update callback hooks to prevent tight UI coupling
var _message_visuals_callback = null;
export function set_message_visuals_callback(fn) {
  _message_visuals_callback = fn;
}

export function update_message_visuals(index, in_progress = false, custom_text = null) {
  if (typeof _message_visuals_callback === 'function') {
    _message_visuals_callback(index, in_progress, custom_text);
  }
}

var _all_message_visuals_callback = null;
export function set_all_visuals_callback(fn) {
  _all_message_visuals_callback = fn;
}

export function update_all_message_visuals() {
  if (typeof _all_message_visuals_callback === 'function') {
    _all_message_visuals_callback();
  }
}

// Progress Bar Display matching SillyTavern-MessageSummarize
export function show_progress_bar(id, progress, total, title) {
  if (typeof $ === 'undefined') return;
  const full_id = `${PROGRESS_BAR_ID}_${id}`;
  const $existing = $(`.${full_id}`);
  if ($existing.length > 0) {
    if (title) $existing.find('div.title').text(title);
    if (progress !== null && progress !== undefined) {
      $existing.find('span.progress').text(progress);
      $existing.find('progress').val(progress);
    }
    if (total !== null && total !== undefined) {
      $existing.find('span.total').text(total);
      $existing.find('progress').attr('max', total);
    }
    return;
  }

  const cancelTitle = typeof t === 'function' ? t`Abort summarization` : 'Abort summarization';
  const bar = $(`
<div class="${full_id} memnext_progress_bar flex-container justifyspacebetween alignitemscenter">
    <div class="title">${title || 'Summarizing...'}</div>
    <div>(<span class="progress">${progress || 0}</span> / <span class="total">${total || 0}</span>)</div>
    <progress value="${progress || 0}" max="${total || 0}" class="flex1"></progress>
    <button class="menu_button fa-solid fa-stop" title="${cancelTitle}"></button>
</div>`);

  bar.find('button').on('click', function () {
    summaryQueue.stop();
  });

  $('#sheld').append(bar);
  if ($('#memnext_memory_state_interface #progress_bar').length > 0) {
    $('#memnext_memory_state_interface #progress_bar').append(bar.clone(true));
  }
}

export function hide_progress_bar(id) {
  if (typeof $ === 'undefined') return;
  const full_id = `${PROGRESS_BAR_ID}_${id}`;
  const $existing = $(`.${full_id}`);
  if ($existing.length > 0) {
    debug("Removing progress bar");
    $existing.remove();
  }
}

// SummaryQueue & Concurrency Management
export class SummaryQueue {
  tasks = [];
  active_workers = 0;
  aborted = false;
  total_tasks = 0;
  completed_tasks = 0;
  queue_running = false;
  last_summary_request_time = 0;
  _running_promise = null;

  constructor() {}

  init_ui() {}

  add(index) {
    if (!this.tasks.includes(index)) {
      this.tasks.push(index);
      if (this.queue_running) {
        this.total_tasks++;
        if (get_settings('auto_summarize_progress')) {
          show_progress_bar('summarize', this.completed_tasks, this.total_tasks, "Summarizing...");
        }
      }
    }
  }

  stop() {
    this.aborted = true;
    this.tasks = [];
    const ctx = getContext();
    if (ctx && typeof ctx.stopGeneration === 'function') {
      try {
        ctx.stopGeneration();
      } catch (e) {
        debug(`stopGeneration error: ${e}`);
      }
    }
    this.hide_progress();
    this.queue_running = false;
    this._running_promise = null;
    this.total_tasks = 0;
    this.completed_tasks = 0;
    if (get_settings('block_chat') && ctx && typeof ctx.activateSendButtons === 'function') {
      ctx.activateSendButtons();
    }
    debug("SummaryQueue stopped.");
  }

  clear() {
    this.stop();
  }

  show_progress(completed, total, title = "Summarizing...") {
    if (!get_settings('auto_summarize_progress')) return;
    show_progress_bar('summarize', completed, total, title);
  }

  async hide_progress() {
    hide_progress_bar('summarize');
    await new Promise(r => setTimeout(r, 20));
  }

  add_extra_total(count, title = "Compacting memory...") {
    this.total_tasks += count;
    if (get_settings('auto_summarize_progress')) {
      show_progress_bar('summarize', this.completed_tasks, this.total_tasks, title);
    }
  }

  step_progress(title = null) {
    this.completed_tasks++;
    if (get_settings('auto_summarize_progress')) {
      show_progress_bar('summarize', this.completed_tasks, this.total_tasks, title);
    }
  }

  async finish_compaction_progress() {
    await this.hide_progress();
    this.total_tasks = 0;
    this.completed_tasks = 0;
  }

  async run() {
    if (this.queue_running) {
      if (this._running_promise) {
        await this._running_promise;
      }
      return;
    }
    if (this.tasks.length === 0) return;

    this.queue_running = true;
    this.aborted = false;
    const ctx = getContext();

    if (get_settings('block_chat') && ctx && typeof ctx.deactivateSendButtons === 'function') {
      ctx.deactivateSendButtons();
    }

    const concurrency = Number(get_settings('parallel_summaries_count')) || 1;
    this.completed_tasks = 0;
    this.total_tasks = this.tasks.length;
    this.show_progress(this.completed_tasks, this.total_tasks, "Summarizing...");

    this._running_promise = (async () => {
      try {
        const workers = [];
        for (let i = 0; i < concurrency; i++) {
          workers.push(this.worker());
        }
        await Promise.all(workers);
      } finally {
        this.queue_running = false;
        this._running_promise = null;
        await this.hide_progress();
        this.total_tasks = 0;
        this.completed_tasks = 0;
        if (get_settings('block_chat') && ctx && typeof ctx.activateSendButtons === 'function') {
          ctx.activateSendButtons();
        }
      }

      await refresh_memory();
      update_all_message_visuals();
      saveChatDebounced();
    })();

    await this._running_promise;
  }

  async worker() {
    while (this.tasks.length > 0 && !this.aborted) {
      const mes_id = this.tasks.shift();
      if (mes_id === undefined || mes_id === null) break;

      // Rate limiting: summarization_time_delay (in seconds)
      const time_delay_s = Number(get_settings('summarization_time_delay')) || 0;
      if (time_delay_s > 0 && !this.aborted) {
        const skip_first = Boolean(get_settings('summarization_time_delay_skip_first')) && this.completed_tasks === 0;
        if (!skip_first && this.last_summary_request_time > 0) {
          const elapsed = Date.now() - this.last_summary_request_time;
          const required_delay = time_delay_s * 1000;
          if (elapsed < required_delay) {
            const wait_ms = required_delay - elapsed;
            this.show_progress(this.completed_tasks, this.total_tasks, `Waiting ${Math.ceil(wait_ms / 1000)}s...`);
            await new Promise(r => setTimeout(r, wait_ms));
          }
        }
      }

      if (this.aborted) break;
      await summarize_message(mes_id);
      this.last_summary_request_time = Date.now();
      this.step_progress("Summarizing...");
    }
  }
}

export const summaryQueue = new SummaryQueue();

function escapeRegex(string) {
  return String(string || '').replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}

// Clean reasoning, thoughts, and channel tags from LLM outputs
export function clean_llm_reasoning_tags(text, template = null) {
  if (typeof text !== 'string') return '';
  let str = text;

  // 1. If a specific reasoning template with prefix & suffix is provided
  if (template?.prefix && template?.suffix) {
    const p = escapeRegex(template.prefix);
    const s = escapeRegex(template.suffix);
    str = str.replace(new RegExp(`${p}[\\s\\S]*?${s}`, 'g'), '');
    str = str.replace(new RegExp(`^\\s*${p}`, 'g'), '');
    str = str.replace(new RegExp(`${s}`, 'g'), '');
  }

  // 2. Strip Gemma 4 and general channel thought tags: <|channel>thought ... <channel|>
  str = str.replace(/<\|channel\>thought[\s\S]*?<channel\|>/gi, '');
  str = str.replace(/<\|channel\>thought[\s\S]*?$/i, '');
  str = str.replace(/<\|channel\>thought\s*/gi, '');
  str = str.replace(/<channel\|>\s*/gi, '');

  // 3. Strip DeepSeek / Qwen think tags: <think> ... </think>
  str = str.replace(/<think>[\s\S]*?<\/think>/gi, '');
  str = str.replace(/<think>[\s\S]*?$/i, '');
  str = str.replace(/<\/think>\s*/gi, '');

  // 4. Strip alternative thought tags: <|thought|> ... </|thought|> or <thought> ... </thought>
  str = str.replace(/<|thought\|>[\s\S]*?<\/\|thought\|>/gi, '');
  str = str.replace(/<|thought\|>[\s\S]*?<\|\/thought\|>/gi, '');
  str = str.replace(/<thought>[\s\S]*?<\/thought>/gi, '');

  return str.trim();
}

// LLM Interaction for Summarization
export async function summarize_text(messages, streaming = false) {
  const profile = get_active_connection_profile();
  const profile_id = profile?.id;
  const context = getContext();

  let rawContent = '';
  let rawReasoning = '';

  // 1. Prefer Tavern's ConnectionManagerRequestService if available
  if (profile_id && context?.ConnectionManagerRequestService?.sendRequest) {
    try {
      const max_tokens = get_summary_max_tokens();
      const response = await context.ConnectionManagerRequestService.sendRequest(
        profile_id,
        messages,
        max_tokens,
        { extractData: true, includePreset: true, stream: false }
      );
      if (typeof response === 'string') {
        rawContent = response;
      } else if (response && typeof response === 'object') {
        rawContent = response.content || response.text || '';
        rawReasoning = response.reasoning || '';
      }
    } catch (err) {
      debug(`ConnectionManagerRequestService sendRequest failed, falling back to generateRaw: ${err}`);
    }
  }

  // 2. Fallback to generateRaw if sendRequest did not produce output
  if (!rawContent) {
    let prompt;
    if (profile_id && context?.ConnectionManagerRequestService?.constructPrompt) {
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
        rawContent = typeof response === 'string' ? response.trim() : (response?.text || '').trim();
      }
    } catch (err) {
      debug(`Generate raw failed: ${err}`);
    }
  }

  if (!rawContent) {
    return `[Summary of: ${JSON.stringify(messages).slice(0, 80)}...]`;
  }

  // 3. Process reasoning template if defined in profile or SillyTavern settings
  const template_name = profile?.['reasoning-template'] || profile?.reasoningTemplate;
  let template = null;
  if (template_name && typeof context?.getReasoningTemplateByName === 'function') {
    template = context.getReasoningTemplateByName(template_name);
  }
  if (!template && context?.power_user?.reasoning) {
    template = context.power_user.reasoning;
  }

  if (template && typeof context?.parseReasoningFromString === 'function') {
    try {
      const parsed = context.parseReasoningFromString(rawContent, { strict: false }, template);
      if (parsed && typeof parsed.content === 'string' && parsed.content.length > 0) {
        rawContent = parsed.content;
      }
    } catch (e) {
      debug(`parseReasoningFromString error: ${e}`);
    }
  }

  // 4. Clean any residual reasoning/channel tags (e.g. <|channel>thought\n<channel|>)
  let cleanContent = clean_llm_reasoning_tags(rawContent, template);

  // 5. Trim to end sentence if powerUserSettings.trim_sentences is active
  if (context?.powerUserSettings?.trim_sentences && typeof trimToEndSentence === 'function') {
    cleanContent = trimToEndSentence(cleanContent);
  }

  return cleanContent || rawContent.trim();
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

  if (!get_summary_initialized()) {
    const ok = await ensure_summary_initialized();
    if (!ok) return;
  }

  for (let i = 0; i < chat.length; i++) {
    const msg = chat[i];
    if (!msg) continue;
    const has_mem = get_memory(msg);
    if (!has_mem && check_message_exclusion(msg)) {
      summaryQueue.add(i);
    }
  }
  if (summaryQueue.tasks.length > 0) {
    await summaryQueue.run();
  }
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
  await fillup();
  if (!Array.isArray(chat) || chat.length === 0) return;
  const ctx = getContext();
  const IGNORE_SYMBOL = ctx?.symbols?.ignore || Symbol.for('ignore');
  let start = chat.length - 1;
  if (type === 'continue') start--;
  let iti = get_injection_threshold_index();
  if (iti === null || iti === undefined || iti < 0) return;

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

let last_char_message_index = null;

// Chat event router
export async function on_chat_event(event, data = null) {
  debug(`Handling chat event: ${event}`);
  switch (event) {
    case 'user_message':
      if (data !== null && data !== undefined) {
        update_message_visuals(Number(data));
      }
      await auto_summarize_chat();
      update_all_message_visuals();
      break;
    case 'char_message':
      if (data !== null && data !== undefined) {
        update_message_visuals(Number(data));
      }
      // Check if continuing the same character message
      if (data !== null && data !== undefined && Number(data) === last_char_message_index) {
        if (get_settings('auto_summarize_on_continue')) {
          summaryQueue.add(Number(data));
          setTimeout(async () => {
            await summaryQueue.run();
            update_all_message_visuals();
          }, 50);
        }
      } else {
        last_char_message_index = data !== null && data !== undefined ? Number(data) : null;
        // Defer auto-summarization so SillyTavern finishes rendering
        // and the browser immediately paints/prints the message in chat.
        setTimeout(async () => {
          await auto_summarize_chat();
          update_all_message_visuals();
        }, 100);
      }
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
      last_char_message_index = null;
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
  }
}
