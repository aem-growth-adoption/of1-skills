import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  signalsToRows, rowsToSignals, llmquestionsToRows, rowsToLlmquestions,
  contextEndpointsToRows, rowsToContextEndpoints, COLUMNS,
} from './to-sheet.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const EP = {
  name: 'acct', description: 'Firmographics', url: 'https://e.example/api', method: 'POST', timeoutMs: 300,
  inputs: [{ name: 'id', from: 'account.accountId', required: true }, { name: 'page', from: 'url' }],
  output: { description: 'Company data', fields: { industry: 'Sector of the company', size: 'Headcount band' } },
};

test('columns', () => {
  assert.deepEqual(COLUMNS.signals, ['param', 'value', 'source', 'context']);
  assert.deepEqual(COLUMNS.llmquestions, ['url', 'question']);
  assert.equal(COLUMNS['context-endpoints'].join(), 'name,description,url,method,timeoutMs,inputs,outputDescription,outputFields');
});
test('signals round-trip', () => {
  const bare = [{ param: 'utm_x', value: 'a', source: 'ai', context: 'Came from X' }, { param: 'p', value: 'v' }];
  const rows = signalsToRows(bare);
  assert.deepEqual(rows[1], { param: 'p', value: 'v', source: '', context: '' });
  assert.deepEqual(rowsToSignals(rows), bare);
  assert.deepEqual(signalsToRows([]), []);
});
test('llmquestions round-trip, one row per question', () => {
  const bare = [{ url: '/a', questions: ['q1', 'q2'] }, { url: '/b', questions: ['q3'] }];
  const rows = llmquestionsToRows(bare);
  assert.deepEqual(rows, [{ url: '/a', question: 'q1' }, { url: '/a', question: 'q2' }, { url: '/b', question: 'q3' }]);
  assert.deepEqual(rowsToLlmquestions(rows), bare);
});
test('context-endpoints round-trip incl. required marker and optional fields', () => {
  const bare = { endpoints: [EP, { name: 'b', url: 'https://e.example/b' }] };
  const rows = contextEndpointsToRows(bare);
  assert.equal(rows[0].inputs, 'id=account.accountId*; page=url');
  assert.equal(rows[0].outputFields, 'industry=Sector of the company; size=Headcount band');
  assert.equal(rows[0].timeoutMs, '300'); assert.equal(rows[1].method, '');
  assert.deepEqual(rowsToContextEndpoints(rows), bare);
});
const bad = (fn, input, re) => assert.throws(() => fn(input), re);
test('signals rejections name the key', () => {
  bad(signalsToRows, {}, /signals\.json.*array/);
  bad(signalsToRows, [{ value: 'a' }], /signals\.json\[0\]\.param/);
  bad(signalsToRows, [{ param: 'p', value: 'a', extra: 1 }], /signals\.json\[0\]\.extra/);
  bad(signalsToRows, [{ param: 'p', value: { a: 1 } }], /signals\.json\[0\]\.value/);
  bad(signalsToRows, [{ param: 'p', value: 'a', context: ['x'] }], /signals\.json\[0\]\.context/);
  bad(signalsToRows, [null], /signals\.json\[0\]/);
});
test('llmquestions rejections', () => {
  bad(llmquestionsToRows, {}, /llmquestions\.json.*array/);
  bad(llmquestionsToRows, [{ url: '/a', questions: [] }], /llmquestions\.json\[0\]\.questions/);
  bad(llmquestionsToRows, [{ url: '/a', questions: [{ q: 1 }] }], /llmquestions\.json\[0\]\.questions\[0\]/);
  bad(llmquestionsToRows, [{ questions: ['q'] }], /llmquestions\.json\[0\]\.url/);
  bad(llmquestionsToRows, [{ url: '/a', questions: ['q'] }, { url: '/a', questions: ['r'] }], /llmquestions\.json\[1\]\.url.*duplicate/);
  bad(llmquestionsToRows, [{ url: '/a', questions: ['q'], note: 'x' }], /llmquestions\.json\[0\]\.note/);
});
test('context-endpoints rejections', () => {
  const ep = (o) => ({ endpoints: [{ ...EP, ...o }] });
  bad(contextEndpointsToRows, [], /context-endpoints\.json.*endpoints/);
  bad(contextEndpointsToRows, { endpoints: [EP, EP, EP] }, /context-endpoints\.json.*more than 2/);
  bad(contextEndpointsToRows, ep({ inputs: [{ name: 'x', from: 'cookie.secret' }] }), /endpoints\[0\]\.inputs\[0\]\.from.*cookie\.secret/);
  bad(contextEndpointsToRows, ep({ output: { fields: { a: 'x; y' } } }), /endpoints\[0\]\.output\.fields\.a/);
  bad(contextEndpointsToRows, ep({ output: { fields: { a: 'x=y' } } }), /endpoints\[0\]\.output\.fields\.a/);
  bad(contextEndpointsToRows, ep({ output: { fields: { a: { n: 1 } } } }), /endpoints\[0\]\.output\.fields\.a/);
  bad(contextEndpointsToRows, ep({ inputs: [{ name: 'a;b', from: 'url' }] }), /endpoints\[0\]\.inputs\[0\]\.name/);
  bad(contextEndpointsToRows, ep({ timeoutMs: { a: 1 } }), /endpoints\[0\]\.timeoutMs/);
  bad(contextEndpointsToRows, ep({ description: ['x'] }), /endpoints\[0\]\.description/);
  bad(contextEndpointsToRows, ep({ extra: 1 }), /endpoints\[0\]\.extra/);
  bad(contextEndpointsToRows, ep({ inputs: [{ name: 'a', from: 'url', required: 'yes' }] }), /endpoints\[0\]\.inputs\[0\]\.required/);
  bad(contextEndpointsToRows, ep({ url: undefined }), /endpoints\[0\]\.url/);
  bad(contextEndpointsToRows, { endpoints: [EP], other: 1 }, /context-endpoints\.json\.other/);
});
test('CLI prints rows, refuses with exit 1 naming file and key', () => {
  const d = mkdtempSync(join(tmpdir(), 'tosheet-'));
  writeFileSync(join(d, 'ok.json'), JSON.stringify([{ param: 'p', value: 'v' }]));
  writeFileSync(join(d, 'bad.json'), JSON.stringify([{ param: 'p' }]));
  const ok = spawnSync('node', [join(here, 'to-sheet.mjs'), 'signals', join(d, 'ok.json')], { encoding: 'utf8' });
  assert.equal(ok.status, 0); assert.equal(JSON.parse(ok.stdout)[0].param, 'p');
  const b = spawnSync('node', [join(here, 'to-sheet.mjs'), 'signals', join(d, 'bad.json')], { encoding: 'utf8' });
  assert.equal(b.status, 1); assert.match(b.stderr, /signals\.json\[0\]\.value/); assert.equal(b.stdout, '');
});
