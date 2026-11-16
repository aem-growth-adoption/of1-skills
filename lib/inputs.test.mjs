import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInputs } from './inputs.mjs';

test('defaults and env', () => {
  assert.deepEqual(parseInputs([], { OF1_AUTONOMOUS: '1' }), { autonomous: true, pages: null, pageMode: 'copy', codeDelivery: 'main' });
  assert.equal(parseInputs([], {}).autonomous, false);
  assert.equal(parseInputs(['autonomous'], {}).autonomous, true);
});

test('arguments and env fallbacks', () => {
  const r = parseInputs(['page-mode=real', 'code-delivery=pr'], {});
  assert.equal(r.pageMode, 'real');
  assert.equal(r.codeDelivery, 'pr');
  assert.equal(parseInputs([], { OF1_PAGE_MODE: 'real' }).pageMode, 'real');
});

test('invalid enums throw', () => {
  assert.throws(() => parseInputs(['code-delivery=force'], {}), /code-delivery must be main, branch or pr/);
  assert.throws(() => parseInputs(['page-mode=x'], {}), /page-mode must be copy or real/);
});

test('pages JSON and @file', () => {
  assert.deepEqual(parseInputs(['pages=[{"path":"/a"},"/b"]'], {}).pages, [{ path: '/a' }, { path: '/b' }]);
  assert.deepEqual(parseInputs(['pages=@p.json'], {}, { readFile: () => '[{"path":"/c","type":"faq"}]' }).pages, [{ path: '/c', type: 'faq' }]);
  assert.throws(() => parseInputs(['pages=nope'], {}), /pages/);
});

test('autonomous=true/1/false argument', () => {
  assert.equal(parseInputs(['autonomous=true'], {}).autonomous, true);
  assert.equal(parseInputs(['autonomous=1'], {}).autonomous, true);
  assert.equal(parseInputs(['autonomous=false'], {}).autonomous, false);
});

test('bad pages JSON has a clear error', () => {
  assert.throws(() => parseInputs(['pages=[oops'], {}), /pages must be JSON or @file with JSON/);
});
