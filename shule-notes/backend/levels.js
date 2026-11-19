// The classes a student can be in. This is the ONE list: the app fetches it
// from GET /levels and the admin panel fills its "Class" menu from the same
// route, so a class can never exist in one place and not the other.
// A note's or student's class is stored as the full name ("Senior 2").
//
// Uganda's school system. To use another country's naming, edit this file
// only; nothing else holds a copy.
'use strict';

function range(prefix, from, to, shortPrefix) {
  const out = [];
  for (let n = from; n <= to; n++) out.push({ id: `${prefix} ${n}`, name: `${prefix} ${n}`, short: `${shortPrefix}${n}` });
  return out;
}

const GROUPS = [
  { id: 'primary', name: 'Primary', levels: range('Primary', 1, 7, 'P') },
  { id: 'o-level', name: 'O-Level', levels: range('Senior', 1, 4, 'S') },
  { id: 'a-level', name: 'A-Level', levels: range('Senior', 5, 6, 'S') },
];

const NAMES = GROUPS.flatMap((g) => g.levels.map((l) => l.id));

function isValidLevel(name) {
  return typeof name === 'string' && NAMES.includes(name);
}

module.exports = { GROUPS, NAMES, isValidLevel };
