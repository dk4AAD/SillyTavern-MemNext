let prompt = `{{#if crop_history 5}}
Following is a history:
{{crop_history 5}}
{{/if}}`;
prompt = prompt.replace(/(\{\{\s*#?if\s+|\{\{\s*)crop_history\s+(\d+)(\s*}})/g, "$1crop_history_$2$3");
console.log(prompt);
