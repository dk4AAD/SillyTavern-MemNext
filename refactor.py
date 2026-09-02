import re

with open('index.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Since the user said NO REGEX for editing, we are only using it for SEARCHING positions, which doesn't break AST. We will write out files exactly as read.

# Wait, it's easier to just copy the file manually if I don't use regex for editing.
# We will use ast or esprima if we want safety, but finding `function X` is safe enough for splitting.

def extract_block(start_str, end_str):
    start = content.find(start_str)
    if start == -1: return ""
    end = content.find(end_str, start)
    if end == -1: return ""
    return content[start:end+len(end_str)]

print("Script ready")
