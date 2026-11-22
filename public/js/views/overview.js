import { state, personName, esc, icon } from '../ui.js';
import {
  todayISO, effectiveStatus, daysBetween, maturityValue, fmtINR, fmtShort, fmtRate, fmtDate, fmtDaysLeft, fmtMonth, monthShort,
  addMonths, typeInsurance, accruedValue, DICGC_LIMIT, fyBounds, interestBetween, periodicPayout,
} from '../calc.js';

const instKey = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');

export function fdLine(fd, today) {
  const left = daysBetween(today, fd.maturityDate);
  return `<a href="#/fd/${fd.id}">
    <div><div style="font-weight:650">${esc(fd.institutionName)}</div><div class="ink2 small">${esc(personName(fd.holderId))} · ${fmtDate(fd.maturityDate)}</div></div>
    <div style="text-align:right"><div class="num" style="font-weight:700">${fmtINR(maturityValue(fd))}</div><div class="small" style="font-weight:600">${fmtDaysLeft(left)}</div></div>
  </a>`;
}

function barList(rows, hrefFn) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="bars">${rows.map((r) => `
    <a class="bar-row" href="${hrefFn(r)}" style="text-decoration:none;color:inherit" aria-label="${esc(r.label)}: ${fmtINR(r.value)}, ${r.count} FDs">
      <div class="spread"><span class="name">${esc(r.label)}</span><span class="val num">${fmtShort(r.value)} <span class="muted small" style="font-weight:500">· ${r.count} FD${r.count > 1 ? 's' : ''}</span></span></div>
      <div class="track"><div class="fill" style="width:${(r.value / max) * 100}%"></div></div>
    </a>`).join('')}</div>`;
}

function insight(kind, ic, title, text) {
  return `<div class="insight"><div class="ic ${kind}">${icon(ic)}</div><div><h3>${title}</h3><p>${text}</p></div></div>`;
}

export function render({ root }) {
  const today = todayISO();
  const active = state.fds.filter((f) => f.status === 'active');
  const now = new Date();
  const dateLine = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  if (!state.fds.length) {
    root.innerHTML = `
      <div class="page-head"><div><h1>Overview</h1><p class="sub">${dateLine}</p></div></div>
      <div class="card"><div class="empty">${icon('wallet')}
        <h2>No FDs added yet</h2>
        <p>Add your family's fixed deposits to see totals, upcoming maturities and helpful reminders here.</p>
        <div class="actions" style="width:100%;max-width:340px">
          <a class="btn primary" href="#/add">${icon('plus')} Add FDs</a>
          ${state.people.length ? '' : `<a class="btn" href="#/people">${icon('people')} Add family members first</a>`}
        </div></div></div>`;
    return;
  }

  const due = active.filter((f) => effectiveStatus(f, today) === 'due').sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));
  const soon = active.filter((f) => effectiveStatus(f, today) === 'soon').sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));
  const upcoming = active.filter((f) => effectiveStatus(f, today) === 'active').sort((a, b) => a.maturityDate.localeCompare(b.maturityDate));

  const invested = active.reduce((s, f) => s + f.amount, 0);
  const atMaturity = active.reduce((s, f) => s + maturityValue(f), 0);
  const avgRate = invested ? active.reduce((s, f) => s + f.amount * f.rate, 0) / invested : 0;

  // Group by person / institution
  const group = (keyFn, labelFn) => {
    const m = new Map();
    for (const f of active) {
      const k = keyFn(f);
      const g = m.get(k) || { key: k, label: labelFn(f), value: 0, count: 0 };
      g.value += f.amount;
      g.count++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  };
  const byPerson = group((f) => f.holderId, (f) => personName(f.holderId));
  let byInst = group((f) => instKey(f.institutionName), (f) => f.institutionName.trim());
  if (byInst.length > 7) {
    const rest = byInst.slice(6);
    byInst = [...byInst.slice(0, 6), { key: '', label: `${rest.length} others`, value: rest.reduce((s, r) => s + r.value, 0), count: rest.reduce((s, r) => s + r.count, 0) }];
  }

  // Next 12 months of maturities
  const months = Array.from({ length: 12 }, (_, i) => addMonths(today.slice(0, 8) + '01', i).slice(0, 7));
  const tl = months.map((m) => {
    const fds = active.filter((f) => f.maturityDate.slice(0, 7) === m);
    return { m, fds, value: fds.reduce((s, f) => s + maturityValue(f), 0) };
  });
  const tlMax = Math.max(...tl.map((t) => t.value), 1);
  const later = active.filter((f) => f.maturityDate.slice(0, 7) > months[11]).length;

  // ---------- insights ----------
  const ins = [];
  // Deposit insurance (DICGC): ₹5 lakh per depositor per bank, principal + interest, same capacity.
  const exposure = new Map();
  for (const f of active.filter((f) => typeInsurance(f.institutionType) === 'dicgc')) {
    const k = `${f.holderId}|${[...f.jointHolderIds].sort().join(',')}|${instKey(f.institutionName)}`;
    const e = exposure.get(k) || { holder: f.holderId, joint: f.jointHolderIds.length > 0, inst: f.institutionName, value: 0 };
    e.value += accruedValue(f, today);
    exposure.set(k, e);
  }
  const over = [...exposure.values()].filter((e) => e.value > DICGC_LIMIT).sort((a, b) => b.value - a.value);
  if (over.length) {
    ins.push(insight('warn', 'shield', 'Above the ₹5 lakh insurance limit',
      over.map((e) => `<b>${esc(personName(e.holder))}${e.joint ? ' (joint)' : ''}</b> has about ${fmtShort(e.value)} at ${esc(e.inst)}`).join('<br>') +
      '<br><span class="muted small">Bank deposits are insured by DICGC only up to ₹5 lakh per person per bank (principal + interest). Consider spreading across banks or family members.</span>'));
  } else if (exposure.size) {
    ins.push(insight('good', 'shield', 'Within deposit insurance limits', 'Every person has under ₹5 lakh in each bank, so bank FDs are fully covered by DICGC insurance.'));
  }
  const uninsured = active.filter((f) => typeInsurance(f.institutionType) === 'none');
  if (uninsured.length) {
    const amt = uninsured.reduce((s, f) => s + f.amount, 0);
    ins.push(insight('warn', 'alert', `${fmtShort(amt)} is not insured`,
      `${uninsured.length} FD${uninsured.length > 1 ? 's are' : ' is'} in patasanstha / company deposits (${Math.round((amt / invested) * 100)}% of the total). These are not covered by DICGC deposit insurance, so keep an eye on the institution's health.`));
  }
  const noNominee = active.filter((f) => !f.hasNominee);
  if (noNominee.length) {
    ins.push(insight('warn', 'user', `${noNominee.length} FD${noNominee.length > 1 ? 's have' : ' has'} no nominee`,
      `Adding a nominee makes it much easier for family to claim the money. <a href="#/fds?filter=nonominee">See which ones</a>`));
  } else {
    ins.push(insight('good', 'user', 'All FDs have a nominee', 'Every active FD has nomination recorded.'));
  }
  if (active.length >= 2) {
    const byRate = [...active].sort((a, b) => a.rate - b.rate);
    const lo = byRate[0], hi = byRate.at(-1);
    if (hi.rate - lo.rate >= 0.75) {
      ins.push(insight('info', 'trend', `Rates range from ${fmtRate(lo.rate)} to ${fmtRate(hi.rate)}`,
        `Lowest: <a href="#/fd/${lo.id}">${esc(lo.institutionName)}</a> (${esc(personName(lo.holderId))}), matures ${fmtDate(lo.maturityDate)}. Compare current rates before renewing it.`));
    }
  }
  const payers = active.filter((f) => f.interestPayout !== 'cumulative');
  if (payers.length) {
    const perMonth = payers.reduce((s, f) => s + (periodicPayout(f) * { monthly: 12, quarterly: 4, half_yearly: 2, yearly: 1 }[f.interestPayout]) / 12, 0);
    ins.push(insight('info', 'rupee', `About ${fmtINR(perMonth)} a month in interest payouts`, `${payers.length} FD${payers.length > 1 ? 's pay' : ' pays'} interest out regularly instead of adding it at maturity.`));
  }

  // Interest this financial year, per person (estimate)
  const fy = fyBounds(today);
  const fyRows = new Map();
  for (const f of state.fds) {
    const v = interestBetween(f, fy.from, fy.to);
    if (v > 0) fyRows.set(f.holderId, (fyRows.get(f.holderId) || 0) + v);
  }
  const fyTotal = [...fyRows.values()].reduce((s, v) => s + v, 0);

  const selMonth = tl.find((t) => t.value > 0)?.m || months[0];

  // Data lives only on this phone, so nudge for a backup when there are unsaved changes.
  const last = state.meta.lastBackupAt;
  const changed = state.meta.changedAt;
  const needBackup = !last || (changed > last && daysBetween(last.slice(0, 10), today) >= 14);

  root.innerHTML = `
    <div class="page-head"><div><h1>Overview</h1><p class="sub">${dateLine}</p></div></div>
    <div class="stack">
      ${needBackup ? `<section class="card tint"><div class="row" style="align-items:flex-start">${icon('shield')}<div style="flex:1">
          <h2>${last ? 'Time for a fresh backup' : 'Make your first backup'}</h2>
          <p class="ink2" style="margin:.2rem 0 .75rem">Your FDs are saved only on this phone. ${last ? `Last backup was ${fmtDate(last.slice(0, 10))}.` : 'Keep a copy somewhere safe in case the phone is lost.'}</p>
          <a class="btn small" href="#/more">Make a backup</a></div></div></section>` : ''}
      ${due.length ? `<section class="card danger" aria-labelledby="h-due">
        <div class="card-head"><h2 id="h-due" class="row" style="gap:.5rem">${icon('alert')} Matured — needs action</h2></div>
        <p class="ink2" style="margin:-.4rem 0 .6rem">These dates have passed. Open each one and mark it renewed or closed.</p>
        <div class="mini-list">${due.map((f) => fdLine(f, today)).join('')}</div></section>` : ''}

      ${soon.length ? `<section class="card warn" aria-labelledby="h-soon">
        <div class="card-head"><h2 id="h-soon" class="row" style="gap:.5rem">${icon('bell')} Maturing in the next 30 days</h2></div>
        <div class="mini-list">${soon.map((f) => fdLine(f, today)).join('')}</div></section>`
      : `<section class="card tint"><div class="row" style="align-items:flex-start">${icon('bell')}<div>
          <h2>Nothing matures in the next 30 days</h2>
          ${upcoming[0] ? `<p class="ink2" style="margin-top:.2rem">Next: <a href="#/fd/${upcoming[0].id}">${esc(upcoming[0].institutionName)}</a> (${esc(personName(upcoming[0].holderId))}) on ${fmtDate(upcoming[0].maturityDate)}.</p>` : ''}
        </div></div></section>`}

      <section class="card hero" aria-label="Totals">
        <div class="label">Total in active FDs</div>
        <div class="big num">${fmtINR(invested)}</div>
        <div class="facts">
          <div><b class="num">${fmtShort(atMaturity)}</b><span>at maturity</span></div>
          <div><b class="num">${active.length}</b><span>active FDs</span></div>
          <div><b class="num">${fmtRate(avgRate.toFixed(2))}</b><span>average rate</span></div>
        </div>
      </section>

      <section class="card" aria-labelledby="h-person">
        <div class="card-head"><h2 id="h-person">By family member</h2><span class="muted small">amount invested</span></div>
        ${barList(byPerson, (r) => `#/fds?person=${r.key}`)}
      </section>

      <section class="card" aria-labelledby="h-tl">
        <div class="card-head"><h2 id="h-tl">Maturities in the next 12 months</h2></div>
        <div class="timeline" role="list">
          ${tl.map((t) => `<button class="tl-col ${t.m === selMonth ? 'sel' : ''}" data-m="${t.m}" role="listitem" aria-label="${fmtMonth(t.m + '-01')}: ${t.fds.length} FDs, ${fmtINR(t.value)}">
            ${t.value ? `<div class="tl-bar" style="height:${Math.max(4, (t.value / tlMax) * 100)}%"></div>` : '<div class="tl-zero"></div>'}
          </button>`).join('')}
        </div>
        <div class="tl-labels">${tl.map((t) => `<span class="${t.m === selMonth ? 'sel' : ''}" data-lm="${t.m}">${monthShort(t.m + '-01')}</span>`).join('')}</div>
        <div id="tl-detail" style="margin-top:1rem"></div>
        ${later ? `<p class="muted small" style="margin-top:.5rem">${later} more FD${later > 1 ? 's' : ''} mature after ${fmtMonth(months[11] + '-01')}.</p>` : ''}
      </section>

      <section class="card" aria-labelledby="h-inst">
        <div class="card-head"><h2 id="h-inst">By bank / institution</h2><span class="muted small">amount invested</span></div>
        ${barList(byInst, (r) => (r.key ? `#/fds?inst=${encodeURIComponent(r.key)}` : '#/fds'))}
      </section>

      <section class="card" aria-labelledby="h-ins">
        <div class="card-head"><h2 id="h-ins">Insights</h2></div>
        ${ins.join('')}
      </section>

      ${fyTotal > 0 ? `<section class="card" aria-labelledby="h-fy">
        <div class="card-head"><h2 id="h-fy">Interest earned in ${fy.label}</h2><span class="muted small">estimate</span></div>
        <table class="simple"><thead><tr><th>Name</th><th class="r">Interest</th></tr></thead><tbody>
          ${[...fyRows.entries()].sort((a, b) => b[1] - a[1]).map(([id, v]) => `<tr><td>${esc(personName(id))}</td><td class="r num">${fmtINR(v)}</td></tr>`).join('')}
          <tr><td><b>Total</b></td><td class="r num"><b>${fmtINR(fyTotal)}</b></td></tr>
        </tbody></table>
        <p class="muted small" style="margin-top:.6rem">Counts interest earned between ${fmtDate(fy.from)} and ${fmtDate(fy.to)}, whether paid out or added to the FD. Useful for income tax returns and Form 15G / 15H.</p>
      </section>` : ''}
    </div>`;

  const showMonth = (m) => {
    const t = tl.find((x) => x.m === m);
    root.querySelectorAll('.tl-col').forEach((b) => b.classList.toggle('sel', b.dataset.m === m));
    root.querySelectorAll('[data-lm]').forEach((b) => b.classList.toggle('sel', b.dataset.lm === m));
    root.querySelector('#tl-detail').innerHTML = t.fds.length
      ? `<div class="spread" style="margin-bottom:.25rem"><h3>${fmtMonth(m + '-01')}</h3><span class="num" style="font-weight:700">${fmtINR(t.value)}</span></div>
         <div class="mini-list">${t.fds.sort((a, b) => a.maturityDate.localeCompare(b.maturityDate)).map((f) => fdLine(f, today)).join('')}</div>`
      : `<p class="muted">No FDs mature in ${fmtMonth(m + '-01')}.</p>`;
  };
  root.querySelectorAll('.tl-col').forEach((b) => b.addEventListener('click', () => showMonth(b.dataset.m)));
  showMonth(selMonth);
}
