# Project Rules & Development Guidelines

1. **NEVER use `sed`, `awk`, `grep` or equivalent regexp-based tools for files editing.** This breaks syntax and AST.
2. **To modify a file, you must read and re-write it entirely.**
3. **Always run syntax tests** (`node -c index.js` or `node index.js`) after making modifications to verify there are no syntax errors before committing.
