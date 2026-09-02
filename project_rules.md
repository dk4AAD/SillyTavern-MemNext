# Project Rules & Development Guidelines

1. **NEVER use `sed`, `awk`, `grep` or equivalent regexp-based tools for files editing.** This breaks syntax and AST.
2. **To modify a file, you must read and re-write it entirely.**
3. **Always run test and syntax verification** (`npm test` and `npm run lint`) after making modifications to verify there are no syntax, lint, or runtime errors before committing.

## Modular Architecture (8 Modules)
The plugin is divided into 8 cleanly decoupled ES modules to prevent circular dependencies, Temporal Dead Zone (TDZ) initialization errors, and monolithic degradation:

- `constants.js`: Zero-dependency constants (`MODULE_NAME`, `MODULE_NAME_FANCY`, `PROGRESS_BAR_ID`, CSS selectors, default macro definitions, default prompt templates).
- `utils.js`: Pure helpers (`clean_string_for_html`, `escape_string`, `unescape_string`, `count_tokens`, `log`, `toast`, context calculators).
- `state.js`: Extension settings, default profile fallback, profile management (`load_profile`, `save_profile`, `rename_profile`, `new_profile`, `delete_profile`, `export_profile`, `import_profile`).
- `macros.js`: Standalone prompt macro compilation (`create_summary_prompt`, `compute_macro`, `preprocess_crop_history`, Handlebars template compilation). Decoupled from UI modals.
- `memory.js`: Chat memory state (`extra.memnext`), exclusion checks, context budgeting math, `fillup`, and compaction algorithms (`compact_history`).
- `summarization.js`: LLM calling service (`summarize_text`), message summarization flow (`summarize_message`), worker queue (`SummaryQueue`), and lifecycle event router (`on_chat_event`).
- `ui.js`: UI modal classes (`SummaryPromptEditInterface`, `PromptEditInterface`, `MemoryEditInterface`), in-chat message action buttons, popout window, and settings DOM bindings (`initialize_settings_ui`).
- `index.js`: Main bootstrap entry point for SillyTavern (`jQuery(async function() { ... })`), lifecycle event listener registration, and slash command bindings.

## Testing
- Tests are located in `tests/` and run using Node 20's native test runner via `npm test`.
- SillyTavern browser and runtime APIs are mocked via `tests/mocks/sillytavern.js` and hooked via `tests/loader.mjs`.
