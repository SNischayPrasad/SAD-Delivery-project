# Steel Access Doors: 3D website redesign

A redesign of [steelaccessdoors.com](https://www.steelaccessdoors.com/) with the same pages, product
range and contact details, plus an interactive 3D experience.

It is a static site with no build step. Open `index.html` in a browser, or serve the folder:

```bash
npx serve steel-access-doors      # or: python3 -m http.server -d steel-access-doors
```

## What's in it

| Page | Route | Highlights |
|------|-------|------------|
| Home | `#/` | Scroll-driven 3D hero: a steel double door opens and the camera moves into a clean room with laminar airflow. Stats counters, "why choose us" tilt cards, a 3D product carousel, and a 3D showroom with 8 interactive models. |
| About Us | `#/about` | Company intro, reputation, values, and Vision/Mission flip cards. |
| Products | `#/products`, `#/products/<category>` | Filter by category, live search, 3D tilt cards. |
| Product detail | `#/product/<slug>` | A 3D model of each of the 19 products (drag to rotate, pinch or +/- to zoom, tap doors and pass boxes to open them), a photo tab, features, benefits, applications, an enquiry form and related products. Metal Doors has a door-type switcher (Scientific, Fire, Commercial, Decorative, Shaft). |
| Gallery | `#/gallery` | Category filter, masonry grid, lightbox with keyboard navigation. |
| Reach Us | `#/contact` | Phone, email, address, message form and map. |

The site also has:

- The BFRC certification announcement, shown once per session.
- A mega menu.
- Floating WhatsApp and call buttons.
- A "Get a Quote" modal on every page.

## Files

- `js/data.js`: all site content (company details, copy, products, image paths). **Edit this file to change text.**
- `js/scene.js`: Three.js scenes. The hero doorway, plus procedural models for doors, pass boxes, tables, LAF units, booths, AHUs, clean rooms, the modular OT, benches, dust collectors, scrub sinks and garment cubicles.
- `js/app.js`: hash router, page templates and interactions (tilt, reveal, carousel, forms, lightbox).
- `css/styles.css`: design system (graphite and brushed steel, with the brand's amber `#efa21f`).

## Notes

- **Images** load from the live site (`IMAGE_BASE` in `js/data.js`). To self-host, copy the site's `img/` folder
  next to `index.html` and set `IMAGE_BASE = './'`. A missing image shows a styled placeholder.
- **Forms** have no backend. They open the visitor's email app (to `sales@steelaccessdoors.com`) or WhatsApp
  with the message pre-filled. Point `bindForm` in `js/app.js` at an API if you add one.
- **Three.js** (r170) loads from jsDelivr through the import map in `index.html`. Without WebGL, or if the CDN is
  unreachable, the site falls back to a CSS doorway and product photos. `prefers-reduced-motion` is respected.
- **Copy** keeps the original site's facts (product names, features, applications and contact details), with the
  descriptions rewritten. The original text for *Wall Mounted Scrubber*, *Foot Operating Scrubber* and
  *Garment Cubic* described unrelated products (air scrubbers, floor scrubbers, a garment-manufacturing
  service). Here they are described as what the photos show: surgical scrub sinks and a stainless garment
  cabinet. "Dynamic Three Leaf Passbooks" is spelled "Pass Box".
