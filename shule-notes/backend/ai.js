// Which AI answers: Claude or Gemini, as the owner chose in the admin panel, with the other one as a backup when it
// is set up (so a busy or failing provider does not leave students without an answer).
'use strict';
const claude = require('./claude');
const gemini = require('./gemini');

const PROVIDERS = ['claude', 'gemini'];

function haveKey(settings, provider) {
  if (provider === 'gemini') return gemini.KEY_PATTERN.test(settings.geminiKey || '') || gemini.KEY_PATTERN.test(process.env.GEMINI_API_KEY || '');
  return /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(settings.anthropicKey || '') || /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(process.env.ANTHROPIC_API_KEY || '');
}

// Returns the order to try: the chosen one first, then the other if it is set up and backup is on.
function order(settings) {
  const first = PROVIDERS.includes(settings.aiProvider) ? settings.aiProvider : 'claude';
  const second = first === 'claude' ? 'gemini' : 'claude';
  const list = [first];
  if (settings.aiFallback !== false && haveKey(settings, second)) list.push(second);
  return list;
}

const run = {
  claude: (s, a) => claude.askAboutDocument({ ...a, apiKey: s.anthropicKey, model: s.aiModel || undefined }),
  gemini: (s, a) => gemini.askAboutDocument({ ...a, apiKey: s.geminiKey, model: s.geminiModel || undefined, fetchImpl: a.fetchImpl }),
};
const classify = { claude: claude.classifyClaudeError, gemini: gemini.classifyGeminiError };

// Throws the LAST provider's error (use classifyAiError to turn it into a message). The backup is tried for every
// problem except "the AI declined this question" (a different AI would be asked the same thing).
async function ask(settings, args, runners = run) {
  let lastErr;
  for (const provider of order(settings)) {
    try {
      const r = await runners[provider](settings, args);
      return { ...r, provider };
    } catch (e) {
      lastErr = e;
      try { e.provider = provider; } catch (_) { /* frozen error: the message falls back to Claude's wording */ }
      if (classify[provider](e).status === 422) break;
    }
  }
  throw lastErr;
}

function classifyAiError(err) {
  return (classify[err && err.provider] || classify.claude)(err);
}

module.exports = { ask, classifyAiError, order, haveKey, PROVIDERS };
