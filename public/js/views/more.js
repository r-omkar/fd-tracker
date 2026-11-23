import { state, esc, icon, reload, toast, dialog, confirmBox, alertBox, pickFile, shareOrDownload, downloadBlob, go, personName } from '../ui.js';
import * as db from '../db.js';
import { exportXlsx, calendarIcs } from '../excel.js';
import { alertStatus, enableAlerts, disableAlerts, testAlert } from '../alerts.js';
import { fmtShort, fmtDate } from '../calc.js';

const store = {
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch {} },
};
const stamp = () => new Date().toISOString().slice(0, 10);
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

export async function render({ root }) {
  const size = document.documentElement.dataset.size || 'normal';
  const theme = document.documentElement.dataset.theme || 'auto';
  const last = state.meta.lastBackupAt;
  const fpAvail = await db.fingerprintAvailable();
  const persisted = await db.isPersisted();

  root.innerHTML = `
    <div class="page-head"><div><h1>More</h1></div></div>
    <div class="stack">
      <a class="card big-choice" href="#/people"><div class="ic">${icon('people')}</div>
        <div style="flex:1"><h2>Family members</h2><p class="ink2">${state.people.length} people · add or rename</p></div>${icon('chevron')}</a>

      <section class="card form-section" id="backup-card">
        <h2 class="row" style="gap:.5rem">${icon('shield')} Backup</h2>
        <p class="ink2">Your FDs are saved <b>only on this phone</b>. If the phone is lost or reset, they are gone — so keep a backup file somewhere else (send it to yourself on WhatsApp, Google Drive or email). The file is locked with a password you choose.</p>
        <p class="${last ? 'ink2' : ''}" style="font-weight:600;${last ? '' : 'color:var(--warn-ink)'}">${last ? `Last backup: ${fmtDate(last.slice(0, 10))}` : 'No backup made yet'}</p>
        <button class="btn primary block" id="backup">${icon('share')} Make a backup file</button>
        <button class="btn block" id="restore">${icon('upload')} Restore from a backup file</button>
        <p class="muted small">To give another family member a copy, send them the backup file and its password; they open FD Tracker on their phone and choose "Restore". Their copy won't update by itself.</p>
      </section>

      <section class="card form-section">
        <h2 class="row" style="gap:.5rem">${icon('bell')} Maturity alerts</h2>
        <div id="alerts" class="muted">Checking…</div>
      </section>

      <section class="card form-section">
        <h2 class="row" style="gap:.5rem">${icon('text')} Text size</h2>
        <div class="seg" role="group" aria-label="Text size">${[['normal', 'Normal'], ['large', 'Large'], ['xl', 'Extra large']].map(([v, l]) => `<button data-size="${v}" class="${size === v ? 'on' : ''}" aria-pressed="${size === v}">${l}</button>`).join('')}</div>
        <h2 style="margin-top:.5rem">Colours</h2>
        <div class="seg" role="group" aria-label="Colour theme">${[['auto', 'Same as phone'], ['light', 'Light'], ['dark', 'Dark']].map(([v, l]) => `<button data-theme="${v}" class="${theme === v ? 'on' : ''}" aria-pressed="${theme === v}">${l}</button>`).join('')}</div>
      </section>

      <section class="card form-section">
        <h2 class="row" style="gap:.5rem">${icon('lock')} App lock</h2>
        <div class="field"><label for="lockm">Ask for PIN again after</label>
          <select class="input" id="lockm">${[5, 15, 30, 60, 240].map((m) => `<option value="${m}" ${state.settings.lockMinutes === m ? 'selected' : ''}>${m < 60 ? `${m} minutes` : `${m / 60} hour${m > 60 ? 's' : ''}`} of not using it</option>`).join('')}</select></div>
        ${fpAvail ? `<div class="field"><span class="label">Unlock with fingerprint</span>
          <div class="seg" role="group">${[['on', 'On'], ['off', 'Off']].map(([v, l]) => `<button data-fp="${v}" class="${(db.fingerprintOn() ? 'on' : 'off') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
          <div class="hint">Uses the phone's own fingerprint or face lock. The PIN always works too.</div></div>` : ''}
        <div class="actions inline"><button class="btn" id="chpin">Change PIN</button><button class="btn" id="lock">${icon('lock')} Lock now</button></div>
      </section>

      <section class="card form-section">
        <h2 class="row" style="gap:.5rem">${icon('download')} Export</h2>
        <button class="btn block" id="xlsx">${icon('sheet')} All FDs as Excel</button>
        <button class="btn block" id="ics">${icon('calendar')} Maturity dates for the calendar</button>
        <p class="muted small">The calendar file adds each maturity date with reminders 30 and 7 days before. If the phone's calendar syncs to Google or iCloud, these entries (bank and amount) will be stored there.</p>
      </section>

      <section class="card form-section">
        <h2 class="row" style="gap:.5rem">${icon('phone')} This phone</h2>
        ${isStandalone() ? `<p><span class="pill active">${icon('check')} Installed</span> FD Tracker is on the home screen.</p>`
          : window.__installPrompt ? `<button class="btn primary block" id="install">${icon('download')} Add FD Tracker to home screen</button>`
          : `<p class="ink2">To get an app icon: in Chrome tap the ⋮ menu → <b>Add to Home screen</b> (or <b>Install app</b>). On iPhone: Safari Share → <b>Add to Home Screen</b>.</p>`}
        <p class="ink2">${persisted ? `${icon('check')} Storage is protected — the phone won't clear it to free up space.` : 'Storage protection: not yet granted. Installing the app to the home screen usually turns it on.'}</p>
        <p class="ink2">Works without internet. Nothing you type is sent anywhere.</p>
        <button class="btn danger block" id="wipe">${icon('trash')} Delete all data on this phone</button>
      </section>
    </div>`;

  // ----- backup -----
  root.querySelector('#backup').addEventListener('click', async () => {
    const pw = await dialog({ title: 'Choose a backup password', body: 'At least 6 characters. <b>Write it down</b> — without it the backup cannot be opened.', input: { label: 'Password', type: 'password' }, ok: 'Next' });
    if (!pw) return;
    if (pw.length < 6) return alertBox('Password too short', 'Please use at least 6 characters.');
    const again = await dialog({ title: 'Type the password again', input: { label: 'Password', type: 'password' }, ok: 'Make backup' });
    if (again !== pw) return alertBox('Passwords did not match', 'No backup was made. Please try again.');
    try {
      const bytes = await db.makeBackup(pw);
      const how = await shareOrDownload(new Blob([bytes], { type: 'application/octet-stream' }), `FD-backup-${stamp()}.fdbackup`, 'FD Tracker backup');
      await reload();
      if (how !== 'cancelled') toast(how === 'shared' ? 'Backup ready' : 'Backup saved to Downloads');
      render({ root });
    } catch (e) { alertBox('Backup failed', esc(e.message)); }
  });
  root.querySelector('#restore').addEventListener('click', async () => {
    const file = await pickFile('.fdbackup,application/octet-stream,*/*');
    if (!file) return;
    const pw = await dialog({ title: 'Restore backup', body: `This replaces <b>all</b> FDs and family members on this phone with the ones in <b>${esc(file.name)}</b>. Your PIN stays the same.`, input: { label: 'Backup password', type: 'password' }, ok: 'Restore', danger: true });
    if (!pw) return;
    try {
      const r = await db.restoreBackup(await file.arrayBuffer(), pw);
      await reload();
      await alertBox('Backup restored', `${r.fds} FDs and ${r.people} family members restored.`);
      go('#/overview');
    } catch (e) { alertBox('Restore failed', esc(e.message)); }
  });

  // ----- alerts -----
  const alertsBox = root.querySelector('#alerts');
  const drawAlerts = async () => {
    const st = await alertStatus().catch(() => ({ supported: false }));
    alertsBox.className = '';
    if (!st.supported) {
      alertsBox.innerHTML = `<p class="ink2">This browser can't show alerts. FDs maturing in the next 30 days are always shown at the top of the Overview. You can also use "Maturity dates for the calendar" below.</p>`;
      return;
    }
    alertsBox.innerHTML = st.on
      ? `<p><span class="pill active">${icon('check')} On</span> You'll get a phone notification 30 days and 7 days before an FD matures${st.background ? '.' : ', the next time you open the app.'}</p>
         ${st.background ? '' : '<p class="muted small">For alerts without opening the app, add FD Tracker to the home screen (Android, Chrome). Even then, the phone decides when to check — usually about once a day.</p>'}
         <div class="actions inline"><button class="btn small" id="al-test">Send a test alert</button><button class="btn quiet small" id="al-off">Turn off</button></div>`
      : `<p class="ink2">Get a phone notification 30 days and 7 days before each FD matures.</p>
         ${st.permission === 'denied' ? '<p style="color:var(--danger-ink);font-weight:600">Notifications are blocked for this app. Allow them in phone Settings → Apps → Chrome → Notifications.</p>' : ''}
         <button class="btn primary block" id="al-on">${icon('bell')} Turn on alerts</button>`;
    alertsBox.querySelector('#al-on')?.addEventListener('click', async () => {
      try { await enableAlerts(); toast('Alerts turned on'); } catch (e) { alertBox('Alerts not turned on', esc(e.message)); }
      drawAlerts();
    });
    alertsBox.querySelector('#al-off')?.addEventListener('click', async () => { await disableAlerts(); drawAlerts(); });
    alertsBox.querySelector('#al-test')?.addEventListener('click', () => testAlert().catch((e) => toast(e.message)));
  };
  drawAlerts();

  // ----- display -----
  root.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.size === 'normal' ? '' : b.dataset.size;
    if (v) document.documentElement.dataset.size = v; else delete document.documentElement.dataset.size;
    store.set('fd.size', v);
    render({ root });
  }));
  root.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    const v = b.dataset.theme === 'auto' ? '' : b.dataset.theme;
    if (v) document.documentElement.dataset.theme = v; else delete document.documentElement.dataset.theme;
    store.set('fd.theme', v);
    render({ root });
  }));

  // ----- lock -----
  root.querySelector('#lockm').addEventListener('change', async (e) => { await db.updateSettings({ lockMinutes: Number(e.target.value) }); toast('Saved'); });
  root.querySelector('#lock').addEventListener('click', () => location.reload());
  root.querySelectorAll('[data-fp]').forEach((b) => b.addEventListener('click', async () => {
    try {
      if (b.dataset.fp === 'on' && !db.fingerprintOn()) { await db.enableFingerprint(); toast('Fingerprint unlock is on'); }
      if (b.dataset.fp === 'off' && db.fingerprintOn()) { await db.disableFingerprint(); toast('Fingerprint unlock is off'); }
    } catch (e) {
      alertBox('Fingerprint not set up', 'The phone did not confirm the fingerprint. You can keep using your PIN.');
    }
    render({ root });
  }));
  root.querySelector('#chpin').addEventListener('click', async () => {
    const oldPin = await dialog({ title: 'Change PIN', input: { label: 'Current PIN', type: 'password', inputmode: 'numeric' }, ok: 'Next' });
    if (!oldPin) return;
    try { await db.checkPin(oldPin); } catch (e) { return alertBox('PIN not changed', esc(e.message)); }
    const newPin = await dialog({ title: 'Change PIN', input: { label: 'New PIN (4–8 digits)', type: 'password', inputmode: 'numeric' }, ok: 'Next' });
    if (!newPin) return;
    const again = await dialog({ title: 'Change PIN', input: { label: 'New PIN again', type: 'password', inputmode: 'numeric' }, ok: 'Change PIN' });
    if (again !== newPin) return alertBox('PINs did not match', 'Nothing was changed.');
    try { await db.setPin(newPin); toast('PIN changed'); } catch (e) { alertBox('PIN not changed', esc(e.message)); }
  });

  // ----- export -----
  root.querySelector('#xlsx').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try { await shareOrDownload(await exportXlsx(state.fds, personName), `FDs-${stamp()}.xlsx`, 'FD list'); } finally { render({ root }); }
  });
  root.querySelector('#ics').addEventListener('click', () => downloadBlob(calendarIcs(state.fds, personName), 'FD-maturities.ics'));

  // ----- this phone -----
  root.querySelector('#install')?.addEventListener('click', async () => {
    const p = window.__installPrompt;
    window.__installPrompt = null;
    await p.prompt();
    await p.userChoice.catch(() => {});
    render({ root });
  });
  root.querySelector('#wipe').addEventListener('click', async () => {
    if (!(await confirmBox('Delete everything?', 'All FDs, family members, photos and the PIN will be removed from this phone. <b>This cannot be undone.</b> Make a backup first if you may need them.', 'Delete everything', true))) return;
    const word = await dialog({ title: 'Are you sure?', body: 'Type DELETE to confirm.', input: { label: 'Type DELETE' }, ok: 'Delete everything', danger: true });
    if (String(word).trim().toUpperCase() !== 'DELETE') return;
    await db.wipeAll();
    location.hash = '';
    location.reload();
  });
}

export function renderPeople({ root }) {
  const counts = (id) => {
    const fds = state.fds.filter((f) => f.status === 'active' && (f.holderId === id || f.jointHolderIds.includes(id)));
    const forThem = state.fds.filter((f) => f.status === 'active' && (f.intendedForId || f.holderId) === id);
    return { n: fds.length, amt: fds.filter((f) => f.holderId === id).reduce((s, f) => s + f.amount, 0), forAmt: forThem.reduce((s, f) => s + f.amount, 0), forN: forThem.length };
  };
  root.innerHTML = `
    <a class="back" href="#/more">${icon('back')} More</a>
    <div class="page-head"><div><h1>Family members</h1><p class="sub">People whose names FDs are in.</p></div></div>
    <div class="stack">
      ${state.people.length ? `<div class="card"><div class="list-plain">${state.people.map((p) => {
        const c = counts(p.id);
        return `<div class="spread">
          <div style="min-width:0"><b>${esc(p.name)}</b>
            <div class="ink2 small">${c.n ? `${c.n} FD${c.n > 1 ? 's' : ''} in their name${c.amt ? ` · ${fmtShort(c.amt)}` : ''}` : 'No FDs in their name'}${c.forN && c.forAmt !== c.amt ? `<br>Meant for them: ${fmtShort(c.forAmt)}` : ''}</div></div>
          <div class="row" style="gap:.25rem"><a class="btn small" href="#/fds?person=${p.id}">FDs</a><button class="btn quiet small" data-edit="${p.id}">Edit</button></div>
        </div>`;
      }).join('')}</div></div>` : `<div class="card"><div class="empty">${icon('people')}<p>No family members yet.</p></div></div>`}
      <button class="btn primary block" id="add">${icon('plus')} Add family member</button>
    </div>`;
  root.querySelector('#add').addEventListener('click', async () => {
    const name = await dialog({ title: 'Add family member', input: { label: 'Full name (as on FD receipts)' }, ok: 'Add' });
    if (!name?.trim()) return;
    await db.addPerson(name);
    await reload();
    renderPeople({ root });
  });
  root.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', async () => {
    const p = state.people.find((x) => x.id === b.dataset.edit);
    const name = await dialog({ title: 'Edit name', body: 'To remove this person, clear the name and press Save.', input: { label: 'Full name', value: p.name }, ok: 'Save' });
    if (name === null) return;
    try {
      if (!name.trim()) {
        if (await confirmBox(`Remove ${esc(p.name)}?`, 'You can only remove someone who has no FDs.', 'Remove', true)) await db.deletePerson(p.id);
      } else await db.renamePerson(p.id, name);
    } catch (e) { return alertBox('Not changed', esc(e.message)); }
    await reload();
    renderPeople({ root });
  }));
}
