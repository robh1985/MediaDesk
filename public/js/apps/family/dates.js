// Dates for the Family Organizer: days as "YYYY-MM-DD" strings in local time, repeating events
// (the iCalendar RRULE subset that calendar services use) and repeating chores.

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMonths = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth() + n, 1); x.setDate(Math.min(d.getDate(), daysIn(x.getFullYear(), x.getMonth()))); return x; };
export const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
export const daysIn = (y, m) => new Date(y, m + 1, 0).getDate();
export const startOfWeek = (d, weekStart = 0) => addDays(startOfDay(d), -((d.getDay() - weekStart + 7) % 7));
export const dayDiff = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);
export const todayYmd = () => ymd(new Date());

export const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(/\s?([AP])\.?M\.?/i, (_, x) => x.toLowerCase() + 'm');
export const fmtDate = (d, opts = { weekday: 'long', month: 'long', day: 'numeric' }) => d.toLocaleDateString(undefined, opts);
export const fmtRange = (o) => (o.allDay ? 'All day' : `${fmtTime(o.start)} – ${fmtTime(o.end)}`);

// When an event starts and ends, as dates. All-day events run to the end of their last day.
export function eventSpan(ev) {
  if (ev.allDay) {
    const start = parseYmd(ev.start);
    return { start, end: addDays(parseYmd(ev.end || ev.start), 1) };
  }
  const start = new Date(ev.start);
  const end = new Date(ev.end || ev.start);
  return { start, end: end > start ? end : new Date(start.getTime() + 30 * 60e3) };
}

const occKey = (ev, d) => (ev.allDay ? ymd(d) : d.toISOString());

function dayMatches(date, rule, monthDays) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const dom = date.getDate();
  if (rule.bymonthday?.length) return rule.bymonthday.some((n) => (n > 0 ? n === dom : daysIn(y, m) + n + 1 === dom));
  if (!rule.byday?.length) return dom === monthDays;
  return rule.byday.some((code) => {
    const mm = /^([-+]?\d+)?([A-Z]{2})$/.exec(code);
    if (!mm || WEEKDAYS.indexOf(mm[2]) !== date.getDay()) return false;
    if (!mm[1]) return true;
    const n = Number(mm[1]);
    const nth = Math.ceil(dom / 7);
    const fromEnd = Math.ceil((daysIn(y, m) - dom + 1) / 7);
    return n > 0 ? n === nth : -n === fromEnd;
  });
}

// The dates (at the event's time of day) a repeating event falls on in one period.
function periodCandidates(rule, base, k) {
  const step = k * rule.interval;
  const at = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), base.getHours(), base.getMinutes(), base.getSeconds());
  if (rule.freq === 'daily') return [at(addDays(base, step))];
  if (rule.freq === 'weekly') {
    const week = addDays(startOfWeek(base, 1), step * 7);
    const days = rule.byday?.length ? rule.byday.map((c) => WEEKDAYS.indexOf(c.slice(-2))).filter((i) => i >= 0) : [base.getDay()];
    return [...new Set(days)].map((i) => at(addDays(week, (i + 6) % 7))).sort((a, b) => a - b);
  }
  const months = [];
  if (rule.freq === 'monthly') months.push(new Date(base.getFullYear(), base.getMonth() + step, 1));
  else {
    const list = rule.bymonth?.length ? rule.bymonth : [base.getMonth() + 1];
    for (const mo of list) months.push(new Date(base.getFullYear() + step, mo - 1, 1));
  }
  const out = [];
  for (const first of months) {
    const days = [];
    for (let d = 1; d <= daysIn(first.getFullYear(), first.getMonth()); d++) {
      const date = new Date(first.getFullYear(), first.getMonth(), d);
      if (dayMatches(date, rule, base.getDate())) days.push(at(date));
    }
    if (rule.bysetpos?.length) out.push(...rule.bysetpos.map((p) => days[p > 0 ? p - 1 : days.length + p]).filter(Boolean));
    else out.push(...days);
  }
  return out.sort((a, b) => a - b);
}

// Every time an event happens that overlaps from..to: [{ ev, start, end, key }].
export function expand(ev, from, to) {
  const span = eventSpan(ev);
  const dur = span.end - span.start;
  const out = [];
  const push = (start) => {
    const end = ev.allDay ? addDays(start, dayDiff(span.start, span.end)) : new Date(start.getTime() + dur);
    if (end > from && start < to) out.push({ ev, start, end, allDay: Boolean(ev.allDay), key: `${ev.id}|${occKey(ev, start)}` });
  };
  const rule = ev.rrule;
  if (!rule || !rule.freq) { push(span.start); return out; }
  const r = { interval: 1, ...rule };
  const ex = new Set(ev.exdates || []);
  const until = r.until ? (/^\d{4}-\d{2}-\d{2}$/.test(r.until) ? addDays(parseYmd(r.until), 1) : new Date(r.until)) : null;
  let n = 0;
  for (let k = 0; k < 20000; k++) {
    const cands = periodCandidates(r, span.start, k);
    if (!cands.length && r.freq !== 'yearly' && r.freq !== 'monthly') break;
    let stop = false;
    for (const c of cands) {
      if (c < span.start) continue;
      if ((until && c > until) || c >= to) { stop = true; break; }
      n++;
      if (r.count && n > r.count) { stop = true; break; }
      if (!ex.has(occKey(ev, c))) push(c);
    }
    if (stop) break;
    if (r.freq === 'yearly' && k > 400) break;
  }
  return out;
}

// "Every 2 weeks on Tue, Thu", for the event editor and details.
export function describeRule(r, start) {
  if (!r) return 'Does not repeat';
  const every = (unit) => (r.interval > 1 ? `Every ${r.interval} ${unit}s` : `Every ${unit}`);
  let s;
  if (r.freq === 'daily') s = r.interval > 1 ? every('day') : 'Every day';
  else if (r.freq === 'weekly') {
    const days = (r.byday?.length ? r.byday : [WEEKDAYS[start.getDay()]]).map((c) => DAY_SHORT[WEEKDAYS.indexOf(c.slice(-2))]);
    s = days.length === 5 && !days.includes('Sat') && !days.includes('Sun') && r.interval === 1 ? 'Every weekday' : `${every('week')} on ${days.join(', ')}`;
  } else if (r.freq === 'monthly') {
    const c = r.byday?.[0];
    if (c) {
      const m = /^([-+]?\d+)?([A-Z]{2})$/.exec(c);
      const ord = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth', '-1': 'last' }[m?.[1]] || '';
      s = `${every('month')} on the ${ord} ${DAY_NAMES[WEEKDAYS.indexOf(m?.[2])]}`;
    } else s = `${every('month')} on day ${r.bymonthday?.[0] || start.getDate()}`;
  } else s = `${r.interval > 1 ? every('year') : 'Every year'} on ${fmtDate(start, { month: 'long', day: 'numeric' })}`;
  if (r.count) s += `, ${r.count} times`;
  else if (r.until) s += `, until ${fmtDate(new Date(/T/.test(r.until) ? r.until : `${r.until}T12:00`), { month: 'short', day: 'numeric', year: 'numeric' })}`;
  return s;
}

// Chores repeat more simply: every day, on chosen weekdays, every few days, monthly or once.
export function choreDue(chore, date) {
  const r = chore.repeat || { kind: 'daily' };
  const d = typeof date === 'string' ? parseYmd(date) : date;
  const key = ymd(d);
  if (chore.start && key < chore.start) return false;
  if (chore.until && key > chore.until) return false;
  switch (r.kind) {
    case 'once': return r.date === key;
    case 'weekly': return (r.days || []).includes(d.getDay());
    case 'every': return dayDiff(parseYmd(r.from || chore.start || key), d) % Math.max(1, r.n || 1) === 0 && key >= (r.from || '');
    case 'monthly': return d.getDate() === Math.min(r.day || 1, daysIn(d.getFullYear(), d.getMonth()));
    default: return true;
  }
}

export function describeChoreRepeat(r = { kind: 'daily' }) {
  switch (r.kind) {
    case 'once': return `Once, ${fmtDate(parseYmd(r.date), { weekday: 'short', month: 'short', day: 'numeric' })}`;
    case 'weekly': {
      const days = [...(r.days || [])].sort();
      if (days.length === 7) return 'Every day';
      if (days.join() === '1,2,3,4,5') return 'Weekdays';
      if (days.join() === '0,6') return 'Weekends';
      return days.map((i) => DAY_SHORT[i]).join(', ') || 'Never';
    }
    case 'every': return `Every ${r.n} days`;
    case 'monthly': return `Monthly on day ${r.day}`;
    default: return 'Every day';
  }
}

// Part of the day, for routines.
export const PARTS = [
  { id: 'morning', label: 'Morning', emoji: '🌅', until: 12 },
  { id: 'afternoon', label: 'Afternoon', emoji: '☀️', until: 17 },
  { id: 'evening', label: 'Evening', emoji: '🌙', until: 24 },
];
export const currentPart = (d = new Date()) => PARTS.find((p) => d.getHours() < p.until).id;

// Quick add: "Soccer practice every Tuesday 4:30-6pm", "Dentist tomorrow at 3pm for 1 hour",
// "Grandma's birthday May 3 every year", "Trip Jun 12 - Jun 15". Returns an event draft.
export function parseQuickAdd(text, now = new Date()) {
  let s = ` ${String(text).trim()} `;
  const take = (re) => { const m = re.exec(s); if (m) s = s.replace(m[0], ' '); return m; };
  const draft = { allDay: true, rrule: null };
  let day = null;
  let endDay = null;
  const monthRe = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const monthIdx = (m) => ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m.slice(0, 3).toLowerCase());
  const dayRe = '(sun|mon|tue|wed|thu|fri|sat)[a-z]*';
  const nextDow = (i, skipToday = false) => { const d = startOfDay(now); let n = (i - d.getDay() + 7) % 7; if (n === 0 && skipToday) n = 7; return addDays(d, n); };
  const mkDate = (mi, dd, yy) => {
    let d = new Date(yy ? Number(yy.length === 2 ? `20${yy}` : yy) : now.getFullYear(), mi, Number(dd));
    if (!yy && d < startOfDay(now)) d = new Date(d.getFullYear() + 1, mi, Number(dd));
    return d;
  };

  // Repeats
  let m = take(new RegExp(`\\b(?:every|each)\\s+((?:${dayRe}(?:\\s*(?:,|and|&)\\s*)?)+)`, 'i'));
  if (m) {
    const codes = [...m[1].matchAll(new RegExp(dayRe, 'gi'))].map((x) => WEEKDAYS[['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(x[1].toLowerCase())]);
    draft.rrule = { freq: 'weekly', interval: 1, byday: codes };
    day = nextDow(WEEKDAYS.indexOf(codes[0]));
  } else if ((m = take(/\b(?:every|each)\s+(weekday)s?\b/i))) {
    draft.rrule = { freq: 'weekly', interval: 1, byday: ['MO', 'TU', 'WE', 'TH', 'FR'] };
  } else if ((m = take(/\bevery\s+(?:(other|\d+)\s+)?(day|week|month|year)s?\b|\b(daily|weekly|monthly|yearly|annually)\b/i))) {
    const freq = m[2] ? { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[m[2].toLowerCase()] : m[3].toLowerCase() === 'annually' ? 'yearly' : m[3].toLowerCase();
    draft.rrule = { freq, interval: m[1] === 'other' ? 2 : Number(m[1]) || 1 };
  }

  // Dates
  if ((m = take(new RegExp(`\\b${monthRe}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?:\\s*(?:-|–|to|until|through)\\s*(?:${monthRe}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?\\b`, 'i')))) {
    day = mkDate(monthIdx(m[1]), m[2], m[3]);
    if (m[5]) endDay = new Date(day.getFullYear(), m[4] ? monthIdx(m[4]) : day.getMonth(), Number(m[5]));
  } else if ((m = take(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${monthRe}(?:,?\\s+(\\d{4}))?\\b`, 'i')))) {
    day = mkDate(monthIdx(m[2]), m[1], m[3]);
  } else if ((m = take(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/))) {
    day = mkDate(Number(m[1]) - 1, m[2], m[3]);
  } else if ((m = take(/\b(today|tonight)\b/i))) day = startOfDay(now);
  else if ((m = take(/\btomorrow\b/i))) day = addDays(startOfDay(now), 1);
  else if ((m = take(new RegExp(`\\b(?:on\\s+)?(next\\s+)?${dayRe}\\b`, 'i')))) {
    day = nextDow(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(m[2].toLowerCase()), Boolean(m[1]));
    if (m[1] && dayDiff(now, day) < 7) day = addDays(day, 7);
  } else if ((m = take(/\bin\s+(\d+)\s+(day|week)s?\b/i))) day = addDays(startOfDay(now), Number(m[1]) * (m[2].toLowerCase() === 'week' ? 7 : 1));

  // Times
  const t = '(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a|p)?';
  let start = null;
  let end = null;
  const hour = (hh, mm, ap, hint) => {
    let hr = Number(hh) % 24;
    const a = (ap || hint || '').toLowerCase()[0];
    if (a === 'p' && hr < 12) hr += 12;
    if (a === 'a' && hr === 12) hr = 0;
    if (!a && hr >= 1 && hr <= 6) hr += 12;
    return [hr, Number(mm || 0)];
  };
  const range = new RegExp(`\\b(?:at\\s+|from\\s+)?${t}\\s*(?:-|–|to|until)\\s*${t}\\b`, 'i').exec(s);
  if (range && (range[3] || range[6] || range[2] || range[5]) && (m = take(new RegExp(range[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))))) {
    m = range;
    start = hour(m[1], m[2], m[3], m[6]);
    end = hour(m[4], m[5], m[6]);
  } else if ((m = take(new RegExp(`\\b(?:at|@)\\s*${t}\\b|\\b${t.replace('?\\s*(am|pm|a|p)?', '?\\s*(am|pm)')}\\b`, 'i')))) {
    start = m[1] ? hour(m[1], m[2], m[3]) : hour(m[4], m[5], m[6]);
  } else if ((m = take(/\b(noon|midday)\b/i))) start = [12, 0];
  else if ((m = take(/\b(midnight)\b/i))) start = [0, 0];
  if (/\btonight\b/i.test(text) && !start) start = [19, 0];
  let durMin = null;
  if ((m = take(/\bfor\s+(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/i))) durMin = Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1);

  const d0 = day || (draft.rrule?.byday ? nextDow(WEEKDAYS.indexOf(draft.rrule.byday[0])) : startOfDay(now));
  if (start) {
    draft.allDay = false;
    const st = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), start[0], start[1]);
    let en = end ? new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), end[0], end[1]) : new Date(st.getTime() + (durMin || 60) * 60e3);
    if (en <= st) en = new Date(en.getTime() + 864e5);
    draft.start = st.toISOString();
    draft.end = en.toISOString();
  } else {
    draft.start = ymd(d0);
    draft.end = ymd(endDay && endDay >= d0 ? endDay : d0);
  }
  draft.title = s.replace(/\s+(on|at|from|for|in|every)\s*$/i, ' ').replace(/^\s*(on|at)\s+/i, ' ').replace(/\s+/g, ' ').trim() || 'New event';
  return draft;
}
