// Visit times are agreed in UK wall-clock time ("every Tuesday at 10:00"), so a
// series keeps 10:00 across the clocks changing, not the same number of hours.
const TZ = 'Europe/London';

const partsFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

// The calendar date and clock time a UTC instant shows in the UK.
function londonParts(date) {
  const p = Object.fromEntries(partsFormatter.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour), minute: Number(p.minute) };
}

// The UTC instant at which UK clocks read the given date and time.
function londonToUtc({ year, month, day, hour, minute }) {
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wanted;
  // Two passes settle the offset, including on the day the clocks change.
  for (let i = 0; i < 2; i += 1) {
    const shown = londonParts(new Date(guess));
    const shownAsUtc = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour, shown.minute);
    guess += wanted - shownAsUtc;
  }
  return new Date(guess);
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

module.exports = { londonParts, londonToUtc, daysInMonth };
