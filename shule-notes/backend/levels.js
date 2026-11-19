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

// What is taught at each level, from the NCDC curricula and UNEB's exam
// structure. These names are also what the app matches to a subject icon
// and colour, so spell them the way they are written here.
//   Lower primary (P1-P3): the thematic curriculum -- literacy, numeracy.
//   Upper primary (P4-P7): English, Mathematics, Science, Social Studies are
//     the four PLE papers; Religious Education sits inside Social Studies.
//   O-Level (S1-S4): English, Mathematics, the three sciences, Geography,
//     History, Kiswahili, PE, Entrepreneurship and Religious Education are
//     compulsory (Entrepreneurship becomes an elective in S3-S4); the rest
//     are electives that each school chooses from.
//   A-Level (S5-S6): three principal subjects, General Paper, and one
//     subsidiary (Subsidiary Mathematics or Subsidiary ICT).
const LOWER_PRIMARY = ['English', 'Mathematics', 'Reading', 'Religious Education', 'Local Language', 'Creative Arts & PE'];
const UPPER_PRIMARY = ['English', 'Mathematics', 'Science', 'Social Studies', 'Religious Education', 'Kiswahili', 'Local Language', 'Creative Arts & PE'];
const O_LEVEL = [
  'English', 'Mathematics', 'Biology', 'Chemistry', 'Physics', 'Geography', 'History & Political Education',
  'Kiswahili', 'Physical Education', 'Entrepreneurship Education', 'Christian Religious Education', 'Islamic Religious Education',
  'Agriculture', 'ICT', 'Art & Design', 'Performing Arts', 'Nutrition & Food Technology', 'Technology & Design',
  'Literature in English', 'Foreign Languages', 'Local Language',
];
const A_LEVEL = [
  'General Paper', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Geography', 'History', 'Economics',
  'Entrepreneurship Education', 'Literature in English', 'Christian Religious Education', 'Islamic Religious Education',
  'Agriculture', 'Fine Art', 'Kiswahili', 'Subsidiary Mathematics', 'Subsidiary ICT',
];

function subjectsFor(levelName) {
  const n = Number(levelName.split(' ')[1]);
  if (levelName.startsWith('Primary')) return n <= 3 ? LOWER_PRIMARY : UPPER_PRIMARY;
  return n <= 4 ? O_LEVEL : A_LEVEL;
}

for (const group of GROUPS) {
  for (const level of group.levels) level.subjects = subjectsFor(level.name);
}

// Every standard subject once, in a sensible order, for the admin's "add the
// standard subjects" button.
const ALL_SUBJECTS = [...new Set([LOWER_PRIMARY, UPPER_PRIMARY, O_LEVEL, A_LEVEL].flat())];

module.exports = { GROUPS, NAMES, ALL_SUBJECTS, isValidLevel };
