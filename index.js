import { log, debug, error, toast, saveChatDebounced, clean_string_for_html, escape_string, unescape_string, get_regex_script, regex, add_i18n, refresh_select2_element, display_text_modal } from "./utils.js";
import { default_settings, initialize_settings, get_settings, set_settings, chat_enabled, toggle_chat_enabled, auto_load_profile, get_summary_connection_profile } from "./state.js";
import { MODULE_NAME, MODULE_NAME_FANCY, PROGRESS_BAR_ID, update_all_message_visuals, initialize_settings_ui, refresh_settings, initialize_message_buttons, initialize_popout, init_interfaces } from "./ui.js";
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
  init_interfaces();

