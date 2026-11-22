# FD Tracker

A calm, simple phone app for keeping track of the family's Fixed Deposits: whose name each FD is in, when it matures, its interest rate and nominee details.

**Your data stays on the phone.** FD Tracker is a web app you install on the phone's home screen (a "PWA"). Everything you enter is saved inside the phone. There's no account and no server, and it works without internet. The only thing ever downloaded is the app itself.

## What it does

- **Overview**
  - First: FDs that have **matured and need action**, then FDs **maturing in the next 30 days**.
  - Totals: the total invested, the expected amount at maturity and the average interest rate.
  - Breakdowns: by family member, by bank, and a 12-month maturity calendar.
  - Insights: the DICGC ₹5 lakh insurance check per person per bank, how much is in uninsured patasansthas and company FDs, FDs with no nominee, the spread of rates, and interest earned this financial year (useful for ITR and Form 15G/15H).
- **All FDs:** large, easy-to-read cards with search, filters and sorting.
- **Adding FDs**
  - **Type it in:** a 4-step form. Tap "1 year" and the maturity date and estimated maturity amount are filled in.
  - **From Excel / CSV:** columns are matched automatically (English or Marathi headers) and you can correct the matching. Everything is checked before saving, and FDs you've already saved are skipped. A template is included.
  - **Photo of the receipt:** can be attached to any FD.
- **Renew** pre-fills the new FD from the old one and keeps the renewal history.
- **Maturity alerts:** phone notifications 30 days and 7 days before each maturity, and on the day it matures.
- **PIN lock,** with optional fingerprint unlock using the phone's own screen lock.
- **Text size:** Normal, Large or Extra large. Light and dark modes.
- **Backup:** a password-protected backup file you can send to yourself on WhatsApp, Google Drive or email, and restore on any phone.
- **Export:** to Excel, and to a calendar file.

## Putting it on the phone

The app is just the files in `public/`. They need to be served once over **https** so the phone can install the app. After that it runs offline.

### Option A: GitHub Pages (free, recommended)

1. Create a GitHub repository and upload this folder.
2. In the repository, go to **Settings → Pages → Source: GitHub Actions**.
3. The workflow in `.github/workflows/pages.yml` publishes the app at `https://<your-username>.github.io/<repo-name>/`.

Only the app's code is published. Anyone who opens the link gets an **empty** app on their own phone; nobody can see your FDs.

### Option B: any static web host

Upload the contents of `public/` to any host that serves https, for example Netlify or Cloudflare Pages.

### On the phone (Android, Chrome)

1. Open the link once.
2. Tap ⋮ → **Add to Home screen** (or **Install app**).
3. Open FD Tracker from the home screen and create a PIN.
4. Go to **More → Maturity alerts → Turn on alerts**.
5. Add family members, then add FDs by typing them in or from Excel.
6. Go to **More → Make a backup file** and send the file to yourself.

On an iPhone, use Safari Share → **Add to Home Screen**.

## Important: one phone holds the data

- The FDs live on **one** phone. Choose the senior's phone as the main one.
- Others can get a **copy**: send them the backup file and its password, and they use **More → Restore**. Their copy does not update by itself.
- **Make a backup regularly.** The app reminds you on the Overview. If the phone is lost, reset, or Chrome's data is cleared, the FDs can only be brought back from a backup file.
- Installing the app to the home screen asks Chrome to protect its storage from automatic clean-up. **More → This phone** shows whether that protection is on.

## About the alerts

When the app is installed on Android, Chrome checks in the background about once a day and shows a notification. Android decides exactly when, so alerts can come a day late, and battery-saver modes can delay them further. Each alert appears once.

The Overview always shows what's maturing, whatever the alerts do. If the calendar suits you better, **More → Maturity dates for the calendar** adds the dates with reminders 30 and 7 days before.

## Try it with demo data

These commands need Node.js 20 or newer. First install the dependencies:

```bash
npm install
```

Create a backup file full of made-up FDs (`demo.fdbackup`, password `demo1234`):

```bash
npm run demo
```

Start a preview of the app at http://localhost:8080:

```bash
npm start
```

Then go to **More → Restore from a backup file** and choose `demo.fdbackup`.

## For developers

- No build step: vanilla JS ES modules in `public/`.
  - `js/db.js`: IndexedDB storage and the data model
  - `js/calc.js`: interest calculations, dates and parsers
  - `js/excel.js`: Excel/CSV import and export (uses the bundled `vendor/exceljs.min.js`, MIT licence)
  - `js/backup.js`: AES-GCM + PBKDF2 encrypted backups
  - `sw.js`: offline cache and maturity alerts
- Releasing an update: change `VERSION` in `public/sw.js`. Phones pick up the new version the next time the app is opened with internet.
- Maturity amounts are estimates (bank-style quarterly compounding unless set otherwise). Entering the amount from the receipt overrides the estimate.
