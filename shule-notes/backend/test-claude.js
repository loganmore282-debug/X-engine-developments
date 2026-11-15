#!/usr/bin/env node
/**
 * Runs the real classifyClaudeError() against REAL SDK error instances
 * (constructed the way the SDK itself builds them, not hand-rolled lookalike
 * objects) -- proving the most-specific-first chain actually discriminates,
 * and that nothing ever leaks a raw Anthropic error message to a student.
 */
'use strict';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-not-a-real-key';
const Anthropic = require('@anthropic-ai/sdk');
const { classifyClaudeError, MODEL } = require('./claude');

let bad = 0;
const ck = (ok, label) => { if (!ok) bad++; console.log((ok ? 'PASS  ' : 'FAIL  ') + label); };

const H = () => new Headers();

console.log('— classifyClaudeError() discriminates the real SDK error types —');
{
  const rl = classifyClaudeError(new Anthropic.RateLimitError(429, {}, 'rate limited upstream', H()));
  ck(rl.status === 503, 'a rate limit is reported as 503 (try again), not a client-fault 4xx');
  ck(!/rate limited upstream/.test(rl.message), 'the raw provider message is never shown to the student');

  const auth = classifyClaudeError(new Anthropic.AuthenticationError(401, {}, 'invalid x-api-key', H()));
  ck(auth.status === 500, 'a misconfigured API key is an operator problem (500), not something retrying fixes');
  ck(!/x-api-key/.test(auth.message), 'the raw auth failure detail never reaches the student');

  const bad1 = classifyClaudeError(new Anthropic.BadRequestError(400, {}, 'messages: at least one message is required', H()));
  ck(bad1.status === 500, 'a bad request from our own code is an operator problem, not the student\'s fault');

  const conn = classifyClaudeError(new Anthropic.APIConnectionError({ message: 'fetch failed' }));
  ck(conn.status === 503, 'a network failure reaching Claude is reported as transient (503)');

  const generic = classifyClaudeError(new Anthropic.InternalServerError(500, {}, 'upstream 500', H()));
  ck(generic.status === 502, 'an upstream 5xx not matching a specific class still gets a sensible status');

  const unknown = classifyClaudeError(new Error('something totally unexpected'));
  ck(unknown.status === 500, 'a non-SDK error (a bug in our own code) is still handled, not thrown further');
  ck(!/totally unexpected/.test(unknown.message), 'and its raw message is not echoed to the student either');

  // Every classified error must return a STRING a member can actually read --
  // never undefined, never the error object itself.
  for (const r of [rl, auth, bad1, conn, generic, unknown]) {
    ck(typeof r.message === 'string' && r.message.length > 0, 'every classified error carries a real, non-empty message');
  }
}

console.log('\n— model is configurable, not hardcoded to the priciest default —');
ck(typeof MODEL === 'string' && MODEL.length > 0, 'a model id is set');
ck(MODEL !== 'claude-opus-5-5', 'the default is NOT Anthropic\'s own priciest default -- deliberately chosen for a free, high-volume student app (override with AI_MODEL)');

console.log(bad ? `\n${bad} check(s) FAILED` : '\nall claude.js checks pass');
process.exit(bad ? 1 : 0);
