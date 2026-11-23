// Makes a backup file full of made-up FDs, to try the app:
//   npm run demo   ->  demo.fdbackup  (password: demo1234)
// Then in the app: More → Restore from a backup file.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { addMonths, todayISO } from '../public/js/calc.js';
import { encryptBackup } from '../public/js/backup.js';

const out = process.argv[2] || 'demo.fdbackup';
const id = () => crypto.randomBytes(6).toString('hex');
const today = todayISO();
const people = ['Ramesh Patil', 'Sunita Patil', 'Kamal Patil', 'Anil Patil', 'Meera Patil', 'Rahul Patil'].map((name) => ({ id: id(), name, relation: '' }));
const P = Object.fromEntries(people.map((p) => [p.name.split(' ')[0], p.id]));
// [holder, joint, institution, type, amount, rate, startMonthsAgo, tenureMonths, payout, nominee]
const rows = [
  ['Ramesh', ['Sunita'], 'State Bank of India', 'bank', 300000, 7.1, 11, 12, 'cumulative', 'Anil Patil'],
  ['Ramesh', [], 'State Bank of India', 'bank', 250000, 6.8, 20, 24, 'quarterly', 'Sunita Patil'],
  ['Ramesh', [], 'Bank of Maharashtra', 'bank', 200000, 7.25, 6, 36, 'cumulative', 'Sunita Patil'],
  ['Ramesh', [], 'Janata Sahakari Bank', 'coop_bank', 150000, 7.75, 13, 12, 'cumulative', ''],
  ['Ramesh', [], 'Shri Ganesh Nagari Sahakari Patsanstha', 'patasanstha', 200000, 9.5, 5, 13, 'cumulative', 'Anil Patil'],
  ['Sunita', [], 'State Bank of India', 'bank', 180000, 7.0, 3, 24, 'cumulative', 'Rahul Patil'],
  ['Sunita', [], 'Post Office', 'post_office', 300000, 7.5, 14, 60, 'yearly', 'Ramesh Patil'],
  ['Sunita', [], 'Shri Ganesh Nagari Sahakari Patsanstha', 'patasanstha', 100000, 9.25, 9, 12, 'cumulative', 'Ramesh Patil'],
  ['Sunita', ['Ramesh'], 'Bank of Maharashtra', 'bank', 120000, 6.9, 22, 24, 'cumulative', 'Meera Patil'],
  ['Kamal', [], 'Post Office', 'post_office', 450000, 7.4, 8, 60, 'monthly', 'Anil Patil'],
  ['Kamal', [], 'Janata Sahakari Bank', 'coop_bank', 300000, 8.0, 4, 24, 'quarterly', 'Anil Patil'],
  ['Kamal', [], 'Samarth Krupa Patsanstha', 'patasanstha', 150000, 10.0, 10, 12, 'cumulative', ''],
  ['Kamal', [], 'State Bank of India', 'bank', 200000, 7.5, 2, 12, 'cumulative', 'Anil Patil'],
  ['Anil', ['Meera'], 'HDFC Bank', 'bank', 400000, 7.1, 7, 15, 'cumulative', 'Rahul Patil'],
  ['Anil', [], 'HDFC Bank', 'bank', 250000, 6.6, 16, 18, 'cumulative', 'Meera Patil'],
  ['Anil', [], 'Bajaj Finance', 'nbfc', 200000, 8.25, 12, 36, 'cumulative', 'Meera Patil'],
  ['Meera', [], 'ICICI Bank', 'bank', 150000, 6.9, 11, 12, 'cumulative', 'Anil Patil'],
  ['Meera', [], 'Shri Ganesh Nagari Sahakari Patsanstha', 'patasanstha', 75000, 9.0, 1, 24, 'cumulative', ''],
  ['Rahul', [], 'Bank of Maharashtra', 'bank', 50000, 6.5, 4, 12, 'cumulative', 'Meera Patil'],
  ['Rahul', [], 'Post Office', 'post_office', 100000, 7.5, 18, 60, 'cumulative', 'Meera Patil'],
];
const fds = rows.map(([h, joint, inst, type, amount, rate, ago, ten, payout, nominee], i) => {
  const start = addMonths(today, -ago);
  const startDate = addMonths(start, 0).slice(0, 8) + String(((i * 7) % 26) + 1).padStart(2, '0');
  return {
    id: id(), holderId: P[h], jointHolderIds: joint.map((j) => P[j]), mode: joint.length ? 'Either or Survivor' : 'Single',
    institutionName: inst, institutionType: type, branch: ['Kothrud', 'Deccan', 'Main', 'Aundh'][i % 4], fdNumber: String(40210000 + i * 137),
    amount, rate, startDate, maturityDate: addMonths(startDate, ten), interestPayout: payout, compounding: type === 'patasanstha' ? 'yearly' : 'quarterly',
    maturityAmount: null, autoRenew: i % 5 === 0, hasNominee: !!nominee, nominees: nominee ? [{ name: nominee, relation: '', share: 100 }] : [],
    status: 'active', closedOn: null, notes: '', photos: [], renewedFromId: null, renewedToId: null, source: 'manual',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
});
// Some FDs are in one person's name but meant for someone else
const R = (i, who, purpose) => Object.assign(fds[i], { intendedForId: P[who], purpose });
R(10, 'Rahul', "Rahul's higher education");
R(12, 'Meera', 'Gift for Meera');
R(19, 'Rahul', '');
for (const f of fds) { f.intendedForId ??= null; f.purpose ??= ''; }
// One renewal chain
const old = { ...fds[0], id: id(), startDate: addMonths(fds[0].startDate, -12), maturityDate: fds[0].startDate, amount: 280000, rate: 6.9, status: 'renewed', closedOn: fds[0].startDate, renewedToId: fds[0].id };
fds[0].renewedFromId = old.id;
fds[0].amount = 300000;
fds.push(old);
const db = {
  version: 2, people, fds,
  settings: { lockMinutes: 15, alerts: false },
  meta: { createdAt: new Date().toISOString(), changedAt: new Date().toISOString(), lastBackupAt: null },
};
fs.writeFileSync(out, await encryptBackup({ createdAt: new Date().toISOString(), db, photos: {} }, 'demo1234'));
console.log(`Demo backup written to ${out} (password: demo1234). In the app: More → Restore from a backup file.`);
