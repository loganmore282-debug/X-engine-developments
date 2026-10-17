'use strict';
/**
 * FIREBASE_SERVICE_ACCOUNT, validated so each way of being wrong says which.
 *
 * This lived inline in server.js as:
 *
 *     JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}')
 *     if (!serviceAccount.project_id) throw new Error('Missing project_id');
 *     ... console.error('FIREBASE_SERVICE_ACCOUNT invalid:', e.message)
 *
 * which reported an UNSET variable and a MALFORMED one with the identical
 * sentence -- '{}' parses cleanly and carries no project_id. That is precisely
 * the state a fresh host is in before anything has been pasted, and being told
 * the value is "invalid" sends you to re-copy a credential that was never
 * there. Same family as the blank clock-offset box that silently meant UTC.
 *
 * It is a MODULE rather than a function in server.js because server.js cannot
 * be required by a test -- importing it connects to Mongo and starts
 * listening. The alternative was slicing the function out of the file with a
 * brace counter, which this project does elsewhere and which genuinely cannot
 * work here: the messages below contain a literal `}` and the checks contain
 * regex literals holding quote characters, so both a naive counter and a
 * string-aware one mis-slice it. A pure function in its own file needs no
 * slicing at all.
 *
 * Takes the raw value and RETURNS a verdict; it does not read process.env,
 * exit, or log. That is what makes every branch reachable from a test.
 */

const REQUIRED = ['project_id', 'client_email', 'private_key'];

/**
 * @param {string|undefined} raw  the FIREBASE_SERVICE_ACCOUNT value
 * @returns {{sa: object}|{fatal: string}}
 */
function loadServiceAccount(raw) {
  const text = (raw || '').trim();

  if (!text) {
    return { fatal: 'FIREBASE_SERVICE_ACCOUNT is not set. Paste the whole ' +
      "service-account JSON into it (one line) in the host's variables." };
  }

  let sa;
  try {
    sa = JSON.parse(text);
  } catch (e) {
    // The usual causes, in the order they actually happen: the value got
    // wrapped in quotes by a shell or a raw-editor paste; it was pasted with
    // real newlines (many variable editors keep only the first line); or only
    // part of it was copied.
    let hint = '';
    if (/^['"]/.test(text)) {
      hint = ' It starts with a quote -- paste the JSON itself, not a quoted string.';
    } else if (/\n/.test(text)) {
      hint = ' It contains line breaks -- paste it as ONE line.';
    } else if (text[text.length - 1] !== '}') {
      hint = ' It does not end with a closing brace -- the paste looks truncated.';
    }
    return { fatal: `FIREBASE_SERVICE_ACCOUNT is not valid JSON (${e.message}).${hint}` };
  }

  // A quote-wrapped paste is VALID JSON -- it parses to a string, not an
  // object -- so it never reaches the catch above, and a bare "not an object"
  // would explain nothing. This is the commoner of the two quoting mistakes:
  // the value survives the JSON parser and fails as the wrong type.
  if (typeof sa === 'string') {
    return { fatal: 'FIREBASE_SERVICE_ACCOUNT was pasted as a quoted string, so ' +
      'it reads as one long value instead of an object. Paste the JSON itself, ' +
      'with no surrounding quotes.' };
  }
  if (!sa || typeof sa !== 'object' || Array.isArray(sa)) {
    return { fatal: 'FIREBASE_SERVICE_ACCOUNT parsed but is not a JSON object ' +
      `(got ${Array.isArray(sa) ? 'an array' : sa === null ? 'null' : typeof sa}).` };
  }

  // All three are required by admin.credential.cert(). Naming every missing
  // one at once matters: reporting them one per deploy is one restart each to
  // find out the next field is also absent, and a deploy here is minutes.
  const missing = REQUIRED.filter(k => !sa[k]);
  if (missing.length) {
    return { fatal: 'FIREBASE_SERVICE_ACCOUNT is missing ' + missing.join(', ') +
      '. That is not the whole service-account file -- download a fresh ' +
      'private key from Firebase and paste all of it.' };
  }

  // A private_key that is not a PEM key at all is the classic hand-edited
  // value: valid JSON, every field present, and it fails inside cert() with a
  // message about key parsing rather than about the variable.
  if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(String(sa.private_key))) {
    return { fatal: 'FIREBASE_SERVICE_ACCOUNT private_key does not look like a ' +
      'PEM key. Do not edit it by hand; paste the file as downloaded.' };
  }

  return { sa };
}

module.exports = { loadServiceAccount, REQUIRED };
