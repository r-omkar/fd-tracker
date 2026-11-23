import { state, personName, esc, icon } from '../ui.js';
import {
  todayISO, effectiveStatus, daysBetween, fmtINR, fmtShort, fmtRate, fmtDate, fmtDaysLeft, typeLabel, maturityValue,
} from '../calc.js';
import { meantForId, isForSomeoneElse } from '../calc.js';

const STATUS_FILTERS = [
  ['active', 'Active'],
  ['soon', 'Maturing soon'],
  ['due', 'Needs action'],
  ['old', 'Renewed / Closed'],
  ['all', 'All'],
];
const SORTS = [
  ['maturity', 'Maturity date (soonest first)'],
  ['amount', 'Amount (largest first)'],
  ['rate', 'Interest rate (highest first)'],
  ['inst', 'Bank name (A–Z)'],
  ['person', 'Person name (A–Z)'],
];
const RELS = [['any', 'All'], ['name', 'In their name'], ['for', 'Meant for them']];
const ui = { q: '', status: 'active', person: '', rel: 'any', sort: 'maturity' };

export function statusPill(fd, today = todayISO()) {
  const st = effectiveStatus(fd, today);
  const left = daysBetween(today, fd.maturityDate);
  if (st === 'due') return `<span class="pill due">${icon('alert')} Matured ${fmtDaysLeft(left)}</span>`;
  if (st === 'soon') return `<span class="pill soon">${icon('bell')} Matures ${fmtDaysLeft(left)}</span>`;
  if (st === 'active') return `<span class="pill active">Matures ${fmtDaysLeft(left)}</span>`;
  if (st === 'renewed') return '<span class="pill">Renewed</span>';
  return '<span class="pill">Closed</span>';
}

export function fdCard(fd, today) {
  const joint = fd.jointHolderIds.length ? ` + ${fd.jointHolderIds.map(personName).map(esc).join(', ')}` : '';
  return `<a class="fd-item" href="#/fd/${fd.id}">
    <div class="top">
      <div style="min-width:0"><div class="inst">${esc(fd.institutionName)}</div><div class="who">${esc(personName(fd.holderId))}${joint}</div>
        ${isForSomeoneElse(fd) || fd.purpose ? `<div class="for-line">${isForSomeoneElse(fd) ? `For <b>${esc(personName(meantForId(fd)))}</b>` : ''}${isForSomeoneElse(fd) && fd.purpose ? ' · ' : ''}${esc(fd.purpose || '')}</div>` : ''}</div>
      <div><div class="amt num">${fmtINR(fd.amount)}</div><div class="muted small" style="text-align:right">${fmtRate(fd.rate)}</div></div>
    </div>
    <div class="bottom">
      <span class="ink2 small">${fd.status === 'active' ? 'Matures' : 'Matured'} <b>${fmtDate(fd.maturityDate)}</b></span>
      ${statusPill(fd, today)}
    </div>
  </a>`;
}

export function render({ root, query }) {
  const today = todayISO();
  if (query.get('person')) { ui.person = query.get('person'); ui.rel = query.get('rel') || 'any'; ui.status = 'active'; }
  const instFilter = query.get('inst') || '';
  const nomineeFilter = query.get('filter') === 'nonominee';

  root.innerHTML = `
    <div class="page-head"><div><h1>All FDs</h1><p class="sub" id="summary"></p></div>
      <a class="btn primary small" href="#/add">${icon('plus')} Add</a></div>
    <div class="stack">
      <div class="search">${icon('search')}<input class="input" id="q" type="search" placeholder="Search bank, name, FD number…" value="${esc(ui.q)}" aria-label="Search FDs"></div>
      ${instFilter || nomineeFilter ? `<div class="card tint spread"><span>${nomineeFilter ? 'Showing FDs <b>without a nominee</b>' : `Showing <b>${esc(instFilter)}</b> only`}</span><a class="btn small" href="#/fds">Show all</a></div>` : ''}
      <div class="filters" role="group" aria-label="Status">${STATUS_FILTERS.map(([id, l]) => `<button class="chip ${ui.status === id ? 'on' : ''}" data-status="${id}" aria-pressed="${ui.status === id}">${l}</button>`).join('')}</div>
      <div class="grid2 collapse">
        <div class="field"><label for="person">Person</label><select class="input" id="person"><option value="">Everyone</option>
          ${state.people.map((p) => `<option value="${p.id}" ${ui.person === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="sort">Sort by</label><select class="input" id="sort">
          ${SORTS.map(([id, l]) => `<option value="${id}" ${ui.sort === id ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      </div>
      <div class="filters ${ui.person ? '' : 'hidden'}" id="rel" role="group" aria-label="Which FDs of this person">${RELS.map(([id, l]) => `<button class="chip ${ui.rel === id ? 'on' : ''}" data-rel="${id}" aria-pressed="${ui.rel === id}">${l}</button>`).join('')}</div>
      <div class="stack-sm" id="items"></div>
    </div>`;

  const draw = () => {
    const q = ui.q.trim().toLowerCase();
    let items = state.fds.filter((f) => {
      const st = effectiveStatus(f, today);
      if (!nomineeFilter) {
        if (ui.status === 'active' && f.status !== 'active') return false;
        if (ui.status === 'soon' && st !== 'soon') return false;
        if (ui.status === 'due' && st !== 'due') return false;
        if (ui.status === 'old' && f.status === 'active') return false;
      } else if (f.status !== 'active' || f.hasNominee) return false;
      if (ui.person) {
        const inName = f.holderId === ui.person || f.jointHolderIds.includes(ui.person);
        const isFor = meantForId(f) === ui.person;
        if (ui.rel === 'name' ? !inName : ui.rel === 'for' ? !isFor : !inName && !isFor) return false;
      }
      if (instFilter && f.institutionName.trim().toLowerCase().replace(/\s+/g, ' ') !== instFilter) return false;
      if (q) {
        const hay = [f.institutionName, f.branch, f.fdNumber, personName(f.holderId), personName(meantForId(f)), f.purpose, ...f.jointHolderIds.map(personName), f.notes, typeLabel(f.institutionType), ...f.nominees.map((n) => n.name)].join(' ').toLowerCase();
        if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const cmp = {
      maturity: (a, b) => a.maturityDate.localeCompare(b.maturityDate),
      amount: (a, b) => b.amount - a.amount,
      rate: (a, b) => b.rate - a.rate,
      inst: (a, b) => a.institutionName.localeCompare(b.institutionName),
      person: (a, b) => personName(a.holderId).localeCompare(personName(b.holderId)) || a.maturityDate.localeCompare(b.maturityDate),
    }[ui.sort];
    items.sort(cmp);
    if (ui.status === 'old') items.reverse();
    const total = items.reduce((s, f) => s + f.amount, 0);
    root.querySelector('#summary').textContent = `${items.length} FD${items.length === 1 ? '' : 's'} · ${fmtShort(total)} total`;
    root.querySelector('#items').innerHTML = items.length
      ? items.map((f) => fdCard(f, today)).join('') + `<p class="muted small" style="text-align:center;margin-top:.5rem">Total ${fmtINR(total)} · at maturity ${fmtINR(items.reduce((s, f) => s + maturityValue(f), 0))}</p>`
      : `<div class="empty">${icon('search')}<p>No FDs match. Try another filter.</p></div>`;
  };
  draw();

  root.querySelector('#q').addEventListener('input', (e) => { ui.q = e.target.value; draw(); });
  root.querySelector('#person').addEventListener('change', (e) => { ui.person = e.target.value; root.querySelector('#rel').classList.toggle('hidden', !ui.person); draw(); });
  root.querySelectorAll('[data-rel]').forEach((b) => b.addEventListener('click', () => {
    ui.rel = b.dataset.rel;
    root.querySelectorAll('[data-rel]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    draw();
  }));
  root.querySelector('#sort').addEventListener('change', (e) => { ui.sort = e.target.value; draw(); });
  root.querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => {
    ui.status = b.dataset.status;
    root.querySelectorAll('[data-status]').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    draw();
  }));
}
