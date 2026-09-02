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
    callback: () => {
      refresh_memory();
      return 'MemNext memory state refreshed.';
    },
    helpString: 'Recalculate inclusion boundaries and refresh injections.'
  }));

  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'memnext-summarize',
    callback: async args => {
      const ctx = getContext();
      const last = ctx?.chat?.length ? ctx.chat.length - 1 : 0;
      const index = args?.index !== undefined ? Number(args.index) : last;
      await summarize_message(index);
      return `Summarized message ID ${index}.`;
    },
    helpString: 'Summarize a message by index (defaults to latest message).'
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
      set_chat_long_term_memory('');
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
    helpString: 'Return the max tokens allowed for summarization.'
  }));
}

// Extension Bootstrap
if (typeof jQuery !== 'undefined') {
  jQuery(async function () {
    guard_get_element_by_id();
    log(`Loading ${MODULE_NAME_FANCY} extension...`);
    initialize_settings();
    init_interfaces();
    summaryQueue.init_ui();

    // Fetch and inject settings.html
    try {
      if (typeof $ !== 'undefined') {
        const index_url = new URL(import.meta.url);
        const settings_url = new URL('settings.html', index_url).href;
        const html = await $.get(settings_url);
        $('#extensions_settings2').append(html);
      }
    } catch (e) {
      error("Could not load settings.html:", e);
    }

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
        return get_chat_long_term_memory() || "";
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
        eventSource.on(event_types.MESSAGE_DELETED, id => on_chat_event('message_deleted', id));
        eventSource.on(event_types.MESSAGE_EDITED, id => on_chat_event('message_edited', id));
        eventSource.on(event_types.MESSAGE_SWIPED, id => on_chat_event('message_swiped', id));
        eventSource.on(event_types.CHAT_CHANGED, () => on_chat_event('chat_changed'));
        if (event_types.CHAT_LOADED) {
          eventSource.on(event_types.CHAT_LOADED, () => on_chat_event('chat_changed'));
        }
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
          refresh_memory();
          update_all_message_visuals();
        });
        eventSource.on(event_types.GENERATION_STARTED, (type, _params, isDryRun) => on_chat_event('before_message', { type, isDryRun }));
      }
    }

    refresh_memory();
    update_all_message_visuals();
    setTimeout(() => update_all_message_visuals(), 100);
    setTimeout(() => update_all_message_visuals(), 400);
    log(`${MODULE_NAME_FANCY} loaded successfully.`);
  });
}
