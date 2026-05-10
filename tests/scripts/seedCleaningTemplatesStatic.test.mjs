import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('清掃テンプレートseedは日間・週間・月間の標準タスクを投入する', async () => {
  const script = await readFile('scripts/seed-cleaning-templates.mjs', 'utf8');

  assert.match(script, /id:\s*'cleaning-daily'/);
  assert.match(script, /id:\s*'cleaning-weekly'/);
  assert.match(script, /id:\s*'cleaning-monthly'/);
  assert.match(script, /バーナー・コンロの清掃/);
  assert.match(script, /換気扇の清掃/);
  assert.match(script, /sampleTitles\.join/);
});
