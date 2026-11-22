// Shared logic used by both the browser and the server.
// Dates are always stored as 'YYYY-MM-DD' strings. Money is in rupees.

export const INSTITUTION_TYPES = [
  { id: 'bank', label: 'Bank', insurance: 'dicgc' },
  { id: 'coop_bank', label: 'Co-operative Bank', insurance: 'dicgc' },
  { id: 'sfb', label: 'Small Finance Bank', insurance: 'dicgc' },
  { id: 'patasanstha', label: 'Patasanstha (Credit Society)', insurance: 'none' },
  { id: 'post_office', label: 'Post Office', insurance: 'govt' },
  { id: 'nbfc', label: 'NBFC / Company FD', insurance: 'none' },
  { id: 'other', label: 'Other', insurance: 'unknown' },
];
export const typeLabel = (id) => (INSTITUTION_TYPES.find((t) => t.id === id) || INSTITUTION_TYPES.at(-1)).label;
export const typeInsurance = (id) => (INSTITUTION_TYPES.find((t) => t.id === id) || INSTITUTION_TYPES.at(-1)).insurance;

export const PAYOUTS = [
  { id: 'cumulative', label: 'At maturity (cumulative)' },
  { id: 'monthly', label: 'Paid monthly' },
  { id: 'quarterly', label: 'Paid quarterly' },
  { id: 'half_yearly', label: 'Paid half-yearly' },
  { id: 'yearly', label: 'Paid yearly' },
];
export const payoutLabel = (id) => (PAYOUTS.find((p) => p.id === id) || PAYOUTS[0]).label;

export const COMPOUNDING = [
  { id: 'quarterly', label: 'Quarterly (most banks)' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'half_yearly', label: 'Half-yearly' },
  { id: 'yearly', label: 'Yearly' },
  { id: 'simple', label: 'Simple interest' },
];

export const MODES = ['Single', 'Either or Survivor', 'Former or Survivor', 'Anyone or Survivor', 'Jointly'];

export const STATUSES = [
  { id: 'active', label: 'Active' },
  { id: 'renewed', label: 'Renewed' },
  { id: 'closed', label: 'Closed (money received)' },
];

export const DICGC_LIMIT = 500000;
export const SOON_DAYS = 30;

// ---------- dates ----------
const DAY = 86400000;
const pad = (n) => String(n).padStart(2, '0');
export const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
export const fromUTC = (t) => new Date(t).toISOString().slice(0, 10);
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && fromUTC(toUTC(s)) === s;
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY);
export const addDays = (iso, n) => fromUTC(toUTC(iso) + n * DAY);
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return fromUTC(Date.UTC(ny, nm, Math.min(d, last)));
}
const maxISO = (a, b) => (toUTC(a) >= toUTC(b) ? a : b);
const minISO = (a, b) => (toUTC(a) <= toUTC(b) ? a : b);

export function fyBounds(iso = todayISO()) {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return { from: `${start}-04-01`, to: `${start + 1}-03-31`, label: `FY ${start}-${pad((start + 1) % 100)}` };
}

// ---------- interest ----------
const PER_YEAR = { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 };

// Value of a cumulative FD on a given date (bank-style: simple interest under ~6 months,
// otherwise compounding per period plus simple interest for leftover days). An estimate.
export function accruedValue(fd, upto) {
  const P = Number(fd.amount) || 0;
  const r = (Number(fd.rate) || 0) / 100;
  if (!P || !isISO(fd.startDate) || !isISO(upto)) return P;
  let end = upto;
  if (isISO(fd.maturityDate)) end = minISO(end, fd.maturityDate);
  if (toUTC(end) <= toUTC(fd.startDate)) return P;
  const fullDays = isISO(fd.maturityDate) ? daysBetween(fd.startDate, fd.maturityDate) : daysBetween(fd.startDate, end);
  const comp = fd.compounding || 'quarterly';
  if (comp === 'simple' || fullDays < 181) return P * (1 + (r * daysBetween(fd.startDate, end)) / 365);
  const n = PER_YEAR[comp] || 4;
  const step = 12 / n;
  let v = P;
  let last = fd.startDate;
  for (let k = 1; k < 2000; k++) {
    const next = addMonths(fd.startDate, step * k);
    if (toUTC(next) > toUTC(end)) break;
    v *= 1 + r / n;
    last = next;
  }
  return v * (1 + (r * daysBetween(last, end)) / 365);
}

export function estimateMaturityAmount(fd) {
  const P = Number(fd.amount) || 0;
  if ((fd.interestPayout || 'cumulative') !== 'cumulative') return P;
  if (!isISO(fd.maturityDate)) return P;
  return Math.round(accruedValue(fd, fd.maturityDate));
}

export const maturityValue = (fd) => (Number(fd.maturityAmount) > 0 ? Number(fd.maturityAmount) : estimateMaturityAmount(fd));

export function periodicPayout(fd) {
  const n = PER_YEAR[fd.interestPayout];
  if (!n) return 0;
  return ((Number(fd.amount) || 0) * (Number(fd.rate) || 0)) / 100 / n;
}

// Interest earned between two dates (estimate), used for financial-year totals.
export function interestBetween(fd, from, to) {
  if (!isISO(fd.startDate) || !isISO(fd.maturityDate)) return 0;
  const a = maxISO(fd.startDate, from);
  const b = minISO(fd.maturityDate, to);
  if (toUTC(b) <= toUTC(a)) return 0;
  const P = Number(fd.amount) || 0;
  if ((fd.interestPayout || 'cumulative') !== 'cumulative') {
    return (P * (Number(fd.rate) || 0) * daysBetween(a, b)) / 100 / 365;
  }
  const est = accruedValue(fd, b) - accruedValue(fd, a);
  // If the receipt's maturity amount was typed in, scale our estimate to match it.
  const estTotal = estimateMaturityAmount(fd) - P;
  const actualTotal = maturityValue(fd) - P;
  return estTotal > 0 && actualTotal > 0 ? (est * actualTotal) / estTotal : est;
}

// 'due' = maturity date passed but FD still marked active; 'soon' = matures within 30 days.
export function effectiveStatus(fd, today = todayISO()) {
  if (fd.status && fd.status !== 'active') return fd.status;
  if (!isISO(fd.maturityDate)) return 'active';
  const left = daysBetween(today, fd.maturityDate);
  if (left < 0) return 'due';
  if (left <= SOON_DAYS) return 'soon';
  return 'active';
}

// ---------- formatting ----------
export function fmtINR(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return '₹' + Math.round(Number(n)).toLocaleString('en-IN');
}
export function fmtShort(n) {
  n = Number(n) || 0;
  const trim = (x) => x.toFixed(2).replace(/\.?0+$/, '');
  if (n >= 1e7) return `₹${trim(n / 1e7)} Cr`;
  if (n >= 1e5) return `₹${trim(n / 1e5)} L`;
  return fmtINR(n);
}
export const fmtRate = (r) => (r || r === 0 ? `${Number(r).toFixed(2).replace(/\.?0+$/, '')}%` : '—');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(iso) {
  if (!isISO(iso)) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
export const fmtMonth = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
export const monthShort = (iso) => MONTHS[Number(iso.split('-')[1]) - 1];
export function fmtDaysLeft(n) {
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n < 0) return `${-n} days ago`;
  if (n < 60) return `in ${n} days`;
  if (n < 730) return `in ${Math.round(n / 30.4)} months`;
  return `in ${(n / 365).toFixed(1).replace(/\.0$/, '')} years`;
}
export function tenureLabel(start, end) {
  if (!isISO(start) || !isISO(end)) return '—';
  let months = 0;
  while (toUTC(addMonths(start, months + 1)) <= toUTC(end)) months++;
  const days = daysBetween(addMonths(start, months), end);
  const parts = [];
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y) parts.push(`${y} yr`);
  if (m) parts.push(`${m} mo`);
  if (days) parts.push(`${days} day${days > 1 ? 's' : ''}`);
  return parts.join(' ') || '0 days';
}

// ---------- parsing messy input (Excel cells, handwriting) ----------
const DEV = '०१२३४५६७८९';
export const normDigits = (s) => String(s ?? '').replace(/[०-९]/g, (c) => String(DEV.indexOf(c)));

export function parseAmount(v) {
  if (typeof v === 'number') return v > 0 ? v : null;
  let s = normDigits(v).toLowerCase().replace(/rs\.?|inr|₹|\/-|,|\s|रु\.?|रुपये/g, '');
  if (!s) return null;
  let mult = 1;
  if (/(crores?|cr|कोटी)$/.test(s)) mult = 1e7;
  else if (/(lakhs?|lacs?|l|लाख)$/.test(s)) mult = 1e5;
  else if (/(k|thousand|हजार)$/.test(s)) mult = 1e3;
  const n = parseFloat(s.replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? Math.round(n * mult * 100) / 100 : null;
}

export function parseRate(v) {
  let n = typeof v === 'number' ? v : parseFloat(normDigits(v).replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1) n *= 100; // 0.075 written as a fraction
  return n < 30 ? Math.round(n * 100) / 100 : null;
}

const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  जानेवारी: 1, फेब्रुवारी: 2, मार्च: 3, एप्रिल: 4, मे: 5, जून: 6, जुलै: 7, ऑगस्ट: 8, सप्टेंबर: 9, ऑक्टोबर: 10, नोव्हेंबर: 11, डिसेंबर: 12,
};
const monthFromName = (s) => {
  const k = s.toLowerCase();
  return MONTH_NAMES[k] || MONTH_NAMES[k.slice(0, 3)] || null;
};
const mkDate = (y, m, d) => {
  y = Number(y);
  if (y < 100) y += y < 70 ? 2000 : 1900;
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isISO(iso) && y > 1970 && y < 2100 ? iso : null;
};

// Indian convention: 05/03/2025 means 5 March 2025.
export function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    if (v > 20000 && v < 80000) return fromUTC(Date.UTC(1899, 11, 30) + Math.round(v) * DAY); // Excel serial
    return null;
  }
  const s = normDigits(v).trim().replace(/\s+/g, ' ');
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return mkDate(m[1], m[2], m[3]);
  if ((m = s.match(/^(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{2,4})$/))) return mkDate(m[3], m[2], m[1]);
  if ((m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[-/ ,.]*([A-Za-zऀ-ॿ]{3,10})[-/ ,.]*(\d{2,4})$/))) {
    const mo = monthFromName(m[2]);
    return mo ? mkDate(m[3], mo, m[1]) : null;
  }
  if ((m = s.match(/^([A-Za-z]{3,10})[ .-]*(\d{1,2}),?[ ]*(\d{4})$/))) {
    const mo = monthFromName(m[1]);
    return mo ? mkDate(m[3], mo, m[2]) : null;
  }
  if (/^\d{5}$/.test(s)) return parseDate(Number(s));
  return null;
}

// "1 year", "18 months", "400 days", "1y 6m", "२ वर्ष"  -> { months, days }
export function parseTenure(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v > 0 ? { months: Math.round(v), days: 0 } : null;
  const s = normDigits(v).toLowerCase();
  let months = 0, days = 0, found = false;
  const re = /(\d+(?:\.\d+)?)\s*(years?|yrs?|y|वर्ष[ेां]*|months?|mon|mo|m|महिन[ेा]*|days?|d|दिवस)?/g;
  let mm;
  while ((mm = re.exec(s))) {
    if (!mm[1]) continue;
    const n = parseFloat(mm[1]);
    const u = mm[2] || 'm';
    found = true;
    if (/^(y|yr|year|वर्ष)/.test(u)) months += Math.round(n * 12);
    else if (/^(d|day|दिवस)/.test(u)) days += Math.round(n);
    else months += Math.round(n);
  }
  return found && (months || days) ? { months, days } : null;
}
export const applyTenure = (start, t) => (isISO(start) && t ? addDays(addMonths(start, t.months || 0), t.days || 0) : null);

export function parsePayout(v) {
  const s = String(v ?? '').toLowerCase();
  if (!s.trim()) return null;
  if (/half|सहामाही/.test(s)) return 'half_yearly';
  if (/quarter|त्रैमासिक|तिमाही|\bqtr/.test(s)) return 'quarterly';
  if (/month|मासिक|महिना/.test(s)) return 'monthly';
  if (/year|annual|वार्षिक/.test(s)) return 'yearly';
  if (/cumul|maturity|reinvest|मुदतीअंती|मुदतीनंतर/.test(s)) return 'cumulative';
  return null;
}

export function parseYesNo(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/^(y|yes|true|1|हो|होय|auto)/.test(s)) return true;
  if (/^(n|no|false|0|नाही)/.test(s)) return false;
  return null;
}

export function guessType(name) {
  const s = String(name ?? '').toLowerCase();
  if (!s.trim()) return null;
  if (/pat\s*-?\s*sanst|patsanst|patasanst|पतसंस्था|pat\s*pedhi|पतपेढी|credit\s*(co-?op\w*)?\s*soc/.test(s)) return 'patasanstha';
  if (/small\s*finance/.test(s)) return 'sfb';
  if (/post\b|पोस्ट|india post/.test(s)) return 'post_office';
  if (/sahakari\s*bank|सहकारी\s*बँक|co-?op(erative)?\.?\s*bank|urban\s*(co-?op\w*\s*)?bank|nagari\s*(sahakari\s*)?bank/.test(s)) return 'coop_bank';
  if (/bajaj|shriram|mahindra\s*fin|finance\s*(ltd|limited)|housing\s*fin/.test(s)) return 'nbfc';
  if (/bank|बँक|\bsbi\b|hdfc|icici|axis|kotak|\bbob\b|\bboi\b|\bpnb\b|canara|union|idbi|maharashtra|indusind|yes\s*bank|federal/.test(s)) return 'bank';
  return null;
}

// Match a written name ("Smt. Sunita Patil", "S. Patil") to a family member.
const TITLES = /^(shri|shree|smt|sau|mr|mrs|ms|kum|km|dr|late|श्री|श्रीमती|सौ|कु)\.?$/;
const tokens = (s) => String(s ?? '').toLowerCase().replace(/[^a-zऀ-ॿ\s.]/g, ' ').split(/[\s.]+/).filter((t) => t && !TITLES.test(t));
export function matchPerson(name, people) {
  const a = tokens(name);
  if (!a.length) return null;
  let best = null, bestScore = 0, tie = false;
  for (const p of people) {
    const b = tokens(p.name);
    if (a.join(' ') === b.join(' ')) return p;
    let score = 0;
    for (const t of a) {
      if (b.includes(t)) score += 2;
      else if (t.length === 1 && b.some((x) => x[0] === t)) score += 1;
      else if (t.length > 3 && b.some((x) => x.length > 3 && (x.startsWith(t) || t.startsWith(x)))) score += 1.5;
    }
    if (score > bestScore) { bestScore = score; best = p; tie = false; }
    else if (score === bestScore && score > 0) tie = true;
  }
  return bestScore >= 2 && !tie ? best : null;
}
