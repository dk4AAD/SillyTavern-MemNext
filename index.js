/* eslint-disable */
import { getContext } from '../../../extensions.js';
import { MacrosParser } from '../../../macros.js';
import { MODULE_NAME, MODULE_NAME_FANCY, long_memory_macro, short_memory_macro } from './constants.js';
import { log, error, guard_get_element_by_id } from './utils.js';
import { initialize_settings, chat_enabled, toggle_chat_enabled } from './state.js';
import {
  init_interfaces,
  initialize_settings_ui,
  initialize_popout,
  initialize_message_buttons,
  update_all_message_visuals
} from './ui.js';
import {
  refresh_memory,
  set_chat_long_term_memory,
  check_message_exclusion,
  get_memory,
  get_chat_long_term_memory
} from './memory.js';
import {
  summaryQueue,
  summarize_message,
  on_chat_event,
  get_summary_max_tokens
} from './summarization.js';

export { MODULE_NAME } from './constants.js';

// Install DOM guard immediately on module load to prevent empty-string getElementById warnings
guard_get_element_by_id();

// Register SillyTavern slash commands
export function initialize_slash_commands() {
  const ctx = getContext();
  const SlashCommandParser = ctx?.SlashCommandParser;
  const SlashCommand = ctx?.SlashCommand;
  if (!SlashCommandParser || !SlashCommand) return;

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'memnext-toggle',
    callback: () => {
      toggle_chat_enabled();
      return `MemNext is now ${chat_enabled() ? 'enabled' : 'disabled'}.`;
    },
    helpString: 'Toggle MemNext on or off for the current chat.'
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'memnext-refresh',
    callback: async () => {
      await refresh_memory();
      return 'MemNext memory and inclusion flags refreshed.';
    },
    helpString: 'Force a full refresh of MemNext memories and prompt injections.'
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'memnext-summarize',
    callback: async (args) => {
      const idx = args?.index !== undefined ? Number(args.index) : null;
      if (idx !== null && !isNaN(idx)) {
        await summarize_message(idx);
        return `Summarized message ${idx}.`;
      }
      return 'Please provide a valid message index.';
    },
    helpString: 'Summarize a specific message by index.'
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'memnext-summarize-all',
    callback: async () => {
      const ctx = getContext();
      const chat = ctx?.chat || [];
      let count = 0;
      for (let i = 0; i < chat.length; i++) {
        if (!get_memory(chat[i]) && check_message_exclusion(chat[i])) {
          summaryQueue.add(i);
          count++;
        }
      }
      void summaryQueue.run();
      return `Queued ${count} unsummarized messages for processing.`;
    },
    helpString: 'Summarize all unsummarized messages from the start of the chat.'
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'memnext-clear-long',
    callback: () => {
      const ctx = getContext(); if (Array.isArray(ctx?.chat) && ctx.chat.length > 0) { delete_long_term_history_range(0, ctx.chat.length - 1); }
      refresh_memory();
      return 'Long-term consolidated memory cleared.';
    },
    helpString: 'Clear consolidated long-term narrative for the active chat.'
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'memnext-max-summary-tokens',
    callback: () => {
      return String(get_summary_max_tokens());
    },
    helpString: 'Return current max summary generation tokens.'
  }));
}

// Module Initializer
if (typeof jQuery !== 'undefined') {
  jQuery(async () => {
    try {
      const is_browser = typeof window !== 'undefined';
      if (!is_browser) return;

      log(`Initializing ${MODULE_NAME_FANCY} extension...`);
      init_interfaces();

      // Load settings HTML into SillyTavern extensions settings container
      try {
        if ($('#memnext_settings').length === 0) {
          const index_url = import.meta.url;
          const settings_url = new URL('settings.html', index_url).href;
          const html = await $.get(settings_url);
          $('#extensions_settings2').append(html);
        }
      } catch (e) {
        error("Could not load settings.html:", e);
      }

      initialize_settings();
      initialize_settings_ui();
      initialize_popout();
      initialize_message_buttons();
      initialize_slash_commands();

      // Global macros registration
      if (typeof MacrosParser !== 'undefined' && typeof MacrosParser.registerMacro === 'function') {
        MacrosParser.registerMacro(short_memory_macro, () => {
          const ctx = getContext();
          return ctx?.chat_metadata?.memnext?.short_injection || "";
        }, 'MemNext Short-Term Memory');

        MacrosParser.registerMacro(long_memory_macro, () => {
          const ctx = getContext();
          const block = get_last_long_term_history_block(); return ctx?.chat_metadata?.memnext?.long_injection || block?.text || "";
        }, 'MemNext Long-Term Memory');
      }

      // Event listeners
      const ctx = getContext();
      const eventSource = ctx?.eventSource;
      const event_types = ctx?.eventTypes || ctx?.event_types;
      if (eventSource && event_types) {
        if (typeof eventSource.makeLast === 'function') {
          eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, id => on_chat_event('char_message', id));
        } else if (typeof eventSource.on === 'function') {
          eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, id => on_chat_event('char_message', id));
        }
        if (typeof eventSource.on === 'function') {
          eventSource.on(event_types.USER_MESSAGE_RENDERED, id => on_chat_event('user_message', id));
          eventSource.on(event_types.MESSAGE_EDITED, id => on_chat_event('message_edited', id));
          eventSource.on(event_types.MESSAGE_SWIPED, id => on_chat_event('message_swiped', id));
          eventSource.on(event_types.CHAT_CHANGED, () => on_chat_event('chat_changed'));
          if (event_types.CHARACTER_SELECTED) eventSource.on(event_types.CHARACTER_SELECTED, () => on_chat_event('chat_changed'));
          if (event_types.MORE_MESSAGES_LOADED) eventSource.on(event_types.MORE_MESSAGES_LOADED, () => on_chat_event('chat_changed'));
          eventSource.on(event_types.MESSAGE_DELETED, () => on_chat_event('message_deleted'));
        }
      }

      // Register Generate Interceptor
      if (typeof ctx?.generateInterceptor === 'function') {
        ctx.generateInterceptor(MODULE_NAME, async (chat, contextSize, abort, type) => {
          if (typeof globalThis.memnext_intercept_messages === 'function') {
            await globalThis.memnext_intercept_messages(chat, contextSize, abort, type);
          }
        });
      }

      log(`${MODULE_NAME_FANCY} initialized successfully.`);
    } catch (err) {
      error("Critical initialization failure:", err);
    }
  });
}
