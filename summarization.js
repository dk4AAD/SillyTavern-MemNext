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
import { debug, error } from "./utils.js";
import { get_settings, chat_enabled, get_active_connection_profile } from "./state.js";
import { update_message_visuals, promptInterface1 } from "./ui.js";
import { set_data, get_memory, check_message_exclusion } from "./memory.js";
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

// SummaryQueue & Concurrency Management
export
// Single Message Summarization Flow
async function summarize_message(index, custom_profile = null) {
  const ctx = getContext();
  const chat = ctx?.chat;
  if (!Array.isArray(chat) || !chat[index]) {
    throw new Error(`Message at index ${index} does not exist.`);
  }
  const message = chat[index];
  debug(`Summarizing message ID [${index}]`);
  update_message_visuals(index, true, t`Summarizing...`);
  const messages_payload = await promptInterface1.create_summary_prompt(index);
  try {
    const result = await summarize_text(messages_payload, custom_profile);
    set_data(message, 'memory', result);
    set_data(message, 'hash', getStringHash(message.mes || ''));
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

// Exclusion checking
export
// Auto-summarize chat
async function auto_summarize_chat() {
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

// Chat event router
export let summaryQueue;
export async function get_connection_profile_api() {
  return "default";
}
export function get_summary_max_tokens() {
  return amount_gen || 50;
}