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
import { log, error, get_current_character_identifier } from "./utils.js";
import { MODULE_NAME, settings_content_class, refresh_settings } from "./ui.js";
import { refresh_memory } from "./memory.js";
import { default_message_summary_prompt, default_short_to_long_prompt, default_long_compaction_prompt, default_long_template, default_short_template, default_summary_macros } from "./macros.js";
export const default_settings = {
  // Message inclusion
  message_length_threshold: 10,
  include_user_messages: true,
  include_system_messages: false,
  include_narrator_messages: false,
  // Three editable prompts
  message_summary_prompt: default_message_summary_prompt,
  short_to_long_prompt: default_short_to_long_prompt,
  long_compaction_prompt: default_long_compaction_prompt,
  summary_prompt_macros: default_summary_macros,
  prompt_role: extension_prompt_roles.SYSTEM,
  prefill: "",
  show_prefill: false,
  connection_profile: "",
  // Auto-summarization
  auto_summarize: true,
  summarization_delay: 0,
  summarization_time_delay: 0,
  summarization_time_delay_skip_first: false,
  auto_summarize_batch_size: 1,
  auto_summarize_message_limit: -1,
  // -1 means lookback entire chat from beginning
  parallel_summaries_count: 1,
  auto_summarize_on_edit: false,
  auto_summarize_on_swipe: true,
  auto_summarize_on_continue: false,
  auto_summarize_progress: true,
  auto_summarize_on_send: false,
  auto_summarize_block_generation: true,
  block_chat: true,
  // Accumulative memory budgets (percent of max context)
  long_term_context_limit: 20,
  // 20%
  short_term_context_limit: 15,
  // 15%
  compaction_threshold_percent: 15,
  // trigger when free space in context < 15%

  // Truncation & Injection
  summary_injection_separator: "\n* ",
  summary_injection_threshold: 10,
  summary_injection_threshold_type: "messages",
  exclude_messages_after_threshold: true,
  keep_last_user_message: true,
  messages_to_keep: 5,
  kept_messages_context_threshold: 30,
  // Cache preservation triggers (deprecated, leaving for compat)
  injection_threshold_update_trigger_messages: 5,
  injection_threshold_update_trigger_summaries: 0,
  injection_threshold_update_trigger_context: 0,
  long_template: default_long_template,
  short_template: default_short_template,
  injection_position: extension_prompt_types.IN_PROMPT,
  // 0 = after system prompt
  injection_role: extension_prompt_roles.SYSTEM,
  // 0 = system

  // Misc
  debug_mode: false,
  display_memories: true,
  default_chat_enabled: true,
  use_global_toggle_state: false
};
export const global_settings = {
  profiles: {},
  character_profiles: {},
  profile: 'Default',
  notify_on_profile_switch: false,
  global_toggle_state: true,
  disabled_group_characters: {},
  memory_edit_interface_settings: {}
};
export const settings_ui_map = {};

// Logging helpers
export
// Settings management
function initialize_settings() {
  if (extension_settings[MODULE_NAME] !== undefined) {
    log("Settings already initialized.");
    soft_reset_settings();
  } else {
    log("Initializing default settings...");
    extension_settings[MODULE_NAME] = structuredClone(global_settings);
    extension_settings[MODULE_NAME].profiles['Default'] = structuredClone(default_settings);
  }
  saveSettingsDebounced();
}
export function soft_reset_settings() {
  if (!extension_settings[MODULE_NAME] || typeof extension_settings[MODULE_NAME] !== 'object') {
    extension_settings[MODULE_NAME] = structuredClone(global_settings);
  }
  for (let key of Object.keys(global_settings)) {
    if (extension_settings[MODULE_NAME][key] === undefined) {
      extension_settings[MODULE_NAME][key] = structuredClone(global_settings[key]);
    }
  }
  const profiles = extension_settings[MODULE_NAME].profiles;
  if (!profiles || typeof profiles !== 'object' || Object.keys(profiles).length === 0) {
    extension_settings[MODULE_NAME].profiles = {
      'Default': structuredClone(default_settings)
    };
  }
  for (let profile of Object.values(extension_settings[MODULE_NAME].profiles)) {
    if (!profile || typeof profile !== 'object') continue;
    for (let key of Object.keys(default_settings)) {
      if (profile[key] === undefined) {
        profile[key] = structuredClone(default_settings[key]);
      }
    }
  }
}
export function get_settings(key = null) {
  const ext = extension_settings[MODULE_NAME];
  if (!ext) return key ? default_settings[key] : default_settings;
  if (key === 'profile') return ext.profile || 'Default';
  if (key in global_settings) return ext[key];
  const current_profile = ext.profile || 'Default';
  const profile_settings = ext.profiles?.[current_profile] || ext.profiles?.['Default'];
  if (key === null) return profile_settings || default_settings;
  return profile_settings?.[key] !== undefined ? profile_settings[key] : default_settings[key];
}
export function set_settings(key, value) {
  const ext = extension_settings[MODULE_NAME];
  if (!ext) return;
  if (key === 'profile') {
    ext.profile = value;
  } else if (key in global_settings) {
    ext[key] = value;
  } else {
    const current_profile = ext.profile || 'Default';
    if (!ext.profiles[current_profile]) {
      ext.profiles[current_profile] = structuredClone(default_settings);
    }
    ext.profiles[current_profile][key] = value;
  }
  saveSettingsDebounced();
}
export function get_character_profile() {
  const char_id = get_current_character_identifier();
  if (!char_id) return null;
  return extension_settings[MODULE_NAME]?.character_profiles?.[char_id] || null;
}
export function get_chat_profile() {
  const meta = chat_metadata;
  return meta?.[MODULE_NAME]?.profile || null;
}
export function chat_enabled() {
  if (get_settings('use_global_toggle_state')) {
    return get_settings('global_toggle_state');
  }
  const meta = chat_metadata;
  if (!meta || typeof meta !== 'object') return get_settings('default_chat_enabled');
  if (meta[MODULE_NAME]?.enabled !== undefined) {
    return Boolean(meta[MODULE_NAME].enabled);
  }
  return get_settings('default_chat_enabled');
}
export function set_chat_enabled(val) {
  if (get_settings('use_global_toggle_state')) {
    set_settings('global_toggle_state', Boolean(val));
  } else {
    if (!chat_metadata || typeof chat_metadata !== 'object') return;
    if (!chat_metadata[MODULE_NAME] || typeof chat_metadata[MODULE_NAME] !== 'object') {
      chat_metadata[MODULE_NAME] = {};
    }
    chat_metadata[MODULE_NAME].enabled = Boolean(val);
    saveMetadataDebounced();
  }
  refresh_settings();
  refresh_memory();
}
export function toggle_chat_enabled() {
  set_chat_enabled(!chat_enabled());
}
export function character_enabled(char_key) {
  if (!char_key) return true;
  const context = getContext();
  if (!context?.groupId) return true;
  const disabled = extension_settings[MODULE_NAME]?.disabled_group_characters?.[context.groupId];
  if (Array.isArray(disabled)) {
    return !disabled.includes(char_key);
  }
  return true;
}
export function get_character_key(message) {
  if (!message) return null;
  return message.original_avatar || message.avatar || null;
}

// Connection Profile & Generation
// --- Main Profile Functions ---
export function update_profile_section() {
  let current_profile = get_settings('profile');
  let current_character_profile = get_character_profile();
  let current_chat_profile = get_chat_profile();
  let profile_options = Object.keys(get_settings('profiles'));
  let content_class = `.${settings_content_class}`;
  let $choose_profile_dropdown = $(`${content_class} #profile`).empty();
  let $character = $(`${content_class} button#character_profile`);
  let $chat = $(`${content_class} button#chat_profile`);
  let $character_icon = $character.find('i');
  let $chat_icon = $chat.find('i');
  for (let profile of profile_options) {
    let text = profile;
    let html_safe_name = profile.replace(/"/g, '&quot;');
    if (profile === current_character_profile) text = `${profile} (Character)`;else if (profile === current_chat_profile) text = `${profile} (Chat)`;
    $choose_profile_dropdown.append(`<option value="${html_safe_name}">${text}</option>`);
  }
  $choose_profile_dropdown.val(current_profile);
  let lock_class = 'fa-lock';
  let unlock_class = 'fa-unlock';
  let highlight_class = 'button_highlight';
  if (current_character_profile === current_profile) {
    $character.addClass(highlight_class);
    $character_icon.removeClass(unlock_class).addClass(lock_class);
  } else {
    $character.removeClass(highlight_class);
    $character_icon.removeClass(lock_class).addClass(unlock_class);
  }
  if (current_chat_profile === current_profile) {
    $chat.addClass(highlight_class);
    $chat_icon.removeClass(unlock_class).addClass(lock_class);
  } else {
    $chat.removeClass(highlight_class);
    $chat_icon.removeClass(lock_class).addClass(unlock_class);
  }
}
export function load_profile(profile = null) {
  if (!profile) profile = get_settings('profile');
  const ext = extension_settings[MODULE_NAME];
  if (!ext.profiles[profile]) {
    error("Profile not found: " + profile);
    return;
  }
  let current_profile = ext.profile;
  ext.profile = profile;
  saveSettingsDebounced();
  if (get_settings("notify_on_profile_switch") && current_profile !== profile) {
    toastr.info(`Switched to profile "${profile}"`);
  }
  refresh_settings();
  refresh_memory();
  update_profile_section();
}
export function export_profile(profile = null) {
  if (!profile) profile = get_settings('profile');
  let profiles = get_settings('profiles');
  let settings = profiles[profile];
  if (!settings) {
    error("Profile not found: " + profile);
    return;
  }
  log("Exporting Configuration Profile: " + profile);
  const data = JSON.stringify(settings, null, 4);
  download(data, `${profile}.json`, 'application/json');
}
export async function import_profile(e) {
  let file = e.target.files[0];
  if (!file) return;
  const name = file.name.replace('.json', '');
  const data = await parseJsonFile(file);
  let profiles = get_settings('profiles');
  profiles[name] = data;
  set_settings('profiles', profiles);
  load_profile(name);
  toastr.success(`Profile "${name}" imported`);
  e.target.value = null;
  refresh_settings();
}
export async function rename_profile() {
  let ctx = getContext();
  let old_name = get_settings('profile');
  let new_name = await ctx.Popup.show.input("Rename Configuration Profile", `Enter a new name:`, old_name);
  if (!new_name || old_name === new_name) return;
  let profiles = get_settings('profiles');
  if (profiles[new_name]) {
    toastr.error(`Profile [${new_name}] already exists`);
    return;
  }
  profiles[new_name] = profiles[old_name];
  delete profiles[old_name];
  set_settings('profiles', profiles);
  set_settings('profile', new_name);
  let character_profiles = get_settings('character_profiles');
  for (let [character_key, character_profile] of Object.entries(character_profiles)) {
    if (character_profile === old_name) character_profiles[character_key] = new_name;
  }
  set_settings('character_profiles', character_profiles);
  log(`Renamed profile [${old_name}] to [${new_name}]`);
  update_profile_section();
}
export function new_profile() {
  let profiles = get_settings('profiles');
  let profile = 'New Profile';
  let i = 1;
  while (profiles[profile]) {
    profile = `New Profile ${i}`;
    i++;
  }
  profiles[profile] = structuredClone(default_settings);
  set_settings('profiles', profiles);
  load_profile(profile);
}
export async function delete_profile() {
  if (Object.keys(get_settings('profiles')).length === 1) {
    toastr.error("Cannot delete your last profile");
    return;
  }
  let profile = get_settings('profile');
  let profiles = get_settings('profiles');
  let result = await getContext().Popup.show.confirm("Confirm Deletion", `Permanently delete profile: "${profile}"?`);
  if (!result) return;
  delete profiles[profile];
  set_settings('profiles', profiles);
  toastr.success(`Deleted Configuration Profile: "${profile}"`);
  let character_profiles = get_settings('character_profiles') ?? {};
  for (let [id, name] of Object.entries(character_profiles)) {
    if (name === profile) delete character_profiles[id];
  }
  set_settings('character_profiles', character_profiles);

  // Switch to Default or first available
  if (profiles['Default']) load_profile('Default');else load_profile(Object.keys(profiles)[0]);
}
export function toggle_character_profile() {
  let key = get_current_character_identifier();
  if (!key) return;
  let profile = get_settings('profile');
  set_character_profile(key, profile === get_character_profile() ? null : profile);
}
export function toggle_chat_profile() {
  let profile = get_settings('profile');
  set_chat_profile(profile === get_chat_profile() ? null : profile);
}
export function set_character_profile(key, profile = null) {
  let character_profiles = get_settings('character_profiles');
  if (profile) {
    character_profiles[key] = profile;
    log(`Set character [${key}] to use profile [${profile}]`);
  } else {
    delete character_profiles[key];
    log(`Unset character [${key}] default profile`);
  }
  set_settings('character_profiles', character_profiles);
  update_profile_section();
}
export function set_chat_profile(profile = null) {
  const meta = chat_metadata;
  if (!meta[MODULE_NAME]) meta[MODULE_NAME] = {};
  if (profile) {
    meta[MODULE_NAME].profile = profile;
    log(`Set chat to use profile [${profile}]`);
  } else {
    meta[MODULE_NAME].profile = null;
    log(`Unset chat default profile`);
  }
  saveMetadataDebounced();
  update_profile_section();
}
export function auto_load_profile() {
  let profile = get_chat_profile() || get_character_profile();
  load_profile(profile || 'Default');
}
export function get_connection_profiles() {
  const context = getContext();
  return context?.extensionSettings?.connectionManager?.profiles || [];
}
export function get_connection_profile(id) {
  return get_connection_profiles().find(p => p.id === id || p.name === id);
}
export function get_active_connection_profile() {
  const configured_id = get_settings('connection_profile');
  if (configured_id) {
    const found = get_connection_profile(configured_id);
    if (found) return found;
  }
  const context = getContext();
  const active_id = context?.extensionSettings?.connectionManager?.selectedProfile;
  return get_connection_profile(active_id);
}
export
// STUBS for macro engine
function get_summary_connection_profile() {
  return get_active_connection_profile()?.id;
}