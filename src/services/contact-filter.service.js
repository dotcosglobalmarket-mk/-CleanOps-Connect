// Hides contact details in in-app chat so customers and cleaners cannot take
// a booking off the platform before it is paid for. It masks (never stores)
// UK phone numbers, email addresses, full UK postcodes, web links and social
// handles, including common attempts to disguise them.
//
// This is a deterrent, not a guarantee: a determined person can still split
// a number across several messages or describe it in words we do not
// recognise. Reporting and the terms of service cover the rest.

const REPLACEMENT = '[contact details hidden]';

const NUMBER_WORDS = {
  zero: 1,
  oh: 1,
  o: 1,
  nought: 1,
  one: 1,
  two: 1,
  three: 1,
  four: 1,
  five: 1,
  six: 1,
  seven: 1,
  eight: 1,
  nine: 1,
  // "double nine" is two digits: the word itself adds one, "nine" adds one.
  double: 1,
  triple: 2,
};
const WORD = Object.keys(NUMBER_WORDS).join('|');

// A run of digit groups and/or spelled-out digits, separated only by spaces,
// dots, hyphens, commas or brackets. Letters, "/" and ":" end a run, so
// "26/10/2026 14:30" and "2 bedrooms, 1 bathroom" are not treated as numbers.
const TOKEN = `(?:\\+?\\(?\\d+\\)?|\\b(?:${WORD})\\b)`;
const NUMBER_RUN = new RegExp(`${TOKEN}(?:[\\s.,\\-]*${TOKEN})*`, 'gi');

// A whole UK number is 10-11 digits (+44 form: 12). Nine or more digits in a
// run, or seven or more when it starts like a UK number (0..., +44, "oh",
// "zero"), is treated as a phone number so partial numbers are caught too.
const MIN_DIGITS = 9;
const MIN_DIGITS_UK_START = 7;

function digitUnits(run) {
  let units = 0;
  const tokens = run.match(new RegExp(`\\d+|\\b(?:${WORD})\\b`, 'gi')) || [];
  tokens.forEach((token, i) => {
    if (/^\d/.test(token)) {
      units += token.length;
      return;
    }
    const lower = token.toLowerCase();
    // "double"/"triple" only count as digits when paired with an actual
    // digit right after them ("double nine" = 2 digits). On their own
    // (e.g. someone repeating the word "triple") they add nothing, so a
    // run of these words alone is never mistaken for a phone number.
    if (lower === 'double' || lower === 'triple') {
      const next = tokens[i + 1];
      if (next && (/^\d/.test(next) || (NUMBER_WORDS[next.toLowerCase()] && next.toLowerCase() !== 'double' && next.toLowerCase() !== 'triple'))) {
        units += NUMBER_WORDS[lower];
      }
      return;
    }
    units += NUMBER_WORDS[lower];
  });
  return units;
}

function startsLikeUkNumber(run) {
  const trimmed = run.replace(/^[\s(]+/, '');
  return /^(\+?\(?44|\+44|0|oh\b|zero\b|nought\b)/i.test(trimmed);
}

function looksLikePhoneNumber(run) {
  const units = digitUnits(run);
  return units >= MIN_DIGITS || (units >= MIN_DIGITS_UK_START && startsLikeUkNumber(run));
}

const EMAIL = /[\w.+-]+\s*(?:@|\(at\)|\[at\]|\{at\})\s*[\w-]+(?:\s*(?:\.|\(dot\)|\[dot\]|\{dot\})\s*[\w-]+)+/gi;
// "name at gmail dot com" - only with a recognisable ending, so ordinary
// sentences containing "at" are left alone.
const SPELLED_EMAIL = /[\w.+-]+\s+at\s+[\w-]+\s+dot\s+(?:com|co\s+uk|uk|net|org|me|io)\b/gi;

// Outward + inward code, e.g. "WF8 2YJ", "ls12 3ab", "SW1A1AA". Outward-only
// codes such as "LS12" are the public job area and stay visible.
const POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[ABD-HJLNP-UW-Z]{2}\b/gi;

const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
const BARE_DOMAIN = /\b[\w-]+(?:\.[\w-]+)*\.(?:com|co\.uk|uk|net|org|io|me|app|info|biz|online|shop)\b(?:\/\S*)?/gi;
const HANDLE = /(?:^|[\s(])@[A-Za-z0-9_.]{3,}/g;
const MESSAGING_LINK = /\b(?:wa\.me|t\.me|bit\.ly)\/\S+/gi;

function replaceAll(text, regex, kind, found) {
  return text.replace(regex, (match) => {
    found.add(kind);
    // HANDLE keeps its leading whitespace/bracket.
    const lead = kind === 'handle' && /^[\s(]/.test(match) ? match[0] : '';
    return `${lead}${REPLACEMENT}`;
  });
}

function maskContactDetails(input) {
  const found = new Set();
  let text = String(input);

  // Order matters: emails and links first so their digits/dots are not
  // re-scanned as phone numbers or domains.
  text = replaceAll(text, EMAIL, 'email', found);
  text = replaceAll(text, SPELLED_EMAIL, 'email', found);
  text = replaceAll(text, MESSAGING_LINK, 'link', found);
  text = replaceAll(text, URL, 'link', found);
  text = replaceAll(text, BARE_DOMAIN, 'link', found);
  text = replaceAll(text, HANDLE, 'handle', found);
  text = replaceAll(text, POSTCODE, 'postcode', found);

  text = text.replace(NUMBER_RUN, (run) => {
    if (!looksLikePhoneNumber(run)) return run;
    found.add('phone');
    // Keep trailing separators so the sentence reads normally.
    const trailing = run.match(/[\s.,\-]+$/);
    return `${REPLACEMENT}${trailing ? trailing[0] : ''}`;
  });

  // Collapse neighbouring replacements ("a, b" both hidden) into one.
  const escaped = REPLACEMENT.replace(/[[\]]/g, '\\$&');
  text = text.replace(new RegExp(`(?:${escaped}[\\s,.\\-]*){2,}`, 'g'), `${REPLACEMENT} `).trim();

  return { text, masked: found.size > 0, kinds: Array.from(found).sort() };
}

module.exports = { maskContactDetails, REPLACEMENT };
