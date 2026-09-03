/* eslint-disable */
import { extension_prompt_roles, extension_prompt_types, chat_metadata, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import {
  MODULE_NAME,
  settings_content_class,
  default_message_summary_prompt,
  default_short_to_long_prompt,
  default_long_compaction_prompt,
  default_long_template,
  default_short_template,
  default_summary_macros
} from './constants.js';
import { log, error, get_current_character_identifier } from './utils.js';
import { refresh_memory } from './memory.js';

export const default_settings = {
  // Plugin master toggle per profile
  disable_plugin: false,

  // Message inclusion
  message_length_threshold: 10,
  include_user_messages: true,
  include_system_messages: false,
  include_narrator_messages: false,

  // Editable prompts & templates
  message_summary_prompt: default_message_summary_prompt,
  short_to_long_prompt: default_short_to_long_prompt,
  long_compaction_prompt: default_long_compaction_prompt,
  summary_prompt_macros: default_summary_macros,
  long_template: default_long_template,
  short_template: default_short_template,
  prompt_role: extension_prompt_roles?.SYSTEM ?? 0,
  prefill: "",
  show_prefill: false,
  connection_profile: "",

  // Auto-summarization
  auto_summarize: true,
  summarization_time_delay: 0,
  summarization_time_delay_skip_first: false,
  parallel_summaries_count: 1,
  auto_summarize_on_edit: false,
  auto_summarize_on_swipe: true,
  auto_summarize_on_continue: false,
  auto_summarize_progress: true,
  block_chat: true,

  // Accumulative memory budgets (percent of max context)
  long_term_context_limit: 20,
  short_term_context_limit: 15,
  compaction_threshold_percent: 85,

  // Truncation & Injection
  summary_injection_separator: "\n* ",
  messages_to_keep: 5,
  kept_messages_context_threshold: 30,

  // Injection placement
  injection_position: extension_prompt_types?.IN_PROMPT ?? 0,
  injection_role: extension_prompt_roles?.SYSTEM ?? 0,

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

// Listener hook for UI refresh without hard cyclic dependency
var _ui_refresh_callback = null;
export function set_ui_refresh_callback(fn) {
  _ui_refresh_callback = fn;
}

export function notify_ui_refresh() {
  if (typeof _ui_refresh_callback === 'function') {
    _ui_refresh_callback();
  }
}

export function initialize_settings() {
  if (extension_settings[MODULE_NAME]) {
    log("Settings already initialized.");
  } else {
    log("Initializing settings...");
    extension_settings[MODULE_NAME] = structuredClone(global_settings);
    extension_settings[MODULE_NAME].profiles = {
      'Default': structuredClone(default_settings)
    };
  }
  load_profile(get_settings('profile'));
}

export function copy_settings(profile = null) {
  let settings = {};
  let current_settings = extension_settings[MODULE_NAME];
  if (profile) current_settings = current_settings?.profiles?.[profile];
  if (!current_settings) return {};
  for (let key in default_settings) {
    if (current_settings[key] !== undefined) {
      settings[key] = structuredClone(current_settings[key]);
    }
  }
  return settings;
}

export function get_settings(name = null) {
  if (name === null) return extension_settings[MODULE_NAME];
  let val = extension_settings[MODULE_NAME]?.[name];
  if (val !== undefined) return val;
  return default_settings[name];
}

export function set_settings(name, val) {
  if (!extension_settings[MODULE_NAME]) extension_settings[MODULE_NAME] = {};
  extension_settings[MODULE_NAME][name] = val;
  if (typeof saveSettingsDebounced === 'function') {
    saveSettingsDebounced();
  } else {
    const ctx = getContext();
    if (typeof ctx?.saveSettingsDebounced === 'function') {
      ctx.saveSettingsDebounced();
    }
  }
}

export function detect_settings_difference() {
  let profile = get_settings('profile');
  let saved = extension_settings[MODULE_NAME]?.profiles?.[profile];
  if (!saved) return false;
  return check_objects_different(copy_settings(), saved);
}

export function check_objects_different(obj1, obj2) {
  if (obj1 === obj2) return false;
  if (!obj1 || !obj2) return true;
  for (let key of Object.keys(obj1)) {
    if (typeof obj1[key] === 'object' && obj1[key] !== null) {
      if (check_objects_different(obj1[key], obj2[key])) return true;
    } else if (obj1[key] !== obj2[key]) {
      return true;
    }
  }
  for (let key of Object.keys(obj2)) {
    if (obj1[key] === undefined) return true;
  }
  return false;
}

export function get_character_profile() {
  let key = get_current_character_identifier();
  if (!key) return null;
  return get_settings('character_profiles')?.[key] || null;
}

export function get_chat_profile() {
  const meta = chat_metadata;
  return meta?.[MODULE_NAME]?.profile || null;
}

export function chat_enabled() {
  if (get_settings('disable_plugin')) {
    return false;
  }
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
    if (typeof saveMetadataDebounced === 'function') {
      saveMetadataDebounced();
    }
  }
  notify_ui_refresh();
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

// Profile UI and management
export function update_profile_section() {
  if (typeof $ === 'undefined') return;
  let current_profile = get_settings('profile');
  let current_character_profile = get_character_profile();
  let current_chat_profile = get_chat_profile();
  let profile_options = Object.keys(get_settings('profiles') || {});
  let content_class = `.${settings_content_class}`;
  let $choose_profile_dropdown = $(`${content_class} #profile`).empty();
  let $character = $(`${content_class} button#character_profile`);
  let $chat = $(`${content_class} button#chat_profile`);
  let $character_icon = $character.find('i');
  let $chat_icon = $chat.find('i');

  for (let profile of profile_options) {
    let text = profile;
    let html_safe_name = profile.replace(/"/g, '&quot;');
    if (profile === current_character_profile) text = `${profile} (Character)`;
    else if (profile === current_chat_profile) text = `${profile} (Chat)`;
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

export function save_profile(profile = null, silent = false) {
  if (!profile) profile = get_settings('profile');
  log("Saving Configuration Profile: " + profile);
  let profiles = get_settings('profiles') || {};
  let settings = copy_settings();
  profiles[profile] = settings;
  set_settings('profiles', profiles);
  if (!silent && typeof toastr !== 'undefined') toastr.success(`Saved profile "${profile}"`);
  notify_ui_refresh();
}

export function load_profile(profile = null) {
  let current_profile = get_settings('profile');
  if (!profile) profile = current_profile || 'Default';
  let settings = copy_settings(profile);
  if (!Object.keys(settings).length) {
    if (profile === 'Default') {
      let profiles = get_settings('profiles') || {};
      profiles['Default'] = structuredClone(default_settings);
      set_settings('profiles', profiles);
      settings = structuredClone(default_settings);
    } else {
      error("Profile not found: " + profile);
      return;
    }
  }
  log("Loading Configuration Profile: " + profile);
  Object.assign(extension_settings[MODULE_NAME], settings);
  set_settings('profile', profile);
  if (typeof saveSettingsDebounced === 'function') {
    saveSettingsDebounced();
  } else {
    const ctx = getContext();
    if (typeof ctx?.saveSettingsDebounced === 'function') {
      ctx.saveSettingsDebounced();
    }
  }
  if (get_settings("notify_on_profile_switch") && current_profile !== profile && typeof toastr !== 'undefined') {
    toastr.info(`Switched to profile "${profile}"`);
  }
  notify_ui_refresh();
  refresh_memory();
  update_profile_section();
}

export function export_profile(profile = null) {
  if (!profile) profile = get_settings('profile');
  let profiles = get_settings('profiles');
  let settings = profiles?.[profile];
  if (!settings) {
    error("Profile not found: " + profile);
    return;
  }
  log("Exporting Configuration Profile: " + profile);
  const data = JSON.stringify(settings, null, 4);
  if (typeof download === 'function') {
    download(data, `${profile}.json`, 'application/json');
  }
}

export async function import_profile(e) {
  let file = e.target.files[0];
  if (!file) return;
  const name = file.name.replace('.json', '');
  if (typeof parseJsonFile !== 'function') return;
  const data = await parseJsonFile(file);
  let profiles = get_settings('profiles') || {};
  profiles[name] = data;
  set_settings('profiles', profiles);
  load_profile(name);
  if (typeof toastr !== 'undefined') {
    toastr.success(`Profile "${name}" imported`);
  }
  e.target.value = null;
  notify_ui_refresh();
}

export async function rename_profile() {
  let ctx = getContext();
  if (!ctx?.Popup?.show?.input) return;
  let old_name = get_settings('profile');
  let new_name = await ctx.Popup.show.input("Rename Configuration Profile", `Enter a new name:`, old_name);
  if (!new_name || old_name === new_name) return;
  let profiles = get_settings('profiles') || {};
  if (profiles[new_name]) {
    if (typeof toastr !== 'undefined') toastr.error(`Profile [${new_name}] already exists`);
    return;
  }
  profiles[new_name] = profiles[old_name];
  delete profiles[old_name];
  set_settings('profiles', profiles);
  set_settings('profile', new_name);

  let character_profiles = get_settings('character_profiles') || {};
  for (let [character_key, character_profile] of Object.entries(character_profiles)) {
    if (character_profile === old_name) character_profiles[character_key] = new_name;
  }
  set_settings('character_profiles', character_profiles);
  log(`Renamed profile [${old_name}] to [${new_name}]`);
  update_profile_section();
  notify_ui_refresh();
}

export function new_profile() {
  let profiles = get_settings('profiles') || {};
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
  let profiles = get_settings('profiles') || {};
  if (Object.keys(profiles).length <= 1) {
    if (typeof toastr !== 'undefined') toastr.error("Cannot delete your last profile");
    return;
  }
  let profile = get_settings('profile');
  let ctx = getContext();
  if (ctx?.Popup?.show?.confirm) {
    let result = await ctx.Popup.show.confirm("Confirm Deletion", `Permanently delete profile: "${profile}"?`);
    if (!result) return;
  }
  delete profiles[profile];
  set_settings('profiles', profiles);
  if (typeof toastr !== 'undefined') toastr.success(`Deleted Configuration Profile: "${profile}"`);

  let character_profiles = get_settings('character_profiles') ?? {};
  for (let [id, name] of Object.entries(character_profiles)) {
    if (name === profile) delete character_profiles[id];
  }
  set_settings('character_profiles', character_profiles);

  if (profiles['Default']) load_profile('Default');
  else load_profile(Object.keys(profiles)[0]);
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
  let character_profiles = get_settings('character_profiles') || {};
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
  if (!meta) return;
  if (!meta[MODULE_NAME]) meta[MODULE_NAME] = {};
  if (profile) {
    meta[MODULE_NAME].profile = profile;
    log(`Set chat to use profile [${profile}]`);
  } else {
    meta[MODULE_NAME].profile = null;
    log(`Unset chat default profile`);
  }
  if (typeof saveMetadataDebounced === 'function') {
    saveMetadataDebounced();
  }
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

export function get_summary_connection_profile() {
  return get_active_connection_profile()?.id;
}


export function is_chat_loaded() {
  const ctx = getContext();
  return Array.isArray(ctx?.chat) && ctx.chat.length > 0;
}

export function get_summary_initialized() {
  if (!chat_metadata || typeof chat_metadata !== 'object') return false;
  const memData = chat_metadata[MODULE_NAME];
  if (!memData || typeof memData !== 'object') return false;
  return Boolean(memData.summary_initialized);
}

export function set_summary_initialized(val) {
  if (!chat_metadata || typeof chat_metadata !== 'object') return;
  if (!chat_metadata[MODULE_NAME] || typeof chat_metadata[MODULE_NAME] !== 'object') {
    chat_metadata[MODULE_NAME] = {};
  }
  chat_metadata[MODULE_NAME].summary_initialized = Boolean(val);
  if (typeof saveMetadataDebounced === 'function') {
    saveMetadataDebounced();
  }
}
