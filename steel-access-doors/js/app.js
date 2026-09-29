/* Steel Access Doors: router, page templates and interactions. */
(function () {
  const { company, announcement, home, about, categories, products, IMAGE_BASE } = window.SAD;
  const app = document.getElementById('app');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const finePointer = matchMedia('(pointer: fine)').matches;
  const bySlug = Object.fromEntries(products.map((p) => [p.slug, p]));
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  /* ---------- helpers ---------- */

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const tel = (p) => 'tel:' + p.replace(/[^\d+]/g, '');
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const store = {
    get(k) {
      try { return sessionStorage.getItem(k); } catch (e) { return null; }
    },
    set(k, v) {
      try { sessionStorage.setItem(k, v); } catch (e) { /* storage unavailable */ }
    },
  };

  const ICONS = {
    shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0 5 5L22 14l-8 8-2.3-2.3a4 4 0 0 0-5-5L2 10l8-8z"/><circle cx="12" cy="12" r="2"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    arrow: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    pin: '<path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 19h16"/>',
    cube: '<path d="m12 2 9 5v10l-9 5-9-5V7z"/><path d="m3 7 9 5 9-5"/><path d="M12 12v10"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 17-5-5-9 8"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    hand: '<path d="M8 13V5a1.5 1.5 0 0 1 3 0v6"/><path d="M11 11V4a1.5 1.5 0 0 1 3 0v7"/><path d="M14 11V6a1.5 1.5 0 0 1 3 0v8a7 7 0 0 1-7 7h-.5A6.5 6.5 0 0 1 4 16l-1.5-3a1.5 1.5 0 0 1 2.6-1.5L8 15"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 3.5 6"/>',
    safety: '<path d="M4 18h16"/><path d="M6 18a6 6 0 0 1 12 0"/><path d="M10 12V8h4v4"/>',
    team: '<circle cx="12" cy="7" r="3"/><circle cx="5" cy="10" r="2"/><circle cx="19" cy="10" r="2"/><path d="M7 20a5 5 0 0 1 10 0"/><path d="M1.5 19a3.5 3.5 0 0 1 5-3"/><path d="M22.5 19a3.5 3.5 0 0 0-5-3"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
    whatsapp: '<path d="M3 21l1.6-4.7A9 9 0 1 1 8 19.6z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    door: '<rect x="5" y="3" width="14" height="18" rx="1"/><path d="M15 12h.01"/>',
    air: '<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h15a3 3 0 1 1-3 3"/><path d="M3 16h7"/>',
    box: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 12h16"/>',
    room: '<path d="M3 21V8l9-5 9 5v13"/><path d="M9 21v-7h6v7"/>',
    table: '<path d="M3 8h18"/><path d="M5 8v12M19 8v12"/><path d="M5 14h14"/>',
  };
  const icon = (n, cls = 'i') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[n] || ''}</svg>`;
  const catIcon = { doors: 'door', rooms: 'room', airflow: 'air', transfer: 'box', furniture: 'table' };

  const media = (src, alt, cls = '') =>
    `<div class="media ${cls}"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" onerror="this.parentNode.classList.add('noimg')"><span class="media-fallback">${esc(alt)}</span></div>`;

  const waLink = (text) => `https://wa.me/${company.whatsapp}?text=${encodeURIComponent(text)}`;

  /* ---------- shared chrome ---------- */

  function buildChrome() {
    $('#year').textContent = new Date().getFullYear();
    $('#fab-wa').href = waLink('Hi, I would like to know more about your products.');
    $('#fab-call').href = tel(company.phones[0]);
    $('#footer-contact').innerHTML = `
      <li>${icon('pin')}<span>${esc(company.address)}</span></li>
      <li>${icon('mail')}<a href="mailto:${company.email}">${company.email}</a></li>
      ${company.phones.map((p) => `<li>${icon('phone')}<a href="${tel(p)}">${esc(p)}</a></li>`).join('')}`;
    $('#footer-products').innerHTML = ['modular-ot', 'gi-work-table', 'mobile-laf', 'dispensing-booth', 'crossover-bench', 'portable-dust-collector', 'work-table-ss', 'wall-mounted-scrubber']
      .map((s) => `<li><a href="#/product/${s}">${esc(bySlug[s].name)}</a></li>`)
      .join('');
    $('#mega').innerHTML = `
      <div class="mega-grid">
        ${categories
          .map(
            (c) => `<div class="mega-col">
              <a class="mega-head" href="#/products/${c.id}">${icon(catIcon[c.id])}<span>${esc(c.name)}</span></a>
              ${products.filter((p) => p.category === c.id).map((p) => `<a href="#/product/${p.slug}">${esc(p.name)}</a>`).join('')}
            </div>`
          )
          .join('')}
      </div>
      <a class="mega-all" href="#/products">View all products ${icon('arrow')}</a>`;

    const header = $('#header');
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    const burger = $('#burger');
    burger.addEventListener('click', () => {
      const open = document.body.classList.toggle('menu-open');
      burger.setAttribute('aria-expanded', String(open));
    });

    document.addEventListener('click', (e) => {
      const q = e.target.closest('[data-quote]');
      if (q) {
        e.preventDefault();
        openQuote(q.dataset.quote || '');
      }
      if (e.target.closest('[data-announce]')) {
        e.preventDefault();
        openAnnouncement();
      }
    });
  }

  /* ---------- modals ---------- */

  function openModal(dlg) {
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    document.body.classList.add('modal-open');
  }
  function closeModal(dlg) {
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }
  $$('dialog').forEach((d) => {
    d.addEventListener('close', () => document.body.classList.remove('modal-open'));
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) closeModal(d);
    });
  });

  function openAnnouncement() {
    const d = $('#announce');
    d.innerHTML = `
      <div class="modal-card announce">
        <button class="modal-x" data-close aria-label="Close">${icon('close')}</button>
        <div class="seal" aria-hidden="true"><div class="seal-inner">${icon('shield', 'i seal-i')}<b>BFRC</b><span>Certified</span></div></div>
        <h2 id="announce-title">${esc(announcement.title)}</h2>
        <p>${esc(announcement.body)}</p>
        <ul class="ticks">${announcement.points.map((p) => `<li>${icon('check')}${esc(p)}</li>`).join('')}</ul>
        <p class="muted">${esc(announcement.closing)}</p>
        <p class="badge-line">${icon('check')} ${esc(announcement.badge)}</p>
        <button class="btn btn-amber" data-close>Continue to site</button>
      </div>`;
    openModal(d);
  }

  function formHTML(id, subject) {
    const options = ['General enquiry', ...products.map((p) => p.name)];
    return `
      <form class="form" id="${id}" novalidate>
        <div class="field-row">
          <label class="field"><span>Name</span><input name="name" autocomplete="name" required placeholder="Your name"></label>
          <label class="field"><span>Phone</span><input name="phone" type="tel" autocomplete="tel" required placeholder="+91"></label>
        </div>
        <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" placeholder="you@company.com"></label>
        <label class="field"><span>Subject</span>
          <select name="subject">${options.map((o) => `<option${o === subject ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Message</span><textarea name="message" rows="4" required placeholder="Tell us about your project, quantities and timelines"></textarea></label>
        <p class="form-error" role="alert" hidden></p>
        <div class="form-actions">
          <button class="btn btn-amber" type="submit" value="email">${icon('mail')} Send by email</button>
          <button class="btn btn-wa" type="submit" value="whatsapp">${icon('whatsapp')} Send on WhatsApp</button>
        </div>
        <p class="form-note">Opens your email app or WhatsApp with the message ready to send to our sales team.</p>
      </form>`;
  }

  function bindForm(form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const via = (e.submitter && e.submitter.value) || 'email';
      const f = new FormData(form);
      const v = (k) => String(f.get(k) || '').trim();
      const err = $('.form-error', form);
      const missing = ['name', 'phone', 'message'].filter((k) => !v(k));
      const badEmail = v('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v('email'));
      $$('input,textarea', form).forEach((i) => i.classList.toggle('invalid', missing.includes(i.name) || (i.name === 'email' && badEmail)));
      if (missing.length || badEmail) {
        err.textContent = missing.length ? 'Please fill in your name, phone and message.' : 'Please check the email address.';
        err.hidden = false;
        return;
      }
      err.hidden = true;
      const body = `Name: ${v('name')}\nPhone: ${v('phone')}${v('email') ? `\nEmail: ${v('email')}` : ''}\nProduct: ${v('subject')}\n\n${v('message')}`;
      if (via === 'whatsapp') window.open(waLink(`Enquiry: ${v('subject')}\n\n${body}`), '_blank', 'noopener');
      else window.location.href = `mailto:${company.email}?subject=${encodeURIComponent('Enquiry: ' + v('subject'))}&body=${encodeURIComponent(body)}`;
      toast('Your message is ready to send. Our team will reply as soon as possible.');
    });
  }

  function openQuote(subject) {
    const d = $('#quote');
    d.innerHTML = `
      <div class="modal-card">
        <button class="modal-x" data-close aria-label="Close">${icon('close')}</button>
        <p class="eyebrow">Get a quote</p>
        <h2 id="quote-title">Tell us what you need</h2>
        <p class="muted">Share a few details and our engineers will get back to you with a proposal.</p>
        ${formHTML('quote-form', subject || 'General enquiry')}
      </div>`;
    bindForm($('#quote-form', d));
    openModal(d);
  }

  let toastTimer;
  function toast(msg) {
    let t = $('.toast');
    if (!t) {
      t = document.createElement('div');
      t.className = 'toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 4200);
  }

  /* ---------- page pieces ---------- */

  const pageHero = (title, crumbs, sub) => `
    <section class="page-hero">
      <div class="page-hero-grid" aria-hidden="true"></div>
      <div class="wrap">
        <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a>${crumbs.map((c) => `<span>/</span>${c[1] ? `<a href="${c[1]}">${esc(c[0])}</a>` : `<span aria-current="page">${esc(c[0])}</span>`}`).join('')}</nav>
        <h1 class="page-title">${esc(title)}</h1>
        ${sub ? `<p class="lead">${esc(sub)}</p>` : ''}
      </div>
    </section>`;

  const productCard = (p) => `
    <a class="pcard" href="#/product/${p.slug}" data-tilt data-reveal>
      ${media(p.image, p.name, 'pcard-media')}
      <div class="pcard-body">
        <span class="chip">${icon(catIcon[p.category])}${esc(catName[p.category])}</span>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.short)}</p>
        <span class="link">View details ${icon('arrow')}</span>
      </div>
      <span class="glare" aria-hidden="true"></span>
    </a>`;

  const contactBand = () => `
    <section class="section">
      <div class="wrap">
        <div class="cta-band" data-reveal>
          <div>
            <p class="eyebrow">How can we help you</p>
            <h2>Talk to our clean room engineers</h2>
            <p class="muted">Contact us any way that suits you. We are available around the clock by email or phone.</p>
          </div>
          <div class="cta-actions">
            <button class="btn btn-amber" data-quote>Get a Quote</button>
            <a class="btn btn-ghost" href="${tel(company.phones[0])}">${icon('phone')} ${esc(company.phones[0])}</a>
          </div>
        </div>
      </div>
    </section>`;

  /* ---------- pages ---------- */

  function pageHome() {
    const featured = home.featured.map((s) => bySlug[s]);
    const showroom = [
      ['metal-doors', 'Metal Door'],
      ['dynamic-passbox', 'Pass Box'],
      ['mobile-laf', 'Mobile LAF'],
      ['dispensing-booth', 'Dispensing Booth'],
      ['ahu-systems', 'AHU'],
      ['clean-rooms', 'Clean Room'],
      ['modular-ot', 'Modular OT'],
      ['garment-cubicle', 'Garment Cubicle'],
    ];
    return `
      <section class="hero" id="hero">
        <div class="hero-sticky">
          <div class="hero-canvas" id="hero-canvas"><div class="hero-fallback"><span></span><span></span></div></div>
          <div class="hero-shade" aria-hidden="true"></div>
          <div class="wrap hero-content" id="hero-content">
            <button class="chip chip-glass" data-announce>${icon('shield')} BFRC certified <span class="dot"></span> Trusted. Certified. Reliable.</button>
            <h1><span class="eyebrow">Welcome to</span><span class="h1-main">Steel Access<br><em>Doors</em></span></h1>
            <p class="lead">${esc(home.welcome)}</p>
            <div class="actions">
              <a class="btn btn-amber" href="#/products">Explore products ${icon('arrow')}</a>
              <a class="btn btn-ghost" href="${company.brochure}" target="_blank" rel="noopener">${icon('download')} Download brochure</a>
            </div>
          </div>
          <div class="hero-inside" id="hero-inside" aria-hidden="true">
            <div>
              <p class="eyebrow">HEPA filtered &middot; Laminar &middot; Controlled</p>
              <h2>Step inside a turnkey clean room</h2>
            </div>
          </div>
          <div class="scroll-cue" id="scroll-cue"><span></span>Scroll to open the door</div>
        </div>
      </section>

      <div class="marquee" aria-hidden="true"><div class="marquee-track">${[...products, ...products].map((p) => `<span>${esc(p.name)}</span>`).join('')}</div></div>

      <section class="section">
        <div class="wrap split">
          <div data-reveal>
            <p class="eyebrow">About Steel Access Doors</p>
            <h2 class="h2">Your trusted partner in clean room solutions</h2>
            <p class="lead-sm">${esc(home.welcome)}</p>
            <p class="muted">As a leading global supplier, we take pride in:</p>
            <ol class="numbered">${home.pillars.map((p) => `<li><span>${esc(p)}</span></li>`).join('')}</ol>
            <div class="actions">
              <a class="btn btn-amber" href="#/about">View more ${icon('arrow')}</a>
              <a class="btn btn-ghost" href="${company.brochure}" target="_blank" rel="noopener">${icon('download')} Brochure</a>
            </div>
          </div>
          <div class="stack" data-reveal data-tilt>
            ${media(IMAGE_BASE + 'img/banner-2-SA.jpeg', 'Steel Access Doors facility', 'stack-back')}
            ${media(IMAGE_BASE + 'img/about-us.jpeg', 'Clean room project by Steel Access Doors', 'stack-front')}
            <div class="stack-badge"><b data-count="99">0</b><span>+ medical clients</span></div>
            <span class="glare" aria-hidden="true"></span>
          </div>
        </div>
      </section>

      <section class="stats">
        <div class="wrap stats-grid">
          ${home.stats.map((s) => `<div class="stat" data-reveal><b><span data-count="${s.value}">0</span>${s.suffix}</b><span>${esc(s.label)}</span></div>`).join('')}
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head" data-reveal>
            <p class="eyebrow">Why choose us</p>
            <h2 class="h2">Built right, built for you, backed fast</h2>
          </div>
          <div class="why-grid">
            ${home.why
              .map(
                (w, i) => `<article class="why" data-tilt data-reveal style="--d:${i * 90}ms">
                  <div class="why-icon">${icon(w.icon)}</div>
                  <h3>${esc(w.title)}</h3>
                  <p>${esc(w.text)}</p>
                  <span class="why-num">0${i + 1}</span>
                  <span class="glare" aria-hidden="true"></span>
                </article>`
              )
              .join('')}
          </div>
        </div>
      </section>

      <section class="section section-dark">
        <div class="wrap">
          <div class="section-head row" data-reveal>
            <div>
              <p class="eyebrow">Products category</p>
              <h2 class="h2">Engineered for controlled environments</h2>
            </div>
            <div class="ring-nav">
              <button class="icon-btn" data-ring="prev" aria-label="Previous product">${icon('left')}</button>
              <button class="icon-btn" data-ring="next" aria-label="Next product">${icon('right')}</button>
            </div>
          </div>
          <div class="ring-stage" id="ring">
            <div class="ring">
              ${featured
                .map(
                  (p) => `<a class="ring-item" href="#/product/${p.slug}" draggable="false">
                    ${media(p.image, p.name)}
                    <div class="ring-body"><h3>${esc(p.name)}</h3><p>${esc(p.short)}</p></div>
                  </a>`
                )
                .join('')}
            </div>
          </div>
          <p class="ring-caption" id="ring-caption"></p>
          <div class="center"><a class="btn btn-ghost" href="#/products">View all products ${icon('arrow')}</a></div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head" data-reveal>
            <p class="eyebrow">3D showroom</p>
            <h2 class="h2">Inspect our products from every angle</h2>
            <p class="muted">Drag to rotate. Tap doors and pass boxes to open them.</p>
          </div>
          <div class="showroom" data-reveal>
            <div class="tabs" role="tablist" aria-label="Showroom models">
              ${showroom.map(([s, l], i) => `<button role="tab" class="tab${i === 0 ? ' active' : ''}" aria-selected="${i === 0}" data-show="${s}">${esc(l)}</button>`).join('')}
            </div>
            <div class="showroom-body">
              <div class="viewer viewer-lg" id="showroom-viewer" data-hint=""></div>
              <div class="showroom-info" id="showroom-info"></div>
            </div>
          </div>
        </div>
      </section>

      ${contactBand()}`;
  }

  function pageAbout() {
    const valueIcons = ['users', 'safety', 'team', 'compass'];
    return `
      ${pageHero('About Us', [['About Us']], company.tagline)}
      <section class="section">
        <div class="wrap split">
          <div data-reveal>
            <p class="eyebrow">Steel Access Doors</p>
            <h2 class="h2">Among the world&rsquo;s leading turnkey clean room suppliers</h2>
            <p class="lead-sm">${esc(about.intro)}</p>
            <p class="muted">Our reputation in the pharma industry is built on:</p>
            <ol class="numbered">${about.reputation.map((p) => `<li><span>${esc(p)}</span></li>`).join('')}</ol>
            <p>${esc(about.closing)}</p>
            <button class="btn btn-amber" data-quote>Contact us ${icon('arrow')}</button>
          </div>
          <div class="stack" data-reveal data-tilt>
            ${media(IMAGE_BASE + 'img/about-us-banner.jpg', 'Steel Access Doors team at work', 'stack-back')}
            ${media(IMAGE_BASE + 'img/about-us.jpeg', 'Clean room installation', 'stack-front')}
            <div class="stack-badge"><b data-count="200">0</b><span>+ professionals</span></div>
            <span class="glare" aria-hidden="true"></span>
          </div>
        </div>
      </section>

      <section class="section section-dark">
        <div class="wrap">
          <div class="section-head" data-reveal>
            <p class="eyebrow">Values</p>
            <h2 class="h2">Value driven, always</h2>
            <p class="muted">${esc(about.valuesIntro)}</p>
          </div>
          <div class="values-grid">
            ${about.values
              .map(
                (v, i) => `<article class="value" data-tilt data-reveal style="--d:${i * 80}ms">
                  <div class="why-icon">${icon(valueIcons[i])}</div>
                  <h3>${esc(v.title)}</h3><p>${esc(v.text)}</p>
                  <span class="glare" aria-hidden="true"></span>
                </article>`
              )
              .join('')}
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap vm-grid">
          ${[
            ['Vision', 'eye', about.vision],
            ['Mission', 'target', about.mission],
          ]
            .map(
              ([t, ic, text]) => `<button class="flip" data-reveal aria-label="${t}: ${esc(text)}">
                <span class="flip-inner">
                  <span class="flip-face flip-front"><span class="why-icon">${icon(ic)}</span><span class="flip-title">${t}</span><span class="flip-hint">${finePointer ? 'Hover' : 'Tap'} to reveal</span></span>
                  <span class="flip-face flip-back"><span class="eyebrow">${t}</span><span class="flip-text">${esc(text)}</span></span>
                </span>
              </button>`
            )
            .join('')}
        </div>
      </section>
      ${contactBand()}`;
  }

  function pageProducts(cat) {
    const active = categories.some((c) => c.id === cat) ? cat : 'all';
    return `
      ${pageHero('Products', [['Products']], 'Doors, clean rooms, airflow systems, material transfer and clean room furniture. Everything for a controlled environment.')}
      <section class="section section-tight">
        <div class="wrap">
          <div class="filter-bar" data-reveal>
            <div class="chips" role="tablist" aria-label="Product categories">
              <button class="chip-btn${active === 'all' ? ' active' : ''}" data-cat="all">All <span>${products.length}</span></button>
              ${categories.map((c) => `<button class="chip-btn${active === c.id ? ' active' : ''}" data-cat="${c.id}">${esc(c.name)} <span>${products.filter((p) => p.category === c.id).length}</span></button>`).join('')}
            </div>
            <label class="search">${icon('search')}<input type="search" placeholder="Search products" aria-label="Search products" id="product-search"></label>
          </div>
          <div class="pgrid" id="pgrid">${products.map(productCard).join('')}</div>
          <p class="empty" id="pempty" hidden>No products match your search.</p>
        </div>
      </section>
      ${contactBand()}`;
  }

  function pageProduct(slug) {
    const p = bySlug[slug];
    if (!p) return pageNotFound();
    const related = products.filter((x) => x.category === p.category && x.slug !== p.slug).concat(products.filter((x) => x.category !== p.category)).slice(0, 4);
    const styles = p.modelStyles || [];
    const specs = p.specs || [];
    return `
      ${pageHero(p.name, [['Products', '#/products'], [catName[p.category], '#/products/' + p.category], [p.name]], p.subtitle || '')}
      <section class="section section-tight">
        <div class="wrap product-top">
          <div class="product-copy" data-reveal>
            <span class="chip chip-amber">${icon(catIcon[p.category])}${esc(catName[p.category])}</span>
            ${p.summary.map((s, i) => `<p class="${i === 0 ? 'lead-sm' : ''}">${esc(s)}</p>`).join('')}
            ${specs.length ? `<dl class="specs">${specs.map((s) => `<div><dt>${esc(s.label)}</dt><dd>${esc(s.value)}</dd></div>`).join('')}</dl>` : ''}
            <div class="actions">
              <button class="btn btn-amber" data-quote="${esc(p.name)}">Enquire now ${icon('arrow')}</button>
              <a class="btn btn-ghost" href="${waLink('Hi, I am interested in ' + p.name + '.')}" target="_blank" rel="noopener">${icon('whatsapp')} WhatsApp</a>
            </div>
          </div>
          <div class="viewer-card" data-reveal>
            <div class="viewer-tabs" role="tablist">
              <button class="tab active" data-view="3d" role="tab" aria-selected="true">${icon('cube')} 3D model</button>
              <button class="tab" data-view="photo" role="tab" aria-selected="false">${icon('image')} Photo</button>
            </div>
            <div class="viewer-wrap">
              <div class="viewer" id="product-viewer" data-model="${p.model}" data-hint=""></div>
              <div class="viewer-photo" hidden>${media(p.image, p.name)}</div>
              <div class="viewer-tools">
                <button class="icon-btn sm" data-zoom="0.85" aria-label="Zoom in">${icon('plus')}</button>
                <button class="icon-btn sm" data-zoom="1.15" aria-label="Zoom out">${icon('minus')}</button>
              </div>
              <p class="viewer-hint">${icon('hand')} <span>Drag to rotate</span></p>
            </div>
            ${styles.length ? `<div class="door-styles" role="group" aria-label="Model type">${styles.map(([l], i) => `<button class="chip-btn${i === 0 ? ' active' : ''}" data-style="${i}">${esc(l)}</button>`).join('')}</div>` : ''}
          </div>
        </div>
      </section>

      ${
        p.variants
          ? `<section class="section section-tight">
              <div class="wrap">
                <div class="section-head" data-reveal><p class="eyebrow">Product detail</p><h2 class="h2">Range</h2></div>
                <div class="variant-grid">
                  ${p.variants
                    .map(
                      (v, i) => `<article class="variant" data-tilt data-reveal style="--d:${i * 70}ms">
                        ${media(v.image, v.name)}
                        <div><h3>${esc(v.name)}</h3><p>${esc(v.text)}</p></div>
                        <span class="glare" aria-hidden="true"></span>
                      </article>`
                    )
                    .join('')}
                </div>
              </div>
            </section>`
          : ''
      }

      ${(p.sections || [])
        .map(
          (s) => `<section class="section section-tight">
            <div class="wrap">
              <div class="section-head" data-reveal><p class="eyebrow">${esc(p.name)}</p><h2 class="h2">${esc(s.title)}</h2></div>
              <div class="feature-grid">
                ${s.items
                  .map(
                    ([t, d], i) => `<article class="feature" data-reveal style="--d:${i * 60}ms">
                      <span class="feature-num">${String(i + 1).padStart(2, '0')}</span>
                      <h3>${esc(t)}</h3><p>${esc(d)}</p>
                    </article>`
                  )
                  .join('')}
              </div>
            </div>
          </section>`
        )
        .join('')}

      ${
        p.gallery
          ? `<section class="section section-tight">
              <div class="wrap">
                <div class="section-head" data-reveal><p class="eyebrow">Gallery</p><h2 class="h2">Recent installations</h2></div>
                <div class="gallery-grid">${p.gallery.map((src, i) => `<button class="gitem" data-lightbox="${i}" data-reveal>${media(src, p.name + ' ' + (i + 1))}</button>`).join('')}</div>
              </div>
            </section>`
          : ''
      }

      <section class="section section-tight">
        <div class="wrap enquiry">
          <div data-reveal>
            <p class="eyebrow">Leave a message</p>
            <h2 class="h2">Interested in ${esc(p.name)}?</h2>
            <p class="muted">Leave a message with your requirements and we will reply as soon as we can.</p>
            <ul class="contact-mini">
              ${company.phones.map((ph) => `<li>${icon('phone')}<a href="${tel(ph)}">${esc(ph)}</a></li>`).join('')}
              <li>${icon('mail')}<a href="mailto:${company.email}">${company.email}</a></li>
            </ul>
          </div>
          <div class="form-card" data-reveal>${formHTML('product-form', p.name)}</div>
        </div>
      </section>

      <section class="section section-tight">
        <div class="wrap">
          <div class="section-head" data-reveal><p class="eyebrow">Related products</p><h2 class="h2">You may also need</h2></div>
          <div class="pgrid">${related.map(productCard).join('')}</div>
        </div>
      </section>`;
  }

  function galleryItems() {
    const items = [];
    products.forEach((p) => {
      items.push({ src: p.image, title: p.name, cat: p.category });
      (p.variants || []).forEach((v) => items.push({ src: v.image, title: v.name, cat: p.category }));
      (p.gallery || []).forEach((src, i) => items.push({ src, title: p.name + ' ' + (i + 1), cat: p.category }));
    });
    return items;
  }

  function pageGallery() {
    const items = galleryItems();
    return `
      ${pageHero('Gallery', [['Gallery']], 'Products and installations from our workshop and project sites.')}
      <section class="section section-tight">
        <div class="wrap">
          <div class="chips gallery-filter" data-reveal>
            <button class="chip-btn active" data-gcat="all">All</button>
            ${categories.map((c) => `<button class="chip-btn" data-gcat="${c.id}">${esc(c.name)}</button>`).join('')}
          </div>
          <div class="masonry" id="masonry">
            ${items
              .map(
                (it, i) => `<button class="gitem" data-lightbox="${i}" data-cat="${it.cat}" data-reveal>
                  ${media(it.src, it.title)}
                  <span class="gcap">${esc(it.title)}</span>
                </button>`
              )
              .join('')}
          </div>
        </div>
      </section>`;
  }

  function pageContact() {
    return `
      ${pageHero('Contact Us', [['Contact Us']], 'Call, email, WhatsApp or visit our facility in Balanagar, Hyderabad.')}
      <section class="section section-tight">
        <div class="wrap contact-cards">
          <article class="ccard" data-tilt data-reveal>
            <div class="why-icon">${icon('phone')}</div>
            <h3>Give us a call</h3>
            ${company.phones.map((p) => `<a href="${tel(p)}">${esc(p)}</a>`).join('')}
            <span class="glare" aria-hidden="true"></span>
          </article>
          <article class="ccard" data-tilt data-reveal style="--d:80ms">
            <div class="why-icon">${icon('mail')}</div>
            <h3>Email us</h3>
            <a href="mailto:${company.email}">${company.email}</a>
            <a href="${waLink('Hi, I would like to know more about your products.')}" target="_blank" rel="noopener">WhatsApp ${esc(company.phones[0])}</a>
            <span class="glare" aria-hidden="true"></span>
          </article>
          <article class="ccard" data-tilt data-reveal style="--d:160ms">
            <div class="why-icon">${icon('pin')}</div>
            <h3>Address</h3>
            <p>${esc(company.address)}</p>
            <a href="${company.mapLink}" target="_blank" rel="noopener">Get directions</a>
            <span class="glare" aria-hidden="true"></span>
          </article>
        </div>
      </section>
      <section class="section section-tight">
        <div class="wrap enquiry">
          <div class="form-card" data-reveal>
            <p class="eyebrow">Leave a message</p>
            <h2 class="h2">Send us a message</h2>
            <p class="muted">Interested in our products? Leave a message and we will reply as soon as we can.</p>
            ${formHTML('contact-form', 'General enquiry')}
          </div>
          <div class="map-card" data-reveal>
            <p class="eyebrow">Visit us</p>
            <div class="map-frame"><iframe title="Steel Access Doors on Google Maps" src="${company.mapEmbed}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>
          </div>
        </div>
      </section>`;
  }

  function pageNotFound() {
    return `
      ${pageHero('Page not found', [['Not found']], 'The page you are looking for has moved or does not exist.')}
      <section class="section section-tight"><div class="wrap center"><a class="btn btn-amber" href="#/">Back to home</a></div></section>`;
  }

  /* ---------- behaviours ---------- */

  let cleanups = [];
  const onCleanup = (f) => cleanups.push(f);

  function initReveal() {
    const els = $$('[data-reveal]', app);
    if (reducedMotion || !('IntersectionObserver' in window)) {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }),
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    els.forEach((e) => io.observe(e));
    onCleanup(() => io.disconnect());
  }

  function initCounters() {
    const els = $$('[data-count]', app);
    const run = (el) => {
      const end = +el.dataset.count;
      if (reducedMotion) return (el.textContent = end);
      const t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / 1400);
        el.textContent = Math.round(end * (1 - Math.pow(1 - k, 3)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };
    const io = new IntersectionObserver((entries) =>
      entries.forEach((e) => {
        if (e.isIntersecting) {
          run(e.target);
          io.unobserve(e.target);
        }
      })
    );
    els.forEach((e) => io.observe(e));
    onCleanup(() => io.disconnect());
  }

  function initTilt() {
    if (!finePointer || reducedMotion) return;
    $$('[data-tilt]', app).forEach((el) => {
      const move = (e) => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        el.style.setProperty('--ry', ((x - 0.5) * 10).toFixed(2) + 'deg');
        el.style.setProperty('--rx', ((0.5 - y) * 8).toFixed(2) + 'deg');
        el.style.setProperty('--mx', (x * 100).toFixed(1) + '%');
        el.style.setProperty('--my', (y * 100).toFixed(1) + '%');
        el.classList.add('tilting');
      };
      const leave = () => {
        el.style.setProperty('--rx', '0deg');
        el.style.setProperty('--ry', '0deg');
        el.classList.remove('tilting');
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', leave);
    });
  }

  function initHero() {
    const hero = $('#hero');
    if (!hero) return;
    const content = $('#hero-content');
    const inside = $('#hero-inside');
    const cue = $('#scroll-cue');
    let heroApi = null;
    const progress = () => {
      const r = hero.getBoundingClientRect();
      const total = hero.offsetHeight - window.innerHeight;
      return total > 0 ? Math.max(0, Math.min(1, -r.top / total)) : 0;
    };
    const update = () => {
      const p = progress();
      content.style.setProperty('--p', p.toFixed(3));
      inside.style.setProperty('--p', p.toFixed(3));
      cue.style.opacity = String(Math.max(0, 1 - p * 6));
      if (heroApi) heroApi.setProgress(p);
    };
    window.addEventListener('scroll', update, { passive: true });
    onCleanup(() => window.removeEventListener('scroll', update));
    update();

    if (reducedMotion) hero.classList.add('static');
    if (!window.SAD3D.supported()) return hero.classList.add('no-gl');
    let disposed = false;
    onCleanup(() => {
      disposed = true;
      if (heroApi) heroApi.dispose();
    });
    window.SAD3D.mountHero($('#hero-canvas'), { reduced: reducedMotion })
      .then((api) => {
        if (disposed) return api.dispose();
        heroApi = api;
        hero.classList.add('gl-ready');
        update();
      })
      .catch(() => hero.classList.add('no-gl'));
  }

  function mountViewer(el, type, opts, onReady) {
    const fallback = () => {
      el.classList.add('no-gl');
      const card = el.closest('.viewer-card');
      if (card) {
        const photoTab = $('[data-view="photo"]', card);
        if (photoTab) photoTab.click();
      }
    };
    if (!window.SAD3D.supported()) return fallback();
    let api = null;
    let disposed = false;
    onCleanup(() => {
      disposed = true;
      if (api) api.dispose();
    });
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        el.classList.add('loading');
        window.SAD3D.mountModel(el, type, opts)
          .then((a) => {
            el.classList.remove('loading');
            if (disposed) return a.dispose();
            api = a;
            el.classList.add('ready');
            onReady && onReady(a);
          })
          .catch(() => {
            el.classList.remove('loading');
            fallback();
          });
      },
      { rootMargin: '200px' }
    );
    io.observe(el);
    onCleanup(() => io.disconnect());
    return { get api() { return api; } };
  }

  function initShowroom() {
    const el = $('#showroom-viewer');
    if (!el) return;
    const info = $('#showroom-info');
    const setInfo = (slug) => {
      const p = bySlug[slug];
      info.innerHTML = `
        <span class="chip">${icon(catIcon[p.category])}${esc(catName[p.category])}</span>
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.short)}</p>
        <a class="btn btn-ghost btn-sm" href="#/product/${p.slug}">Product details ${icon('arrow')}</a>`;
    };
    const first = $('[data-show]', app).dataset.show;
    setInfo(first);
    const v = mountViewer(el, bySlug[first].model, bySlug[first].modelOptions);
    $$('[data-show]', app).forEach((b) =>
      b.addEventListener('click', () => {
        $$('[data-show]', app).forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-selected', String(x === b));
        });
        const p = bySlug[b.dataset.show];
        setInfo(p.slug);
        if (v && v.api) v.api.setModel(p.model, p.modelOptions);
      })
    );
  }

  function initProductViewer() {
    const el = $('#product-viewer');
    if (!el) return;
    const card = el.closest('.viewer-card');
    const slug = location.hash.split('/')[2];
    const p = bySlug[slug];
    const v = mountViewer(el, p.model, p.modelOptions);
    $$('[data-view]', card).forEach((b) =>
      b.addEventListener('click', () => {
        const photo = b.dataset.view === 'photo';
        $$('[data-view]', card).forEach((x) => {
          x.classList.toggle('active', x === b);
          x.setAttribute('aria-selected', String(x === b));
        });
        el.hidden = photo;
        $('.viewer-photo', card).hidden = !photo;
        $('.viewer-tools', card).hidden = photo;
        $('.viewer-hint', card).hidden = photo;
        const styles = $('.door-styles', card);
        if (styles) styles.hidden = photo;
      })
    );
    $$('[data-zoom]', card).forEach((b) => b.addEventListener('click', () => v && v.api && v.api.zoomBy(+b.dataset.zoom)));
    $$('[data-style]', card).forEach((b) =>
      b.addEventListener('click', () => {
        $$('[data-style]', card).forEach((x) => x.classList.toggle('active', x === b));
        if (v && v.api) v.api.setModel(p.model, { ...p.modelOptions, ...p.modelStyles[+b.dataset.style][1] });
      })
    );
    // show the model's own interaction hint once it is ready
    const hint = $('.viewer-hint span', card);
    const mo = new MutationObserver(() => {
      if (el.dataset.hint) hint.textContent = 'Drag to rotate · ' + el.dataset.hint;
    });
    mo.observe(el, { attributes: true, attributeFilter: ['data-hint'] });
    onCleanup(() => mo.disconnect());
  }

  function initRing() {
    const stage = $('#ring');
    if (!stage) return;
    const ring = $('.ring', stage);
    const items = $$('.ring-item', ring);
    const caption = $('#ring-caption');
    const n = items.length;
    const step = 360 / n;
    let radius = 0;
    let rot = 0;
    let target = 0;
    let dragging = false;
    let dragMoved = 0;
    let lastX = 0;
    let lastInteract = performance.now();
    const layout = () => {
      const w = items[0].offsetWidth;
      radius = Math.round(w / 2 / Math.tan(Math.PI / n)) + 40;
      items.forEach((it, i) => (it.style.transform = `rotateY(${i * step}deg) translateZ(${radius}px)`));
    };
    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(stage);
    const frontIndex = () => ((Math.round(-target / step) % n) + n) % n;
    let raf = 0;
    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (!dragging && !reducedMotion && t - lastInteract > 3800) {
        target -= step;
        lastInteract = t;
      }
      rot += (target - rot) * (reducedMotion ? 1 : 0.08);
      ring.style.transform = `translateZ(${-radius}px) rotateY(${rot}deg)`;
      const f = frontIndex();
      items.forEach((it, i) => {
        const on = i === f;
        if (it.classList.contains('front') !== on) {
          it.classList.toggle('front', on);
          it.tabIndex = on ? 0 : -1;
          it.setAttribute('aria-hidden', String(!on));
        }
      });
      const name = items[f].querySelector('h3').textContent;
      if (caption.textContent !== name) caption.textContent = name;
    };
    raf = requestAnimationFrame(loop);
    const snap = () => (target = Math.round(target / step) * step);
    stage.addEventListener('pointerdown', (e) => {
      dragging = true;
      dragMoved = 0;
      lastX = e.clientX;
    });
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    function onMove(e) {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      dragMoved += Math.abs(dx);
      target += dx * 0.25;
      lastInteract = performance.now();
    }
    function onUp() {
      if (!dragging) return;
      dragging = false;
      snap();
    }
    items.forEach((it, i) =>
      it.addEventListener('click', (e) => {
        if (dragMoved > 6) return e.preventDefault();
        if (!it.classList.contains('front')) {
          e.preventDefault();
          const cur = frontIndex();
          let d = i - cur;
          if (d > n / 2) d -= n;
          if (d < -n / 2) d += n;
          target -= d * step;
          lastInteract = performance.now();
        }
      })
    );
    $$('[data-ring]', app).forEach((b) =>
      b.addEventListener('click', () => {
        snap();
        target += b.dataset.ring === 'next' ? -step : step;
        lastInteract = performance.now();
      })
    );
    onCleanup(() => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    });
  }

  function initProductFilter(initial) {
    const grid = $('#pgrid');
    if (!grid || !$('#product-search')) return;
    const cards = $$('.pcard', grid);
    const search = $('#product-search');
    let cat = categories.some((c) => c.id === initial) ? initial : 'all';
    const apply = () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      cards.forEach((c, i) => {
        const p = products[i];
        const ok = (cat === 'all' || p.category === cat) && (!q || (p.name + ' ' + p.short + ' ' + (p.subtitle || '')).toLowerCase().includes(q));
        c.hidden = !ok;
        if (ok) {
          shown++;
          c.classList.add('in');
        }
      });
      $('#pempty').hidden = shown > 0;
    };
    $$('[data-cat]', app).forEach((b) =>
      b.addEventListener('click', () => {
        cat = b.dataset.cat;
        $$('[data-cat]', app).forEach((x) => x.classList.toggle('active', x === b));
        history.replaceState(null, '', cat === 'all' ? '#/products' : '#/products/' + cat);
        apply();
      })
    );
    search.addEventListener('input', apply);
    apply();
  }

  function initGallery(items) {
    $$('[data-gcat]', app).forEach((b) =>
      b.addEventListener('click', () => {
        $$('[data-gcat]', app).forEach((x) => x.classList.toggle('active', x === b));
        $$('#masonry .gitem', app).forEach((g) => {
          g.hidden = !(b.dataset.gcat === 'all' || g.dataset.cat === b.dataset.gcat);
          g.classList.add('in');
        });
      })
    );
    $$('[data-lightbox]', app).forEach((b) => b.addEventListener('click', () => openLightbox(items, +b.dataset.lightbox)));
  }

  function openLightbox(items, index) {
    const d = $('#lightbox');
    let i = index;
    const visible = () => items.filter((_, k) => { const b = $(`[data-lightbox="${k}"]`, app); return b && !b.hidden; });
    const render = (dir) => {
      const it = items[i];
      d.innerHTML = `
        <button class="modal-x" data-close aria-label="Close">${icon('close')}</button>
        <button class="lb-nav lb-prev" aria-label="Previous image">${icon('left')}</button>
        <figure class="lb-figure ${dir || ''}">${media(it.src, it.title)}<figcaption>${esc(it.title)} <span>${i + 1} / ${items.length}</span></figcaption></figure>
        <button class="lb-nav lb-next" aria-label="Next image">${icon('right')}</button>`;
      $('.lb-prev', d).onclick = () => go(-1);
      $('.lb-next', d).onclick = () => go(1);
    };
    const go = (s) => {
      const vis = visible();
      const cur = vis.indexOf(items[i]);
      const next = vis[(cur + s + vis.length) % vis.length];
      i = items.indexOf(next);
      render(s > 0 ? 'from-right' : 'from-left');
    };
    const key = (e) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    render();
    d.addEventListener('keydown', key);
    d.addEventListener('close', () => d.removeEventListener('keydown', key), { once: true });
    openModal(d);
  }

  function initFlip() {
    $$('.flip', app).forEach((f) => f.addEventListener('click', () => f.classList.toggle('flipped')));
  }

  /* ---------- router ---------- */

  const titles = {
    home: 'Steel Access Doors | Clean Room Solutions, Hyderabad',
    about: 'About Us | Steel Access Doors',
    products: 'Products | Steel Access Doors',
    gallery: 'Gallery | Steel Access Doors',
    contact: 'Contact Us | Steel Access Doors',
  };

  let firstRender = true;
  function route() {
    cleanups.forEach((f) => {
      try { f(); } catch (e) { /* ignore */ }
    });
    cleanups = [];
    document.body.classList.remove('menu-open');
    $('#burger').setAttribute('aria-expanded', 'false');

    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const [page = 'home', arg] = parts;
    let html;
    let nav = page;
    switch (page) {
      case 'home': html = pageHome(); break;
      case 'about': html = pageAbout(); break;
      case 'products': html = pageProducts(arg); break;
      case 'product': html = pageProduct(arg); nav = 'products'; break;
      case 'gallery': html = pageGallery(); break;
      case 'contact': html = pageContact(); break;
      default: html = pageNotFound(); nav = '';
    }
    document.body.dataset.page = page;
    app.innerHTML = `<div class="page${firstRender || reducedMotion ? '' : ' page-enter'}">${html}</div>`;
    document.title = page === 'product' && bySlug[arg] ? `${bySlug[arg].name} | Steel Access Doors` : titles[page] || 'Steel Access Doors';
    $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
    if (!firstRender) {
      window.scrollTo(0, 0);
      app.focus({ preventScroll: true });
    }
    firstRender = false;

    initReveal();
    initCounters();
    initTilt();
    initFlip();
    if (page === 'home') {
      initHero();
      initRing();
      initShowroom();
    }
    if (page === 'products') initProductFilter(arg);
    if (page === 'product' && bySlug[arg]) {
      initProductViewer();
      const p = bySlug[arg];
      if (p.gallery) {
        const items = p.gallery.map((src, i) => ({ src, title: p.name + ' ' + (i + 1) }));
        $$('[data-lightbox]', app).forEach((b) => b.addEventListener('click', () => openLightbox(items, +b.dataset.lightbox)));
      }
    }
    if (page === 'gallery') initGallery(galleryItems());
    $$('form.form', app).forEach(bindForm);
  }

  buildChrome();
  window.addEventListener('hashchange', route);
  route();

  // loader, then the certification announcement once per session
  const loader = $('#loader');
  const done = () => {
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 900);
    if (!store.get('sad-announce')) {
      store.set('sad-announce', '1');
      setTimeout(openAnnouncement, 1400);
    }
  };
  if (document.readyState === 'complete') setTimeout(done, 500);
  else window.addEventListener('load', () => setTimeout(done, 300));
  setTimeout(() => loader.isConnected && !loader.classList.contains('done') && done(), 3500);
})();
