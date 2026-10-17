import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRequestModel } from './model-routing.mjs';
for (const [agy, codex, claude, expected] of [[true, true, true, 'antigravity/default'], [true, false, false, 'antigravity/default'], [false, true, true, 'codex-chatgpt'], [false, true, false, 'codex-chatgpt'], [false, false, true, 'claude-cli/default']]) {
  test(`omitted model priority Antigravity ${agy}, Codex ${codex}, Claude ${claude}`, async () => {
    assert.equal(await resolveRequestModel(undefined, { antigravityAvailable: async () => agy, codexAvailable: async () => codex, claudeAvailable: async () => claude }), expected);
  });
}
test('no CLI fails and explicit selection never probes or falls back', async () => {
  await assert.rejects(resolveRequestModel('', { antigravityAvailable: async () => false, codexAvailable: async () => false, claudeAvailable: async () => false }), /No available CLI/);
  const unexpected = async () => { throw new Error('must not probe'); };
  assert.equal(await resolveRequestModel('claude-cli/opus', { antigravityAvailable: unexpected, codexAvailable: unexpected, claudeAvailable: unexpected }), 'claude-cli/opus');
});
