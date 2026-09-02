# Project Rules & Development Guidelines

1. **NEVER use `sed`, `awk`, `grep` or equivalent regexp-based tools for files editing.** This breaks syntax and AST.
2. **To modify a file, you must read and re-write it entirely.**
3. **Always run syntax tests** (`node -c index.js` or `node index.js`) after making modifications to verify there are no syntax errors before committing.

## Modular Architecture
The plugin has been refactored into the following modules to prevent `index.js` from becoming monolithic:
- `state.js`: Global variables, settings logic, and profile management.
- `utils.js`: Helpers (`clean_string_for_html`, `escape_string`, `log`, `toast`, etc.)
- `macros.js`: Prompt macros dictionary and replacement logic (`compute_macro`, `create_summary_prompt`).
- `ui.js`: DOM binding and interface classes (`SummaryPromptEditInterface`, etc.).
- `memory.js`: Memory state, token math, `fillup`, and compaction math.
- `summarization.js`: LLM calling logic, queues, and prompt generation.
- `index.js`: Main bootstrap file containing only slash commands and event listener bindings.
