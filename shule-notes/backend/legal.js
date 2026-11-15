// The two public pages Google Play asks every app with accounts to link to:
// a privacy policy, and a page explaining how to delete an account.
'use strict';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page(title, body) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f7f5f0;color:#1b1c1a;line-height:1.6}
  main{max-width:720px;margin:0 auto;padding:32px 20px 64px}
  h1{font-size:26px;margin:0 0 4px} h2{font-size:18px;margin:28px 0 6px}
  .muted{color:#5a605a;font-size:14px} a{color:#17694b}
</style></head><body><main>${body}</main></body></html>`;
}

function contactLine(email) {
  return email
    ? `Email <a href="mailto:${esc(email)}">${esc(email)}</a>.`
    : 'Use the contact details on our Google Play listing.';
}

function privacyPage({ appName, supportEmail, updated }) {
  const app = esc(appName);
  return page(`${appName} Privacy Policy`, `
<h1>${app} Privacy Policy</h1>
<p class="muted">Last updated ${esc(updated)}</p>
<p>${app} lets students read notes, past papers and revision material, and ask an AI helper questions about the document they are reading. This page explains what information the app collects and what happens to it.</p>
<h2>What we collect</h2>
<ul>
  <li><strong>Account details:</strong> your name, your phone number or email address, and your password. The password is stored only in a scrambled (hashed) form that we cannot read.</li>
  <li><strong>AI helper usage:</strong> how many questions you ask each day, so that the daily limit can be applied.</li>
</ul>
<p>The app does not collect your location, contacts, photos or files, and it contains no advertising or tracking software.</p>
<h2>The AI helper</h2>
<p>When you ask a question, the question, your recent questions in the same chat and the text of the document you have open are sent to Anthropic, the company that provides the Claude AI model, so that an answer can be produced. Your name, phone number and email address are not sent. We do not keep a copy of your questions or the answers on our servers.</p>
<h2>How we use your information</h2>
<p>Only to sign you in, to show you the study material, and to operate the AI helper. We do not sell your information or share it with anyone else, except where the law requires it.</p>
<h2>Saved notes</h2>
<p>Notes you bookmark are remembered on your own phone only.</p>
<h2>Deleting your account</h2>
<p>You can delete your account at any time in the app: open <strong>Profile</strong>, choose <strong>Delete account</strong> and confirm with your password. Your account details and usage records are removed straight away. See also <a href="/account-deletion">how to delete your account</a>.</p>
<h2>Children</h2>
<p>${app} is a study tool. If you are under the age at which you can agree to this policy in your country, please use the app with the permission of a parent, guardian or teacher.</p>
<h2>Contact</h2>
<p>Questions about this policy? ${contactLine(supportEmail)}</p>`);
}

function accountDeletionPage({ appName, supportEmail }) {
  const app = esc(appName);
  return page(`Delete your ${appName} account`, `
<h1>Delete your ${app} account</h1>
<h2>In the app</h2>
<ol>
  <li>Open ${app} and sign in.</li>
  <li>Go to the <strong>Profile</strong> tab.</li>
  <li>Choose <strong>Delete account</strong> and enter your password to confirm.</li>
</ol>
<h2>What is deleted</h2>
<p>Your name, phone number or email address, your password, your sign-in sessions and your AI helper usage records are permanently deleted straight away. Nothing is kept.</p>
<h2>Cannot sign in?</h2>
<p>${contactLine(supportEmail)} Tell us the phone number or email address the account was created with and we will delete it for you.</p>`);
}

module.exports = { privacyPage, accountDeletionPage };
