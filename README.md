# Tally

Tally turns an uploaded invoice into a picking checklist.

- **Admins** upload an invoice (PDF or image). Tally reads the invoice number, customer, date and
  line items, and the admin checks the lines and publishes a checklist.
- **Staff** find the checklist by invoice number or customer name. They tick items as they collect
  them, photograph the collected goods and submit for review.
- **Admins are notified live.** They compare the photos with the checklist, then **approve** it or
  **return** it to staff with a note saying what to fix.

It is a single Node.js server with a SQLite database and a plain HTML/JavaScript frontend. There is
no build step and no external database.

---

## Requirements

- **Node.js 22.13 or newer** (Node 24 recommended). Tally uses the built-in `node:sqlite` module.
- About 150 MB of disk space for dependencies, plus room for uploaded invoices and photos.
- Internet access the first time an image or scanned PDF is read, to download OCR language data
  (see [How invoice reading works](#how-invoice-reading-works)).

Check your version in PowerShell:

```powershell
node --version
```

## Install and run (Windows PowerShell)

```powershell
cd C:\path\to\tally
npm install
npm start
```

Then open <http://localhost:3000> (or run `Start-Process http://localhost:3000`).

The console prints `Tally is running at http://localhost:3000`. Stop the server with **Ctrl+C**.

To use another port for one session:

```powershell
$env:PORT = "8080"; npm start
```

For settings you want to keep, copy the example file and edit it. `npm start` reads `.env`
automatically:

```powershell
Copy-Item .env.example .env
notepad .env
```

`npm run dev` starts the server in watch mode, restarting when a server file changes.

The same commands work on macOS and Linux (use `cp` instead of `Copy-Item`).

## First sign-in and the admin password

On the first run Tally creates an admin account:

| Username | Password   |
|----------|------------|
| `admin`  | `admin123` |

The console shows a loud warning while this default password is in use. **Change it straight away.**
There are two ways:

- **Before the first run:** set `ADMIN_USERNAME` and/or `ADMIN_PASSWORD` in `.env` (or in the
  environment). These are used only when the database has no admin yet, so changing them later
  does nothing.

  ```powershell
  $env:ADMIN_PASSWORD = "a-long-private-password"; npm start
  ```

- **In the app:** sign in at **Admin sign-in**, then choose **Change password** at the bottom of the
  left rail (the key icon on narrow screens). New passwords need at least 8 characters. Your other
  signed-in devices are signed out.

## Creating staff accounts

1. Sign in as an admin and open **Staff accounts**.
2. Choose **Add staff account** and enter a display name (shown in notifications and activity), a
   username (3–40 letters, numbers, dots, dashes or underscores), a password (at least 8
   characters) and a role:
   - **Staff** can find, pick and submit checklists.
   - **Admin** has full access: uploads, reviews and accounts.
3. Give the person their username and password. Staff sign in through **Staff sign-in** on the
   start page.

From the same table you can **Rename** an account, **Reset password** (signs that person out
everywhere), change the role, or turn **Access** off. A deactivated account can't sign in and its
open sessions end immediately; its past work stays in the records. You can't deactivate or demote
your own account.

Staff who forget their password should ask an admin to reset it.

## How invoice reading works

When an admin uploads an invoice, Tally tries to fill in the invoice number, customer name, date
and line items (description, SKU, quantity, unit). **Nothing reaches staff until an admin has
reviewed the lines and pressed Publish checklist.** Every automatic reading can be corrected by
hand, and the draft shows how the invoice was read, with any warnings.

Invoices can be PDF, JPEG, PNG or WEBP files up to 20 MB.

1. **PDFs with a text layer** (most PDFs exported from billing or accounting software): the text is
   read directly and parsed into lines. This is fast and usually exact.
2. **Images and scanned PDFs:** Tally runs OCR (text recognition) with tesseract.js. Scanned PDFs are
   rendered page by page, up to the first 5 pages. OCR makes character mistakes, so check these
   lines carefully.
   - The first time OCR is needed, Tally downloads the English language data (about 5 MB) into
     `data/cache`. After that it works offline. Without internet access on that first use, the draft
     is created with no lines and a warning, and you add the lines by hand.
3. **Optional AI extraction with Claude:** if `ANTHROPIC_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`) is set
   and `EXTRACTOR` is `auto` (the default) or `claude`, Tally sends the invoice to Claude and uses
   the structured result.
   - **Uploaded invoice files are then sent to the Anthropic API.** Only use this if that is
     acceptable for your invoices. Set `EXTRACTOR=local` to make sure invoices never leave the
     server.
   - If the AI call fails, or the file type or size isn't supported, Tally falls back to local
     reading and shows a warning.

If nothing can be read, the draft is still created with a warning. Add the lines manually, or use
**Re-read invoice**.

## Configuration

All settings are optional environment variables. Put them in `.env` (see `.env.example`) or set
them in the shell before `npm start`. A number that is out of range (for example `0`, a negative
value, or more than the maximum below) is ignored with a warning at startup, and the default is used.
The admin and staff apps ask the server for the upload limits after sign-in, so they check files
against the values you set here.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DATA_DIR` | `<project>/data` | Folder for the database, uploads and OCR cache |
| `SESSION_TTL_HOURS` | `168` | How long a sign-in lasts (7 days). At most 87600 (10 years) |
| `MAX_INVOICE_MB` | `20` | Largest invoice upload (at most 1024) |
| `MAX_PHOTO_MB` | `15` | Largest single photo (at most 1024) |
| `MAX_PHOTOS_PER_UPLOAD` | `10` | Photos per upload request, a whole number from 1 to 100 |
| `ADMIN_USERNAME` | `admin` | Username of the admin created on first run |
| `ADMIN_PASSWORD` | `admin123` | Password of the admin created on first run |
| `EXTRACTOR` | `auto` | `auto`: Claude when a key is set, else local. `local`: never call Claude. `claude`: Claude, falling back to local on failure |
| `CLAUDE_MODEL` | `claude-opus-5` | Model used for AI extraction |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | — | Setting either enables AI extraction in `auto` mode (invoice files are sent to the Anthropic API) |

## Admin workflow

1. **Upload.** Open **Upload invoice** and drop a file on the drop zone (or browse). Tally uploads
   it, shows *Reading invoice…*, then opens the draft.
2. **Check the draft.** Compare the fields with **View original** (opens the file in a new tab).
   Fix the invoice number, customer and date, then edit, add or delete lines. Warnings about the
   reading are shown at the top. **Save changes** keeps your edits. **Re-read invoice** reads the
   file again and replaces everything.
3. **Publish.** **Publish checklist** makes the checklist visible to staff. It needs an invoice
   number, a customer name and at least one line. Invoice numbers must be unique among published
   checklists.
4. **Follow progress.** The **Queue** has tabs: *Needs review*, *In progress*, *Drafts*,
   *Verified* and *All*, plus a search box. It refreshes live. You can still edit a published
   checklist while staff pick it, and you see their ticks and photos as they arrive.
5. **Review.** When staff submit, you get a live notification: the bell badge, a toast with a
   **Review** button and, if enabled, a desktop alert. Use **Enable desktop alerts** in the bell
   menu. The review screen shows the photos (click one for a full-screen zoomable viewer; arrow
   keys switch photos) next to the checklist, with the staff's ticks and notes. Mark lines **OK** or
   **Issue** as you compare.
6. **Decide.**
   - **Approve** (optional note) closes the checklist as *Verified*.
   - **Return to staff** needs a note saying what to fix. The checklist goes back to the staff
     member, with the lines you marked *Issue* flagged.
   - Either way the submitter is notified. Approved checklists are kept as a read-only record with
     photos and an activity timeline. **Delete** removes an invoice, its photos and its files for
     good.

## Staff workflow

The staff app is designed for phones.

1. **Sign in** through **Staff sign-in**.
2. **Find the checklist.** Type the invoice number or part of the customer name. Results appear as
   you type. *Your checklists* lists the ones you have worked on, with returned ones at the top and
   the admin's note.
3. **Pick.** Tap an item when it is in your basket; it gets a yellow highlighter band. Tap again to
   undo. Use **Add note** on a line for things like "only 3 in stock"; the note saves when you
   leave the field.
4. **Photograph.** **Take or add photos** opens the camera; **Choose from gallery** picks existing
   photos. Take photos that show the collected items together. You can remove photos you added.
5. **Submit.** **Submit for review** needs at least one photo. If some items weren't collected,
   you are asked which ones and why. After submitting, the checklist is read-only and shows
   *Sent to admin for review*.
6. **If it comes back.** A returned checklist shows the admin's note in a red banner, with the lines
   they flagged. Fix it and submit again. You're notified when the admin approves or returns it.

## Where data is stored

Everything lives under `DATA_DIR` (default: the `data` folder in the project):

| Path | Contents |
|---|---|
| `data/tally.db` (plus `tally.db-wal`, `tally.db-shm`) | SQLite database: accounts, sessions, invoices, checklist lines, events, notifications |
| `data/uploads/invoices/` | Original invoice files (random file names) |
| `data/uploads/photos/` | Staff photos (random file names) |
| `data/uploads/tmp/` | Uploads in progress (cleared on start) |
| `data/cache/` | OCR language data (downloaded on first use; safe to delete) |

Files are only served through the signed-in API, never directly. Staff can't download original
invoices.

### Backups

1. Stop the server (Ctrl+C), so the database files are consistent.
2. Copy the whole `data` folder, including the `-wal`/`-shm` files if present:

   ```powershell
   Copy-Item -Recurse data "D:\Backups\tally-$(Get-Date -Format yyyy-MM-dd)"
   ```

3. Start the server again.

To restore, stop the server and replace the `data` folder with the backup.

## Running the tests

```powershell
npm test
```

This runs:

- `tests/heuristics.test.js`: text-to-invoice parsing.
- `tests/extract.test.js`: invoice reading against the sample files in `tests/fixtures`
  (local strategies only). The OCR tests download the language data once into
  `%TEMP%\tally-test-ocr`, and are skipped if it can't be downloaded.
- `tests/e2e.test.js`: the full API flow (sign-in, upload, publish, pick, photos, submit, live
  notifications, return, approve, file access, deletion) against a real server on a temporary data
  folder.
- `tests/ui-contract.test.js`: static checks that the frontend's imports, element ids, API paths
  and live-event names match the server.

`npm run sample-invoices` regenerates the sample invoices in `tests/fixtures`.

## Limitations

- **One server process.** Live notifications, the login rate limit and the database connection
  live in a single Node.js process. Don't run several copies against the same data folder or behind
  a load balancer.
- **The password rate limit is in memory:** 10 failed sign-in attempts per username and IP in 15
  minutes (and, separately, 10 wrong current passwords when changing a password). Attempts sent at
  the same time count too. It resets when the server restarts.
- **Admins change their own password with Change password**, which asks for the current password.
  **Reset password** in Staff accounts is only for other people's accounts.
- **HEIC photos** from iPhones are accepted and stored as-is, but browsers other than Safari may not
  preview them. They show as a file tile instead. HEIC can't be used for invoices.
- **Automatic reading is a starting point, not a guarantee.** Line tables that wrap unusually or
  OCR of poor photos can produce wrong or missing lines, which is why an admin reviews every draft
  before publishing. Only the first 5 pages of a scanned PDF are read.
- **Plain HTTP.** Tally doesn't terminate TLS itself. To use it beyond a trusted local network, put
  it behind an HTTPS reverse proxy.
- Staff can't change their own password in the app; an admin resets it.
