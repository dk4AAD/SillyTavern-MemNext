import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getStringHash,
  compute_hash,
  clean_string_for_html,
  escape_string,
  unescape_string,
  count_tokens,
  get_chat_context_size,
  get_long_token_limit,
  get_short_token_limit,
  get_chat_cache_capacity,
  get_free_context_space,
  get_free_context_percent,
  assign_and_prune,
  assign_defaults,
  regex,
  guard_get_element_by_id,
  refresh_select2_element
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

test('utils.js: get_chat_cache_capacity subtracts system prompt and memory reserves', () => {
  const cap = get_chat_cache_capacity(10000);
  assert.equal(cap.context_size, 10000);
  assert.ok(cap.long_budget > 0);
  assert.ok(cap.short_budget > 0);
  assert.ok(cap.cc_max < 10000);
  assert.equal(cap.cc_max, 10000 - cap.OC);
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
  const input = "{{macro1}} and {{macro2}}";
  const results = regex(input, /\{\{([^}]+)\}\}/g);
  assert.deepEqual(results, ['macro1', 'macro2']);
});

test('utils.js: guard_get_element_by_id intercepts empty string safely', () => {
  let nativeCalled = 0;
  global.document = {
    getElementById: function (id) {
      nativeCalled++;
      return { id };
    }
  };

  guard_get_element_by_id();

  // Passing empty string or null/undefined must return null directly without calling native
  assert.equal(document.getElementById(''), null);
  assert.equal(document.getElementById(null), null);
  assert.equal(document.getElementById(undefined), null);
  assert.equal(nativeCalled, 0);

  // Passing valid non-empty string must delegate to native getElementById
  const el = document.getElementById('valid_id');
  assert.deepEqual(el, { id: 'valid_id' });
  assert.equal(nativeCalled, 1);
});

test('utils.js: refresh_select2_element handles elements without id gracefully', () => {
  const mockElement = {
    attr: (attrName, val) => {
      if (val !== undefined) mockElement[attrName] = val;
      return mockElement[attrName];
    },
    empty: () => mockElement,
    append: () => mockElement,
    val: () => mockElement,
    parent: () => mockElement
  };

  const orig$ = global.$;
  global.$ = () => ({
    length: 0,
    find: () => mockElement
  });

  try {
    assert.doesNotThrow(() => {
      refresh_select2_element(mockElement, [], [{ id: 1, name: 'Script1' }], 'Select script', () => {});
    });
    assert.ok(mockElement['id'], 'An auto-generated ID should be assigned to the element');
  } finally {
    global.$ = orig$;
  }
});


test('utils.js: getStringHash and compute_hash compute fast distinguishing hashes', () => {
  const text1 = "The party arrived at the ancient tavern in the woods.";
  const text2 = "The party arrived at the ancient tavern in the woods!"; // 1 char diff
  const hash1 = compute_hash(text1);
  const hash2 = compute_hash(text2);

  assert.ok(typeof hash1 === 'string' && hash1.length > 0, 'Hash must be a non-empty string');
  assert.equal(hash1, compute_hash(text1), 'Hash of identical string must be deterministic');
  assert.notEqual(hash1, hash2, 'Hash of different strings must differ');

  // Empty / null handling
  assert.equal(compute_hash(''), '');
  assert.equal(compute_hash(null), '');
  assert.equal(compute_hash(undefined), '');
  assert.equal(getStringHash(''), 0);
});
