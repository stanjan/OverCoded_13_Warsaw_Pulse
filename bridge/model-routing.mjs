// Discover only for omitted models. Explicit selections never silently change.
export async function resolveRequestModel(model, { antigravityAvailable, codexAvailable, claudeAvailable }) {
  if (typeof model === 'string' && model.trim()) return model.trim();
  if (model !== undefined && model !== null && typeof model !== 'string')
    throw Object.assign(new Error('model must be a string when provided.'), { statusCode: 400 });
  if (await antigravityAvailable()) return 'antigravity/default';
  if (await codexAvailable()) return 'codex-chatgpt';
  if (await claudeAvailable()) return 'claude-cli/default';
  throw Object.assign(new Error('No available CLI was found. Start Antigravity, or sign in to Codex or Claude CLI; alternatively request an explicitly configured provider/model.'), { statusCode: 503 });
}
