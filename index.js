import { log, debug, error, toast, saveChatDebounced, clean_string_for_html, escape_string, unescape_string, get_regex_script, regex, add_i18n, refresh_select2_element, display_text_modal } from "./utils.js";
import { default_settings, initialize_settings, get_settings, set_settings, chat_enabled, toggle_chat_enabled, auto_load_profile, get_summary_connection_profile } from "./state.js";
import { MODULE_NAME, MODULE_NAME_FANCY, PROGRESS_BAR_ID, update_all_message_visuals, initialize_settings_ui, refresh_settings, initialize_message_buttons, initialize_popout, promptInterface1, promptInterface2, promptInterface3, memoryEditInterface } from "./ui.js";
import { set_data, get_memory, set_chat_long_term_memory, check_message_exclusion, INJECTION_THRESHOLD_INDEX, refresh_memory, fillup } from "./memory.js";
import { summarize_message, auto_summarize_chat, get_connection_profile_api, get_summary_max_tokens, summaryQueue } from "./summarization.js";
import { long_memory_macro, short_memory_macro, default_short_to_long_prompt, default_long_compaction_prompt, default_summary_macros, get_message_prompts } from "./macros.js";
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
export { MODULE_NAME } from "./ui.js";
// SummaryQueue & Concurrency Management
class SummaryQueue {
  tasks = [];
  active_workers = 0;
  aborted = false;
  constructor() {
    this.progress_bar = $(`<div id="${PROGRESS_BAR_ID}" class="memnext_progress_bar" style="display:none;"><div class="progress_bar_fill"></div></div>`);
  }
  init_ui() {
    $('#sheld').append(this.progress_bar);
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
  show_progress(completed, total) {
    if (!get_settings('auto_summarize_progress')) return;
    this.progress_bar.show();
    const percent = total > 0 ? Math.round(completed / total * 100) : 0;
    this.progress_bar.find('.progress_bar_fill').css('width', `${percent}%`);
  }
  hide_progress() {
    this.progress_bar.hide();
    this.progress_bar.find('.progress_bar_fill').css('width', `0%`);
  }
  block_chat() {
    if (!get_settings('block_chat')) return;
    $('#send_textarea').prop('disabled', true);
    $('#send_button').prop('disabled', true);
  }
  unblock_chat() {
    $('#send_textarea').prop('disabled', false);
    $('#send_button').prop('disabled', false);
  }
  async run() {
    if (this.tasks.length === 0) return;
    this.aborted = false;
    this.block_chat();
    const total = this.tasks.length;
    let completed = 0;
    this.show_progress(completed, total);
    const concurrency = Math.max(1, Number(get_settings('parallel_summaries_count')) || 1);
    const time_delay = Number(get_settings('summarization_time_delay')) || 0;
    const worker = async () => {
      while (this.tasks.length > 0 && !this.aborted) {
        const index = this.tasks.shift();
        if (index === undefined) break;
        try {
          await summarize_message(index);
        } catch (e) {
          error(`Error summarizing message [${index}]:`, e);
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

// Single Message Summarization Flow

// Generate Interceptor (Truncate Raw Chat Beyond Threshold)
globalThis.memnext_intercept_messages = async function (chat, _contextSize, _abort, type) {
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
};

// UI Rendering & Message Visuals

// Chat event router
async function on_chat_event(event, data = null) {
  debug(`Handling chat event: ${event}`);
  switch (event) {
    case 'user_message':
    case 'char_message':
      // No need to call refresh_memory() here because the interceptor will call fillup() when generating,
      // and char_message doesn't need immediate fillup until the next turn. 
      // But we can call it to keep UI updated.
      refresh_memory();
      await auto_summarize_chat();
      break;
    case 'message_edited':
      if (get_settings('auto_summarize_on_edit') && data !== null) {
        summaryQueue.add(data);
        await summaryQueue.run();
      }
      if (chat_metadata.memnext && data <= chat_metadata.memnext.iti) {
        chat_metadata.memnext.iti = null; // force short_term recalculation
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
      INJECTION_THRESHOLD_INDEX = null;
      if (chat_metadata.memnext) chat_metadata.memnext.iti = null;
      refresh_settings();
      refresh_memory();
      break;
    case 'message_deleted':
      if (chat_metadata.memnext) chat_metadata.memnext.iti = null;
      refresh_memory();
      break;
    case 'before_message':
      if (get_settings('auto_summarize_on_send')) {
        await auto_summarize_chat();
      }
      break;
  }
}

// Prompt Edit Modal Interface (Re-usable for all 3 prompts)
class PromptEditInterface {
  constructor(config) {
    this.setting_key = config.setting_key;
    this.title = config.title;
    this.description = config.description;
    this.default_prompt = config.default_prompt;
    this.macros = config.macros || [];
    this.ctx = getContext();
    let macros_html = "";
    if (this.macros.length > 0) {
      macros_html = `<div style="flex: 1; border: 1px solid var(--SmartThemeBorderColor); border-radius: 5px; padding: 10px; overflow-y: auto; background-color: var(--SmartThemeBlurTintColor);">
                <h4 style="margin-top: 0; margin-bottom: 10px;">Available Macros</h4>`;
      for (let m of this.macros) {
        macros_html += `<div style="margin-bottom: 10px;">
                    <div style="font-family: monospace; font-weight: bold; margin-bottom: 3px;">{{${m.name}}}</div>
                    <div style="font-size: 0.9em; opacity: 0.9;">${m.desc}</div>
                </div>`;
      }
      macros_html += `</div>`;
    }
    this.html_template = `
<div id="memnext_prompt_interface" style="height: 100%; display: flex; flex-direction: column;">
    <div class="flex-container justifyspacebetween alignitemscenter" style="margin-bottom: 10px;">
        <h3 class="margin0">${this.title}</h3>
        <i class="fa-solid fa-info-circle" title="${this.description}"></i>
        <button id="restore_default" class="menu_button fa-solid fa-recycle red_button" title="Restore default prompt" style="margin-left: auto;"></button>
    </div>
    <div style="flex: 1; display: flex; gap: 10px; margin-bottom: 10px;">
        <div style="${this.macros.length > 0 ? 'flex: 2;' : 'flex: 1;'}">
            <textarea id="prompt_text" class="text_pole" style="width: 100%; height: 100%; box-sizing: border-box; resize: none; font-family: monospace;"></textarea>
        </div>
        ${macros_html}
    </div>
</div>
`;
  }
  async show() {
    const popup = new this.ctx.Popup(this.html_template, this.ctx.POPUP_TYPE.TEXT, '', {
      wider: true,
      okButton: 'Save',
      cancelButton: 'Cancel'
    });
    const $content = $(popup.content);
    $content.closest('dialog').css('min-width', '70%');
    const $textarea = $content.find('#prompt_text');
    const $restore = $content.find('#restore_default');
    $textarea.val(get_settings(this.setting_key) || this.default_prompt);
    $restore.on('click', () => {
      $textarea.val(this.default_prompt);
    });
    const result = await popup.show();
    if (result) {
      set_settings(this.setting_key, $textarea.val());
      toast(`${this.title} saved.`, "success");
    }
  }
}

// Memory State / Edit Table Interface
class MemoryEditInterface {
  ctx = getContext();
  constructor() {
    this.html_template = `
<div id="memnext_memory_state_interface">
    <div class="flex-container justifyspacebetween alignitemscenter">
        <h3>Memory State</h3>
        <button id="refresh_table" class="menu_button fa-solid fa-sync margin0" title="Refresh Table"></button>
    </div>
    <hr>
    <div id="progress_bar"></div>
    <table cellspacing="0">
        <thead>
            <tr>
                <th title="Message ID"><i class="fa-solid fa-hashtag"></i></th>
                <th title="Sender"><i class="fa-solid fa-comment"></i></th>
                <th title="Summary Text">Summary</th>
                <th class="actions">Actions</th>
            </tr>
        </thead>
        <tbody></tbody>
    </table>
    <hr>
    <div class="flex-container alignitemscenter">
        <button id="bulk_summarize_all" class="menu_button"><i class="fa-solid fa-quote-left"></i> Summarize All Empty</button>
    </div>
</div>
`;
  }
  async show() {
    const popup = new this.ctx.Popup(this.html_template, this.ctx.POPUP_TYPE.TEXT, '', {
      wider: true
    });
    const $content = $(popup.content);
    $content.closest('dialog').css('min-width', '80%');
    const populate = () => {
      const $tbody = $content.find('tbody').empty();
      const chat = this.ctx?.chat || [];
      for (let i = 0; i < chat.length; i++) {
        const msg = chat[i];
        if (!msg) continue;
        const mem = get_memory(msg) || '';
        const sender = msg.name || (msg.is_user ? 'User' : 'Character');
        const $tr = $(`<tr>
                    <td>${i}</td>
                    <td><b>${escape_string(sender)}</b></td>
                    <td class="memory_text_cell"><span class="mem_display">${escape_string(mem)}</span></td>
                    <td class="memory_actions_cell">
                        <button class="menu_button row_summarize fa-solid fa-quote-left" title="Summarize"></button>
                        <button class="menu_button row_clear fa-solid fa-trash red_button" title="Delete"></button>
                    </td>
                </tr>`);
        $tr.find('.row_summarize').on('click', async () => {
          await summarize_message(i);
          populate();
        });
        $tr.find('.row_clear').on('click', () => {
          set_data(msg, 'memory', null);
          populate();
          refresh_memory();
          saveChatDebounced();
        });
        $tbody.append($tr);
      }
    };
    $content.find('#refresh_table').on('click', populate);
    $content.find('#bulk_summarize_all').on('click', async () => {
      const chat = this.ctx?.chat || [];
      for (let i = 0; i < chat.length; i++) {
        if (!get_memory(chat[i]) && check_message_exclusion(chat[i])) {
          summaryQueue.add(i);
        }
      }
      await summaryQueue.run();
      populate();
    });
    populate();
    await popup.show();
  }
}

// UI Initialization & Binding

// Slash commands
function initialize_slash_commands() {
  const ctx = getContext();
  const SlashCommandParser = ctx?.SlashCommandParser;
  const SlashCommand = ctx?.SlashCommand;
  const SlashCommandArgument = ctx?.SlashCommandArgument;
  const SlashCommandNamedArgument = ctx?.SlashCommandNamedArgument;
  const ARGUMENT_TYPE = ctx?.ARGUMENT_TYPE;
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
    name: 'memnext-compact',
    callback: async () => {
      await compact_short_to_long();
      return 'Compaction executed (Phase 2 staged).';
    },
    helpString: 'Trigger manual batch compaction of memory blocks.'
  }));
  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'memnext-get-message-world-info',
    callback: async (args, index) => {
      let chat = getContext().chat;
      if (index === "") index = chat.length - 1;
      index = Number(index);
      let prompts = get_message_prompts(index);
      return prompts?.worldInfoString ?? "";
    },
    helpString: 'Return the world info used when generating a given message.',
    unnamedArgumentList: [SlashCommandArgument.fromProps({
      description: 'Index of the message',
      isRequired: false,
      typeList: [ARGUMENT_TYPE.NUMBER]
    })]
  }));
  SlashCommandParser.addCommandObject(SlashCommand.fromProps({
    name: 'memnext-max-summary-tokens',
    callback: async args => {
      return String(get_summary_max_tokens());
    },
    helpString: 'Return the max tokens allowed for summarization.'
  }));
}

// Popout logic

// Entry Point
jQuery(async function () {
  log(`Loading ${MODULE_NAME_FANCY} extension...`);
  initialize_settings();
  promptInterface1 = new SummaryPromptEditInterface();
  promptInterface2 = new PromptEditInterface({
    setting_key: 'short_to_long_prompt',
    title: 'Short \u2192 Long Compaction Prompt',
    description: 'Template used to consolidate graduating short-term memories into the long-term narrative.',
    default_prompt: default_short_to_long_prompt,
    macros: [{
      name: 'existing_long_memory',
      desc: 'The existing long-term narrative summary.'
    }, {
      name: 'new_events',
      desc: 'The block of recent short-term memories graduating to long-term.'
    }, {
      name: 'long_term_memory_size',
      desc: 'The current token size of the existing long-term memory.'
    }]
  });
  promptInterface3 = new PromptEditInterface({
    setting_key: 'long_compaction_prompt',
    title: 'Long-Term Compaction Prompt',
    description: 'Template used to re-compact the long-term narrative when it approaches its token limit.',
    default_prompt: default_long_compaction_prompt,
    macros: [{
      name: 'long_memory',
      desc: 'The combined long-term narrative that needs to be compacted.'
    }, {
      name: 'long_term_memory_size',
      desc: 'The current token size of the combined long-term memory.'
    }]
  });
  memoryEditInterface = new MemoryEditInterface();
  summaryQueue = new SummaryQueue();
  summaryQueue.init_ui();

  // Fetch and inject settings.html
  try {
    const index_url = new URL(import.meta.url);
    const settings_url = new URL('settings.html', index_url).href;
    const html = await $.get(settings_url);
    $('#extensions_settings2').append(html);
  } catch (e) {
    error("Could not load settings.html:", e);
  }
  initialize_settings_ui();
  initialize_popout();
  initialize_message_buttons();
  initialize_slash_commands();

  // Global macros registration
  MacrosParser.registerMacro(short_memory_macro, () => get_short_memory(), 'MemNext Short-Term Memory');
  MacrosParser.registerMacro(long_memory_macro, () => get_long_memory(), 'MemNext Long-Term Memory');

  // Event listeners
  const ctx = getContext();
  const eventSource = ctx?.eventSource;
  const event_types = ctx?.eventTypes || ctx?.event_types;
  if (eventSource && event_types) {
    eventSource.makeLast(event_types.CHARACTER_MESSAGE_RENDERED, id => on_chat_event('char_message', id));
    eventSource.on(event_types.USER_MESSAGE_RENDERED, id => on_chat_event('user_message', id));
    eventSource.on(event_types.MESSAGE_DELETED, id => on_chat_event('message_deleted', id));
    eventSource.on(event_types.MESSAGE_EDITED, id => on_chat_event('message_edited', id));
    eventSource.on(event_types.MESSAGE_SWIPED, id => on_chat_event('message_swiped', id));
    eventSource.on(event_types.CHAT_CHANGED, () => on_chat_event('chat_changed'));
    eventSource.on(event_types.MORE_MESSAGES_LOADED, refresh_memory);
    eventSource.on(event_types.GENERATION_STARTED, (type, _params, isDryRun) => on_chat_event('before_message', {
      type,
      isDryRun
    }));
  }
  refresh_memory();
  log(`${MODULE_NAME_FANCY} loaded successfully.`);
});
class SummaryPromptEditInterface {
  html_template = `
<div id="qvink_summary_prompt_interface" style="height: 100%">
<div class="flex-container justifyspacebetween">
    <div class="flex2 toggle-macro">
        <div class="flex-container justifyspacebetween alignitemscenter">
            <h3>Summary Prompt</h3>
            <i class="fa-solid fa-info-circle" style="margin-right: 1em" title="Customize the prompt used for summarizing messages."></i>
            <button id="preview_summary_prompt" class="menu_button fa-solid fa-eye margin0" title="Preview current summary prompt (the exact text that will be sent to the model)"></button>
            <button id="restore_default_prompt" class="menu_button fa-solid fa-recycle margin0 red_button" title="Restore the default prompt"></button>

            <label class="flex-container alignItemsCenter" title="Role used for the summary prompt" style="margin-left: auto;">
                <span>Role: </span>
                <select id="prompt_role" class="text_pole inline_setting">
                    <option value="0">System</option>
                    <option value="1">User</option>
                    <option value="2">Assistant</option>
                </select>
            </label>
            <button class="menu_button fa-solid fa-list-check margin0 qm-small open_macros" title="Show/hide macro editor"></button>

        </div>
    </div>
    <div class="flex1 qm-large toggle-macro" style="height: 100%">
        <div class="flex-container justifyspacebetween alignitemscenter">
            <h3 class="flex2">Macros <i class="fa-solid fa-info-circle" title="Dynamic macros only available for the summary prompt."></i></h3>
            <button id="add_macro" class="flex1 menu_button" title="Add a new macro">New</button>
            <button class="menu_button fa-solid fa-list-check margin0 qm-small open_macros" title="Show/hide macro editor"></button>
        </div>
    </div>
</div>

<div class="flex-container justifyspacebetween" style="height: calc(100% - 120px);">
    <div class="flex2 toggle-macro">
        <textarea id="prompt" class="" style="height: 100%; overflow-y: auto"></textarea>
    </div>
    <div class="flex1 qm-large toggle-macro" style="height: 100%">
        <div id="macro_definitions" style="height: 100%; overflow-y: auto"></div>
    </div>
</div>

<div class="flex-container justifyspacebetween alignitemscenter">
    <label title="Start the summarization with this prefilled text." class="checkbox_label">
        <span>Prefill</span>
        <input id="prefill" class="text_pole" type="text" placeholder="Start reply with...">
    </label>

    <label title="Include the prefill in displayed memories and injections (no effect with reasoning models)" class="checkbox_label">
        <input id="show_prefill" type="checkbox" />
        <span>Include in Memories</span>
    </label>
</div>

</div>
`;
  // remember to set the name of the radio group for each separate instance
  macro_definition_template = `

<div class="macro_definition qvink_interface_card">
<div class="inline-drawer">
    <div class="inline-drawer-header">
        <div class="flex-container alignitemscenter margin0 flex1">
            <button class="macro_enable menu_button fa-solid margin0"></button>
            <button class="macro_preview menu_button fa-solid fa-eye margin0" title="Preview the result of this macro"></button>
            <input class="macro_name flex1 text_pole" type="text" placeholder="name">
        </div>
        <div class="inline-drawer-toggle">
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
    </div>

    <div class="inline-drawer-content">
        <div class="flex-container alignitemscenter justifyCenter">
            <div class="macro_type flex2">
                <label>
                    <input type="radio" value="preset" />
                    <span>Range</span>
                </label>
                <label>
                    <input type="radio" value="custom" />
                    <span>STScript</span>
                </label>
            </div>
        </div>

        <div class="macro_type_range">
            <div title="The range of messages to replace this macro, relative to the message being summarized (which is at 0). For example, setting this to (3, 10) will include from the 3rd to the 10th message back in the chat.">
                <input class="macro_preset_start text_pole widthUnset" type="number" min="0" max="99" />
                <span> - </span>
                <input class="macro_preset_end text_pole widthUnset" type="number" min="0" max="99" />
            </div>

            <label title="Bot messages within the range above will be included" class="checkbox_label">
                <input class="macro_preset_bot_messages" type="checkbox" />
                <span>Bot Messages</span>
            </label>
            <label title="Summaries on bot messages within the range above will be included" class="checkbox_label">
                <input class="macro_preset_bot_summaries" type="checkbox" />
                <span>Bot Summaries</span>
            </label>
            <label title="User messages within the range above will be included" class="checkbox_label">
                <input class="macro_preset_user_messages" type="checkbox" />
                <span>User Messages</span>
            </label>
            <label title="Summaries on user messages within the range above will be included" class="checkbox_label">
                <input class="macro_preset_user_summaries" type="checkbox" />
                <span>User Summaries</span>
            </label>
        </div>

        <div class="macro_type_message">
            <table style="width: 100%;">
                <tr title="Each message will be replaced by the return value of the script when run. Use {{message}} for the text of the message and {{id}} for the ID of the message.">
                    <td><span>STScript</span></td>
                    <td><input class="macro_command text_pole" type="text" placeholder="STScript"></td>
                </tr>
                <tr title="Select regex scripts to run on each message. This will occur before the messages are passed to the above script.">
                    <td><span>Regex</span></td>
                    <td><select multiple="multiple" class="regex_select"></select></td>
                </tr>
            </table>
        </div>

        <div class="macro_type_script">
            <label title="The macro will be replaced by the return value of the script when run. Use {{message}} for the text of the message and {{id}} for the ID of the message." class="checkbox_label">
                <input class="macro_command text_pole" type="text" placeholder="STScript">
            </label>
        </div>

        <div class="macro_type_any flex-container alignitemscenter">
            <label title="[Text Completion]: The result of this macro will be wrapped in your instruct template. [Chat Completion]: The result of this macro will be added as a separate message." class="checkbox_label">
                <input class="macro_instruct_template" type="checkbox">
                <span>Separate Block</span>
            </label>

            <button class="macro_delete menu_button red_button fa-solid fa-trash" title="Delete custom macro" style="margin-left: auto;"></button>
            <button class="macro_restore menu_button red_button fa-solid fa-recycle" title="Restore default macro" style="margin-left: auto;"></button>
        </div>

    </div>
</div>
</div>

    `;
  ctx = getContext();

  // enable/disable icons
  static fa_enabled = "fa-check";
  static fa_disabled = "fa-xmark";
  default_macro_settings = {
    name: "new_macro",
    enabled: true,
    type: "preset",
    start: 1,
    end: 1,
    bot_messages: true,
    bot_summaries: true,
    user_messages: true,
    user_summaries: true,
    instruct_template: true,
    command: "",
    regex_scripts: []
  };

  // If you define the popup in the constructor so you don't have to recreate it every time, then clicking the "ok" button has like a .5-second lag before closing the popup.
  // If you instead re-create it every time in show(), there is no lag.
  constructor() {
    this.from_settings();
  }
  async init() {
    this.popup = new this.ctx.Popup(this.html_template, this.ctx.POPUP_TYPE.TEXT, '', {
      wider: true,
      okButton: 'Save',
      cancelButton: 'Cancel'
    });
    this.$content = $(this.popup.content);
    this.$buttons = this.$content.find('.popup-controls');
    this.$preview = this.$content.find('#preview_summary_prompt');
    this.$restore = this.$content.find('#restore_default_prompt');
    this.$definitions = this.$content.find('#macro_definitions');
    this.$add_macro = this.$content.find('#add_macro');
    this.$open_macros = this.$content.find('.open_macros');

    // settings
    this.$prompt = this.$content.find('#prompt');
    this.$prompt_role = this.$content.find('#prompt_role');
    this.$prefill = this.$content.find('#prefill');
    this.$show_prefill = this.$content.find('#show_prefill');

    // manually set a larger width
    this.$content.closest('dialog').css({
      'min-width': '80%',
      'height': '70vh'
    });

    // buttons
    this.$preview.on('click', () => this.preview_prompt());
    this.$add_macro.on('click', () => this.new_macro());
    this.$restore.on('click', () => this.$prompt.val(default_settings["prompt"]));
    this.$open_macros.on('click', () => {
      this.$content.find('.toggle-macro').toggle();
    });

    // manually add tooltips to the popout buttons because you can't do that when defining them
    this.$buttons.find('.popup-button-ok').attr('title', 'Save changes to the prompt and macros');
    this.$buttons.find('.popup-button-cancel').attr('title', 'Discard changes to the prompt and macros');

    // set the prompt text and the macro settings
    this.from_settings();
    this.api = await get_connection_profile_api();

    // translate
    add_i18n(this.$content);
  }
  async show() {
    this.init();
    this.update_macros();
    let result = await this.popup.show(); // wait for result
    if (result) {
      // clicked save
      this.save_settings();
    }
    refresh_settings();
  }

  // building interface
  update_macros(macro = null) {
    // Update the interface from settings (all macros or just the specified macro)
    if (macro === null) {
      for (let name of this.list_macros()) {
        let macro = this.get_macro(name);
        this.create_macro_interface(macro);
      }
    } else {
      this.create_macro_interface(macro);
    }
    add_i18n(this.$content);
  }
  create_macro_interface(macro) {
    // Create or update a macro interface item with the given settings
    let id = this.get_id(macro.name);

    // first check if it already exists
    let $macro = this.$definitions.find(`#${id}`);
    if ($macro.length > 0) {
      // if it exists, remove it and replace with the template
      // Need to only replace the items inside the drawer so it says open if it's already open
      let $template = $(this.macro_definition_template);
      let $drawer_content = $macro.find('.inline-drawer-content');
      $drawer_content.empty();
      $drawer_content.append($template.find('.inline-drawer-content').children());
      let $header_content = $macro.find('.inline-drawer-header');
      $header_content.children().first().remove(); // remove the first div in the header (not the toggle)
      $header_content.prepend($template.find('.inline-drawer-header').children().first());
    } else {
      // doesn't exist - add it
      $macro = $(this.macro_definition_template).prependTo(this.$definitions);
      $macro.attr('id', id);
    }

    // handling the macro type radio group
    let radio_group_name = `macro_type_radio_${macro.name}`;
    $macro.find(`.macro_type input`).attr('name', radio_group_name); // set the radio group name

    let $range_div = $macro.find(".macro_type_range");
    let $message_div = $macro.find(".macro_type_message");
    let $script_div = $macro.find(".macro_type_script");
    let $any_div = $macro.find(".macro_type_any");
    function set_enabled() {
      if (macro.enabled) {
        $enable.removeClass(SummaryPromptEditInterface.fa_disabled);
        $enable.addClass(SummaryPromptEditInterface.fa_enabled);
        $enable.removeClass("red_button");
        $enable.addClass("button_highlight");
        $enable.prop('title', "Enabled");
      } else {
        $enable.removeClass(SummaryPromptEditInterface.fa_enabled);
        $enable.addClass(SummaryPromptEditInterface.fa_disabled);
        $enable.removeClass("button_highlight");
        $enable.addClass("red_button");
        $enable.prop('title', "Disabled");
      }
    }

    // set settings
    let $name = $macro.find("input.macro_name");
    let $enable = $macro.find("button.macro_enable");
    let $preview = $macro.find("button.macro_preview");
    let $delete = $macro.find("button.macro_delete");
    let $restore = $macro.find("button.macro_restore");
    let $macro_type_div = $macro.find('.macro_type');
    let $macro_type_radios = $macro.find(`input[name=${radio_group_name}]`);
    let $macro_preset_start = $macro.find(".macro_preset_start");
    let $macro_preset_end = $macro.find(".macro_preset_end");
    let $macro_preset_bot_messages = $macro.find(".macro_preset_bot_messages");
    let $macro_preset_bot_summaries = $macro.find(".macro_preset_bot_summaries");
    let $macro_preset_user_messages = $macro.find(".macro_preset_user_messages");
    let $macro_preset_user_summaries = $macro.find(".macro_preset_user_summaries");
    let $macro_command_message = $macro.find(".macro_type_message input.macro_command");
    let $macro_command_script = $macro.find(".macro_type_script input.macro_command");
    let $macro_instruct = $macro.find(".macro_instruct_template");
    let $regex_select = $macro.find(".regex_select");
    function show_settings_div() {
      // hide/show the appropriate settings divs.
      // .show() fails if the object isn't in the DOM yet, so we have to try/catch since the popup isn't inserted yet.
      if (macro.type === "preset") {
        try {
          $range_div.show();
          $message_div.show();
          $macro_command_message.change(); // trigger a change event on the command input so the macro's script actually changes
        } catch {}
        $script_div.hide();
      } else if (macro.type === "custom") {
        $range_div.hide();
        $message_div.hide();
        try {
          $script_div.show();
          $macro_command_script.change();
        } catch {}
      }
    }
    show_settings_div();

    // preview
    $preview.on('click', async () => await this.preview_macro(macro));

    // enable
    set_enabled();
    $enable.on('click', async () => {
      macro.enabled = !macro.enabled;
      set_enabled();
    });

    // if it has a description, add it as the title for the name
    if (macro.description) {
      $name.attr('title', macro.description);
    }

    // special case for special macros
    if (macro.type === "special") {
      $macro_type_div.remove();
      $range_div.remove();
      $script_div.remove();
    }

    // delete / restore
    if (macro.default) {
      $name.prop('disabled', true); // prevent name change (or else we couldn't restore default)
      $delete.remove();
      $restore.on('click', () => this.restore_macro_default(macro.name));
    } else {
      $restore.remove();
      $delete.on('click', () => {
        delete this.macros[macro.name];
        $macro.remove();
      });
    }

    // name
    $name.val(macro.name);
    $name.on('change', () => {
      let old_name = macro.name;
      let new_name = $name.val();
      if (old_name === new_name) return; // no change

      // can't change the name of a default or special macro
      if (macro.default || macro.type === "special") {
        $name.val(old_name); // set the field to the old value
        return;
      }
      new_name = this.get_unique_name(new_name); // ensure unique name
      macro.name = new_name;
      this.macros[new_name] = macro;
      delete this.macros[old_name];

      // change the ID of the card
      $macro.attr('id', this.get_id(new_name));
      $name.val(new_name); // set the field
    });

    // type
    $macro_type_radios.filter(`[value=${macro.type}]`).prop('checked', true);
    $macro_type_radios.on('change', () => {
      macro.type = $macro_type_radios.filter(':checked').val();
      show_settings_div();
    });

    // start, end
    $macro_preset_start.val(macro.start ?? this.default_macro_settings.start);
    $macro_preset_start.on('change', () => {
      macro.start = Number($macro_preset_start.val());
    });
    $macro_preset_end.val(macro.end ?? this.default_macro_settings.end);
    $macro_preset_end.on('change', () => {
      macro.end = Number($macro_preset_end.val());
    });

    // checkboxes
    $macro_preset_bot_messages.prop('checked', macro.bot_messages);
    $macro_preset_bot_messages.on('change', () => {
      macro.bot_messages = $macro_preset_bot_messages.is(':checked');
    });
    $macro_preset_bot_summaries.prop('checked', macro.bot_summaries);
    $macro_preset_bot_summaries.on('change', () => {
      macro.bot_summaries = $macro_preset_bot_summaries.is(':checked');
    });
    $macro_preset_user_messages.prop('checked', macro.user_messages);
    $macro_preset_user_messages.on('change', () => {
      macro.user_messages = $macro_preset_user_messages.is(':checked');
    });
    $macro_preset_user_summaries.prop('checked', macro.user_summaries);
    $macro_preset_user_summaries.on('change', () => {
      macro.user_summaries = $macro_preset_user_summaries.is(':checked');
    });
    $macro_instruct.prop('checked', macro.instruct_template);
    $macro_instruct.on('change', () => {
      macro.instruct_template = $macro_instruct.is(':checked');
    });

    // update the regex Select2 (gotta add an ID to the template too)
    let options = [];
    let selected = [];
    let regex_scripts = getRegexScripts();
    for (let i in regex_scripts) {
      let name = regex_scripts[i].scriptName;
      options.push({
        id: i,
        name: name
      });
      if (macro.regex_scripts?.includes(name)) selected.push(i);
    }
    refresh_select2_element($regex_select, selected, options, t`Select regex scripts`, values => {
      macro.regex_scripts = values;
    });

    // commands
    $macro_command_message.val(macro.command);
    $macro_command_message.on('change', () => {
      macro.command = $macro_command_message.val();
    });
    $macro_command_script.val(macro.command);
    $macro_command_script.on('change', () => {
      macro.command = $macro_command_script.val();
    });
  }

  // special macros
  async special_macro_speaker(index) {
    let macro = this.get_macro("speaker");
    let message = this.ctx.chat[index];
    let role = message.is_user ? "user" : message.is_system ? "system" : "assistant";
    let text = message.name;
    if (!text) {
      text = message.is_user ? this.ctx.name1 : this.ctx.name2;
    }
    text = await this.evaluate_script(macro, index, text);
    if (!text) return null;
    let payload = [];
    if (macro.instruct_template && role !== "system") {
      text = this.ctx.formatInstructModePrompt(this.ctx.chat[index].name, text, role === "user");
      payload.push({
        role: role,
        content: text
      });
    } else {
      payload.push({
        content: text
      });
    }
    return payload;
  }
  async special_macro_message(index) {
    let macro = this.get_macro("message");
    let message = this.ctx.chat[index];
    let role = message.is_user ? 'user' : message.is_system ? 'system' : 'assistant';

    // apply script and regex
    let text = await this.evaluate_script(macro, index);
    if (macro.instruct_template) {
      // apply template
      return [{
        role: role,
        name: message.name,
        content: text
      }];
    } else {
      return [{
        content: text
      }];
    }
  }

  // utilities
  is_open() {
    if (!this.popup) return false;
    return this.$content.closest('dialog').attr('open');
  }
  from_settings() {
    // set the interface from settings
    this.$prompt?.val(get_settings('message_summary_prompt'));
    this.$prompt_role?.val(get_settings('prompt_role'));
    this.$prefill?.val(escape_string(get_settings('prefill')));
    this.$show_prefill?.prop('checked', get_settings('show_prefill', true));
    this.macros = Object.assign(structuredClone(default_summary_macros), structuredClone(get_settings('summary_prompt_macros')));

    // for each macro, ensure default settings if not specified
    for (let name of Object.keys(this.macros)) {
      this.macros[name] = Object.assign({}, this.default_macro_settings, this.macros[name]);

      // check each regex macro. Only keep valid macros.
      let valid_macros = [];
      for (let regex of this.macros[name].regex_scripts) {
        if (get_regex_script(regex)) valid_macros.push(regex);
      }
      this.macros[name].regex_scripts = valid_macros;
    }
  }
  save_settings() {
    // save settings in the interface
    set_settings('message_summary_prompt', this.$prompt.val()); // save the prompt
    set_settings('prompt_role', Number(this.$prompt_role.val()));
    set_settings('prefill', unescape_string(this.$prefill.val()));
    set_settings('show_prefill', this.$show_prefill.is(':checked'));
    set_settings('summary_prompt_macros', structuredClone(this.macros));
    update_all_message_visuals();
    debug(get_settings('summary_prompt_macros'));
  }
  get_prompt_role(name = false) {
    let role = this.is_open() ? Number(this.$prompt_role.val()) : get_settings('prompt_role');
    if (name) {
      switch (role) {
        case extension_prompt_roles.USER:
          role = 'user';
          break;
        case extension_prompt_roles.ASSISTANT:
          role = 'assistant';
          break;
        default:
          role = 'system';
          break;
      }
    }
    return role;
  }
  get_prefill() {
    return this.is_open() ? unescape_string(this.$prefill.val()) : get_settings('prefill');
  }
  get_unique_name(name) {
    // if the given name isn't unique, make it unique

    // replace the last "_n" with "_(n+1)"
    while (this.get_macro(name)) {
      let match = name.match(/_(\d+)$/);
      if (match) {
        name = name.slice(0, match.index) + "_" + (Number(match[1]) + 1);
      } else {
        name += "_2";
      }
    }
    return name;
  }
  get_id(name) {
    // get the HTML ID for the given macro name
    return `summary_macro_definition_${name}`;
  }
  list_macros() {
    return Object.keys(this.macros);
  }
  get_macro(name) {
    // get the macro by name.
    let macro = this.macros[name];
    if (macro) return macro;
  }
  new_macro(name = null) {
    // Create a new macro with the given name or the default
    let macro = structuredClone(this.default_macro_settings);
    if (name) macro.name = name;
    macro.name = this.get_unique_name(macro.name); // ensure unique name from existing macros
    this.macros[macro.name] = macro;
    this.create_macro_interface(macro);
  }
  restore_macro_default(name) {
    // Restore the macro to default (does nothing for non-default macros).
    // Edit the macro settings object in-place so all the callbacks with a reference to it still work.
    let macro = this.get_macro(name);
    if (!macro.default) return;
    let default_macro = default_summary_macros[name];
    if (!default_macro) error(`Attempted to restore default summary macro, but no default was found: "${name}"`);
    assign_and_prune(macro, default_macro); // set macro to the specific default in-place
    assign_defaults(macro, this.default_macro_settings); // set global defaults if they don't exist
    this.update_macros(macro);
  }
  async preview_prompt() {
    // show the summary prompt preview popup using the current interface settings
    let index = this.ctx.chat.length - 1;
    let text = this.$prompt.val();
    let messages = await this.create_summary_prompt(index, text);
    let profile_id = get_summary_connection_profile();
    if (profile_id === undefined) {
      error("Cannot display prompt, no connection profile selected.");
      return;
    }
    let prompt = this.ctx.ConnectionManagerRequestService.constructPrompt(messages, profile_id);
    if (typeof prompt === 'string') {
      prompt = clean_string_for_html(prompt);
    } else {
      // array
      prompt = prompt.map(m => {
        // need to clean text *before* we stringify because of the &emsp;
        m.content = clean_string_for_html(m.content);
        return m;
      });
      prompt = JSON.stringify(prompt, null, "&emsp;");
    }
    await display_text_modal(t`Summary Prompt Preview (Last Message)`, prompt);
  }
  async preview_macro(macro) {
    // show the result of the given macro
    let messages = await this.compute_macro(this.ctx.chat.length - 1, macro.name, true);
    let result;
    if (!messages) {
      // no messages, empty macro
      result = '';
    } else if (macro.instruct_template) {
      result = createRawPrompt(messages, this.api, false, false, '', ''); // build prompt with instruct template
      if (typeof result === 'string') {
        // remove the end line (which for TC include the assistant start sequence)
        let end_line = formatInstructModePrompt(this.ctx.name2, false, '', this.ctx.name1, this.ctx.name2, true, false);
        if (result.slice(result.length - end_line.length, result.length) === end_line) {
          // end line present
          result = result.slice(0, result.length - end_line.length);
        }
        result = clean_string_for_html(result); // if string, clean it
      } else {
        // list of message objects
        result = result.map(m => {
          // need to clean text *before* we stringify because of the &emsp;
          m.content = clean_string_for_html(m.content);
          return m;
        });
        result = JSON.stringify(result, null, "&emsp;");
      }
    } else {
      result = createRawPrompt(messages, this.api, true, false, '', ''); // build prompt ignoring instruct
      result = result?.[0]?.content ?? result;
      result = clean_string_for_html(result);
    }
    await display_text_modal(t`Macro Preview:` + ` {{${macro.name}}}`, result);
  }

  // creating the prompt
  async evaluate_script(macro, id, text = null) {
    // Evaluate any regex and scripts on the macro for the given message index
    if (text === null) {
      text = this.ctx.chat[id].mes;
    }

    // evaluate regex if present
    for (let regex of macro.regex_scripts ?? []) {
      text = runRegexScript(get_regex_script(regex), text);
    }

    // evaluate script if present
    let command = macro.command;
    if (command?.trim()) {
      // replace {{id}} in the command with the message index
      command = command.replace(/\{\{id}}/g, id.toString());

      // replace {{message}} with the text of the message
      command = command.replace(/\{\{message}}/g, text);
      try {
        let result = await this.ctx.executeSlashCommandsWithOptions(command);
        text = result?.pipe ?? "";
      } catch (e) {
        error(e);
        return "";
      }
    }
    return text;
  }
  async compute_macro(index, name, ignore_enabled = false) {
    // get the result from the given custom macro for the given message index
    // Returns a list of message objects, i.e.: [{role: '', content: ''}, ...]
    // If macro evaluated empty, returns null

    // check for dynamic macros
    if (name.startsWith("crop_history_")) {
      let num = parseInt(name.split("_").pop());
      if (num && !isNaN(num)) {
        let dynamic_macro = {
          name: name,
          type: "preset",
          instruct_template: false,
          start: 1,
          end: num,
          bot_messages: true,
          user_messages: true,
          bot_summaries: false,
          user_summaries: false,
          enabled: true
        };
        return this.compute_range_macro(index, dynamic_macro);
      }
    }
    let macro = this.get_macro(name);
    if (!macro) return; // macro doesn't exist
    if (!macro.enabled && !ignore_enabled) return;
    debug("Computing Macro: " + name);

    // special macro?
    if (name === "message") {
      return this.special_macro_message(index);
    }
    if (name === "speaker") {
      if (name === "crop_history") {
        return [{
          content: ""
        }];
      }
      return this.special_macro_speaker(index);
    }
    if (macro.type === "preset") {
      // range presets
      return this.compute_range_macro(index, macro);
    } else if (macro.type === "custom") {
      // STScript
      let text = await this.evaluate_script(macro, index, "");
      if (text && macro.instruct_template) {
        return [{
          role: this.get_prompt_role(true),
          content: text
        }];
      } else if (text) {
        return [{
          content: text
        }];
      }
    } else {
      error(`Unknown summary prompt macro type: "${macro.type}"`);
    }
    return null;
  }
  async compute_range_macro(index, macro) {
    // Get a history of messages from index-end to index-start
    // Returns a list of message objects
    let chat = this.ctx.chat;
    let history = [];

    // calculate starting and ending indexes, bounded by the start of the chat
    let start_index = Math.max(index - macro.end, 0);
    let end_index = Math.max(index - macro.start, 0);
    debug(`Getting Message History. Index: ${index}, Start: ${macro.start}, End: ${macro.end} (${start_index} to ${end_index})`);
    for (let i = start_index; i <= end_index && i < chat.length; i++) {
      let m = chat[i];
      let include_message = true;
      let include_summary = true;

      // whether we include the message itself is determined only by these settings.
      // Even if the message wouldn't be *summarized* we still want to include it in the history for context.
      if (m.is_user) {
        include_message = macro.user_messages;
        include_summary = macro.user_summaries;
      } else if (m.is_system || m.is_thoughts) {
        include_message = false;
        include_summary = false;
      } else {
        // otherwise it's a bot message
        include_message = macro.bot_messages;
        include_summary = macro.bot_summaries;
      }
      if (include_message) {
        // apply script and regex
        let text = await this.evaluate_script(macro, i);
        let role = m.is_user ? 'user' : m.is_system ? 'system' : 'assistant';

        // apply template
        if (macro.instruct_template) {
          history.push({
            role: role,
            name: m.name,
            content: text
          });
        } else {
          let name = m.name || (m.is_user ? this.ctx.name1 : this.ctx.name2);
          if (name) {
            history.push(`${name}: ${text}`);
          } else {
            history.push(text);
          }
        }
      }
      if (include_summary) {
        // Whether we include the *summary* is also determined by the regular summary inclusion criteria.
        // This is so the inclusion matches the summary injection.
        include_summary = check_message_exclusion(m);
        let memory = get_memory(m);
        if (include_summary && memory) {
          // if there is a memory to include
          memory = `Summary: ${memory}`;
          if (macro.instruct_template) {
            history.push({
              role: 'system',
              content: memory
            });
          } else {
            history.push(memory);
          }
        }
      }
    }

    // join with newlines
    if (macro.instruct_template) {
      return history;
    } else {
      return [{
        content: history.join('\n')
      }];
    }
  }
  async create_summary_prompt(index, prompt = null) {
    // Create the full summary prompt for the message at the given index.

    // If no prompt given, use the current settings prompt.
    if (prompt === null) {
      prompt = get_settings('message_summary_prompt');
    }

    // preprocess dynamic arguments
    prompt = prompt.replace(/(\{\{\s*#?if\s+|\{\{\s*)crop_history\s+(\d+)(\s*}})/g, "$1crop_history_$2$3");

    // map of macros used in the prompt to their values
    let macros = await this.compute_used_macros(index, prompt);

    // Substitute any {{#if macro}} ... {{/if}} blocks.
    // These conditional substitutions have to be done before splitting and making each section a system prompt,
    //   because the conditional content may contain regular text that should be included in the system prompt.
    prompt = this.compile_handlebars(prompt, macros, index);

    // now split the prompt into messages and substitute custom macros
    let messages = this.evaluate_prompt(prompt, macros);
    return messages;
  }
  async compute_used_macros(index, text) {
    // return a mapping of the macros used in this text and their return value

    // Matches {{macro}} or {{#if macro}}, captures the macro name
    let matches = regex(text, /\{\{#if (.*?)}}|\{\{(?!\/if)(.*?)}}/gs);

    // trim whitespace and remove duplicates
    let names = new Set();
    for (let match of matches) {
      // iterate over all match objects
      names.add(match.trim());
    }

    // compute value for each
    let values = {};
    for (let name of names) {
      let value = await this.compute_macro(index, name);
      if (!value) continue;
      values[name] = value;
    }
    return values;
  }
  compile_handlebars(text, macros, index) {
    // substitute any {{#if macro}} ... {{/if}} blocks in the text with its content if the macro is in the passed map
    // Does NOT replace the actual macros, that is done later
    // DOES replace ST built-in macros like {{char}} and {{user}} (I don't know why)
    // We use Handlebars.js to parse out the {{#if}} ... {{/if}} blocks
    // ignoreStandalone=true: blocks and partials that are on their own line will not remove the whitespace on that line.

    // TODO: for some reason this.ctx.groupId is null when in a group so we have to get the context again??? Even though other fields properly update?
    let group_id = getContext().groupId;
    let name = this.ctx.chat[index].name;

    // include all character card fields as macros
    let template_data = Object.assign({}, getCharacterCardFields());

    // I don't know why, but Handlebars.compile does replace ST built-in macros like {{user}}, {{char}}, and {{persona}} even if not specified in the template.
    //   Because of this, any modifications to these have to be done here.
    if (group_id) {
      // if in group chat, define {{char}} (it's normally empty in group chats)
      template_data['char'] = name;
    }
    for (let name of Object.keys(macros)) {
      template_data[name] = `{{${name}}}`; // replace any instance of the macro with itself
    }
    try {
      return Handlebars.compile(text, {
        ignoreStandalone: true
      })(template_data);
    } catch (e) {
      error(`ERROR: ${e}`);
      return text;
    }
  }
  evaluate_prompt(text, macros) {
    // Convert the prompt into chat-style messages, i.e. [{role: '', content: ''}, ...]
    // Any {{macro}} items present will become a separate message if they need to be wrapped in an instruct template.
    // It is assumed that the macros will be later replaced with appropriate text

    // split on {{...}}
    // /g flag is for global, /s flag makes . match newlines so the {{#if ... /if}} can span multiple lines
    // You need the capturing groups for the matches to be included in the parts.
    // However this results in some parts being undefined for some reason, I think because only one capturing group is used for each match
    let parts = text.split(/(\{\{.*?}})/g);
    let messages = [];
    let merge_next = false;
    let add = content => {
      // add content to the message list
      for (let message of content) {
        if (message.role) {
          // if a role is present, don't merge it.
          messages.push(message);
          merge_next = false; // don't merge the next one
        } else {
          // no role - merge with last message if possible
          if (merge_next && messages.length > 0) {
            messages[messages.length - 1].content += message.content;
          } else {
            // can't merge or first item
            messages.push({
              role: this.get_prompt_role(true),
              content: message.content
            }); // use default role
          }
          merge_next = true; // can merge next one with this
        }
      }
    };
    for (let part of parts) {
      let trimmed_part = part?.trim();
      if (!trimmed_part) continue; // some parts are undefined
      if (trimmed_part.startsWith('{{') && trimmed_part.endsWith('}}')) {
        // this is a macro
        let macro_name = trimmed_part.slice(2, -2); // get the macro name
        let value = macros[macro_name];
        if (value === undefined) log(`Undefined macro in summary prompt: "${macro_name}"`);
        add(value ?? ''); // don't merge
      } else {
        // not a macro - merge according to the previous item
        add([{
          content: part
        }]);
      }
    }
    let prefill = this.get_prefill();
    if (prefill) {
      messages.push({
        content: prefill,
        role: 'assistant'
      });
    }
    return messages;
  }
}

// STUBS for macro engine