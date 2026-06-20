# GPU / Scroll Corruption Playbook

Reference for killing GPU rendering corruption on mobile WebView (Android / Samsung
Internet / Chrome engine). This is what fixed the rainbow-static, black-blocks and
ghosting we hit on the Nexus Plans page — ported straight from the working X-engine build.

## What is actually wrong

Mobile WebView composites the page into **GPU layers**, each needing its own slice of
GPU memory. When too many big layers exist at once — or one keeps animating forever —
the GPU runs out of budget and:

- **fills the gaps with garbage pixels** → rainbow / TV-static noise
- **fails to paint a region** → black or blue rectangles
- **reuses an old frame** → ghosting / duplicate cards while scrolling

It is almost never the HTML being "wrong". It is **layer pressure**.

## The 4 fixes (in order of impact)

### 1. Never keep full-screen pages alive off-screen — use `display:none`

A `position:fixed; inset:0` element pushed off-screen with `transform` stays a
**permanent full-screen GPU layer**, burning memory 24/7. We had two of them
(deposit + withdraw pages).

```css
/* ❌ BAD — 2 full-screen layers always alive */
.page-overlay      { position:fixed; inset:0; transform:translateX(100%); }
.page-overlay.open { transform:translateX(0); }

/* ✅ GOOD — zero GPU cost when closed */
.page-overlay      { position:fixed; inset:0; display:none; transform:translateX(100%); transition:transform .28s; }
.page-overlay.open { transform:translateX(0); }
```

```js
openPage = id => {
  const el = document.getElementById(id);
  el.style.display = 'block';
  // double rAF: let the browser paint the display:block frame FIRST,
  // then add .open so the slide-in actually animates.
  requestAnimationFrame(() => requestAnimationFrame(() => { el.classList.add('open'); el.scrollTop = 0; }));
};
closePage = id => {
  const el = document.getElementById(id);
  el.classList.remove('open');
  el.addEventListener('transitionend', () => { el.style.display = 'none'; }, { once: true });
};
```

### 2. Isolate every repeating card with `contain`

```css
.product-card { contain:layout style paint; transform:translateZ(0); }
```

`contain:paint` tells the browser "nothing inside this card affects anything outside it",
so it stops repainting neighbours when one card changes. `translateZ(0)` pins it to its
own stable layer so it cannot smear.

### 3. Global image lock

```css
img { -webkit-backface-visibility:hidden; backface-visibility:hidden; }
```

Stops images re-rasterizing / smearing into black streaks during scroll.

### 4. Pin animated surfaces (ticker, slideshow) to their own layer

```css
.ticker-wrap, .slideshow-wrap { contain:layout style paint; transform:translateZ(0); }
```

An always-running animation that is NOT isolated forces the whole scroll list to
recomposite every frame. Isolate it and the damage is contained.

## Bonus: remove `backdrop-filter`

`backdrop-filter:blur()` is the **single worst offender** on Android WebView — it leaves
trails on sticky/fixed bars. If the background is already ~98% opaque the blur is
invisible anyway, so delete it.

```css
/* ❌ */ .topbar { background:rgba(255,255,255,.98); backdrop-filter:blur(20px); }
/* ✅ */ .topbar { background:#fff; }
```

## Debugging cheat-sheet

| Symptom                          | Cause                     | Fix                                          |
|----------------------------------|---------------------------|----------------------------------------------|
| Rainbow / static noise           | GPU out of layer memory   | `display:none` off-screen pages, `contain` on cards |
| Black / blue rectangles          | Region failed to paint    | same as above                                |
| Cards duplicate / ghost on scroll| Old frame reused          | `contain:paint` + `translateZ(0)`            |
| Trails behind sticky bar         | `backdrop-filter`         | remove it, use opaque background             |
| Image smears to black            | image re-rasterizing      | global `img{ backface-visibility:hidden }`   |
| White strip below a dark screen  | body bg / padding showing | match body background to the screen          |

## Two golden rules

1. **Fewer layers = fewer problems.** Anything `position:fixed`/`absolute` + `transform`
   that is permanently in the DOM is a permanent GPU layer. Kill it with `display:none`
   when it is not shown.
2. **When in doubt, copy what works.** Diff against a known-good build (e.g. X-engine),
   find what it does that the broken build does not, and port it exactly.
