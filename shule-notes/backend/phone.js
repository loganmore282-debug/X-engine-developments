// One stored form per number, so someone who signs up as 0772 123 456 can
// sign in as +256772123456. A full East African number (254/255/256 + nine
// digits) is stored the way it is dialled locally, with a leading 0.
'use strict';

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (/^25[456]\d{9}$/.test(digits)) return '0' + digits.slice(3);
  if (/^[1-9]\d{8}$/.test(digits)) return '0' + digits;
  return digits;
}

function isValidPhone(phone) {
  return /^\d{9,15}$/.test(phone);
}

module.exports = { normalizePhone, isValidPhone };
