// Excel / CSV import & export, done entirely on the phone. ExcelJS is bundled (vendor/) and loaded only when needed.
import {
  typeLabel, payoutLabel, maturityValue, fmtINR, INSTITUTION_TYPES, PAYOUTS, MODES, todayISO, daysBetween, addDays,
} from './calc.js';

let loading;
function excelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('../vendor/exceljs.min.js', import.meta.url).href;
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => { loading = null; reject(new Error('Could not load the Excel reader.')); };
    document.head.append(s);
  });
  return loading;
}

export const COLUMNS = [
  { key: 'holder', header: 'Holder Name', width: 22 },
  { key: 'jointHolders', header: 'Joint Holders', width: 22 },
  { key: 'mode', header: 'Mode of Operation', width: 20 },
  { key: 'institutionName', header: 'Bank / Institution', width: 30 },
  { key: 'institutionType', header: 'Institution Type', width: 26 },
  { key: 'branch', header: 'Branch', width: 16 },
  { key: 'fdNumber', header: 'FD / Receipt No', width: 18 },
  { key: 'amount', header: 'Amount', width: 14 },
  { key: 'rate', header: 'Interest Rate (%)', width: 12 },
  { key: 'startDate', header: 'Start Date', width: 14 },
  { key: 'maturityDate', header: 'Maturity Date', width: 14 },
  { key: 'interestPayout', header: 'Interest Payout', width: 22 },
  { key: 'maturityAmount', header: 'Maturity Amount', width: 16 },
  { key: 'autoRenew', header: 'Auto Renew', width: 10 },
  { key: 'nomineeName', header: 'Nominee Name', width: 22 },
  { key: 'nomineeRelation', header: 'Nominee Relation', width: 16 },
  { key: 'nomineeShare', header: 'Nominee Share (%)', width: 12 },
  { key: 'status', header: 'Status', width: 12 },
  { key: 'notes', header: 'Notes', width: 30 },
  { key: 'meantFor', header: 'Meant For', width: 22 },
  { key: 'purpose', header: 'Purpose', width: 26 },
];

// Header words (English + Marathi) that hint which field a column holds.
const SYNONYMS = {
  holder: ['holder', 'name', 'depositor', 'account holder', 'first holder', 'investor', 'नाव', 'ठेवीदार'],
  jointHolders: ['joint', 'second holder', 'संयुक्त'],
  mode: ['mode', 'operation'],
  institutionName: ['bank', 'institution', 'patsanstha', 'patasanstha', 'society', 'company', 'बँक', 'संस्था', 'पतसंस्था'],
  institutionType: ['type', 'institution type', 'प्रकार'],
  branch: ['branch', 'शाखा'],
  fdNumber: ['fd no', 'fd number', 'receipt', 'account no', 'a/c', 'certificate', 'पावती', 'खाते'],
  amount: ['amount', 'principal', 'deposit', 'invested', 'रक्कम', 'ठेव रक्कम'],
  rate: ['rate', 'interest', 'roi', '%', 'व्याज', 'व्याजदर'],
  startDate: ['start', 'deposit date', 'opening', 'open date', 'date of deposit', 'issue', 'from', 'दिनांक', 'ठेव दिनांक'],
  maturityDate: ['maturity date', 'due date', 'maturity', 'mat date', 'to', 'मुदत संपण्याची', 'परिपक्वता'],
  tenure: ['tenure', 'period', 'term', 'duration', 'मुदत', 'कालावधी'],
  interestPayout: ['payout', 'interest payment', 'scheme', 'cumulative'],
  maturityAmount: ['maturity amount', 'maturity value', 'mat amount', 'मुदतीअंती रक्कम'],
  autoRenew: ['renew', 'auto renew'],
  nomineeName: ['nominee', 'nomination', 'वारस', 'नॉमिनी'],
  nomineeRelation: ['relation', 'नाते'],
  nomineeShare: ['share'],
  status: ['status', 'स्थिती'],
  notes: ['note', 'remark', 'comment', 'शेरा'],
  meantFor: ['meant for', 'intended for', 'intended', 'for whom', 'kept for', 'beneficiary', 'कोणासाठी', 'लाभार्थी'],
  purpose: ['purpose', 'goal', 'reason', 'उद्देश', 'हेतू'],
};

function scoreHeader(h, key) {
  const s = h.toLowerCase().replace(/\s+/g, ' ').trim();
  let best = 0;
  for (const w of SYNONYMS[key]) {
    if (s === w) best = Math.max(best, 100 + w.length);
    else if (w.length > 2 && s.includes(w)) best = Math.max(best, 10 + w.length);
  }
  return best;
}

export function suggestMapping(headers) {
  const pairs = [];
  headers.forEach((h, i) => {
    for (const key of Object.keys(SYNONYMS)) {
      const sc = scoreHeader(h || '', key);
      if (sc) pairs.push({ i, key, sc });
    }
  });
  pairs.sort((a, b) => b.sc - a.sc);
  const mapping = headers.map(() => '');
  const used = new Set();
  for (const p of pairs) {
    if (mapping[p.i] || used.has(p.key)) continue;
    mapping[p.i] = p.key;
    used.add(p.key);
  }
  return mapping;
}

function cellValue(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellValue(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
    return '';
  }
  return v;
}

// Small RFC-4180 CSV reader (handles quotes, commas and new lines inside quotes).
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const sep = (text.split('\n')[0].match(/;/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => v.trim()));
}

export async function parseSpreadsheet(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  let grid = [], sheet = 'CSV';
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new Error('This is an old .xls file. Please open it in Excel and "Save As" .xlsx (or CSV), then try again.');
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const ExcelJS = await excelJS();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf.buffer);
    const sheets = wb.worksheets.filter((ws) => ws.actualRowCount > 1 && !/instruction|help|readme/i.test(ws.name));
    const ws = sheets.sort((a, b) => b.actualRowCount - a.actualRowCount)[0];
    if (!ws) throw new Error('No rows found in this file.');
    sheet = ws.name;
    ws.eachRow({ includeEmpty: false }, (row) => {
      const vals = [];
      for (let c = 1; c <= ws.columnCount; c++) vals.push(cellValue(row.getCell(c).value));
      grid.push(vals);
    });
  } else {
    grid = parseCsv(new TextDecoder().decode(buf));
  }
  grid = grid.filter((r) => r.some((v) => String(v).trim()));
  if (grid.length < 2) throw new Error('No rows found in this file.');
  let hi = grid.slice(0, 10).findIndex((r) => r.filter((v) => typeof v === 'string' && v.trim() && !/^\d/.test(v)).length >= 3);
  if (hi < 0) hi = 0;
  const width = Math.max(...grid.map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => String(grid[hi][i] ?? '').trim() || `Column ${i + 1}`);
  const rows = grid.slice(hi + 1).slice(0, 500);
  const keep = headers.map((h, i) => !/^Column \d+$/.test(h) || rows.some((r) => String(r[i] ?? '').trim()));
  const H = headers.filter((_, i) => keep[i]);
  const R = rows.map((r) => r.filter((_, i) => keep[i]));
  return { sheet, headers: H, rows: R, mapping: suggestMapping(H) };
}

async function buildWorkbook(rows, withInstructions) {
  const ExcelJS = await excelJS();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FD Tracker';
  const ws = wb.addWorksheet('FDs', { views: [{ state: 'frozen', ySplit: 1 }] });
  const extra = withInstructions ? [] : [{ key: 'daysLeft', header: 'Days Left', width: 10 }];
  ws.columns = [...COLUMNS, ...extra].map((c) => ({ key: c.key, header: c.header, width: c.width }));
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F0EE' } };
  rows.forEach((r) => ws.addRow(r));
  for (const key of ['startDate', 'maturityDate']) ws.getColumn(key).numFmt = 'dd-mmm-yyyy';
  for (const key of ['amount', 'maturityAmount']) ws.getColumn(key).numFmt = '#,##,##0';
  const list = (arr) => ({ type: 'list', allowBlank: true, formulae: [`"${arr.join(',')}"`] });
  for (let i = 2; i <= Math.max(rows.length + 100, 200); i++) {
    ws.getCell(i, 5).dataValidation = list(INSTITUTION_TYPES.map((t) => t.label.replace(/[(),]/g, '')));
    ws.getCell(i, 12).dataValidation = list(PAYOUTS.map((p) => p.label.replace(/[(),]/g, '')));
    ws.getCell(i, 3).dataValidation = list(MODES);
    ws.getCell(i, 14).dataValidation = list(['Yes', 'No']);
  }
  if (withInstructions) {
    const help = wb.addWorksheet('Instructions');
    help.getColumn(1).width = 110;
    [
      'How to fill the FDs sheet',
      '',
      '• One row per FD. Only these are needed: Holder Name, Bank / Institution, Amount, Interest Rate, Start Date, Maturity Date.',
      '• Dates: type as DD/MM/YYYY (e.g. 15/04/2025).',
      '• Amount: plain number, e.g. 100000 (commas are fine).',
      '• Institution Type: pick from the list (Bank, Co-operative Bank, Patasanstha, Post Office ...). If left empty, the app guesses from the name.',
      '• Joint Holders / Nominees: separate multiple names with ;  e.g.  Sunita Patil; Rahul Patil',
      '• Meant For: if the FD is in one person\'s name but kept for someone else, write that person\'s name here. Leave empty if it is for the holder.',
      '• Marathi is fine for names and notes.',
      '• Delete the example row before importing.',
    ].forEach((t, i) => {
      const c = help.getCell(i + 1, 1);
      c.value = t;
      if (i === 0) c.font = { bold: true, size: 14 };
    });
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

const xlDate = (iso) => (iso ? new Date(iso + 'T00:00:00Z') : null);

export function templateXlsx() {
  return buildWorkbook([{
    holder: 'Ramesh Patil', jointHolders: 'Sunita Patil', mode: 'Either or Survivor', institutionName: 'Example Nagari Sahakari Patsanstha',
    institutionType: 'Patasanstha Credit Society', branch: 'Main', fdNumber: '12345', amount: 100000, rate: 8.5,
    startDate: xlDate('2025-04-15'), maturityDate: xlDate('2026-04-15'), interestPayout: 'At maturity cumulative', maturityAmount: '',
    autoRenew: 'No', nomineeName: 'Rahul Patil', nomineeRelation: 'Son', nomineeShare: 100, status: 'Active', notes: 'Example row – delete me',
    meantFor: 'Rahul Patil', purpose: 'Education',
  }], true);
}

export function exportXlsx(fds, personName) {
  const today = todayISO();
  const rows = [...fds]
    .sort((a, b) => (a.maturityDate || '').localeCompare(b.maturityDate || ''))
    .map((fd) => ({
      holder: personName(fd.holderId),
      jointHolders: fd.jointHolderIds.map(personName).join('; '),
      mode: fd.mode,
      institutionName: fd.institutionName,
      institutionType: typeLabel(fd.institutionType),
      branch: fd.branch,
      fdNumber: fd.fdNumber,
      amount: fd.amount,
      rate: fd.rate,
      startDate: xlDate(fd.startDate),
      maturityDate: xlDate(fd.maturityDate),
      interestPayout: payoutLabel(fd.interestPayout),
      maturityAmount: Math.round(maturityValue(fd)),
      autoRenew: fd.autoRenew ? 'Yes' : 'No',
      nomineeName: fd.nominees.map((n) => n.name).join('; '),
      nomineeRelation: fd.nominees.map((n) => n.relation).join('; '),
      nomineeShare: fd.nominees.map((n) => n.share ?? '').join('; '),
      status: fd.status === 'active' ? 'Active' : fd.status === 'renewed' ? 'Renewed' : 'Closed',
      notes: fd.notes,
      meantFor: fd.intendedForId && fd.intendedForId !== fd.holderId ? personName(fd.intendedForId) : '',
      purpose: fd.purpose || '',
      daysLeft: fd.status === 'active' && fd.maturityDate ? daysBetween(today, fd.maturityDate) : '',
    }));
  return buildWorkbook(rows, false);
}

// ---------- calendar (.ics) with reminders 30 and 7 days before ----------
const icsEscape = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
export function calendarIcs(fds, personName) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FD Tracker//EN', 'CALSCALE:GREGORIAN'];
  for (const fd of fds.filter((f) => f.status === 'active' && f.maturityDate)) {
    const title = `FD matures: ${fd.institutionName} – ${fmtINR(fd.amount)} (${personName(fd.holderId)})`;
    lines.push(
      'BEGIN:VEVENT', `UID:fd-${fd.id}@fd-tracker`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${fd.maturityDate.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(fd.maturityDate, 1).replace(/-/g, '')}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(`FD No: ${fd.fdNumber || '-'}\nRate: ${fd.rate}%\nDecide: renew or withdraw.`)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, 'TRIGGER:-P30D', 'END:VALARM',
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, 'TRIGGER:-P7D', 'END:VALARM',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return new Blob([lines.join('\r\n')], { type: 'text/calendar' });
}
