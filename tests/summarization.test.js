import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SummaryQueue,
  summaryQueue,
  summarize_text,
  on_chat_event,
  get_summary_max_tokens,
  clean_llm_reasoning_tags
} from '../summarization.js';

test('summarization.js: SummaryQueue class and singleton instance', () => {
  assert.ok(summaryQueue instanceof SummaryQueue);
  assert.deepEqual(summaryQueue.tasks, []);
  summaryQueue.add(1);
  summaryQueue.add(2);
  summaryQueue.add(1); // duplicate ignored
  assert.deepEqual(summaryQueue.tasks, [1, 2]);
  summaryQueue.clear();
  assert.deepEqual(summaryQueue.tasks, []);
  assert.equal(summaryQueue.aborted, true);
});

test('summarization.js: clean_llm_reasoning_tags strips Gemma 4 channel thought tags', () => {
  // Empty thought channel
  const emptyTag = "<|channel>thought\n<channel|>Alice and Bob agreed to go to the park.";
  assert.equal(clean_llm_reasoning_tags(emptyTag), "Alice and Bob agreed to go to the park.");

  // Non-empty thought channel
  const populatedTag = "<|channel>thought\nLet me summarize this message briefly.\n<channel|>Alice and Bob agreed to go to the park.";
  assert.equal(clean_llm_reasoning_tags(populatedTag), "Alice and Bob agreed to go to the park.");

  // Unclosed or trailing thought channel
  const unclosedTag = "<|channel>thought\nStill thinking...";
  assert.equal(clean_llm_reasoning_tags(unclosedTag), "");
});

test('summarization.js: clean_llm_reasoning_tags strips DeepSeek and standard think tags', () => {
  const deepseek = "<think>Analyze the conversation history.</think>Summary content here.";
  assert.equal(clean_llm_reasoning_tags(deepseek), "Summary content here.");

  const customTemplate = { prefix: ">>>THINK\n", suffix: "<<<THINK" };
  const customStr = ">>>THINK\nInternal reasoning steps\n<<<THINKActual final summary.";
  assert.equal(clean_llm_reasoning_tags(customStr, customTemplate), "Actual final summary.");
});

test('summarization.js: summarize_text produces output via mock LLM', async () => {
  const result = await summarize_text([{ role: 'user', content: 'Tell me a story.' }]);
  assert.ok(result.length > 0);
  assert.ok(result.includes('Summary of:'));
});

test('summarization.js: get_summary_max_tokens returns value', () => {
  const tokens = get_summary_max_tokens();
  assert.equal(tokens, 50);
});

test('summarization.js: on_chat_event dispatches various lifecycle events without crashing', async () => {
  await on_chat_event('chat_changed');
  await on_chat_event('user_message', 0);
  await on_chat_event('message_deleted', 0);
  await on_chat_event('before_message', { type: 'chat', isDryRun: false });
  assert.ok(true);
});
