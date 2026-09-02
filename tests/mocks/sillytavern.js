/* Mock SillyTavern runtime environment for unit testing */

export const mockChat = [];
export const mockCharacters = [
  { avatar: 'bot.png', name: 'Assistant', description: 'Helpful AI', personality: 'Friendly', scenario: 'Testing', mes_example: '' }
];

export const mockContext = {
  chat: mockChat,
  characterId: 0,
  characters: mockCharacters,
  groupId: null,
  name1: 'User',
  name2: 'Assistant',
  getTokenCount: (text, padding = 0) => Math.ceil(String(text || '').length / 4) + padding,
  saveChat: () => {},
  setExtensionPrompt: (_key, _val, _pos, _depth, _scan, _role) => {},
  extensionSettings: {
    memnext: {
      profiles: {
        Default: {}
      },
      profile: 'Default'
    },
    connectionManager: {
      profiles: [{ id: 'profile-1', name: 'OpenAI Test' }],
      selectedProfile: 'profile-1'
    }
  },
  Popup: class {
    constructor(content) {
      this.content = content;
    }
    show() {
      return Promise.resolve(true);
    }
  },
  POPUP_TYPE: { TEXT: 1 },
  SlashCommandParser: {
    addCommandObject: () => {}
  },
  SlashCommand: {
    fromProps: (props) => props
  },
  eventSource: {
    on: () => {},
    makeLast: () => {}
  },
  eventTypes: {
    CHARACTER_MESSAGE_RENDERED: 'char_rendered',
    USER_MESSAGE_RENDERED: 'user_rendered',
    MESSAGE_DELETED: 'msg_deleted',
    MESSAGE_EDITED: 'msg_edited',
    MESSAGE_SWIPED: 'msg_swiped',
    CHAT_CHANGED: 'chat_changed',
    MORE_MESSAGES_LOADED: 'more_msgs',
    GENERATION_STARTED: 'gen_start'
  }
};

export function getContext() {
  return mockContext;
}

export const extension_settings = mockContext.extensionSettings;
export const chat_metadata = {};

export function saveSettingsDebounced() {}
export function saveMetadataDebounced() {}

export function getRegexScripts() {
  return [];
}
export function runRegexScript(script, text) {
  return text;
}

export function getStringHash(str) {
  return `hash_${str?.length || 0}`;
}
export function debounce(fn) {
  return fn;
}
export function copyText() {}
export function trimToEndSentence(t) { return t; }
export function download() {}
export async function parseJsonFile(f) { return {}; }
export function stringToRange() { return []; }
export function waitUntilCondition() { return Promise.resolve(); }

export const animation_duration = 100;
export function scrollChatToBottom() {}
export function getCharacterCardFields() {
  return { char: 'Assistant', user: 'User' };
}
export function messageFormatting(t) { return t; }
export async function generateRaw(prompt) {
  return `Summary of: ${String(prompt).slice(0, 30)}`;
}
export function createRawPrompt(messages) {
  return Array.isArray(messages) ? messages.map(m => m?.content || '').join('\n') : String(messages);
}
export function getMaxContextSize() {
  return 8192;
}
export function streamingProcessor() {}
export const amount_gen = 50;
export const system_message_types = { NARRATOR: 1 };
export const extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
export const extension_prompt_types = { IN_PROMPT: 0, IN_CHAT: 1 };
export const CONNECT_API_MAP = {};
export const main_api = 'mock';
export const online_status = 'connected';

export function formatInstructModePrompt(name, isUser, content) {
  return `[Instruct: ${name}]: ${content}`;
}
export const selected_group = null;
export const openGroupId = null;
export function loadMovingUIState() {}
export const power_user = {};
export function dragElement() {}
export const debounce_timeout = { relaxed: 50 };

export const MacrosParser = {
  registeredMacros: {},
  registerMacro: (name, fn) => {
    MacrosParser.registeredMacros[name] = fn;
  }
};
export const itemizedPrompts = [];
export function t(strings, ...values) {
  return String(strings?.[0] || '');
}
export function translate(text) {
  return text;
}
