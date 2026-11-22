import { state, esc, icon, reload, toast, go, pickFile, personName, alertBox, shareOrDownload } from '../ui.js';
import * as db from '../db.js';
import { parseSpreadsheet, templateXlsx } from '../excel.js';
import {
  parseAmount, parseRate, parseDate, parseTenure, applyTenure, parsePayout, parseYesNo, guessType, matchPerson,
  INSTITUTION_TYPES, fmtINR, fmtRate, fmtDate, isISO,
} from '../calc.js';
import { blankDraft, fdEditor, draftErrors, toPayload } from './form.js';

// ---------- choose how to add ----------
export function renderChoice({ root }) {
  root.innerHTML = `
    <div class="page-head"><div><h1>Add FDs</h1><p class="sub">Choose the easiest way for you.</p></div></div>
    <div class="stack">
      <a class="card big-choice" href="#/add/manual"><div class="ic">${icon('pen')}</div>
        <div style="flex:1"><h2>Type it in</h2><p class="ink2">Fill a simple form for one FD.</p></div>${icon('chevron')}</a>
      <a class="card big-choice" href="#/add/excel"><div class="ic">${icon('sheet')}</div>
        <div style="flex:1"><h2>From an Excel file</h2><p class="ink2">Bring in many FDs at once from a spreadsheet.</p></div>${icon('chevron')}</a>
    </div>`;
}

// ---------- turning loose values into drafts ----------
const FIELD_LABELS = [
  ['', "Don't use this column"], ['holder', 'Holder name'], ['jointHolders', 'Joint holders'], ['mode', 'Mode of operation'],
  ['institutionName', 'Bank / institution'], ['institutionType', 'Institution type'], ['branch', 'Branch'], ['fdNumber', 'FD / receipt no.'],
  ['amount', 'Amount'], ['rate', 'Interest rate'], ['startDate', 'Start date'], ['maturityDate', 'Maturity date'], ['tenure', 'Period / tenure'],
  ['interestPayout', 'Interest payout'], ['maturityAmount', 'Maturity amount'], ['autoRenew', 'Auto renew'],
  ['nomineeName', 'Nominee name'], ['nomineeRelation', 'Nominee relation'], ['nomineeShare', 'Nominee share %'], ['status', 'Status'], ['notes', 'Notes'],
];

const splitList = (v) => String(v ?? '').split(/\s*(?:;|\n|\/|&|,|\band\b)\s*/i).map((s) => s.trim()).filter(Boolean);
const instKey = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

function parseType(v, name) {
  const s = String(v ?? '').toLowerCase().trim();
  if (s) {
    const hit = INSTITUTION_TYPES.find((t) => s === t.id || s === t.label.toLowerCase() || t.label.toLowerCase().replace(/[(),]/g, '').startsWith(s.replace(/[(),]/g, '')));
    if (hit) return hit.id;
    const g = guessType(s) || (/co-?op/.test(s) ? 'coop_bank' : /post/.test(s) ? 'post_office' : null);
    if (g) return g;
  }
  return guessType(name) || '';
}

function makeDraft(f, ctx) {
  const d = blankDraft();
  const personFor = (name) => {
    name = String(name || '').trim();
    if (!name) return '';
    const p = matchPerson(name, state.people);
    if (p) return p.id;
    const key = name.replace(/\s+/g, ' ');
    const existing = ctx.newPeople.find((n) => n.toLowerCase() === key.toLowerCase());
    if (!existing) ctx.newPeople.push(key);
    return `new:${existing || key}`;
  };
  d.holderId = personFor(f.holder);
  d.jointHolderIds = splitList(f.jointHolders).map(personFor).filter((id) => id && id !== d.holderId);
  if (d.jointHolderIds.length) d.mode = ['Either or Survivor', 'Former or Survivor', 'Anyone or Survivor', 'Jointly'].find((m) => String(f.mode || '').toLowerCase().startsWith(m.slice(0, 5).toLowerCase())) || 'Either or Survivor';
  d.institutionName = String(f.institutionName || '').trim();
  d.institutionType = parseType(f.institutionType, d.institutionName);
  d.branch = String(f.branch || '').trim();
  d.fdNumber = String(f.fdNumber || '').trim();
  d.amount = parseAmount(f.amount) ?? '';
  d.rate = parseRate(f.rate) ?? '';
  d.startDate = parseDate(f.startDate) || '';
  d.maturityDate = parseDate(f.maturityDate) || '';
  if (!d.maturityDate && d.startDate) d.maturityDate = applyTenure(d.startDate, parseTenure(f.tenure)) || '';
  d.interestPayout = parsePayout(f.interestPayout) || 'cumulative';
  d.maturityAmount = parseAmount(f.maturityAmount) ?? '';
  d.autoRenew = parseYesNo(f.autoRenew) === true;
  const names = String(f.nomineeName || '').split(/\s*[;\n]\s*/).filter(Boolean);
  const rels = String(f.nomineeRelation || '').split(/\s*[;\n]\s*/);
  const shares = String(f.nomineeShare ?? '').split(/\s*[;\n]\s*/);
  const yn = parseYesNo(f.nomineeName);
  d.nominees = yn === null ? names.map((n, i) => ({ name: n, relation: rels[i] || '', share: parseFloat(shares[i]) || '' })) : [];
  d.hasNominee = d.nominees.length > 0 || yn === true;
  d.status = /clos|withdraw|paid|बंद|renew/i.test(String(f.status || '')) ? 'closed' : 'active';
  d.notes = String(f.notes || '').trim();
  d.source = ctx.source;
  // Possible duplicate of something already saved?
  d.dupOf = state.fds.find((x) =>
    (d.fdNumber && x.fdNumber && x.fdNumber === d.fdNumber && instKey(x.institutionName) === instKey(d.institutionName)) ||
    (x.amount === d.amount && x.startDate === d.startDate && x.holderId === d.holderId && instKey(x.institutionName) === instKey(d.institutionName)))?.id || null;
  d.include = !d.dupOf;
  return d;
}

// ---------- review step ----------
function review(root, drafts, ctx, { title, back }) {
  const extra = () => ctx.newPeople.map((n) => ({ id: `new:${n}`, name: `${n} (new)` }));
  const nameOf = (id) => (id?.startsWith('new:') ? `${id.slice(4)} (new)` : id ? personName(id) : '');
  let open = -1;

  root.innerHTML = `
    <a class="back" href="${back}">${icon('back')} Back</a>
    <div class="page-head"><div><h1>${esc(title)}</h1><p class="sub" id="rv-sub"></p></div></div>
    ${ctx.newPeople.length ? `<div class="card tint" style="margin-bottom:1rem"><p><b>New family members will be added:</b> ${ctx.newPeople.map(esc).join(', ')}.<br><span class="ink2 small">If a name is really an existing person spelled differently, open that FD and choose the right person.</span></p></div>` : ''}
    <div class="stack" id="rv-list"></div>
    <div class="errors hidden" id="rv-err" role="alert" style="margin-top:1rem"></div>
    <div class="sticky-save"><button class="btn primary block" id="rv-save"></button></div>`;

  const list = root.querySelector('#rv-list');
  const draw = () => {
    const inc = drafts.filter((d) => d.include);
    root.querySelector('#rv-sub').textContent = `${drafts.length} found · ${inc.length} selected. Check each one, then save.`;
    root.querySelector('#rv-save').innerHTML = `${icon('check')} Save ${inc.length} FD${inc.length === 1 ? '' : 's'}`;
    root.querySelector('#rv-save').disabled = !inc.length;
    list.innerHTML = drafts.map((d, i) => {
      const errs = draftErrors(d);
      return `<section class="card draft ${d.include ? '' : 'off'}" data-i="${i}">
        <div class="draft-head">
          <label class="check"><input type="checkbox" data-inc="${i}" ${d.include ? 'checked' : ''}> FD ${i + 1}</label>
          ${errs.length ? `<span class="pill due">${errs.length} to fix</span>` : '<span class="pill active">Looks good</span>'}
        </div>
        <div>
          <div style="font-weight:650;font-size:1.05rem">${esc(d.institutionName || 'Bank not read')}</div>
          <div class="ink2">${esc(nameOf(d.holderId) || 'Name not read')}${d.jointHolderIds.length ? ' + ' + d.jointHolderIds.map(nameOf).map(esc).join(', ') : ''}</div>
          <div class="num" style="margin-top:.35rem"><b>${d.amount ? fmtINR(d.amount) : '₹ ?'}</b> at ${d.rate ? fmtRate(d.rate) : '?'} · ${isISO(d.startDate) ? fmtDate(d.startDate) : '?'} → ${isISO(d.maturityDate) ? fmtDate(d.maturityDate) : '?'}</div>
          ${errs.length ? `<p class="small" style="color:var(--danger-ink);font-weight:600;margin-top:.35rem">${errs.map((e) => esc(e[1])).join(' · ')}</p>` : ''}
          ${d.dupOf ? `<p class="small" style="color:var(--warn-ink);font-weight:600;margin-top:.35rem">This looks like an FD you already saved. It is unticked so it isn't added twice. <a href="#/fd/${d.dupOf}">View saved one</a></p>` : ''}
        </div>
        ${open === i ? '<div class="stack" data-editor></div><button class="btn block" data-close>Done checking</button>' : `<button class="btn block" data-open="${i}">${icon('pen')} Check / edit details</button>`}
      </section>`;
    }).join('');
    if (open >= 0) {
      const host = list.querySelector('[data-editor]');
      fdEditor(host, drafts[open], { extraPeople: extra(), showErrors: true });
    }
  };
  list.addEventListener('change', (e) => {
    if (e.target.dataset.inc !== undefined) { drafts[e.target.dataset.inc].include = e.target.checked; draw(); }
  });
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[data-open],[data-close]');
    if (!b) return;
    const was = open;
    open = b.dataset.open !== undefined ? Number(b.dataset.open) : -1;
    draw();
    const target = list.querySelector(`[data-i="${open >= 0 ? open : was}"]`);
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  root.querySelector('#rv-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const inc = drafts.filter((d) => d.include);
    const bad = inc.findIndex((d) => draftErrors(d).length);
    const errBox = root.querySelector('#rv-err');
    if (bad >= 0) {
      open = drafts.indexOf(inc[bad]);
      draw();
      errBox.textContent = `FD ${open + 1} needs a few details before saving. Fill them in, or untick it to skip.`;
      errBox.classList.remove('hidden');
      list.querySelector(`[data-i="${open}"]`).scrollIntoView({ block: 'start', behavior: 'smooth' });
      return;
    }
    btn.disabled = true;
    try {
      const used = new Set(inc.flatMap((d) => [d.holderId, ...d.jointHolderIds]).filter((id) => id.startsWith('new:')).map((id) => id.slice(4)));
      const fds = inc.map((d) => { const p = toPayload(d); delete p.dupOf; delete p.include; return p; });
      const saved = await db.createMany(fds, [...used]);
      await reload();
      toast(`${saved} FD${saved === 1 ? '' : 's'} saved`);
      go('#/fds');
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
      btn.disabled = false;
    }
  });
  draw();
}

// ---------- Excel ----------
export function renderExcel({ root }) {
  root.innerHTML = `
    <a class="back" href="#/add">${icon('back')} Back</a>
    <div class="page-head"><div><h1>From an Excel file</h1><p class="sub">Works with .xlsx or .csv files. The file is read on this phone.</p></div></div>
    <div class="stack">
      <div class="card drop">${icon('sheet')}
        <p>Choose the Excel file that lists your FDs. One row per FD works best.</p>
        <button class="btn primary" id="pick">${icon('upload')} Choose Excel file</button>
      </div>
      <div class="card tint stack-sm">
        <h2>Don't have a sheet yet?</h2>
        <p class="ink2">Get our ready-made template, fill it in (on a computer or in Google Sheets / Excel on the phone), then choose it above.</p>
        <button class="btn" id="tpl">${icon('download')} Get the Excel template</button>
      </div>
    </div>`;
  root.querySelector('#tpl').addEventListener('click', async () => {
    await shareOrDownload(await templateXlsx(), 'FD-template.xlsx', 'FD Tracker template');
  });
  root.querySelector('#pick').addEventListener('click', async () => {
    const file = await pickFile('.xlsx,.csv,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv');
    if (!file) return;
    const btn = root.querySelector('#pick');
    btn.disabled = true;
    btn.textContent = 'Reading file…';
    try {
      const parsed = await parseSpreadsheet(file);
      mapping(root, parsed, file.name);
    } catch (e) {
      await alertBox("Couldn't read this file", esc(e.message));
      renderExcel({ root });
    }
  });
}

function mapping(root, { headers, rows, mapping: map, sheet }, fileName) {
  const sample = (i) => rows.map((r) => r[i]).find((v) => String(v ?? '').trim()) ?? '';
  root.innerHTML = `
    <a class="back" href="#/add/excel">${icon('back')} Choose another file</a>
    <div class="page-head"><div><h1>Match the columns</h1><p class="sub">${esc(fileName)} · sheet "${esc(sheet)}" · ${rows.length} rows</p></div></div>
    <div class="stack">
      <p class="ink2">We've guessed what each column means. Please check, and change any that are wrong.</p>
      <div class="card">${headers.map((h, i) => `<div class="map-row">
        <div><div class="col-name">${esc(h)}</div><div class="sample">e.g. ${esc(String(sample(i)).slice(0, 40)) || '—'}</div></div>
        <select class="input" data-col="${i}" aria-label="Meaning of column ${esc(h)}">${FIELD_LABELS.map(([v, l]) => `<option value="${v}" ${map[i] === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>`).join('')}</div>
      <div class="errors hidden" id="map-err" role="alert"></div>
      <button class="btn primary block" id="go">Continue</button>
    </div>`;
  root.querySelectorAll('[data-col]').forEach((s) => s.addEventListener('change', () => (map[s.dataset.col] = s.value)));
  root.querySelector('#go').addEventListener('click', () => {
    const need = ['holder', 'institutionName', 'amount'].filter((k) => !map.includes(k));
    if (need.length) {
      const box = root.querySelector('#map-err');
      box.textContent = `Please choose which column has: ${need.map((k) => FIELD_LABELS.find((f) => f[0] === k)[1]).join(', ')}`;
      box.classList.remove('hidden');
      return;
    }
    const ctx = { newPeople: [], source: 'excel' };
    const drafts = rows.map((r) => {
      const f = {};
      map.forEach((k, i) => { if (k && f[k] === undefined) f[k] = r[i]; });
      return makeDraft(f, ctx);
    }).filter((d) => d.amount || d.institutionName);
    if (!drafts.length) return alertBox('No FDs found', 'No rows with an amount or bank name were found.');
    review(root, drafts, ctx, { title: 'Check before saving', back: '#/add/excel' });
  });
}
