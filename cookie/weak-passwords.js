'use strict';
// Refuses passwords that password-guessing tools try first. The rule is deliberately light (the member app promises "at least 10
// characters"): only the most common passwords, one repeated character, simple runs like 123456 / 654321 / abcdef, and a
// password that is the member's own phone number.
const COMMON = new Set(('123456 1234567 12345678 123456789 1234567890 12345 123123 123321 111111 222222 333333 444444 555555 666666 777777 ' +
  '888888 999999 000000 121212 112233 654321 987654 987654321 159753 147258 258369 102030 101010 696969 789456 123654 ' +
  'password password1 password123 passw0rd p@ssword p@ssw0rd qwerty qwerty1 qwerty123 qwertyuiop asdfgh asdfghjkl zxcvbn zxcvbnm ' +
  '1q2w3e 1q2w3e4r 1qaz2wsx qazwsx abc123 abcabc abcdef abcd1234 admin admin123 administrator letmein welcome welcome1 login ' +
  'iloveyou iloveyou1 monkey dragon master football baseball sunshine princess shadow superman michael jesus jesus1 god1234 ' +
  'trustno1 whatever freedom hello123 secret test1234 uganda uganda1 kampala kampala1 kampala123 mtn1234 airtel123 money123 ' +
  'cookie123 cookie1234 cookiecookie changeme default guest user1234 pass1234 pass123 mypassword').split(/\s+/));
function isRun(s) {
  if (s.length < 4) return false;
  let up = true, down = true;
  for (let i = 1; i < s.length; i++) { const d = s.charCodeAt(i) - s.charCodeAt(i - 1); if (d !== 1) up = false; if (d !== -1) down = false; }
  return up || down;
}
// Returns '' when the password is acceptable, otherwise a short reason.
function weakPasswordReason(password, phone) {
  const p = String(password || '');
  const low = p.toLowerCase();
  if (COMMON.has(low)) return 'common';
  if (/^(.)\1+$/.test(p)) return 'repeated';
  if (isRun(low)) return 'run';
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length >= 7 && p.replace(/\D/g, '').length >= 7 && (digits.endsWith(p.replace(/\D/g, '')) || p.replace(/\D/g, '').endsWith(digits.slice(-9)))) return 'phone';
  return '';
}
const WEAK_PASSWORD_MESSAGE = 'That password is too easy to guess. Choose a different one, for example a few letters and numbers that only you know.';
module.exports = { weakPasswordReason, WEAK_PASSWORD_MESSAGE };
