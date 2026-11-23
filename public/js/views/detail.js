import { state, personName, esc, icon, reload, toast, confirmBox, dialog, viewImage, go } from '../ui.js';
import * as db from '../db.js';
import {
  todayISO, fmtINR, fmtRate, fmtDate, typeLabel, payoutLabel, tenureLabel, maturityValue, estimateMaturityAmount,
  periodicPayout, typeInsurance, isISO,
} from '../calc.js';
import { statusPill } from './list.js';
import { meantForId, isForSomeoneElse } from '../calc.js';


const kv = (k, v, full = false) => `<div class="${full ? 'full' : ''}"><div class="k">${k}</div><div class="v">${v}</div></div>`;

export function render({ root, params: [id] }) {
  const fd = state.fds.find((f) => f.id === id);
  if (!fd) throw new Error('This FD was not found. It may have been deleted.');
  const today = todayISO();
  const byId = (x) => state.fds.find((f) => f.id === x);

  // Renewal chain: oldest → newest
  const chain = [fd];
  for (let p = byId(fd.renewedFromId); p && chain.length < 50; p = byId(p.renewedFromId)) chain.unshift(p);
  for (let n = byId(fd.renewedToId); n && chain.length < 50; n = byId(n.renewedToId)) chain.push(n);

  const mv = maturityValue(fd);
  const manual = Number(fd.maturityAmount) > 0;
  const insurance = typeInsurance(fd.institutionType);
  const payout = fd.interestPayout !== 'cumulative' ? `${fmtINR(periodicPayout(fd))} ${payoutLabel(fd.interestPayout).replace('Paid ', '')}` : null;

  root.innerHTML = `
    <a class="back" href="#/fds">${icon('back')} All FDs</a>
    <div class="stack">
      <section class="card">
        <div class="spread" style="align-items:flex-start">
          <div style="min-width:0"><h1 style="font-size:1.4rem">${esc(fd.institutionName)}</h1>
            <p class="ink2">${esc(typeLabel(fd.institutionType))}${fd.branch ? ` · ${esc(fd.branch)} branch` : ''}</p></div>
        </div>
        <div style="margin:1rem 0 .25rem" class="num"><span style="font-size:2rem;font-weight:750">${fmtINR(fd.amount)}</span> <span class="ink2">at ${fmtRate(fd.rate)}</span></div>
        <div style="margin-bottom:1rem">${statusPill(fd, today)}</div>
        <div class="kv">
          ${kv('Start date', fmtDate(fd.startDate))}
          ${kv('Maturity date', fmtDate(fd.maturityDate))}
          ${kv('Period', tenureLabel(fd.startDate, fd.maturityDate))}
          ${kv('Interest', esc(payoutLabel(fd.interestPayout)))}
          ${kv(`Maturity amount${manual ? '' : ' (estimate)'}`, `<span class="num">${fmtINR(mv)}</span>`)}
          ${payout ? kv('Interest payout', payout) : kv('Interest earned', `<span class="num">${fmtINR(mv - fd.amount)}</span>`)}
          ${kv('FD / receipt no.', esc(fd.fdNumber || '—'))}
          ${kv('Auto-renew', fd.autoRenew ? 'Yes' : 'No')}
          ${fd.status !== 'active' && isISO(fd.closedOn) ? kv(fd.status === 'renewed' ? 'Renewed on' : 'Closed on', fmtDate(fd.closedOn)) : ''}
        </div>
        ${manual && Math.abs(estimateMaturityAmount(fd) - mv) > 50 ? `<p class="muted small" style="margin-top:.75rem">Maturity amount is from the receipt. Our estimate was ${fmtINR(estimateMaturityAmount(fd))}.</p>` : ''}
      </section>

      <section class="card">
        <h2 style="margin-bottom:.75rem">Whose FD</h2>
        <div class="kv">
          ${kv('In the name of', esc(personName(fd.holderId)))}
          ${kv('Meant for', isForSomeoneElse(fd) ? `<span class="pill accent">${esc(personName(meantForId(fd)))}</span>` : 'Same person')}
          ${fd.purpose ? kv('Purpose', esc(fd.purpose), true) : ''}
          ${kv('Mode of operation', esc(fd.jointHolderIds.length ? fd.mode : 'Single'))}
          ${fd.jointHolderIds.length ? kv('Joint holders', fd.jointHolderIds.map(personName).map(esc).join(', '), true) : ''}
        </div>
      </section>

      <section class="card ${fd.hasNominee ? '' : 'warn'}">
        <h2 style="margin-bottom:.6rem">Nominee</h2>
        ${fd.hasNominee && fd.nominees.length
          ? `<div class="list-plain">${fd.nominees.map((n) => `<div class="spread"><div><b>${esc(n.name)}</b>${n.relation ? `<div class="ink2 small">${esc(n.relation)}</div>` : ''}</div>${n.share ? `<span class="pill">${n.share}%</span>` : ''}</div>`).join('')}</div>`
          : fd.hasNominee ? '<p>Nomination: Yes (details not entered)</p>' : `<p>No nominee recorded. Consider adding one at the ${insurance === 'govt' ? 'post office' : 'branch'}.</p>`}
      </section>

      ${chain.length > 1 ? `<section class="card"><h2 style="margin-bottom:.5rem">Renewal history</h2><div class="chain">
        ${chain.map((c) => {
          const inner = `<span class="dot"></span><div style="flex:1"><b class="num">${fmtINR(c.amount)}</b> at ${fmtRate(c.rate)}<div class="ink2 small">${fmtDate(c.startDate)} → ${fmtDate(c.maturityDate)}</div></div>${c.id === fd.id ? '<span class="pill accent">This one</span>' : icon('chevron')}`;
          return c.id === fd.id ? `<div class="cur">${inner}</div>` : `<a href="#/fd/${c.id}">${inner}</a>`;
        }).join('')}</div></section>` : ''}

      ${fd.photos.length || fd.notes ? `<section class="card">
        ${fd.notes ? `<h2 style="margin-bottom:.4rem">Notes</h2><p style="white-space:pre-wrap">${esc(fd.notes)}</p>` : ''}
        ${fd.photos.length ? `<h2 style="margin:${fd.notes ? '1rem' : '0'} 0 .6rem">Photos</h2><div class="photos">${fd.photos.map((p) => `<button class="ph" data-open-photo="${esc(p)}" aria-label="Open photo" style="padding:0;cursor:pointer"><img data-photo="${esc(p)}" alt="Receipt photo"></button>`).join('')}</div>` : ''}
      </section>` : ''}

      <div class="actions">
        ${fd.status === 'active' ? `<a class="btn primary block" href="#/renew/${fd.id}">${icon('refresh')} Renew this FD</a>
          <button class="btn block" data-act="close">${icon('check')} Mark as closed (money received)</button>` : ''}
        ${fd.status === 'closed' ? `<button class="btn block" data-act="reopen">Mark as active again</button>` : ''}
        <a class="btn block" href="#/edit/${fd.id}">${icon('pen')} Edit details</a>
        <button class="btn quiet block" data-act="delete" style="color:var(--danger-ink)">${icon('trash')} Delete this FD</button>
      </div>
      <p class="muted small" style="text-align:center">Added ${fd.source === 'excel' ? 'from Excel' : 'by hand'} · last changed ${fmtDate(fd.updatedAt?.slice(0, 10))}</p>
    </div>`;

  root.querySelectorAll('[data-open-photo]').forEach((b) => b.addEventListener('click', () => viewImage(b.dataset.openPhoto)));

  const update = async (patch, msg) => {
    await db.updateFd(fd.id, { ...fd, ...patch });
    await reload();
    toast(msg);
    render({ root, params: [id] });
  };
  root.querySelector('[data-act="close"]')?.addEventListener('click', async () => {
    const d = await dialog({ title: 'Mark as closed?', body: 'Use this when the money has been received in the bank account. When was it closed?', ok: 'Mark closed', input: { label: 'Date', type: 'date', value: today } });
    if (d === null) return;
    await update({ status: 'closed', closedOn: d || today }, 'Marked as closed');
  });
  root.querySelector('[data-act="reopen"]')?.addEventListener('click', () => update({ status: 'active', closedOn: null }, 'Marked as active'));
  root.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    if (!(await confirmBox('Delete this FD?', `${esc(fd.institutionName)} – ${fmtINR(fd.amount)}. This cannot be undone. If the FD has ended, "Mark as closed" keeps its history instead.`, 'Delete', true))) return;
    await db.deleteFd(fd.id);
    await reload();
    toast('FD deleted');
    go('#/fds');
  });
}
