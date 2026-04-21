import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('README に権限・単一店舗前提・/api/link 契約・日次時刻が記載されている', async () => {
  const readme = await readFile('README.md', 'utf8');

  assert.match(readme, /part_time \/ manager \/ admin/);
  assert.match(readme, /1ユーザー = 1店舗/);
  assert.match(readme, /employeeCode \+ passcode/);
  assert.match(readme, /10:30/);
  assert.match(readme, /0:00/);
});
