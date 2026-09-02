import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clean_string_for_html,
  escape_string,
  unescape_string,
  count_tokens,
  get_chat_context_size,
  get_long_token_limit,
  get_short_token_limit,
  get_free_context_space,
  get_free_context_percent,
  assign_and_prune,
  assign_defaults,
  regex
} from '../utils.js';

test('utils.js: clean_string_for_html escapes HTML chars properly', () => {
  const input = `<script>alert("hello" & 'world')</script>`;
  const cleaned = clean_string_for_html(input);
  assert.equal(cleaned, `&lt;script&gt;alert(&quot;hello&quot; &amp; &#39;world&#39;)&lt;/script&gt;`);
});

test('utils.js: escape_string and unescape_string preserve content round-trip', () => {
  const original = "Line 1\nLine 2\tTabbed\\Escaped";
  const escaped = escape_string(original);
  assert.equal(escaped, "Line 1\\nLine 2\\tTabbed\\\\Escaped");
  const unescaped = unescape_string(escaped);
  assert.equal(unescaped, original);
});

test('utils.js: count_tokens calculates token size correctly', () => {
  assert.equal(count_tokens(''), 0);
  assert.equal(count_tokens(null), 0);
  // '1234' is length 4, Math.ceil(4/4) = 1
  assert.equal(count_tokens('1234'), 1);
  assert.equal(count_tokens('12345'), 2);
});

test('utils.js: context calculation functions work correctly', () => {
  const ctxSize = get_chat_context_size();
  assert.equal(ctxSize, 8192); // from mock
  // default limits: 20% long, 15% short
  assert.equal(get_long_token_limit(), Math.floor(8192 * 0.2));
  assert.equal(get_short_token_limit(), Math.floor(8192 * 0.15));
  assert.equal(get_free_context_space(), 8192);
  assert.equal(get_free_context_percent(), 100);
});

test('utils.js: assign_and_prune and assign_defaults work as expected', () => {
  const target = { a: 1, b: 2 };
  assign_and_prune(target, { b: 20, c: 30 });
  assert.deepEqual(target, { b: 20, c: 30 });

  const defTarget = { x: 1 };
  assign_defaults(defTarget, { x: 10, y: 20 });
  assert.deepEqual(defTarget, { x: 1, y: 20 });
});

test('utils.js: regex helper matches capture groups', () => {
  const str = "hello {{macro1}} world {{macro2}}";
  const matches = regex(str, /\{\{(.*?)\}\}/g);
  assert.deepEqual(matches, ['macro1', 'macro2']);
});
