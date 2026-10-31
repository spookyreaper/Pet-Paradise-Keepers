const timeZone = 'America/New_York';
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function dateInput(date) {
  const value = new Date(date);
  if (!Number.isFinite(value.getTime())) return '';
  const parts = Object.fromEntries(formatter.formatToParts(value).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function parseDateInput(value, label = 'Date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw Object.assign(new Error(`Enter a valid ${label.toLowerCase()} in Eastern time.`), { status: 400 });
  }
  const [year, month, day, hour, minute] = value.match(/\d+/g).map(Number);
  const intended = Date.UTC(year, month - 1, day, hour, minute);
  const normalized = new Date(intended).toISOString().slice(0, 16);
  if (year < 2000 || year > 2100 || normalized !== value) {
    throw Object.assign(new Error(`Enter a valid ${label.toLowerCase()}.`), { status: 400 });
  }
  let timestamp = intended;
  // Resolve the local wall-clock value using the zone's actual daylight-saving offset.
  for (let attempt = 0; attempt < 4; attempt++) {
    const rendered = dateInput(timestamp);
    if (rendered === value) return new Date(timestamp);
    const parts = rendered.match(/\d+/g).map(Number);
    const observed = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
    timestamp += intended - observed;
  }
  throw Object.assign(new Error(`${label} falls in a daylight-saving clock change. Choose another time.`), { status: 400 });
}

module.exports = { timeZone, dateInput, parseDateInput };
