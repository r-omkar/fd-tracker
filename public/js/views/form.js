import { state, esc, icon, reload, toast, go, dialog, pickFile, addPhoto, viewImage } from '../ui.js';
import * as db from '../db.js';
import {
  INSTITUTION_TYPES, PAYOUTS, COMPOUNDING, MODES, STATUSES, isISO, addMonths, toUTC, tenureLabel, estimateMaturityAmount,
  fmtINR, maturityValue, guessType, parseAmount, parseRate, daysBetween, todayISO,
} from '../calc.js';

export const blankDraft = () => ({
  holderId: '', intendedForId: '', purpose: '', jointHolderIds: [], mode: 'Single', institutionName: '', institutionType: '', branch: '', fdNumber: '',
  amount: '', rate: '', startDate: '', maturityDate: '', interestPayout: 'cumulative', compounding: 'quarterly',
  maturityAmount: '', autoRenew: false, hasNominee: false, nominees: [], status: 'active', notes: '', photos: [],
});

export function draftErrors(d) {
  const e = [];
  if (!d.holderId) e.push(['holderId', 'Choose whose name the FD is in']);
  if (!String(d.institutionName).trim()) e.push(['institutionName', 'Enter the bank / institution name']);
  if (!parseAmount(d.amount)) e.push(['amount', 'Enter the amount']);
  if (parseRate(d.rate) === null) e.push(['rate', 'Enter the interest rate']);
  if (!isISO(d.startDate)) e.push(['startDate', 'Enter the start date']);
  if (!isISO(d.maturityDate)) e.push(['maturityDate', 'Enter the maturity date']);
  if (isISO(d.startDate) && isISO(d.maturityDate) && d.maturityDate <= d.startDate) e.push(['maturityDate', 'Maturity date must be after the start date']);
  return e;
}

const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
const seg = (field, options, value) => `<div class="seg" role="group">${options.map(([v, l]) => `<button type="button" data-seg="${field}" data-v="${esc(v)}" class="${String(value) === String(v) ? 'on' : ''}" aria-pressed="${String(value) === String(v)}">${esc(l)}</button>`).join('')}</div>`;

// Full FD editor. Mutates `d` in place. extraPeople = [{id:'new:Name', name}] for imports.
export function fdEditor(el, d, { extraPeople = [], showStatus = false, showErrors = false } = {}) {
  let showErr = showErrors;
  const people = () => [...state.people, ...extraPeople];
  const instNames = [...new Set(state.fds.map((f) => f.institutionName.trim()))].sort();
  const uid = Math.random().toString(36).slice(2, 7);

  const html = () => {
    const errs = showErr ? Object.fromEntries(draftErrors(d)) : {};
    const bad = (f) => (errs[f] ? 'bad' : '');
    const errLine = (f) => (errs[f] ? `<div class="small" style="color:var(--danger-ink);font-weight:600">${esc(errs[f])}</div>` : '');
    const others = people().filter((p) => p.id !== d.holderId);
    return `
    <section class="card form-section">
      <h2><span class="step-no">1</span> Whose FD, and where</h2>
      <div class="field"><label for="holder-${uid}">In the name of</label>
        <select class="input ${bad('holderId')}" id="holder-${uid}" data-f="holderId">
          ${opt('', 'Choose a person…', !d.holderId)}
          ${people().map((p) => opt(p.id, p.name, p.id === d.holderId)).join('')}
          ${opt('__new', '+ Add a new person', false)}
        </select>${errLine('holderId')}</div>
      ${others.length ? `<div class="field"><span class="label">Joint holders <span class="muted">(if any)</span></span>
        <div class="chips">${others.map((p) => `<button type="button" class="chip ${d.jointHolderIds.includes(p.id) ? 'on' : ''}" data-joint="${esc(p.id)}" aria-pressed="${d.jointHolderIds.includes(p.id)}">${d.jointHolderIds.includes(p.id) ? icon('check') : ''}${esc(p.name)}</button>`).join('')}</div></div>` : ''}
      ${d.jointHolderIds.length ? `<div class="field"><span class="label">Mode of operation</span>${seg('mode', MODES.slice(1).map((m) => [m, m]), d.mode)}</div>` : ''}
      <div class="field"><label for="for-${uid}">Who is this FD meant for?</label>
        <select class="input" id="for-${uid}" data-f="intendedForId">
          ${opt('', d.holderId ? `Same person (${people().find((p) => p.id === d.holderId)?.name || 'holder'})` : 'Same person as the FD holder', !d.intendedForId || d.intendedForId === d.holderId)}
          ${others.map((p) => opt(p.id, p.name, p.id === d.intendedForId)).join('')}
          ${opt('__new', '+ Add a new person', false)}
        </select>
        <div class="hint">Change this when the FD is in one person's name but kept for someone else — for example, in Aaji's name for Rahul.</div></div>
      <div class="field"><label for="pur-${uid}">Purpose <span class="muted">(optional)</span></label>
        <input class="input" id="pur-${uid}" data-f="purpose" value="${esc(d.purpose || '')}" placeholder="e.g. Rahul's education, marriage, emergency fund"></div>
      <div class="field"><label for="inst-${uid}">Bank / patasanstha name</label>
        <input class="input ${bad('institutionName')}" id="inst-${uid}" data-f="institutionName" list="insts-${uid}" value="${esc(d.institutionName)}" autocomplete="off" placeholder="e.g. State Bank of India">
        <datalist id="insts-${uid}">${instNames.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>${errLine('institutionName')}</div>
      <div class="field"><label for="type-${uid}">Type</label>
        <select class="input" id="type-${uid}" data-f="institutionType">${opt('', 'Choose type…', !d.institutionType)}${INSTITUTION_TYPES.map((t) => opt(t.id, t.label, t.id === d.institutionType)).join('')}</select></div>
      <div class="grid2">
        <div class="field"><label for="br-${uid}">Branch</label><input class="input" id="br-${uid}" data-f="branch" value="${esc(d.branch)}"></div>
        <div class="field"><label for="no-${uid}">FD / receipt no.</label><input class="input" id="no-${uid}" data-f="fdNumber" value="${esc(d.fdNumber)}"></div>
      </div>
    </section>

    <section class="card form-section">
      <h2><span class="step-no">2</span> Amount and dates</h2>
      <div class="grid2">
        <div class="field"><label for="amt-${uid}">Amount</label><div class="input-wrap"><span class="pre">₹</span>
          <input class="input has-pre num ${bad('amount')}" id="amt-${uid}" data-f="amount" inputmode="decimal" value="${esc(d.amount)}" placeholder="100000"></div>
          <div class="hint" data-words>${parseAmount(d.amount) ? fmtINR(parseAmount(d.amount)) : ''}</div>${errLine('amount')}</div>
        <div class="field"><label for="rate-${uid}">Interest rate</label><div class="input-wrap">
          <input class="input has-post num ${bad('rate')}" id="rate-${uid}" data-f="rate" inputmode="decimal" value="${esc(d.rate)}" placeholder="7.5"><span class="post">%</span></div>${errLine('rate')}</div>
      </div>
      <div class="grid2">
        <div class="field"><label for="sd-${uid}">Start date</label><input class="input ${bad('startDate')}" type="date" id="sd-${uid}" data-f="startDate" value="${esc(d.startDate)}">${errLine('startDate')}</div>
        <div class="field"><label for="md-${uid}">Maturity date</label><input class="input ${bad('maturityDate')}" type="date" id="md-${uid}" data-f="maturityDate" value="${esc(d.maturityDate)}">${errLine('maturityDate')}</div>
      </div>
      <div class="field"><span class="label">Or set the period from the start date</span>
        <div class="chips">${[[6, '6 months'], [12, '1 year'], [24, '2 years'], [36, '3 years'], [60, '5 years']].map(([m, l]) => `<button type="button" class="chip" data-tenure="${m}">${l}</button>`).join('')}
          <button type="button" class="chip" data-tenure="custom">Other…</button></div>
        <div class="hint" data-tenure-label></div></div>
      <div class="field"><label for="po-${uid}">How is interest paid?</label>
        <select class="input" id="po-${uid}" data-f="interestPayout">${PAYOUTS.map((p) => opt(p.id, p.label, p.id === d.interestPayout)).join('')}</select></div>
      ${d.interestPayout === 'cumulative' ? `<div class="field"><label for="cp-${uid}">Interest is added</label>
        <select class="input" id="cp-${uid}" data-f="compounding">${COMPOUNDING.map((c) => opt(c.id, c.label, c.id === d.compounding)).join('')}</select>
        <div class="hint">If unsure, leave as quarterly. Patasansthas sometimes use simple or yearly interest.</div></div>` : ''}
      <div class="estimate" data-estimate></div>
      <div class="field"><label for="ma-${uid}">Maturity amount written on the receipt <span class="muted">(optional)</span></label>
        <div class="input-wrap"><span class="pre">₹</span><input class="input has-pre num" id="ma-${uid}" data-f="maturityAmount" inputmode="decimal" value="${esc(d.maturityAmount ?? '')}"></div>
        <div class="hint">If entered, this is used instead of the estimate.</div></div>
      <div class="field"><span class="label">Auto-renew at maturity?</span>${seg('autoRenew', [[true, 'Yes'], [false, 'No']], !!d.autoRenew)}</div>
    </section>

    <section class="card form-section">
      <h2><span class="step-no">3</span> Nomination</h2>
      <div class="field"><span class="label">Is there a nominee?</span>${seg('hasNominee', [[true, 'Yes'], [false, 'No']], !!d.hasNominee)}</div>
      ${d.hasNominee ? `${d.nominees.map((n, i) => `<div class="nominee">
          <div class="spread"><b>Nominee ${d.nominees.length > 1 ? i + 1 : ''}</b>${d.nominees.length > 1 ? `<button type="button" class="btn quiet small" data-rm-nominee="${i}">Remove</button>` : ''}</div>
          <div class="field"><label for="nn-${uid}-${i}">Name</label><input class="input" id="nn-${uid}-${i}" data-n="${i}" data-nf="name" value="${esc(n.name)}"></div>
          <div class="grid2"><div class="field"><label for="nr-${uid}-${i}">Relation</label><input class="input" id="nr-${uid}-${i}" data-n="${i}" data-nf="relation" value="${esc(n.relation)}" placeholder="Son, Wife…"></div>
          <div class="field"><label for="ns-${uid}-${i}">Share %</label><input class="input num" id="ns-${uid}-${i}" data-n="${i}" data-nf="share" inputmode="numeric" value="${esc(n.share ?? '')}"></div></div>
        </div>`).join('')}
        <button type="button" class="btn small" data-add-nominee>${icon('plus')} Add another nominee</button>` : ''}
    </section>

    <section class="card form-section">
      <h2><span class="step-no">4</span> Photo and notes</h2>
      ${d.photos.length ? `<div class="photos">${d.photos.map((p, i) => `<div class="ph"><img data-photo="${esc(p)}" alt="Receipt photo" data-view="${esc(p)}"><button type="button" class="rm" data-rm-photo="${i}" aria-label="Remove photo">×</button></div>`).join('')}</div>` : ''}
      <button type="button" class="btn" data-add-photo>${icon('camera')} Add photo of receipt</button>
      <div class="field"><label for="nt-${uid}">Notes</label><textarea class="input" id="nt-${uid}" data-f="notes" placeholder="Anything to remember – where the receipt is kept, who to contact…">${esc(d.notes)}</textarea></div>
      ${showStatus ? `<div class="field"><label for="st-${uid}">Status</label><select class="input" id="st-${uid}" data-f="status">${STATUSES.map((s) => opt(s.id, s.label, s.id === d.status)).join('')}</select></div>` : ''}
    </section>`;
  };

  const derived = () => {
    const est = el.querySelector('[data-estimate]');
    const tl = el.querySelector('[data-tenure-label]');
    const words = el.querySelector('[data-words]');
    if (words) words.textContent = parseAmount(d.amount) ? fmtINR(parseAmount(d.amount)) : '';
    if (tl) tl.textContent = isISO(d.startDate) && isISO(d.maturityDate) && d.maturityDate > d.startDate ? `Period: ${tenureLabel(d.startDate, d.maturityDate)}` : '';
    if (!est) return;
    const fd = { ...d, amount: parseAmount(d.amount), rate: parseRate(d.rate), maturityAmount: parseAmount(d.maturityAmount) };
    if (fd.amount && fd.rate && isISO(fd.startDate) && isISO(fd.maturityDate) && fd.maturityDate > fd.startDate) {
      est.innerHTML = d.interestPayout === 'cumulative'
        ? `<span>Estimated amount at maturity</span><b class="num">${fmtINR(estimateMaturityAmount(fd))}</b>`
        : `<span>You get back the ${fmtINR(fd.amount)} at maturity; interest is paid out along the way.</span>`;
      est.classList.remove('hidden');
    } else est.classList.add('hidden');
  };

  const draw = () => { el.innerHTML = html(); derived(); };

  el.oninput = (e) => {
    const t = e.target;
    if (t.dataset.f && t.tagName !== 'SELECT') { d[t.dataset.f] = t.value; t.classList.remove('bad'); derived(); }
    if (t.dataset.n !== undefined) d.nominees[t.dataset.n][t.dataset.nf] = t.value;
  };
  el.onchange = async (e) => {
    const t = e.target;
    if (!t.dataset.f) return;
    if (t.value === '__new' && ['holderId', 'intendedForId'].includes(t.dataset.f)) {
      const name = await dialog({ title: 'Add a family member', input: { label: 'Full name' }, ok: 'Add' });
      if (name && name.trim()) {
        const p = await db.addPerson(name);
        await reload();
        d[t.dataset.f] = p.id;
      }
      return draw();
    }
    d[t.dataset.f] = t.value;
    if (t.dataset.f === 'holderId') {
      d.jointHolderIds = d.jointHolderIds.filter((x) => x !== t.value);
      if (d.intendedForId === t.value) d.intendedForId = '';
    }
    if (t.dataset.f === 'institutionName' && !d.institutionType) {
      const g = guessType(t.value);
      if (g) { d.institutionType = g; el.querySelector('[data-f="institutionType"]').value = g; }
    }
    if (['holderId', 'interestPayout'].includes(t.dataset.f)) draw();
    else derived();
  };
  el.onclick = async (e) => {
    const b = e.target.closest('button, img[data-view]');
    if (!b) return;
    if (b.dataset.view) return viewImage(b.dataset.view);
    if (b.dataset.seg) {
      const v = b.dataset.v;
      d[b.dataset.seg] = v === 'true' ? true : v === 'false' ? false : v;
      if (b.dataset.seg === 'hasNominee' && d.hasNominee && !d.nominees.length) d.nominees.push({ name: '', relation: '', share: '' });
      return draw();
    }
    if (b.dataset.joint) {
      const id = b.dataset.joint;
      d.jointHolderIds = d.jointHolderIds.includes(id) ? d.jointHolderIds.filter((x) => x !== id) : [...d.jointHolderIds, id];
      if (d.jointHolderIds.length && d.mode === 'Single') d.mode = 'Either or Survivor';
      return draw();
    }
    if (b.dataset.tenure) {
      if (!isISO(d.startDate)) {
        toast('Please enter the start date first');
        return el.querySelector('[data-f="startDate"]').focus();
      }
      let months = Number(b.dataset.tenure);
      let days = 0;
      if (b.dataset.tenure === 'custom') {
        const v = await dialog({ title: 'FD period', body: 'Enter months, or days followed by "d" (for example 15 for 15 months, or 400d for 400 days).', input: { label: 'Period', inputmode: 'text' }, ok: 'Set' });
        if (!v) return;
        const m = v.trim().match(/^(\d+)\s*(d|days?)?$/i);
        if (!m) return toast('Could not understand that period');
        if (m[2]) { months = 0; days = Number(m[1]); } else months = Number(m[1]);
      }
      const end = addMonths(d.startDate, months);
      d.maturityDate = days ? new Date(toUTC(end) + days * 86400000).toISOString().slice(0, 10) : end;
      el.querySelector('[data-f="maturityDate"]').value = d.maturityDate;
      return derived();
    }
    if (b.dataset.addNominee !== undefined) { d.nominees.push({ name: '', relation: '', share: '' }); return draw(); }
    if (b.dataset.rmNominee !== undefined) { d.nominees.splice(Number(b.dataset.rmNominee), 1); return draw(); }
    if (b.dataset.rmPhoto !== undefined) { d.photos.splice(Number(b.dataset.rmPhoto), 1); return draw(); }
    if (b.dataset.addPhoto !== undefined) {
      const file = await pickFile('image/*');
      if (!file) return;
      b.disabled = true;
      b.textContent = 'Saving photo…';
      try { d.photos.push(await addPhoto(file)); } catch (err) { toast(err.message); }
      return draw();
    }
  };

  draw();
  return {
    errors: () => draftErrors(d),
    showErrors: () => { showErr = true; draw(); },
    redraw: draw,
  };
}

export const toPayload = (d) => ({
  ...d,
  amount: parseAmount(d.amount),
  rate: parseRate(d.rate),
  maturityAmount: parseAmount(d.maturityAmount),
  institutionType: d.institutionType || guessType(d.institutionName) || 'other',
  nominees: d.nominees.map((n) => ({ ...n, share: n.share === '' ? null : Number(n.share) })),
});

export function render({ root, params: [id], mode, query }) {
  let d, title, sub, saveLabel;
  const src = id && state.fds.find((f) => f.id === id);
  if (mode !== 'new' && !src) throw new Error('This FD was not found.');
  if (mode === 'new') {
    d = blankDraft();
    if (query.get('person')) d.holderId = query.get('person');
    if (!state.people.length) d.holderId = '';
    title = 'Add an FD';
    sub = 'Fill in what you know. Fields marked in red are needed.';
    saveLabel = 'Save FD';
  } else if (mode === 'edit') {
    d = structuredClone(src);
    d.maturityAmount = d.maturityAmount ?? '';
    title = 'Edit FD';
    sub = `${src.institutionName}`;
    saveLabel = 'Save changes';
  } else {
    // Renew: new FD starts on the old maturity date with the maturity amount (if cumulative).
    const months = Math.max(1, Math.round(daysBetween(src.startDate, src.maturityDate) / 30.44));
    d = {
      ...blankDraft(),
      ...structuredClone(src),
      amount: src.interestPayout === 'cumulative' ? Math.round(maturityValue(src)) : src.amount,
      startDate: src.maturityDate,
      maturityDate: addMonths(src.maturityDate, months),
      maturityAmount: '', fdNumber: '', notes: '', photos: [], status: 'active',
    };
    title = 'Renew FD';
    sub = `Details are copied from the old FD. Please check the new interest rate, amount and receipt number.`;
    saveLabel = 'Save renewed FD';
  }
  delete d.id;

  root.innerHTML = `
    <a class="back" href="${src ? `#/fd/${src.id}` : '#/add'}">${icon('back')} Back</a>
    <div class="page-head"><div><h1>${title}</h1><p class="sub">${esc(sub)}</p></div></div>
    <div class="stack" id="editor"></div>
    <div class="errors hidden" id="errs" role="alert" style="margin-top:1rem"></div>
    <div class="sticky-save"><button class="btn primary block" id="save">${icon('check')} ${saveLabel}</button></div>`;
  const ed = fdEditor(root.querySelector('#editor'), d, { showStatus: mode === 'edit' && !src?.renewedToId });

  const saveBtn = root.querySelector('#save');
  saveBtn.addEventListener('click', async () => {
    const errs = ed.errors();
    const box = root.querySelector('#errs');
    if (errs.length) {
      ed.showErrors();
      box.textContent = 'Please fix: ' + errs.map((x) => x[1]).join(', ');
      box.classList.remove('hidden');
      root.querySelector('.input.bad')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    saveBtn.disabled = true;
    try {
      const payload = toPayload(d);
      const saved = mode === 'new' ? await db.createFd({ ...payload, source: 'manual' })
        : mode === 'edit' ? await db.updateFd(src.id, payload)
        : await db.renewFd(src.id, payload);
      await reload();
      toast(mode === 'renew' ? 'Renewed FD saved' : 'Saved');
      go(`#/fd/${saved.id}`);
    } catch (err) {
      box.textContent = err.message;
      box.classList.remove('hidden');
      saveBtn.disabled = false;
    }
  });
}
