/* eslint-disable */
import { runRegexScript } from '../../../../scripts/extensions/regex/engine.js';
import { getCharacterCardFields, extension_prompt_roles } from '../../../../script.js';
import { getContext } from '../../../extensions.js';
import { itemizedPrompts } from '../../../../scripts/itemized-prompts.js';
import {
  long_memory_macro,
  short_memory_macro,
  generic_memories_macro,
  default_message_summary_prompt,
  default_short_to_long_prompt,
  default_long_compaction_prompt,
  default_long_template,
  default_short_template,
  default_macro_settings,
  default_summary_macros
} from './constants.js';
import { debug, error, log, get_regex_script, regex } from './utils.js';
import { get_settings } from './state.js';
import { check_message_exclusion, get_memory } from './memory.js';

export {
  long_memory_macro,
  short_memory_macro,
  generic_memories_macro,
  default_message_summary_prompt,
  default_short_to_long_prompt,
  default_long_compaction_prompt,
  default_long_template,
  default_short_template,
  default_macro_settings,
  default_summary_macros
};

export function get_message_prompts(index) {
  if (typeof itemizedPrompts !== 'undefined' && Array.isArray(itemizedPrompts)) {
    for (let i = 0; i < itemizedPrompts.length; i++) {
      let itemized_prompt = itemizedPrompts[i];
      if (itemized_prompt && itemized_prompt.mesId === index) {
        return itemized_prompt;
      }
    }
  }
  return null;
}

export function preprocess_crop_history(prompt) {
  if (!prompt || typeof prompt !== 'string') return '';
  return prompt.replace(/(\{\{\s*#?if\s+|\{\{\s*)crop_history\s+(\d+)(\s*}})/g, "$1crop_history_$2$3");
}

export async function evaluate_script(macro, id, text = null, ctx = null) {
  ctx = ctx || getContext();
  if (text === null) {
    text = ctx?.chat?.[id]?.mes || "";
  }

  for (let reg of macro.regex_scripts ?? []) {
    const regScript = get_regex_script(reg);
    if (regScript && typeof runRegexScript === 'function') {
      text = runRegexScript(regScript, text);
    }
  }

  let command = macro.command;
  if (command?.trim()) {
    command = command.replace(/\{\{id}}/g, id.toString());
    command = command.replace(/\{\{message}}/g, text);
    try {
      if (ctx?.executeSlashCommandsWithOptions) {
        let result = await ctx.executeSlashCommandsWithOptions(command);
        text = result?.pipe ?? "";
      }
    } catch (e) {
      error(`Error evaluating macro script:`, e);
      return "";
    }
  }
  return text;
}

export async function special_macro_message(index, custom_macros = null, ctx = null) {
  ctx = ctx || getContext();
  const all_macros = custom_macros || get_settings('summary_prompt_macros') || default_summary_macros;
  let macro = all_macros["message"] || default_summary_macros["message"];
  let message = ctx?.chat?.[index];
  if (!message) return [{ content: "" }];
  let role = message.is_user ? 'user' : message.is_system ? 'system' : 'assistant';
  let text = await evaluate_script(macro, index, message.mes || "", ctx);
  if (macro.instruct_template) {
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

export function special_macro_speaker(index, ctx = null) {
  ctx = ctx || getContext();
  let message = ctx?.chat?.[index];
  if (!message) return [{ content: "" }];
  let speaker = message.name || (message.is_user ? (ctx?.name1 || "User") : (ctx?.name2 || "Assistant"));
  return [{
    content: speaker
  }];
}

export async function compute_range_macro(index, macro, ctx = null) {
  ctx = ctx || getContext();
  let chat = ctx?.chat || [];
  let history = [];

  let start_index = Math.max(index - (macro.end || 0), 0);
  let end_index = Math.max(index - (macro.start || 0), 0);

  debug(`Getting Message History. Index: ${index}, Start: ${macro.start}, End: ${macro.end} (${start_index} to ${end_index})`);

  for (let i = start_index; i <= end_index && i < chat.length; i++) {
    let m = chat[i];
    if (!m) continue;
    let include_message = true;
    let include_summary = true;

    if (m.is_user) {
      include_message = macro.user_messages;
      include_summary = macro.user_summaries;
    } else if (m.is_system || m.is_thoughts) {
      include_message = false;
      include_summary = false;
    } else {
      include_message = macro.bot_messages;
      include_summary = macro.bot_summaries;
    }

    if (include_message) {
      let text = await evaluate_script(macro, i, m.mes || "", ctx);
      let role = m.is_user ? 'user' : m.is_system ? 'system' : 'assistant';

      if (macro.instruct_template) {
        history.push({
          role: role,
          name: m.name,
          content: text
        });
      } else {
        let name = m.name || (m.is_user ? ctx?.name1 : ctx?.name2);
        if (name) {
          history.push(`${name}: ${text}`);
        } else {
          history.push(text);
        }
      }
    }

    if (include_summary) {
      let memory = get_memory(m);
      if (check_message_exclusion(m) && memory) {
        let memStr = `Summary: ${memory}`;
        if (macro.instruct_template) {
          history.push({
            role: 'system',
            content: memStr
          });
        } else {
          history.push(memStr);
        }
      }
    }
  }

  if (macro.instruct_template) {
    return history;
  } else {
    return [{
      content: history.join('\n')
    }];
  }
}

export async function compute_macro(index, name, ignore_enabled = false, custom_macros = null, ctx = null) {
  ctx = ctx || getContext();

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
      return await compute_range_macro(index, dynamic_macro, ctx);
    }
  }

  const all_macros = custom_macros || get_settings('summary_prompt_macros') || default_summary_macros;
  let macro = all_macros[name];
  if (!macro) return null;
  if (!macro.enabled && !ignore_enabled) return null;

  debug("Computing Macro: " + name);

  if (name === "message") {
    return await special_macro_message(index, all_macros, ctx);
  }
  if (name === "speaker") {
    return special_macro_speaker(index, ctx);
  }
  if (name === "crop_history") {
    return [{ content: "" }];
  }

  if (macro.type === "preset") {
    return await compute_range_macro(index, macro, ctx);
  } else if (macro.type === "custom") {
    let text = await evaluate_script(macro, index, "", ctx);
    if (text && macro.instruct_template) {
      return [{
        role: 'system',
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

export async function compute_used_macros(index, text, custom_macros = null, ctx = null) {
  let matches = regex(text, /\{\{#if (.*?)}}|\{\{(?!\/if)(.*?)}}/gs);
  let names = new Set();
  for (let match of matches) {
    names.add(match.trim());
  }
  let values = {};
  for (let name of names) {
    let value = await compute_macro(index, name, false, custom_macros, ctx);
    if (!value) continue;
    values[name] = value;
  }
  return values;
}

export function compile_handlebars(text, macros, index, ctx = null) {
  ctx = ctx || getContext();
  let group_id = ctx?.groupId;
  let name = ctx?.chat?.[index]?.name;

  let template_data = Object.assign({}, typeof getCharacterCardFields === 'function' ? getCharacterCardFields() : {});
  if (group_id && name) {
    template_data['char'] = name;
  }
  for (let name of Object.keys(macros)) {
    template_data[name] = `{{${name}}}`;
  }

  if (typeof Handlebars !== 'undefined' && Handlebars.compile) {
    try {
      return Handlebars.compile(text, {
        ignoreStandalone: true
      })(template_data);
    } catch (e) {
      error(`Handlebars compile error:`, e);
      return text;
    }
  }

  return text.replace(/\{\{#if\s+(.*?)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, inner) => {
    return macros[condition.trim()] ? inner : '';
  });
}

export function evaluate_prompt(text, macros, default_role = 'system', prefill = '') {
  let parts = text.split(/(\{\{.*?}})/g);
  let messages = [];
  let merge_next = false;

  let add = content => {
    for (let message of content) {
      if (message.role) {
        messages.push(message);
        merge_next = false;
      } else {
        if (merge_next && messages.length > 0) {
          messages[messages.length - 1].content += message.content;
        } else {
          messages.push({
            role: default_role,
            content: message.content
          });
        }
        merge_next = true;
      }
    }
  };

  for (let part of parts) {
    let trimmed_part = part?.trim();
    if (!trimmed_part) continue;
    if (trimmed_part.startsWith('{{') && trimmed_part.endsWith('}}')) {
      let macro_name = trimmed_part.slice(2, -2);
      let value = macros[macro_name];
      if (value === undefined) log(`Undefined macro in summary prompt: "${macro_name}"`);
      add(value ?? '');
    } else {
      add([{ content: part }]);
    }
  }

  if (prefill) {
    messages.push({
      content: prefill,
      role: 'assistant'
    });
  }
  return messages;
}

export function get_resolved_role_string(role_code) {
  if (role_code === undefined || role_code === null) {
    role_code = get_settings('prompt_role');
  }
  switch (Number(role_code)) {
    case extension_prompt_roles?.USER ?? 1:
      return 'user';
    case extension_prompt_roles?.ASSISTANT ?? 2:
      return 'assistant';
    default:
      return 'system';
  }
}

export async function create_summary_prompt(index, prompt = null, options = {}) {
  let ctx = options.ctx || getContext();
  if (prompt === null) {
    prompt = get_settings('message_summary_prompt');
  }

  prompt = preprocess_crop_history(prompt);
  let custom_macros = options.custom_macros || null;
  let macros = await compute_used_macros(index, prompt, custom_macros, ctx);
  prompt = compile_handlebars(prompt, macros, index, ctx);

  let role_str = options.role_str || get_resolved_role_string(options.prompt_role);
  let prefill = options.prefill !== undefined ? options.prefill : (get_settings('prefill') || '');

  return evaluate_prompt(prompt, macros, role_str, prefill);
}