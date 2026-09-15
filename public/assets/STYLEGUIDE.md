# Tally UI styleguide

The reference for everything in `public/assets/tally.css`, `public/assets/ui.js` and
`public/assets/api.js`. Page authors (`public/admin/*`, `public/staff/*`) build **only** from what is
documented here. Do not add colors, fonts, or new component classes in page files; small
page-specific layout rules in a page `<style>` are fine if they use the tokens below.

Concept (SPEC section 8): the stockroom pick list. Carbon-copy paper, navy ballpoint ink, a yellow
highlighter swiped across each picked line, a rubber stamp when the admin rules. Boldness lives in
two places only: the **highlighter band** (`.check-row`) and the **stamp** (`.stamp`). Everything
else stays quiet.

---

## 0. Page setup

Every page `<head>`:

```html
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>Queue · Tally</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800&family=IBM+Plex+Mono:wght@400;500&family=Public+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/assets/tally.css">
```

Scripts are ES modules with absolute imports:

```html
<script type="module" src="/admin/admin.js"></script>
```

```js
import { api, requireUser, connectEvents, signOut } from '/assets/api.js';
import { h, toast, statusChip, progress, mountBell } from '/assets/ui.js';
```

Body classes:

| Class | Where | Effect |
|---|---|---|
| *(none)* | admin (`/admin/`) | 40px control height, 14px dense tables |
| `app--staff` | staff (`/staff/`) | every `.btn`, `.input`, `.select`, `.seg__btn`, `.review-toggle__btn`, icon button is **≥ 44px** tall (tap targets) |

Light/dark theme is automatic (`prefers-color-scheme`). Never hardcode colors; use tokens.

### Rules that apply everywhere

- Build DOM with `h()` / `textContent`. **Never** `innerHTML` with user or extracted data.
- `[hidden]` always hides (`display: none !important`), so toggle `el.hidden = true/false`.
- Focus ring is automatic (`:focus-visible` → `2px solid var(--carbon)`, offset 2px). Don't remove outlines.
- `prefers-reduced-motion: reduce` is handled globally (animations/transitions ≈ 0ms, the band just
  appears, the stamp does not thump). `prefersReducedMotion()` exists for JS decisions.
- No horizontal page scroll down to 320px: wide content goes in `.table-wrap`, `.tabs`, `.seg` or
  `.thumbs--strip`, which scroll inside themselves. `body` has `overflow-wrap: anywhere`.
- Copy voice: plain verbs, sentence case, specific. Buttons say what happens ("Publish checklist",
  "Mark collected", "Add photos", "Submit for review", "Approve", "Return to staff"). Empty states
  invite the next action.

---

## 1. Tokens (CSS custom properties on `:root`)

### Palette (dark values apply automatically)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#EEF2F6` | `#0E1520` | page ground |
| `--sheet` | `#FBFCFD` | `#162131` | cards / checklist sheet |
| `--ink` | `#14213D` | `#E4EAF3` | primary text |
| `--ink-soft` | `#4A5A75` | `#9DAAC0` | secondary text |
| `--rule` | `#C9D2DD` | `#2A3A50` | hairlines, table rules, input borders |
| `--carbon` | `#2F4B7C` | `#8FB0E8` | links, primary buttons, focus ring |
| `--highlight` | `#FFE45C` | `#FFE45C` | collected band |
| `--highlight-ink` | `#14213D` | `#14213D` | text/marks drawn **on** `--highlight` (always navy) |
| `--stamp-green` | `#1E7F4F` | `#4CC38A` | approved |
| `--stamp-red` | `#C23B22` | `#FF7A5C` | returned / errors / destructive |
| `--amber` | `#B7791F` | `#F2B84B` | submitted / needs review |

### Derived colors (use these for tints instead of mixing your own)

| Token | Use |
|---|---|
| `--on-carbon` | text on a `--carbon` fill |
| `--on-danger` | text on a `--stamp-red` / `--stamp-green` fill |
| `--sheet-sunken` | recessed areas (table header, sheet footer, note background) |
| `--rule-soft` | faint row separators, progress track |
| `--ink-faint` | hover borders, decorative dots |
| `--carbon-tint` / `--carbon-hover` | selected nav/tab background / primary hover |
| `--amber-tint` / `--amber-text` | "needs review" background / readable amber text |
| `--green-tint` / `--green-text` | verified background / readable green text |
| `--red-tint` / `--red-text` | returned or error background / readable red text |
| `--danger-hover` | danger button hover |
| `--margin-rule` | the faint red ruled-paper margin line |
| `--backdrop` | modal backdrop |
| `--shadow-sheet`, `--shadow-raise`, `--shadow-pop` | resting card, hover/raised, popovers & dialogs |

### Type

| Token | Value |
|---|---|
| `--font-display` | Big Shoulders Display (700/800), fallback `"Arial Narrow", "Roboto Condensed", sans-serif`. Page titles, invoice numbers in headers, stamp text, big counts only. |
| `--font-body` | Public Sans (400/500/600), fallback `system-ui, sans-serif` (default on `body`) |
| `--font-mono` | IBM Plex Mono (400/500), fallback `ui-monospace, Consolas, monospace`. Invoice numbers in lists, SKUs, quantities, timestamps. |
| `--text-12` `--text-14` `--text-16` `--text-20` `--text-28` `--text-40` `--text-56` | the type scale (rem) |

### Space, shape, motion, layers

| Token | Value |
|---|---|
| `--s-1` … `--s-16` | `--s-1:4px --s-2:8px --s-3:12px --s-4:16px --s-5:20px --s-6:24px --s-8:32px --s-10:40px --s-12:48px --s-16:64px` |
| `--radius-control` | 6px (buttons, inputs) |
| `--radius-sheet` | 10px (sheets, cards, tables) |
| `--radius-chip` | 4px |
| `--tap` | control height: 40px, 44px under `.app--staff` |
| `--ease-out` | `cubic-bezier(0.22, 0.8, 0.3, 1)` |
| `--swipe-ms` | 280ms (highlighter swipe) |
| `--toast-offset` | extra bottom offset for toasts (set it when a `.bottom-bar` is visible, see §19) |
| `--z-sticky` 20, `--z-rail` 30, `--z-pop` 60, `--z-toast` 80 | stacking layers |

---

## 2. Typography & utilities

| Class | Effect |
|---|---|
| `page-title` | Display font, 40px, uppercase. One per view: `<h1 class="page-title">INV-1042</h1>` |
| `display` | Display font/uppercase without a size (combine with `text-28` etc.) |
| `section-title` | 20px / 600 (`<h2>`) |
| `subsection-title` | 16px / 600 (`<h3>`) |
| `eyebrow` | tiny mono uppercase label above a title: `<p class="eyebrow">Invoice</p>` |
| `wordmark` | the TALLY logotype with a highlighter swash. `<a class="wordmark" href="/admin/">Tally</a>` |
| `mono` | mono font (invoice numbers, SKUs) |
| `num` | mono, tabular, right-aligned, nowrap (quantities, counts in tables) |
| `muted` | `--ink-soft` color |
| `text-danger` / `text-success` | red / green readable text |
| `text-12` `text-14` `text-16` `text-20` `text-28` `text-40` `text-56` | font sizes |
| `weight-500` / `weight-600` | font weights |
| `nowrap` | no wrapping |
| `truncate` | single line with ellipsis (needs a width-constrained parent) |
| `prose` | spacing between `<p>` siblings |
| `sr-only` | visually hidden, still read by screen readers |
| `skip-link` | "Skip to content" link, visible on focus: `<a class="skip-link" href="#main">Skip to content</a>` |
| `icon` | an inline SVG icon (use `icon()` from ui.js; 1.25em, stroke = currentColor) |

Links: plain `<a>` is carbon-colored with an underline. For a button that looks like a link:

```html
<button type="button" class="link">Add note</button>
<button type="button" class="link link--quiet">Cancel</button>   <!-- ink-soft -->
<button type="button" class="link link--danger">Remove</button>   <!-- red -->
```

---

## 3. Layout primitives

| Class | Structure / effect |
|---|---|
| `page` | centered content column, max 1200px, side padding 16px (24px ≥600px). `<main class="page" id="main">` |
| `page--narrow` / `page--wide` | max 760px / 1440px |
| `page-header` | title row: wraps, bottom-aligned, 24px bottom margin. Contains `.page-header__lead` + actions |
| `page-header__lead` | column holding `.eyebrow`, `.page-title`, subtitle |
| `stack` | vertical flex, gap 16px. Gap modifiers: `stack--1` (4px), `stack--2` (8px), `stack--3` (12px), `stack--4` (16px), `stack--6` (24px), `stack--8` (32px) |
| `cluster` | horizontal wrapping flex, centered, gap 8px. Modifiers: `cluster--1` (4px), `cluster--3` (12px), `cluster--4` (16px), `cluster--end` (right-aligned) |
| `spread` | wrapping flex, `space-between` (title left, actions right) |
| `grow` | `flex: 1 1 auto; min-width: 0` |
| `grid-auto` | auto-fill grid; set column min via `style="--min: 220px"` (default 260px), gap via `--gap` |
| `split` | 1 column; **2 columns ≥1000px** (1.1fr / 1fr). Admin review: photos left, checklist right |
| `split--sticky` | the first column sticks while the second scrolls (≥1000px) |
| `divider` | `<hr class="divider">` |
| `hide-narrow` | hidden < 900px |
| `hide-wide` | hidden ≥ 900px |
| `hide-mobile` | hidden < 600px |
| `only-mobile` | hidden ≥ 600px |

```html
<main class="page" id="main">
  <div class="page-header">
    <div class="page-header__lead">
      <p class="eyebrow">Invoice · Draft</p>
      <h1 class="page-title">INV-1042</h1>
      <p class="muted">Harbor Cafe · 1 Sep 2026</p>
    </div>
    <div class="cluster">
      <button class="btn btn--secondary">Save changes</button>
      <button class="btn btn--primary">Publish checklist</button>
    </div>
  </div>
  <div class="split split--sticky">
    <section class="stack">…photos…</section>
    <section class="stack">…checklist…</section>
  </div>
</main>
```

---

## 4. App shells

### Admin shell: left rail that collapses to a top bar under 900px

```html
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <div class="shell">
    <aside class="rail">
      <a class="wordmark rail__brand" href="#/queue">Tally</a>
      <nav class="rail__nav" aria-label="Main">
        <a class="rail__link" href="#/queue" aria-current="page">Queue <span class="rail__count">3</span></a>
        <a class="rail__link" href="#/upload">Upload invoice</a>
        <a class="rail__link" href="#/staff">Staff accounts</a>
      </nav>
      <div class="rail__footer">
        <div id="bell-slot"></div>                              <!-- mountBell(this) -->
        <span class="rail__user hide-narrow">Signed in as <strong>Admin</strong></span>
        <button type="button" class="btn btn--ghost btn--sm">Change password</button>
        <button type="button" class="btn btn--ghost btn--sm">Sign out</button>
      </div>
    </aside>
    <main class="shell__main page" id="main">…</main>
  </div>
</body>
```

- ≥900px: fixed-height column (brand, nav, footer at the bottom). The active link gets a carbon tint
  and left bar via `aria-current="page"`. `.rail__count` (amber count badge) sits at the right edge.
  Inside the rail, the bell shows its text label "Notifications" and a static badge.
- <900px: sticky top bar. Brand and footer on row 1, horizontally scrolling nav on row 2 with an
  underline for the active link. Keep the footer short on narrow screens (`hide-narrow` on the user
  name; you can swap long buttons for `btn--icon` with `aria-label`).
- Put `.page` on the `<main class="shell__main">` (or inside it).

### Staff top bar

```html
<body class="app--staff">
  <header class="topbar">
    <a class="wordmark topbar__brand" href="#/">Tally</a>
    <div class="topbar__actions">
      <span class="topbar__user">Priya</span>
      <div id="bell-slot"></div>
      <button type="button" class="btn btn--ghost btn--sm">Sign out</button>
    </div>
  </header>
  <main class="page page--narrow" id="main">…</main>
</body>
```

`.topbar__user` truncates at 12ch.

### Sticky checklist header and bottom action bar (staff checklist view)

```html
<header class="sticky-head">
  <div class="spread">
    <h1 class="sticky-head__title">INV-1042</h1>
    <!-- statusChip('in_progress') -->
  </div>
  <p class="sticky-head__sub">Harbor Cafe</p>
  <!-- progress(7, 12, { format: 'sentence', size: 'thick', layout: 'stacked' }) -->
</header>
<main class="page page--narrow stack">…rows, photos…</main>
<div class="bottom-bar">
  <span class="bottom-bar__hint">Add a photo to submit</span>
  <button type="button" class="btn btn--primary btn--lg" disabled>Submit for review</button>
</div>
```

- `.sticky-head`: `position: sticky; top: 0`, translucent paper with blur and a bottom rule. Place it
  outside `.page` so it spans full width.
- `.bottom-bar`: `position: sticky; bottom: 0`, sheet background, safe-area padding. Buttons stretch
  full width under 600px. `.bottom-bar__hint` holds the explanation for a disabled button.
- While a bottom bar is on screen, lift toasts above it:
  `document.body.style.setProperty('--toast-offset', '72px')` (remove it when leaving the view).

---

## 5. Buttons

```html
<button type="button" class="btn btn--primary">Publish checklist</button>
<button type="button" class="btn btn--secondary">Save changes</button>
<button type="button" class="btn btn--ghost">Add line</button>
<button type="button" class="btn btn--danger">Delete</button>
<button type="button" class="btn btn--danger-ghost">Remove</button>
<a class="btn btn--secondary" href="/api/admin/invoices/7/file" target="_blank" rel="noopener">View original</a>
```

| Class | Effect |
|---|---|
| `btn` | base: inline-flex, gap 8px, 600 weight, 14px, height `--tap` (secondary look if no variant) |
| `btn--primary` | carbon fill (one per area) |
| `btn--secondary` | sheet fill with rule border |
| `btn--ghost` | transparent, carbon text, tinted on hover |
| `btn--danger` | stamp-red fill (destructive confirmations) |
| `btn--danger-ghost` | transparent, red text |
| `btn--sm` / `btn--lg` | 32px / 48px tall (staff: `sm` is still 44px) |
| `btn--block` | full width |
| `btn--icon` | square icon-only button. **Always** add `aria-label` |
| `is-loading` or `aria-busy="true"` | hides the label and shows a spinner (use `setLoading()`) |
| `:disabled` / `aria-disabled="true"` | 50% opacity, not-allowed cursor |

Icons inside buttons are sized automatically:
`h('button', { class: 'btn btn--ghost btn--icon', 'aria-label': 'Delete line' }, icon('trash'))`.

Spinner on its own: `<span class="spinner" aria-hidden="true"></span>` (`spinner--lg` = 32px).

---

## 6. Forms

```html
<div class="field">
  <label class="field__label" for="inv-number">Invoice number</label>
  <input class="input input--mono" id="inv-number" name="invoice_number" aria-describedby="inv-number-help inv-number-error">
  <p class="field__help" id="inv-number-help">As printed on the invoice.</p>
  <p class="field__error" id="inv-number-error"></p>   <!-- hidden while empty -->
</div>
```

| Class | Effect |
|---|---|
| `field` | column, gap 6px: label → control → help → error |
| `field__label` | 14px / 600. Optional marker: `<span class="field__optional">(optional)</span>` inside the label |
| `field__help` | 12px soft help text |
| `field__error` | 14px red text with an alert glyph; **`display: none` while empty**, so just set `textContent` |
| `field-row` | responsive grid of fields (min 200px per column) |
| `has-error` (on `.field`) or `aria-invalid="true"` (on the control) | red border + inset red bar |
| `input` | text/number/date/password/search input, 16px text (no iOS zoom) |
| `select` | native `<select>` with a custom chevron |
| `textarea` | vertical-resizable, min 88px |
| `input--mono` | mono font (invoice numbers, SKUs, quantities) |
| `input--sm` / `input--lg` | 32px / 56px tall |
| `input--cell` | borderless compact input for table cells (admin line editor); border appears on hover/focus |

Search with a built-in magnifier:

```html
<label class="search search--lg">
  <span class="sr-only">Invoice number or customer name</span>
  <input class="input" type="search" placeholder="Invoice number or customer name" enterkeyhint="search">
</label>
```

`search--lg` = 56px, 20px text (staff home).

Checkbox and switch:

```html
<label class="check"><input type="checkbox" name="x"> Show inactive accounts</label>

<label class="switch">
  <input type="checkbox" role="switch" checked>
  <span class="switch__track"></span>
  Active
</label>
```

The switch turns green when checked and shows a focus ring on the track.

---

## 7. Sheets, tickets, metadata

```html
<section class="sheet">
  <header class="sheet__header">
    <h2 class="sheet__title">Photos</h2>
    <button class="btn btn--secondary btn--sm">Add photos</button>
  </header>
  <div class="sheet__body">…</div>
  <footer class="sheet__footer">
    <button class="btn btn--secondary">Cancel</button>
    <button class="btn btn--primary">Save changes</button>
  </footer>
</section>
```

| Class | Effect |
|---|---|
| `sheet` | sheet background, rule border, 10px radius, soft shadow, `position: relative` |
| `sheet--pad` | padding 16px (24px ≥600px) when there are no header/body parts |
| `sheet--flush` | `overflow: hidden` (tables or checklists edge to edge) |
| `sheet--sunken` | recessed, no shadow |
| `sheet__header` / `sheet__title` / `sheet__body` / `sheet__footer` | sheet parts (footer is sunken, right-aligned) |

Ticket: a clickable pick slip with punched notches (staff search results and "Your checklists"):

```html
<div class="ticket-list">
  <a class="ticket ticket--returned" href="#/checklist/7">
    <span class="ticket__top">
      <span class="ticket__number">INV-1042</span>
      <!-- statusChip('returned') -->
    </span>
    <span class="ticket__customer">Harbor Cafe</span>
    <!-- progress(11, 12) -->
    <span class="ticket__meta"><span>12 lines</span><span>Updated 5 min ago</span></span>
    <span class="ticket__note">Two cartons of oat milk are missing from the photo.</span>
  </a>
</div>
```

| Class | Effect |
|---|---|
| `ticket-list` | grid, gap 12px |
| `ticket` | `<a>` or `<button>`; raises on hover |
| `ticket--returned` | reddish border (returned checklists) |
| `ticket__top` | number + chip row |
| `ticket__number` | mono 20px (the "big mono" invoice number) |
| `ticket__customer` | 16px / 600 |
| `ticket__meta` | small soft wrapping row of facts |
| `ticket__note` | admin note preview with a red left rule, clamped to 2 lines |

Key/value metadata:

```html
<dl class="meta">
  <div class="meta__item"><dt>Extraction</dt><dd>PDF text</dd></div>
  <div class="meta__item"><dt>Submitted</dt><dd>14 Sep 2026, 13:05</dd></div>
</dl>
```

---

## 8. Status chips & counts

```html
<span class="chip chip--submitted">Needs review</span>
```

Always create chips with `statusChip(status)` so labels stay consistent:

| Status | Class | Label | Look |
|---|---|---|---|
| `draft` | `chip--draft` | Draft | ink-soft dashed outline, hollow dot |
| `open` | `chip--open` | Ready to pick | carbon outline |
| `in_progress` | `chip--in_progress` | Picking | carbon light fill |
| `submitted` | `chip--submitted` | Needs review | amber fill, glowing dot |
| `approved` | `chip--approved` | Verified | stamp-green |
| `returned` | `chip--returned` | Returned | stamp-red |

`chip--lg` = 28px (page headers).

Small count badge (not the tab count): `<span class="count">12</span>`, `count--alert` = amber.

---

## 9. Checklist rows and the highlighter swipe (signature)

Build rows with `checkRow()` (ui.js), which produces exactly this structure:

```html
<ul class="checklist">
  <li class="check-row is-collected is-issue" data-item-id="31">
    <!-- interactive (staff): a button; read-only (admin, locked): <div class="check-row__main"> -->
    <button type="button" class="check-row__main" aria-pressed="true">
      <span class="check-row__box" aria-hidden="true"></span>
      <span class="check-row__body">
        <span class="check-row__desc">Oat milk 1L</span>
        <span class="check-row__sku">OM-1L</span>
        <span class="check-row__byline">Ticked by Priya · 5 min ago</span>   <!-- optional -->
      </span>
      <span class="check-row__qty">× 6<span class="check-row__qty-unit"> carton</span></span>
    </button>
    <div class="check-row__extra">       <!-- hidden while empty -->
      <p class="check-row__note">Only 5 on shelf, took 1 from back</p>
      <span class="issue-tag">Issue</span>
      <div class="review-toggle" role="group" aria-label="Cross-check Oat milk 1L">
        <button type="button" class="review-toggle__btn review-toggle__btn--ok" aria-pressed="false">OK</button>
        <button type="button" class="review-toggle__btn review-toggle__btn--issue" aria-pressed="true">Issue</button>
      </div>
      <button type="button" class="link link--quiet text-14">Add note</button>
    </div>
  </li>
</ul>
```

| Class / state | Effect |
|---|---|
| `checklist` | the sheet for rows: border, radius, a faint red **left margin rule** (ruled paper) |
| `check-row` | one line item (`<li>`), hairline separator |
| `check-row__main` | grid `[52px box][description][qty]`, min 60px tall. As a `<button>` it is the whole-row tap target |
| **`is-collected` on `.check-row`** or **`aria-pressed="true"` on `button.check-row__main`** | the yellow **highlighter band** swipes left → right (280ms, skewed, uneven edge); the box fills yellow with a navy check; row text switches to `--highlight-ink`. Removing it fades the band out. Reduced motion: the band just appears |
| `check-row__box` | the 24px tick box. `check-row__box--hidden` keeps its space but hides it |
| `check-row__body` | description column |
| `check-row__desc` | 16px / 500 description |
| `check-row__sku` | small mono SKU |
| `check-row__byline` | small soft line (who ticked, when) |
| `check-row__qty` | right-aligned mono quantity `× 6`; `check-row__qty-unit` makes the unit smaller and softer |
| `check-row__extra` | row below the main line, indented past the margin rule (notes, toggles, links) |
| `check-row__note` | staff note shown as "Note: …" with a carbon left rule |
| `check-row__note-field` | inline note editor wrapper (see below) |
| **`is-issue` on `.check-row`** | the admin's **issue marker**: 5px red bar on the left edge and a faint red wash |
| `issue-tag` | solid red "ISSUE" tag |
| `ok-tag` | green outlined "OK" tag |
| `review-toggle` + `review-toggle__btn` (`--ok` / `--issue`) | the admin OK / Issue segmented toggle; `aria-pressed="true"` fills green / red |

Inline note editor (staff "Add note" expands this inside `.check-row__extra`):

```html
<div class="check-row__note-field">
  <label class="sr-only" for="note-31">Note for Oat milk 1L</label>
  <textarea class="textarea" id="note-31" maxlength="500" placeholder="e.g. only 3 in stock"></textarea>
  <p class="field__help">Saved when you leave the field.</p>
</div>
```

Staff toggle pattern (optimistic update, revert on failure):

```js
const row = checkRow(item, {
  onToggle: async (it, next, li) => {
    setRowCollected(li, next);                                   // optimistic
    try {
      const { item: saved, checklist } = await api.patch(`/api/staff/checklists/${id}/items/${it.id}`, { collected: next });
      it.collected = saved.collected;
      updateProgress(progressEl, checklist.items_collected, checklist.items_total);
    } catch (err) {
      setRowCollected(li, !next);                                // revert
      toast(err.message, { type: 'error' });
    }
  },
  extra: [/* note, "Add note" link */],
});
list.append(row);
```

Put the `.checklist` inside a `.sheet` only when you need a header. The list already looks like a sheet.

---

## 10. Rubber stamp (signature)

Always create stamps with `stamp(container, 'approved' | 'returned', options)`. It produces:

```html
<div class="stamp stamp--approved stamp--overlay stamp--thump" role="img" aria-label="Verified, 14 Sep 2026 · Admin">
  <span class="stamp__text" aria-hidden="true">VERIFIED</span>
  <span class="stamp__meta" aria-hidden="true">14 Sep 2026 · Admin</span>
</div>
```

| Class | Effect |
|---|---|
| `stamp` | rotated inked stamp: double border, uneven ink (SVG noise mask), multiply blend in light mode |
| `stamp--approved` | stamp green, text VERIFIED, −8° |
| `stamp--returned` | stamp red, text RETURNED, −5° |
| `stamp__text` | display font word (40px) |
| `stamp__meta` | small mono line under the word (date · reviewer) |
| `stamp--sm` / `stamp--lg` | 20px / 56px word |
| `stamp--overlay` | absolute, top-right corner of the nearest positioned ancestor (28px word under 600px) |
| `stamp--thump` | one-shot thump (scale 1.4 → 1, 180ms). Added and removed by `stamp()` |

Placement: stamp a **header area** (for example the `.page-header` or `.sheet__header` wrapper
that holds the invoice number), not the checklist itself, so the ink doesn't cover quantities. Use
`animate: true` only at the moment the admin rules. When rendering an already-approved or
already-returned record, pass `animate: false`.

---

## 11. Progress

Build with `progress(collected, total, options)`:

```html
<div class="progress progress--thin" data-format="fraction">
  <span class="progress__text">11/12</span>
  <span class="progress__track" role="progressbar" aria-valuemin="0" aria-valuemax="12" aria-valuenow="11" aria-label="11 of 12 items collected">
    <span class="progress__fill" style="--p: 92%"></span>
  </span>
</div>
```

| Class | Effect |
|---|---|
| `progress` | inline row: text + track |
| `progress--thin` / `progress--thick` | 4px / 10px track (default 6px) |
| `progress--stacked` | text above a full-width track |
| `progress--complete` | green fill (added automatically at 100%) |
| `progress--highlight` | highlighter-yellow fill |
| `progress__text` / `progress__track` / `progress__fill` | parts; the fill width comes from `--p` |

---

## 12. Tables (scroll inside their own container)

```html
<div class="table-wrap">
  <table class="table table--interactive">
    <thead>
      <tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Progress</th><th class="num">Photos</th><th>Updated</th></tr>
    </thead>
    <tbody>
      <tr class="is-row-link">
        <td class="mono"><a class="table__link" href="#/invoice/7">INV-1042</a></td>
        <td>Harbor Cafe</td>
        <td><!-- statusChip --></td>
        <td style="min-width: 140px"><!-- progress(11, 12, { size: 'thin' }) --></td>
        <td class="num">2</td>
        <td class="nowrap muted"><!-- timeAgo(updated_at) --></td>
      </tr>
    </tbody>
  </table>
</div>
```

| Class | Effect |
|---|---|
| `table-wrap` | `overflow-x: auto` sheet container (the page never scrolls sideways) |
| `table-wrap--bare` | same scrolling, no border/background |
| `table` | 14px, hairline rows, sticky sunken uppercase header |
| `table--interactive` | pointer + hover tint on body rows |
| `table--dense` | tighter rows |
| `table--edit` | tight cell padding for `input--cell` editors (admin line editor) |
| `table__link` + `tr.is-row-link` | the link's `::after` stretches over the whole row, so the row is one native link (keyboard- and middle-click-friendly) |
| `tr.is-highlight` | faint amber row wash (e.g. submitted rows) |
| `col-shrink` | column as narrow as its content (`<th class="col-shrink">`) |
| `num` / `mono` | right-aligned numbers / mono cell |

Line editor example cell: `<td><input class="input input--cell" aria-label="Description, line 3" value="Oat milk 1L"></td>`.
Delete-row cell: `<td class="col-shrink"><button class="btn btn--ghost btn--icon btn--sm" aria-label="Delete line 3">…icon('trash')…</button></td>`.

---

## 13. Tabs & segmented control (with counts)

Underline tabs:

```html
<div class="tabs" role="tablist" aria-label="Filter invoices">
  <button type="button" class="tab" role="tab" aria-selected="true">Needs review <span class="tab__count tab__count--alert">3</span></button>
  <button type="button" class="tab" role="tab" aria-selected="false">In progress <span class="tab__count">12</span></button>
  <button type="button" class="tab" role="tab" aria-selected="false">All</button>
</div>
```

Link tabs can use `<a class="tab" aria-current="page">`. `.tabs` scrolls horizontally and has a
16px bottom margin.

Segmented control:

```html
<div class="seg" role="group" aria-label="Filter">
  <button type="button" class="seg__btn" aria-pressed="true">Needs review <span class="tab__count tab__count--alert">3</span></button>
  <button type="button" class="seg__btn" aria-pressed="false">Drafts <span class="tab__count">2</span></button>
</div>
```

| Class | Effect |
|---|---|
| `tabs` / `tab` | underline tabs; selected via `aria-selected="true"` or `aria-current="page"` |
| `seg` / `seg__btn` | pill-group control; selected via `aria-pressed="true"` or `aria-selected="true"` |
| `tab__count` | mono count pill (used in both) |
| `tab__count--alert` | amber count (use for "Needs review" when > 0) |

---

## 14. Drop zone

```html
<label class="dropzone" id="drop">
  <input type="file" class="sr-only" accept="application/pdf,image/jpeg,image/png,image/webp">
  <span class="dropzone__icon"><!-- icon('upload') --></span>
  <span class="dropzone__title">Drop an invoice here</span>
  <span class="dropzone__hint">or <span class="dropzone__browse">browse files</span> · PDF, JPG, PNG or WEBP up to 20 MB</span>
  <span class="dropzone__progress" hidden><!-- progress(...) or text "Reading invoice…" --></span>
</label>
```

| Class | Effect |
|---|---|
| `dropzone` | dashed ruled-paper panel, 240px min height. Being a `<label>` makes the whole zone open the file picker. Focus ring shows via `:focus-within` |
| `is-dragover` | solid carbon border + tint (added by `bindDropzone`) |
| `is-busy` | progress cursor, ignores pointer/drops (set it yourself while uploading) |
| `dropzone__icon` / `__title` / `__hint` / `__browse` / `__progress` | parts |

Wire it with `bindDropzone(zone, { onFiles })`.

---

## 15. Photos: thumbnail grid, viewer

Thumbnail grid (build items with `photoThumb()`):

```html
<ul class="thumbs">
  <li class="thumb" data-photo-id="4">
    <button type="button" class="thumb__open" aria-label="Open photo IMG_2231.jpg"><img class="thumb__img" src="/api/photos/4" alt=""></button>
    <button type="button" class="thumb__remove" aria-label="Remove photo IMG_2231.jpg"><!-- icon('x') --></button>
  </li>
  <!-- while uploading -->
  <li class="thumb thumb--uploading"><img class="thumb__img" src="blob:…" alt=""><span class="thumb__progress" style="--p: 45%"></span></li>
</ul>
```

| Class | Effect |
|---|---|
| `thumbs` | auto-fill square grid (min 96px) |
| `thumbs--strip` | single horizontally scrolling row of 72px squares (under the review viewer) |
| `thumb` | square tile |
| `thumb__open` | full-tile button (zoom-in cursor) |
| `thumb__img` | cover-fit image |
| `thumb__remove` | round × in the top-right (36px on staff) |
| `thumb__file` / `thumb__file-name` | fallback tile "No preview" + filename when an image can't render (HEIC). `photoThumb` swaps it in automatically |
| `thumb--uploading` + `thumb__progress` | dimmed image with a progress line (`--p`) |
| `is-active` | outline on the selected thumb in a strip |

Review viewer (admin, left pane):

```html
<div class="viewer">
  <button type="button" class="viewer__main" aria-label="Open photo 1 of 3 full screen">
    <img src="/api/photos/4" alt="IMG_2231.jpg">
    <span class="viewer__hint"><!-- icon('zoom-in') -->Click to zoom</span>
  </button>
  <ul class="thumbs thumbs--strip"><!-- photoThumb(p, { active: i === current, onOpen }) --></ul>
</div>
```

`viewer__main` is 4:3 on a dark ground with a contain-fit image. Clicking it calls `openLightbox(photos, current)`.

---

## 16. Lightbox

Created only by `openLightbox(photos, startIndex)`. It is a full-screen native `<dialog class="lightbox">`
with `.lightbox__bar` (containing `.lightbox__caption` > `.lightbox__counter` + `.lightbox__name`, and
`.lightbox__tools` > `.lightbox__btn` buttons + `.lightbox__zoom-level`), and `.lightbox__stage` containing
`.lightbox__img` (`is-zoomed`, `is-dragging`), `.lightbox__nav.lightbox__nav--prev` /
`.lightbox__nav.lightbox__nav--next`, and `.lightbox__fallback` for files that can't be previewed.
Don't build it by hand.

Controls: arrow keys / swipe to navigate, `+` `-` `0` / wheel / pinch / double-click (double-tap) to
zoom, drag to pan, Esc or tap on the backdrop to close. Focus returns to the element that opened it.

---

## 17. Modal / bottom sheet

Created by `openModal`, `confirmDialog`, `promptDialog`, `formDialog`. It is a native
`<dialog class="modal">` that becomes a **bottom sheet under 600px** (full-width, grab handle,
stacked full-width buttons). Structure, for reference:

```html
<dialog class="modal modal--sm" aria-labelledby="…">
  <form class="modal__form">
    <div class="modal__header"><h2 class="modal__title">Delete this invoice?</h2><p class="modal__desc">…</p></div>
    <div class="modal__body"><div class="modal__error"></div> …content… </div>
    <div class="modal__footer"><button class="btn btn--secondary">Cancel</button><button type="submit" class="btn btn--danger">Delete invoice</button></div>
    <button type="button" class="btn btn--ghost btn--icon btn--sm modal__close" aria-label="Close">×</button>
  </form>
</dialog>
```

| Class | Effect |
|---|---|
| `modal` | 520px dialog, sheet background, pop shadow, enter/leave animation |
| `modal--sm` / `modal--lg` | 400px / 760px |
| `modal__form`, `modal__header`, `modal__title`, `modal__desc`, `modal__body`, `modal__footer`, `modal__close`, `modal__message`, `modal__error` | parts (`modal__body` scrolls and collapses when empty; `modal__message` is the paragraph `confirmDialog` puts in the body; `modal__error` holds the error banner) |
| `is-closing` | leave animation (managed by JS) |

Page scroll is locked while any dialog is open.

---

## 18. Banners, empty states, skeletons

Banner (use `banner()`):

```html
<div class="banner banner--warning" role="status">
  <span class="banner__icon"><!-- icon('alert') --></span>
  <div class="banner__content">
    <p class="banner__title">Check the extracted lines</p>
    <div class="banner__body">No item table header found. Add the lines manually.</div>
  </div>
  <div class="banner__actions"><a class="btn btn--secondary btn--sm" href="…">View original</a></div>
</div>
```

| Class | Use |
|---|---|
| `banner--info` | neutral notice (carbon) |
| `banner--warning` | extraction warnings, "needs attention" (amber) |
| `banner--error` | returned-by-admin note, failures (red; `role="alert"`) |
| `banner--success` | "Sent to admin for review" (green) |

`banner__body ul` is styled for a bullet list of warnings. Actions wrap under the text below 600px.

Empty state (use `emptyState()`):

```html
<div class="empty">
  <div class="empty__art" aria-hidden="true"></div>   <!-- a little ruled page with a highlighter stroke -->
  <p class="empty__title">Search for a checklist to start picking.</p>
  <p class="empty__text">Type an invoice number or customer name above.</p>
  <div class="empty__action"><a class="btn btn--primary" href="#/upload">Upload invoice</a></div>
</div>
```

`empty--compact` removes the art and reduces padding (inside tables and panels).

Skeleton (use `skeleton()`): `.skeleton-group` containing `.skeleton.skeleton--title`,
`.skeleton--line` (varied widths), `.skeleton--row` (56px list/table row), `.skeleton--block`
(height from `--h`). It shimmers, and is static under reduced motion.

---

## 19. Toasts

Created by `toast()`. Structure: `.toast-stack` (fixed, bottom-center on mobile, bottom-right ≥600px,
`aria-live="polite"`) > `.toast` (plus one of `toast--success`, `toast--warning`, `toast--error`; info has no modifier) > `.toast__icon`, `.toast__message`,
optional `.toast__action` button, `.toast__close`. At most 4 are shown. They pause on hover/focus.
`is-leaving` is the exit animation. Toasts are dark ink cards in light mode and light cards in dark
mode. Raise the stack above sticky bottom bars with the `--toast-offset` custom property on `body`.

---

## 20. Notification bell

Created by `mountBell(container, …)`:

```html
<div class="bell">
  <button type="button" class="bell__button" aria-haspopup="dialog" aria-expanded="false" aria-controls="tally-bell-1" aria-label="Notifications, 2 unread">
    <svg class="icon">…</svg><span class="bell__label">Notifications</span><span class="bell__badge" aria-hidden="true">2</span>
  </button>
</div>
<!-- appended to <body>, positioned next to the button -->
<div class="bell__panel" id="tally-bell-1" role="dialog" aria-label="Notifications">
  <div class="bell__header"><h2 class="bell__title">Notifications</h2><button class="btn btn--ghost btn--sm">Mark all read</button></div>
  <ul class="bell__list">
    <li><button class="bell__item bell__item--submitted is-unread"><span class="bell__dot"></span><span class="bell__message">…</span><time class="bell__time">5 min ago</time></button></li>
  </ul>
  <p class="bell__empty">You’re all caught up. Updates about checklists will show here.</p>
  <div class="bell__footer"><button class="btn btn--secondary btn--sm">Enable desktop alerts</button></div>
</div>
```

| Class | Effect |
|---|---|
| `bell` / `bell__button` | icon button (tap-sized). `bell__label` text is visible only inside `.rail` at ≥900px |
| `bell__badge` | red unread count (`99+` max). `is-bump` pulses when a new one arrives |
| `bell__panel` | fixed dropdown (380px, max 520px tall). In the wide admin rail it opens to the right of the button |
| `bell__item` + `is-unread` | notification row; unread rows are tinted with a colored dot: `bell__item--submitted` amber, `bell__item--approved` green, `bell__item--returned` red |
| `bell__header` / `__title` / `__list` / `__dot` / `__message` / `__time` / `__empty` / `__footer` | parts |

---

## 21. Timeline, big count

Event timeline (admin approved record):

```html
<ol class="timeline">
  <li class="timeline__item timeline__item--approved">
    <div class="timeline__head"><span class="timeline__type">Approved</span><span class="timeline__who">by Admin</span></div>
    <time class="timeline__time" datetime="…">14 Sep 2026, 13:05</time>
    <p class="timeline__note">All good.</p>
  </li>
</ol>
```

Dot modifiers: `timeline__item--created` and `timeline__item--published` (carbon ring),
`timeline__item--submitted` (amber), `timeline__item--approved` (green), `timeline__item--returned` (red). Other event types get the default grey ring
(`timeline__item--item_checked` has no special style and that is fine).

Big display count: `<div class="tally"><span class="tally__num">11</span><span class="tally__label">of 12 collected</span></div>`.

---

## 22. State classes (reference)

| Class | Applied to | Meaning |
|---|---|---|
| `is-collected` | `.check-row` | highlighter band on |
| `is-issue` | `.check-row` | red issue marker |
| `is-loading` | `.btn` | spinner (prefer `setLoading`) |
| `is-active` | `.thumb` | selected thumbnail |
| `is-dragover` / `is-busy` | `.dropzone` | drag hover / uploading |
| `is-unread` | `.bell__item` | unread notification |
| `is-bump` | `.bell__badge` | pulse animation |
| `is-highlight` / `is-row-link` | `tr` | amber wash / stretched row link |
| `is-leaving` | `.toast` | exit animation (JS) |
| `is-closing` | `.modal` | exit animation (JS) |
| `is-zoomed` / `is-dragging` | `.lightbox__img` | zoom/pan cursor (JS) |
| `has-error` | `.field` | red control border |
| `progress--complete` | `.progress` | green fill |
| `stamp--thump` | `.stamp` | thump animation (JS) |

---

# JavaScript: `/assets/api.js`

All paths are absolute (`/api/...`). Every request sends `credentials: 'same-origin'` and the header
`X-Requested-With: fetch` (the server's CSRF guard needs it).

### `class ApiError extends Error`

`{ name: 'ApiError', status: number, message: string, data: object|null }`.
`message` is the server's `{ error }` text when present, otherwise a plain fallback
("That file is too large.", "Something went wrong on the server. Try again."…). `status` is `0`
when the server can't be reached. Show `err.message` directly to users.

### `api.get(path, options?)`, `api.post(path, body?, options?)`, `api.put(path, body?, options?)`, `api.patch(path, body?, options?)`, `api.del(path, body?, options?)`

→ `Promise<parsed JSON | null>` (`null` for 204 or an empty body). Throws `ApiError` for any non-2xx.

- Plain objects/arrays are sent as JSON (`Content-Type: application/json`).
- `FormData`, `Blob`, `URLSearchParams`, `ArrayBuffer`, strings pass through untouched.
- `options`: `{ signal, headers }`. An aborted request rejects with the native `AbortError`.
- A **401 on any non-`/api/auth/` path** dispatches `window` event `'tally:unauthorized'`
  (`detail: { path, status }`). `requireUser()` listens for it and sends the user to sign-in.
- `api.delete` is an alias of `api.del`.

```js
const { invoices } = await api.get(`/api/admin/invoices?status=active&q=${encodeURIComponent(q)}`);
const { invoice } = await api.put(`/api/admin/invoices/${id}`, { invoice_number, customer_name, invoice_date, items });
await api.del(`/api/admin/invoices/${id}`);                     // → null (204)
try {
  await api.post(`/api/staff/checklists/${id}/submit`, { note });
} catch (err) {
  if (err.status === 422) noteError.textContent = err.message; else toast(err.message, { type: 'error' });
}
```

### `uploadWithProgress(path, formData, onProgress?, { method = 'POST', signal }?)`

→ `Promise<parsed JSON | null>`, using XMLHttpRequest so upload progress is reported.
`onProgress(fraction 0..1, { loaded, total })` fires during the upload and once with `1` when the
bytes are sent. The server may still be working after that (e.g. "Reading invoice…"). Errors and
401 handling are the same as `api`.

```js
const fd = new FormData();
fd.append('file', file);                                        // admin invoice: field "file"
zone.classList.add('is-busy');
const bar = progress(0, 100, { format: 'none' });
try {
  const { invoice } = await uploadWithProgress('/api/admin/invoices', fd, (f) => {
    updateProgress(bar, Math.round(f * 100), 100);
    if (f === 1) label.textContent = 'Reading invoice…';
  });
  location.hash = `#/invoice/${invoice.id}`;
} catch (err) { toast(err.message, { type: 'error' }); }
finally { zone.classList.remove('is-busy'); }
// staff photos: fd.append('photos', file) for each file → POST /api/staff/checklists/:id/photos
```

### `connectEvents(handlers, { url = '/api/notifications/stream' }?)` → `close()`

Wraps `EventSource` with reconnect and exponential backoff (1s → 30s, with jitter). It reconnects
right away when the tab becomes visible or the browser comes back online. Every third failed
attempt checks `/api/auth/me`; if that returns 401 it dispatches `'tally:unauthorized'` and stops.
Handler errors are caught and logged.

| Handler | Called with |
|---|---|
| `hello(data, { reconnected })` | `data = { unread }`. `reconnected` is `true` after a drop: refresh your data then (events may have been missed) |
| `notification(n)` | a Notification object (`{ id, type, message, invoice_id, read, created_at }`) |
| `invoice(data)` | `{ id, status }` when an invoice's status changes |
| `status(state)` | `'connecting' | 'open' | 'reconnecting' | 'closed'` (optional) |

```js
const bell = mountBell(slot, { onOpenInvoice: (id) => (location.hash = `#/invoice/${id}`), actionLabel: 'Review' });
const stop = connectEvents({
  hello: (d, { reconnected }) => { bell.setUnread(d.unread); if (reconnected) { bell.refresh(); reloadCurrentView(); } },
  notification: (n) => bell.push(n),            // badge, toast with action, title "(n)", desktop alert
  invoice: ({ id, status }) => refreshQueueIfVisible(id, status),
});
window.addEventListener('pagehide', stop);
```

### `requireUser(expectedRole: 'admin' | 'staff')` → `Promise<User>`

Page guard. Call it first in `admin.js` / `staff.js`:

- 401 → `location.replace('/login.html?role=<expectedRole>&next=<current path+hash>')` and the promise **never resolves**.
- `expectedRole === 'admin'` and the user is staff → redirect to `/staff/` (never resolves).
- `expectedRole === 'staff'`: staff **and admins** are allowed.
- Also installs a one-time `'tally:unauthorized'` listener that sends the user to sign-in (session expired mid-use).
- Network failure → throws `ApiError` with status 0 (show a banner with a retry).

```js
const user = await requireUser('admin');
nameEl.textContent = user.display_name;
```

### `signOut({ to = '/' }?)` → `Promise<void>`

POSTs `/api/auth/logout` (errors ignored), then navigates to `to`.
`h('button', { class: 'btn btn--ghost btn--sm', onClick: () => signOut() }, 'Sign out')`.

### Small auth helpers

| Export | Returns |
|---|---|
| `homeFor(role)` | `'/admin/'` for admin, else `'/staff/'` |
| `currentPath()` | `location.pathname + search + hash` |
| `loginUrl(role, next = currentPath())` | `'/login.html?role=staff&next=%2Fstaff%2F%23%2Fchecklist%2F7'` |
| `safeNext(next, role, origin?)` | `next` if it is a same-origin path under `/admin/` (admins only) or `/staff/` (staff or admin), else `null` |

---

# JavaScript: `/assets/ui.js`

## DOM

### `h(tag, attrs?, ...children)` → `HTMLElement`

Never uses innerHTML. `attrs` may be omitted (`h('p', 'Hello')`).

| Attr | Behavior |
|---|---|
| `class` / `className` | string, array, or `{ name: bool }` object (see `classNames`) |
| `dataset` | `{ itemId: 7 }` → `data-item-id="7"` |
| `style` | string, or object: `{ minWidth: '140px', '--p': '40%' }` (keys with `-` use `setProperty`) |
| `onClick`, `onInput`, `onKeydown`, `onclick`… | `addEventListener` (event name lowercased). Non-function values are ignored |
| `aria-*` | always stringified (`'aria-pressed': false` → `"false"`) |
| boolean attrs | `true` → present (`disabled: true`, `hidden: true`), `false`/`null`/`undefined` → omitted |
| `value`, `checked`, `selected`, `indeterminate`, `defaultValue`, `defaultChecked`, `muted` | set as **properties** after children (so `<select value>` works) |
| `htmlFor` / `for` | the `for` attribute |
| `text` | sets `textContent` |
| `ref` | `ref(el)` is called after creation |
| `href` / `src` / `action` | `javascript:` URLs are dropped |
| `innerHTML` / `outerHTML` | throws |

Children: strings/numbers become text nodes, Nodes are appended, arrays are flattened,
`null`/`undefined`/`false`/`true` are skipped.

```js
const row = h('tr', { class: ['is-row-link', inv.status === 'submitted' && 'is-highlight'] },
  h('td', { class: 'mono' }, h('a', { class: 'table__link', href: `#/invoice/${inv.id}` }, inv.invoice_number ?? 'Draft')),
  h('td', {}, inv.customer_name ?? '—'),
  h('td', {}, statusChip(inv.status)),
  h('td', { style: { minWidth: '140px' } }, progress(inv.items_collected, inv.items_total, { size: 'thin' })),
  h('td', { class: 'num' }, inv.photos_count),
  h('td', { class: 'nowrap muted' }, timeAgo(inv.updated_at)),
);
```

| Export | Signature → result |
|---|---|
| `classNames(value)` | `classNames(['a', false, { b: true }])` → `'a b'` |
| `mount(el, ...children)` | replaces all children of `el`, returns `el` |
| `clear(el)` | removes all children, returns `el` |
| `qs(selector, root = document)` | `querySelector` |
| `qsa(selector, root = document)` | `querySelectorAll` as an array |
| `debounce(fn, ms = 300)` | debounced function with `.cancel()`. `input.addEventListener('input', debounce(search, 300))` |
| `prefersReducedMotion()` | `boolean` |

### `icon(name, { size?, label?, className? }?)` → `SVGElement`

A 24×24 stroke icon with class `icon` (1.25em, currentColor). Decorative (`aria-hidden`) unless
`label` is given. `ICON_NAMES` lists every name:
`bell search x check check-circle chevron-left chevron-right chevron-down arrow-left arrow-right
plus minus camera image upload file trash external zoom-in zoom-out alert info note edit logout
refresh users list key menu clock more package undo send`.

```js
h('button', { class: 'btn btn--secondary' }, icon('camera'), 'Take or add photos')
```

## Formatters (pure, safe in Node)

| Export | Examples |
|---|---|
| `formatQty(n, unit?)` | `formatQty(6, 'carton')` → `'6 carton'`; `formatQty(6)` → `'6'`; `formatQty(2.5, 'kg')` → `'2.5 kg'`; `formatQty(1200)` → `'1,200'`; up to 3 decimals, integers never show decimals; `formatQty(null)` → `''` |
| `formatDate(iso, { time = false }?)` | `'14 Sep 2026'`; with `time: true` → `'14 Sep 2026, 13:05'` (local time). Date-only strings (`'2026-09-01'`) never shift a day and never show a time. Invalid input comes back unchanged, `null` → `''` |
| `formatDateTime(iso)` | `formatDate(iso, { time: true })` |
| `relativeTime(iso, now = Date.now())` | `'just now'`, `'5 min ago'`, `'1 hour ago'`, `'3 hours ago'`, `'yesterday'`, `'4 days ago'`, then `formatDate` after a week; future: `'in 5 min'`, `'tomorrow'` |
| `timeAgo(iso, { className }?)` | `<time datetime title="14 Sep 2026, 13:05" data-relative>5 min ago</time>`; all such elements refresh every minute |
| `STATUS_LABELS` | `{ draft: 'Draft', open: 'Ready to pick', in_progress: 'Picking', submitted: 'Needs review', approved: 'Verified', returned: 'Returned' }` |
| `statusLabel(status)` | `statusLabel('in_progress')` → `'Picking'` |

## Status, progress, stamp, rows

### `statusChip(status, { size: 'lg' }?)` → `<span class="chip chip--<status>">Label</span>`

### `progress(collected, total, { format = 'fraction', size, layout = 'inline' }?)` → `.progress` element

- `format`: `'fraction'` → `11/12`, `'sentence'` → `7 of 12 collected`, `'none'` → bar only
- `size`: `'thin' | 'thick'`
- `layout`: `'inline' | 'stacked'`

It clamps values and adds `progress--complete` at 100%.

### `updateProgress(el, collected, total)`

Updates a `progress()` element in place (text, ARIA values, animated fill).

### `stamp(container, kind, { animate = true, meta, size, overlay = true }?)` → `.stamp` element

`kind`: `'approved'` (VERIFIED) or `'returned'` (RETURNED). Replaces any existing stamp that is a
direct child of `container`. Makes `container` `position: relative` if it was static. `meta` is the
small line (e.g. `` `${formatDate(inv.reviewed_at)} · ${inv.reviewed_by_name}` ``). `size`: `'sm' | 'lg'`.
`overlay: false` renders it inline. The thump plays only when `animate` is true and motion isn't reduced.

```js
// after POST /approve succeeds:
stamp(headerEl, 'approved', { meta: `${formatDate(invoice.reviewed_at)} · ${invoice.reviewed_by_name}` });
// rendering an existing approved record:
stamp(headerEl, 'approved', { animate: false, meta: formatDate(invoice.reviewed_at) });
```

### `checkRow(item, { onToggle, readOnly, extra, byline, showBox = true }?)` → `<li class="check-row">`

- `item`: an API Item (`description`, `sku`, `quantity`, `unit`, `collected`, `review_status`, `id`).
- `onToggle(item, nextCollected, li)`: when given, the row is a `<button aria-pressed>`. The row
  **does not** change itself, so call `setRowCollected` (optimistic) and revert on failure.
- `readOnly` (default: `true` when there is no `onToggle`) renders a `<div>` plus a screen-reader
  ", collected" / ", not collected" suffix.
- `extra`: Node or array of Nodes for `.check-row__extra` (note, issue tag, review toggle, "Add note").
- `byline`: short text under the SKU (e.g. `Ticked by Priya`).
- The quantity renders as `× 6` plus the unit, and `review_status === 'issue'` adds `is-issue`.

### `setRowCollected(li, collected)`

Toggles `is-collected` and `aria-pressed`, which plays or fades the highlighter band.

### `setRowIssue(li, isIssue)`

Toggles the red issue marker.

## Buttons, banners, empty, loading

| Export | Signature → result |
|---|---|
| `setLoading(button, loading = true)` | spinner + `disabled` + `aria-busy`; restores the previous disabled state when turned off |
| `withLoading(button, fn)` | `await withLoading(btn, () => api.post(...))`: loading while `fn` runs; returns its result and rethrows errors |
| `banner({ type = 'info', title?, message?, actions? })` | `.banner` element; `type`: `info | warning | error | success`; `message`: string, Node or array; `actions`: Node or array |
| `emptyState({ title, text?, action?, compact = false })` | `.empty` element |
| `skeleton(lines = 3, { title = false, rows = 0, block = 0 }?)` | `.skeleton-group` (`aria-busy`); `block` is a height in px |

```js
mount(content, skeleton(0, { title: true, rows: 6 }));
const { invoice } = await api.get(`/api/admin/invoices/${id}`);
if (invoice.extraction_warnings.length) {
  content.append(banner({ type: 'warning', title: 'Check the extracted lines',
    message: h('ul', {}, invoice.extraction_warnings.map((w) => h('li', {}, w))) }));
}
list.append(emptyState({ title: 'Nothing needs review', text: 'Submitted checklists will show up here.', compact: true }));
```

## Toasts

### `toast(message, { type = 'info', action?, timeout? }?)` → `{ dismiss(), el }`

- `type`: `'info' | 'success' | 'warning' | 'error'`
- `action`: `{ label, onClick }`; clicking it also dismisses the toast
- `timeout` in ms: defaults to 4500 (8000 with an action, 7000 for errors); `0` = stay until dismissed

`message` may be a string or a Node.

```js
toast('Checklist published', { type: 'success' });
toast('Priya submitted INV-1042 for review', { action: { label: 'Review', onClick: () => (location.hash = '#/invoice/7') } });
toast(err.message, { type: 'error' });
```

## Dialogs (native `<dialog>`, focus trap, Esc, focus restored, bottom sheet < 600px)

### `confirmDialog({ title = 'Are you sure?', message?, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false, onConfirm? })` → `Promise<boolean>`

Also accepts a plain string (the message). With `danger`, the confirm button is red and focus starts
on Cancel. `onConfirm` (async, optional) runs with the button in its loading state. If it throws,
the error shows inside the dialog and it stays open.

```js
const ok = await confirmDialog({
  title: 'Delete this invoice?',
  message: 'The checklist, photos, and original file will be removed. This can’t be undone.',
  confirmLabel: 'Delete invoice', danger: true,
  onConfirm: () => api.del(`/api/admin/invoices/${id}`),
});
if (ok) location.hash = '#/queue';
```

### `promptDialog({ title, message?, label = 'Note', value = '', placeholder?, required = false, multiline = false, type = 'text', autocomplete?, confirmLabel = 'Save', cancelLabel = 'Cancel', maxLength?, minLength?, danger = false, help?, requiredMessage?, validate?, onSubmit? })` → `Promise<string | null>`

`null` means cancelled. The value is trimmed (except `type: 'password'`). `required` shows
"`<label>` is required" inline. `validate(value)` returns an error string or `''`.
`onSubmit(value)` (async) runs before closing; throw (e.g. an `ApiError`) to show the error in the
dialog and keep it open. In a multiline field, Ctrl/Cmd+Enter submits.

```js
const note = await promptDialog({
  title: 'Return to staff', message: 'Tell staff what to fix.', label: 'Note for staff',
  multiline: true, required: true, confirmLabel: 'Return to staff', danger: true, maxLength: 1000,
  onSubmit: async (text) => { ({ invoice } = await api.post(`/api/admin/invoices/${id}/return`, { note: text, item_reviews })); },
});
if (note !== null) stamp(headerEl, 'returned', { meta: formatDate(invoice.reviewed_at) });
```

### `formDialog({ title, description?, fields, confirmLabel = 'Save', cancelLabel = 'Cancel', danger = false, size?, onSubmit? })` → `Promise<values | onSubmit result | null>`

`fields`: `[{ name, label, type = 'text', value, placeholder, required, multiline, rows, autocomplete, help, minLength, maxLength, options, inputmode, mono, trim = true, validate(value, values), requiredMessage, optionalHint = true }]`.

- `options` (`['a','b']` or `[{ value, label }]`) renders a `<select>`.
- Non-required fields get "(optional)" unless `optionalHint: false`.
- Resolves with `{ [name]: value }`, or `onSubmit(values)`'s return value if it isn't `undefined`, or `null` when cancelled.
- Backdrop clicks do not close form dialogs.

```js
await formDialog({
  title: 'Change password', confirmLabel: 'Change password', size: 'sm',
  fields: [
    { name: 'current_password', label: 'Current password', type: 'password', required: true, autocomplete: 'current-password' },
    { name: 'new_password', label: 'New password', type: 'password', required: true, minLength: 8, autocomplete: 'new-password', help: 'At least 8 characters.' },
  ],
  onSubmit: (v) => api.post('/api/auth/password', v).then(() => toast('Password changed', { type: 'success' })),
});
```

### `openModal({ title, description?, content?, actions = [], size?, dismissible = true, closeOnBackdrop?, className?, initialFocus?, onClose? })` → `{ dialog, body, close(value), closed: Promise<value>, setError(message) }`

The low-level building block (use it for custom sheets such as the staff "submit with note" sheet).

- `actions`: `[{ label, variant?: 'primary'|'secondary'|'ghost'|'danger', submit?: boolean, value?, onClick?(ctx) }]`.
  An action without `onClick` closes with its `value`. `onClick` may be async: throw to show an
  error banner in the dialog, return `false` to stay open, or return a value to close with it.
  `ctx = { dialog, form, body, close, setError }`. The `submit: true` action also runs on Enter.
- `dismissible: false` hides × and blocks Esc/backdrop.
- `initialFocus`: an element, `'cancel'`, `'submit'`, or a selector (default: first field, else the submit button).
- `closed` resolves with the value (`undefined` when dismissed).

## Photos

### `openLightbox(photos, startIndex = 0, { onClose(index) }?)` → `{ close(), go(index), dialog } | null`

`photos`: an array of Photo objects (`{ url, original_filename? }`) or URL strings. Returns `null`
for an empty list. See §16 for the controls.

### `photoThumb(photo, { onOpen?(photo), onRemove?(photo, li), active = false }?)` → `<li class="thumb">`

Renders the × button only when `onRemove` is given (staff: own photos only). Falls back to a
"No preview" file tile when the image fails to load (HEIC).

```js
const grid = h('ul', { class: 'thumbs' }, photos.map((p, i) => photoThumb(p, {
  onOpen: () => openLightbox(photos, i),
  onRemove: p.uploaded_by_name === user.display_name ? async (photo, li) => {
    if (!(await confirmDialog({ title: 'Remove this photo?', confirmLabel: 'Remove photo', danger: true }))) return;
    try { await api.del(`/api/staff/checklists/${id}/photos/${photo.id}`); li.remove(); }
    catch (err) { toast(err.message, { type: 'error' }); }
  } : undefined,
})));
```

(Compare by user id if your data has one. Photo objects expose `uploaded_by_name` only.)

### `bindDropzone(zone, { onFiles(files: File[]) })` → `unbind()`

`zone` is the `.dropzone` `<label>` containing an `<input type="file">`. It handles drag
enter/over/leave/drop (`is-dragover`), resets the input after a choice, and stops the browser from
navigating to files dropped just outside the zone. Drops are ignored while the zone has `is-busy`.
Validate type/size in `onFiles` before uploading.

## Notifications & title

### `mountBell(container, { onOpenInvoice?(invoiceId, notification), actionLabel = 'Open', toastOnPush = true, desktopAlerts = true, updateTitle = true, label = 'Notifications' }?)` → `bell`

- Appends `.bell` to `container` and the dropdown panel to `<body>`.
- Loads `GET /api/notifications` immediately.
- Clicking an item marks it read (`POST /api/notifications/:id/read`), closes the panel, and calls
  `onOpenInvoice`. "Mark all read" calls `POST /api/notifications/read-all`.
- The footer shows **"Enable desktop alerts"** (requests `Notification` permission only on click,
  never on load), or the current permission state.
- The badge and `document.title` prefix `(n)` stay in sync automatically (`updateTitle`).
- `actionLabel` may be a string or `(notification) => string` (admin: `'Review'`; staff: `'Open'`).

`bell` object:

| Member | Purpose |
|---|---|
| `push(notification)` | for SSE `notification` events: prepends it (ignores duplicate ids), bumps the badge, shows a toast with the action, and fires a desktop `Notification` when permission is granted and the tab is hidden or unfocused |
| `refresh()` | reload from the server (e.g. after `hello` with `reconnected: true`) |
| `setUnread(n)` | set the badge count (e.g. from `hello`) |
| `open()` / `close()` | show/hide the dropdown (Esc and outside click close it) |
| `destroy()` | remove the bell and its panel |
| `unread` | current unread count (getter) |
| `el` / `panel` | the root `.bell` element / the panel element |

### `setTitleCount(n)`

Prefixes `document.title` with `(n) ` (removed at 0, `99+` max). `mountBell` already calls it, so
don't call it yourself when a bell is mounted.

### `setBaseTitle(title)`

Changes the page title while keeping the `(n)` prefix. Use this instead of assigning
`document.title` on route changes: `setBaseTitle('INV-1042 · Tally')`.

---

## Recipes

**Staff checklist view.** `sticky-head` (invoice number `sticky-head__title`, customer, `statusChip`,
`progress(c, t, { format: 'sentence', size: 'thick', layout: 'stacked' })`), then:
- if returned: `banner({ type: 'error', title: 'Returned by admin', message: review_note })`
- `ul.checklist` of `checkRow(item, { onToggle, extra })`, where issue rows get `is-issue` automatically
- a `.sheet` with the photo inputs, rendered as two buttons that trigger hidden
  `<input type="file" accept="image/*" multiple capture="environment" class="sr-only">` and
  `<input type="file" accept="image/*" multiple class="sr-only">`
- `ul.thumbs` of `photoThumb(...)` with `thumb--uploading` tiles during `uploadWithProgress`
- `.bottom-bar` with "Submit for review" (disabled + `.bottom-bar__hint` "Add a photo to submit")

Locked states render rows with `checkRow(item)` (read-only) and no bottom bar. After submit, show
`banner({ type: 'success', title: 'Sent to admin for review' })`.

**Admin review.** `.split.split--sticky`:
- left: `.viewer` + `thumbs--strip`
- right: a `.sheet` with header "11 of 12 collected", `ul.checklist` of read-only
  `checkRow(item, { extra: [note, review-toggle] })`, the staff submit note in `banner({ type: 'info' })`,
  then "Approve" (`btn--primary`) and "Return to staff" (`btn--danger`, via `promptDialog`
  with `required: true`)

On success, call `stamp(headerEl, kind)` and re-render read-only.

**Admin queue.** `.page-header` (title "Queue"), `.tabs` with `tab__count` from
`/api/admin/invoices/counts` (`tab__count--alert` on Needs review when > 0), `label.search`, then a
`.table-wrap > table.table.table--interactive` built with `h()` (see the `h()` example). Use
`emptyState({ compact: true })` inside the wrap when there are no rows, and `connectEvents` →
`invoice` to re-fetch.
