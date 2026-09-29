/* Three.js scenes: the scroll-driven hero doorway and procedural product models.
 *
 * Loaded as a classic script so the site also works when index.html is opened
 * straight from disk; three.js itself comes from the CDN through the import map
 * in index.html. Everything degrades to the static photo layout if WebGL or the
 * CDN is unavailable.
 */
(function () {
  const AMBER = 0xefa21f;
  const AIR = 0x8fdcff;
  let libsPromise = null;

  function supported() {
    try {
      const c = document.createElement('canvas');
      return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
    } catch (e) {
      return false;
    }
  }

  function libs() {
    if (!libsPromise) {
      libsPromise = Promise.all([
        import('three'),
        import('three/addons/environments/RoomEnvironment.js'),
        import('three/addons/geometries/RoundedBoxGeometry.js'),
      ]).then(([THREE, env, rb]) => ({ THREE, RoomEnvironment: env.RoomEnvironment, RoundedBoxGeometry: rb.RoundedBoxGeometry }));
      libsPromise.catch(() => (libsPromise = null));
    }
    return libsPromise;
  }

  /* ---------- stage: renderer, environment, loop, cleanup ---------- */

  function createStage(L, container, opts = {}) {
    const { THREE, RoomEnvironment } = L;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = opts.exposure || 1;
    renderer.domElement.className = 'gl';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;

    const camera = new THREE.PerspectiveCamera(opts.fov || 35, 1, 0.05, 100);
    const onResize = [];
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      onResize.forEach((f) => f(w, h));
    };
    const ro = new ResizeObserver(resize);
    ro.observe(container);
    resize();

    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { rootMargin: '100px' });
    io.observe(container);

    const ticks = [];
    const clock = new THREE.Clock();
    let raf = 0;
    let alive = true;
    const loop = () => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!visible || document.hidden) return;
      const t = clock.elapsedTime;
      for (const f of ticks) f(dt, t);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    const dispose = () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        mats.forEach((m) => {
          Object.values(m).forEach((v) => v && v.isTexture && v.dispose());
          m.dispose();
        });
      });
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };

    return { THREE, renderer, scene, camera, ticks, onResize, dispose };
  }

  /* ---------- textures & materials ---------- */

  function canvasTexture(THREE, size, draw, srgb = true) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  function brushed(THREE, base, vertical) {
    const t = canvasTexture(THREE, 512, (g, s) => {
      g.fillStyle = base;
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 3000; i++) {
        const a = Math.random() * 0.035;
        g.fillStyle = Math.random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
        g.fillRect(0, Math.random() * s, s, Math.random() * 0.9 + 0.2);
      }
    });
    if (vertical) {
      t.center.set(0.5, 0.5);
      t.rotation = Math.PI / 2;
    }
    return t;
  }

  function dotTexture(THREE) {
    return canvasTexture(THREE, 64, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    });
  }

  function shadowTexture(THREE) {
    return canvasTexture(THREE, 256, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(0,0,0,0.55)');
      r.addColorStop(0.55, 'rgba(0,0,0,0.18)');
      r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    });
  }

  function perforated(THREE, bg, hole, n) {
    return canvasTexture(THREE, 256, (g, s) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, s, s);
      g.fillStyle = hole;
      const step = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          g.beginPath();
          g.arc(x * step + step / 2 + (y % 2 ? step / 4 : 0), y * step + step / 2, step * 0.22, 0, Math.PI * 2);
          g.fill();
        }
    });
  }

  function makeMaterials(THREE) {
    const std = (p) => new THREE.MeshStandardMaterial(p);
    return {
      steel: std({ color: 0xdfe3e8, metalness: 0.9, roughness: 0.3, map: brushed(THREE, '#c9ced4') }),
      steelV: std({ color: 0xdfe3e8, metalness: 0.9, roughness: 0.28, map: brushed(THREE, '#c9ced4', true) }),
      gi: std({ color: 0xb9c0c4, metalness: 0.7, roughness: 0.5, map: brushed(THREE, '#a9b0b5') }),
      dark: std({ color: 0x2f353d, metalness: 0.75, roughness: 0.42 }),
      panel: std({ color: 0xeef1f4, metalness: 0.15, roughness: 0.42 }),
      panelWarm: std({ color: 0xe9e6df, metalness: 0.1, roughness: 0.5 }),
      amber: std({ color: AMBER, metalness: 0.5, roughness: 0.3 }),
      amberGlow: std({ color: AMBER, emissive: AMBER, emissiveIntensity: 1.4 }),
      glass: new THREE.MeshPhysicalMaterial({
        color: 0xbcd8ea, metalness: 0, roughness: 0.04, transparent: true, opacity: 0.28, envMapIntensity: 1.6, depthWrite: false,
      }),
      rubber: std({ color: 0x15181c, roughness: 0.85 }),
      hepa: std({ color: 0xf6f9fc, emissive: 0xd9efff, emissiveIntensity: 0.7, roughness: 0.6, map: perforated(THREE, '#f1f5f9', '#b9c7d3', 16) }),
      grille: std({ color: 0xcfd5dc, metalness: 0.6, roughness: 0.4, map: perforated(THREE, '#d7dde3', '#3a424b', 14) }),
      screen: std({ color: 0x0b1620, emissive: 0x2bb3ff, emissiveIntensity: 0.9 }),
      ledGreen: std({ color: 0x22ff88, emissive: 0x22ff88, emissiveIntensity: 2 }),
      ledRed: std({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 2 }),
      ledOff: std({ color: 0x333a42, roughness: 0.4 }),
      floor: std({ color: 0xcdd6de, metalness: 0.1, roughness: 0.28 }),
      mattress: std({ color: 0x2c5364, roughness: 0.7 }),
      copper: std({ color: 0xc27a45, metalness: 0.9, roughness: 0.35 }),
      fabric: std({ color: 0x7fb6d6, roughness: 0.9 }),
      dot: dotTexture(THREE),
      shadow: shadowTexture(THREE),
    };
  }

  function makeKit(L, m) {
    const { THREE, RoundedBoxGeometry } = L;
    const box = (w, h, d, mat, x = 0, y = 0, z = 0, r = 0) => {
      const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
      const g = rr > 0 ? new RoundedBoxGeometry(w, h, d, 3, rr) : new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const cyl = (rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 32) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const sphere = (r, mat, x = 0, y = 0, z = 0) => {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat);
      mesh.position.set(x, y, z);
      return mesh;
    };
    const tube = (points, r, mat) =>
      new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), 48, r, 12, false), mat);
    const group = (...kids) => {
      const g = new THREE.Group();
      kids.forEach((k) => k && g.add(k));
      return g;
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);

    // Particles drifting through a box volume, used for laminar airflow.
    const flow = (o) => {
      const { count = 300, w = 1, d = 1, top = 1, bottom = 0, x = 0, z = 0, color = AIR, size = 0.018, speed = 0.55, bend } = o;
      const pos = new Float32Array(count * 3);
      const seed = new Float32Array(count);
      const reset = (i, anyY) => {
        pos[i * 3] = x + (Math.random() - 0.5) * w;
        pos[i * 3 + 1] = anyY ? bottom + Math.random() * (top - bottom) : top;
        pos[i * 3 + 2] = z + (Math.random() - 0.5) * d;
      };
      for (let i = 0; i < count; i++) {
        reset(i, true);
        seed[i] = 0.6 + Math.random() * 0.8;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({
        color, size, map: m.dot, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const pts = new THREE.Points(geo, mat);
      pts.userData.tick = (dt) => {
        for (let i = 0; i < count; i++) {
          pos[i * 3 + 1] -= speed * seed[i] * dt;
          if (bend) bend(pos, i, dt, (pos[i * 3 + 1] - bottom) / (top - bottom));
          if (pos[i * 3 + 1] < bottom) reset(i, false);
        }
        geo.attributes.position.needsUpdate = true;
      };
      return pts;
    };

    return { box, cyl, sphere, tube, group, flow, V };
  }

  /* ---------- product models ---------- */

  function buildDoor(k, m, o = {}) {
    const { box, cyl, group } = k;
    const style = o.style || 'scientific';
    const double = style === 'general' || style === 'shaft' || o.double;
    const H = style === 'shaft' ? 1.4 : 2.1;
    const W = double ? 1.6 : 1.0;
    const T = 0.055;
    const fw = 0.075;
    const g = group();
    const y0 = style === 'shaft' ? 0.35 : 0;

    // frame
    g.add(box(fw, H + fw, 0.15, m.dark, -W / 2 - fw / 2, y0 + (H + fw) / 2, 0, 0.008));
    g.add(box(fw, H + fw, 0.15, m.dark, W / 2 + fw / 2, y0 + (H + fw) / 2, 0, 0.008));
    g.add(box(W + fw * 2, fw, 0.15, m.dark, 0, y0 + H + fw / 2, 0, 0.008));
    g.add(box(W + fw * 2, 0.012, 0.152, m.amber, 0, y0 + H + fw - 0.006, 0));
    if (style === 'shaft') g.add(box(W + fw * 2, fw, 0.15, m.dark, 0, y0 - fw / 2, 0, 0.008));

    const leaves = [];
    const makeLeaf = (w, side) => {
      const pivot = group();
      pivot.position.set(side * (W / 2 - 0.004), y0, 0);
      const leaf = group();
      leaf.position.x = -side * (w / 2);
      pivot.add(leaf);
      const cx = 0;
      leaf.add(box(w - 0.008, H - 0.01, T, m.steelV, cx, H / 2, 0, 0.012));
      // hinges
      for (const hy of style === 'shaft' ? [0.25, H - 0.25] : [0.25, H / 2, H - 0.25]) {
        leaf.add(cyl(0.014, 0.014, 0.1, m.dark, side * (w / 2 - 0.004), hy, T / 2));
      }
      const face = T / 2 + 0.004;
      if (style === 'scientific') {
        leaf.add(box(0.3, 0.62, T + 0.01, m.dark, cx, 1.45, 0, 0.01));
        leaf.add(box(0.26, 0.58, T + 0.016, m.glass, cx, 1.45, 0));
        leaf.add(box(w - 0.1, 0.22, 0.006, m.steel, cx, 0.16, face, 0.002));
      } else if (style === 'fire') {
        const vp = cyl(0.11, 0.11, T + 0.014, m.dark, cx, 1.55, 0);
        vp.rotation.x = Math.PI / 2;
        leaf.add(vp);
        const vg = cyl(0.09, 0.09, T + 0.02, m.glass, cx, 1.55, 0);
        vg.rotation.x = Math.PI / 2;
        leaf.add(vg);
        leaf.add(box(0.16, 0.1, 0.006, m.amberGlow, cx, 1.9, face));
        leaf.add(box(w - 0.12, 0.012, 0.006, m.amber, cx, 1.25, face));
      } else if (style === 'decorative') {
        for (const [py, ph] of [[1.55, 0.7], [0.62, 0.9]]) {
          leaf.add(box(w - 0.24, ph, 0.02, m.steelV, cx, py, face + 0.004, 0.008));
          leaf.add(box(w - 0.3, ph - 0.06, 0.022, m.steel, cx, py, face + 0.006, 0.006));
        }
        leaf.add(box(0.03, 0.5, 0.01, m.amber, cx, 1.55, face + 0.018, 0.004));
      } else if (style === 'shaft') {
        for (let i = 0; i < 6; i++) leaf.add(box(w - 0.18, 0.025, 0.012, m.dark, cx, 0.3 + i * 0.16, face, 0.004));
      } else {
        leaf.add(box(0.22, 0.5, T + 0.01, m.dark, cx, 1.5, 0, 0.01));
        leaf.add(box(0.18, 0.46, T + 0.016, m.glass, cx, 1.5, 0));
        leaf.add(box(w - 0.2, 0.18, 0.006, m.steel, cx, 0.15, face, 0.002));
      }
      // handle
      const hx = -side * (w / 2 - 0.1);
      if (style === 'general') {
        leaf.add(box(w * 0.7, 0.035, 0.035, m.steel, cx - side * 0.05, 1.0, face + 0.06, 0.012));
        leaf.add(box(0.03, 0.03, 0.06, m.steel, hx, 1.0, face + 0.03));
      } else {
        leaf.add(box(0.05, 0.1, 0.02, m.steel, hx, 1.02 * (H / 2.1), face + 0.01, 0.006));
        leaf.add(box(0.14, 0.022, 0.022, m.steel, hx + side * 0.06, 1.05 * (H / 2.1), face + 0.04, 0.008));
      }
      g.add(pivot);
      leaves.push({ pivot, side });
    };

    if (double) {
      makeLeaf(W / 2, -1);
      makeLeaf(W / 2, 1);
    } else {
      makeLeaf(W, -1);
    }

    let open = 0;
    let target = 0;
    g.userData.setOpen = (v) => (target = v);
    g.userData.toggle = () => (target = target > 0.5 ? 0 : 1);
    g.userData.tick = (dt) => {
      open += (target - open) * Math.min(1, dt * 4);
      leaves.forEach(({ pivot, side }) => (pivot.rotation.y = -side * open * 1.35));
    };
    g.userData.hint = 'Tap to open';
    return g;
  }

  function buildPassbox(k, m, o = {}) {
    const { box, cyl, sphere, group, flow } = k;
    const S = 0.7;
    const cy = 1.15;
    const g = group();
    // wall the pass box goes through
    g.add(box(1.6, 2.2, 0.08, m.panel, 0, 1.1, -0.05, 0.01));
    g.add(box(1.6, 0.012, 0.082, m.amber, 0, 0.06, -0.05));
    // body
    g.add(box(S + 0.08, S + 0.08, S, m.steel, 0, cy, 0, 0.02));
    // front flange
    g.add(box(S + 0.26, S + 0.26, 0.03, m.steel, 0, cy, 0.01, 0.01));
    const front = S / 2 + 0.01;
    const pivot = group();
    pivot.position.set(-(S - 0.02) / 2, cy, front);
    const door = group(
      box(S - 0.04, S - 0.04, 0.03, m.steelV, (S - 0.02) / 2, 0, 0, 0.01),
      box(S * 0.55, S * 0.55, 0.034, m.glass, (S - 0.02) / 2, 0.02, 0),
      box(0.03, 0.2, 0.03, m.steel, S - 0.1, 0, 0.035, 0.01)
    );
    pivot.add(door);
    g.add(pivot);
    // interlock indicators
    const ledA = sphere(0.018, m.ledGreen, -0.08, cy + S / 2 + 0.07, 0.03);
    const ledB = sphere(0.018, m.ledGreen, 0.08, cy + S / 2 + 0.07, 0.03);
    g.add(ledA, ledB);
    if (o.dynamic) {
      g.add(box(S + 0.08, 0.2, S - 0.1, m.steel, 0, cy + S / 2 + 0.14, -0.05, 0.02));
      g.add(box(S - 0.1, 0.12, 0.012, m.grille, 0, cy + S / 2 + 0.14, S / 2 - 0.1));
      const gauge = cyl(0.055, 0.055, 0.03, m.dark, S / 2 + 0.06, cy + S / 2 + 0.02, 0.04);
      gauge.rotation.x = Math.PI / 2;
      const face = cyl(0.046, 0.046, 0.034, m.panel, S / 2 + 0.06, cy + S / 2 + 0.02, 0.04);
      face.rotation.x = Math.PI / 2;
      g.add(gauge, face);
      const f = flow({ count: 140, w: S * 0.7, d: S * 0.6, top: cy + S / 2 - 0.04, bottom: cy - S / 2 + 0.05, z: 0, size: 0.016, speed: 0.35 });
      g.add(f);
      g.userData.ticks = [f.userData.tick];
    }
    if (o.leaves === 3) {
      const side = group(
        box(0.03, S - 0.06, S - 0.14, m.steelV, 0, 0, 0, 0.01),
        box(0.034, S * 0.45, S * 0.4, m.glass, 0, 0.02, 0),
        box(0.03, 0.18, 0.03, m.steel, 0.03, 0, S / 2 - 0.14, 0.01)
      );
      side.position.set(S / 2 + 0.055, cy, 0);
      g.add(side);
      g.add(sphere(0.018, m.ledGreen, 0, cy + S / 2 + 0.07, 0.03));
      g.add(box(0.2, 0.06, 0.006, m.amberGlow, 0, cy - S / 2 - 0.08, 0.03));
    }
    let open = 0;
    let target = 0;
    g.userData.toggle = () => (target = target > 0.5 ? 0 : 1);
    g.userData.hint = 'Tap to test the interlock';
    const baseTick = g.userData.ticks || [];
    g.userData.ticks = baseTick.concat((dt) => {
      open += (target - open) * Math.min(1, dt * 4);
      pivot.rotation.y = -open * 1.6;
      ledB.material = open > 0.05 ? m.ledRed : m.ledGreen;
    });
    return g;
  }

  function buildTable(k, m, o = {}) {
    const { box, cyl, group } = k;
    const mat = o.finish === 'gi' ? m.gi : m.steel;
    const L = 1.5, D = 0.75, H = 0.86;
    const g = group();
    g.add(box(L, 0.04, D, mat, 0, H - 0.02, 0, 0.008));
    if (o.finish !== 'gi') g.add(box(L, 0.12, 0.02, mat, 0, H + 0.06, -D / 2 + 0.01, 0.006));
    g.add(box(L - 0.02, 0.06, 0.02, mat, 0, H - 0.07, D / 2 - 0.02));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        g.add(box(0.045, H - 0.06, 0.045, mat, sx * (L / 2 - 0.07), (H - 0.06) / 2 + 0.03, sz * (D / 2 - 0.07), 0.006));
        g.add(cyl(0.028, 0.02, 0.04, m.dark, sx * (L / 2 - 0.07), 0.02, sz * (D / 2 - 0.07)));
      }
    g.add(box(L - 0.1, 0.025, D - 0.1, mat, 0, 0.2, 0, 0.006));
    return g;
  }

  function buildLafUnit(k, m, o = {}) {
    const { box, cyl, group, flow } = k;
    const g = group();
    const ticks = [];
    if (o.ceiling) {
      // OT LAF: ceiling plenum over an operating table
      g.add(box(2.4, 0.32, 2.2, m.panel, 0, 2.75, 0, 0.02));
      g.add(box(2.1, 0.02, 1.9, m.hepa, 0, 2.58, 0));
      g.add(box(2.4, 0.02, 0.04, m.amberGlow, 0, 2.58, 1.08));
      g.add(box(2.4, 0.02, 0.04, m.amberGlow, 0, 2.58, -1.08));
      g.add(cyl(0.3, 0.42, 0.62, m.dark, 0, 0.31, 0));
      g.add(cyl(0.08, 0.08, 0.3, m.steel, 0, 0.75, 0));
      g.add(box(1.95, 0.08, 0.55, m.steel, 0, 0.92, 0, 0.02));
      g.add(box(1.85, 0.08, 0.5, m.mattress, 0, 1.0, 0, 0.03));
      // surgical light
      g.add(cyl(0.015, 0.015, 0.5, m.steel, 0.5, 2.34, 0.2));
      const lamp = cyl(0.28, 0.2, 0.08, m.panel, 0.5, 2.05, 0.2);
      lamp.rotation.z = 0.35;
      g.add(lamp);
      const f = flow({ count: 520, w: 2.0, d: 1.8, top: 2.55, bottom: 0.05, speed: 0.8 });
      g.add(f);
      ticks.push(f.userData.tick);
    } else {
      // Mobile LAF on castors
      const H = 1.95;
      const W = 1.2, D = 0.8;
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          g.add(box(0.045, H - 0.2, 0.045, m.steel, sx * (W / 2 - 0.03), (H - 0.2) / 2 + 0.15, sz * (D / 2 - 0.03), 0.006));
          g.add(cyl(0.05, 0.05, 0.035, m.rubber, sx * (W / 2 - 0.03), 0.05, sz * (D / 2 - 0.03)).rotateZ(Math.PI / 2));
          g.add(box(0.05, 0.06, 0.05, m.dark, sx * (W / 2 - 0.03), 0.12, sz * (D / 2 - 0.03)));
        }
      g.add(box(W + 0.04, 0.36, D + 0.04, m.steel, 0, H, 0, 0.02));
      g.add(box(W - 0.06, 0.02, D - 0.06, m.hepa, 0, H - 0.19, 0));
      g.add(box(0.26, 0.12, 0.01, m.screen, -0.3, H, D / 2 + 0.025));
      g.add(box(0.5, 0.012, 0.01, m.amberGlow, 0.25, H - 0.1, D / 2 + 0.025));
      // curtains
      g.add(box(W - 0.05, 1.0, 0.006, m.glass, 0, H - 0.7, -D / 2 + 0.03));
      g.add(box(0.006, 1.0, D - 0.05, m.glass, -W / 2 + 0.03, H - 0.7, 0));
      g.add(box(0.006, 1.0, D - 0.05, m.glass, W / 2 - 0.03, H - 0.7, 0));
      g.add(box(W - 0.05, 0.5, 0.006, m.glass, 0, H - 0.45, D / 2 - 0.03));
      const f = flow({ count: 260, w: W - 0.1, d: D - 0.1, top: H - 0.2, bottom: 0.55, speed: 0.55 });
      g.add(f);
      ticks.push(f.userData.tick);
    }
    g.userData.ticks = ticks;
    return g;
  }

  function buildBooth(k, m, o = {}) {
    const { box, cyl, group, flow } = k;
    const W = 2.2, H = 2.45, D = 1.5;
    const g = group();
    g.add(box(W, H, 0.06, m.steelV, 0, H / 2, -D / 2, 0.01));
    g.add(box(0.06, H, D, m.steel, -W / 2, H / 2, 0, 0.01));
    g.add(box(0.06, H, D, m.steel, W / 2, H / 2, 0, 0.01));
    g.add(box(W + 0.06, 0.45, D, m.steel, 0, H + 0.2, 0, 0.02));
    g.add(box(W - 0.1, 0.02, D - 0.1, m.hepa, 0, H - 0.04, 0));
    // fascia with controls
    g.add(box(0.5, 0.18, 0.01, m.screen, -0.5, H + 0.2, D / 2 + 0.006));
    g.add(box(W * 0.9, 0.014, 0.01, m.amberGlow, 0, H - 0.01, D / 2 + 0.006));
    for (const gx of [0.35, 0.6]) {
      const gg = cyl(0.06, 0.06, 0.02, m.panel, gx, H + 0.2, D / 2 + 0.01);
      gg.rotation.x = Math.PI / 2;
      g.add(gg);
    }
    // return grilles low on back wall
    g.add(box(W - 0.3, 0.35, 0.012, m.grille, 0, 0.3, -D / 2 + 0.04));
    const ticks = [];
    if (o.table !== false) {
      const t = buildTable(k, m, { finish: 'ss' });
      t.scale.setScalar(0.75);
      t.position.set(0, 0, -0.2);
      g.add(t);
      g.add(box(0.3, 0.05, 0.3, m.dark, 0.2, 0.7, -0.2, 0.01));
      g.add(box(0.26, 0.012, 0.26, m.steel, 0.2, 0.735, -0.2));
    }
    // airflow: down, then sweep towards the rear return grilles
    const f = flow({
      count: 480, w: W - 0.2, d: D - 0.2, top: H - 0.08, bottom: 0.1, speed: 0.75,
      bend: (p, i, dt, h) => {
        if (h < 0.35) p[i * 3 + 2] -= (0.35 - h) * 2.4 * dt;
        if (p[i * 3 + 2] < -D / 2 + 0.08) p[i * 3 + 1] = -1;
      },
    });
    g.add(f);
    ticks.push(f.userData.tick);
    g.userData.ticks = ticks;
    return g;
  }

  function buildAhu(k, m, o = {}) {
    const { box, cyl, group } = k;
    const decks = o.decks || 1;
    const sections = [0.6, 0.75, 0.95, 0.55];
    const L = sections.reduce((a, b) => a + b, 0);
    const H = 1.0, D = 1.1;
    const g = group();
    g.add(box(L + 0.06, 0.12, D + 0.06, m.dark, 0, 0.06, 0, 0.01));
    const fans = [];
    for (let d = 0; d < decks; d++) {
      const y = 0.12 + d * H + H / 2;
      let x = -L / 2;
      sections.forEach((len, i) => {
        g.add(box(len - 0.012, H - 0.012, D, m.panel, x + len / 2, y, 0, 0.012));
        // profile edges
        g.add(box(0.03, H, 0.03, m.dark, x + 0.015, y, D / 2 - 0.015));
        g.add(box(0.12, 0.03, 0.03, m.dark, x + len - 0.12, y + 0.05, D / 2 + 0.015, 0.008));
        if (i === 2) {
          // fan section with inspection window
          const ring = cyl(0.26, 0.26, 0.03, m.dark, x + len / 2, y, D / 2);
          ring.rotation.x = Math.PI / 2;
          g.add(ring);
          const glass = cyl(0.23, 0.23, 0.034, m.glass, x + len / 2, y, D / 2);
          glass.rotation.x = Math.PI / 2;
          g.add(glass);
          const fan = group();
          for (let b = 0; b < 5; b++) {
            const blade = box(0.2, 0.06, 0.01, m.steel, 0.1, 0, 0);
            const arm = group(blade);
            arm.rotation.z = (b / 5) * Math.PI * 2;
            fan.add(arm);
          }
          fan.add(cyl(0.04, 0.04, 0.04, m.amber).rotateX(Math.PI / 2));
          fan.position.set(x + len / 2, y, D / 2 - 0.03);
          g.add(fan);
          fans.push(fan);
        }
        if (i === 1) {
          for (const py of [-0.25, -0.1]) {
            const p = cyl(0.03, 0.03, 0.3, m.copper, x + len / 2 + 0.15, y + py, D / 2 + 0.15);
            p.rotation.x = Math.PI / 2;
            g.add(p);
          }
        }
        if (i === 0 || i === 3) g.add(box(len - 0.14, 0.012, 0.01, m.amberGlow, x + len / 2, y + H / 2 - 0.08, D / 2 + 0.004));
        x += len;
      });
    }
    // duct flange on the inlet end
    g.add(box(0.12, 0.65, 0.75, m.steel, -L / 2 - 0.06, 0.12 + H / 2, 0, 0.01));
    g.userData.ticks = [(dt) => fans.forEach((f) => (f.rotation.z -= dt * 7))];
    return g;
  }

  function roomShell(k, m, W, D, H) {
    const { box, group } = k;
    const g = group();
    g.add(box(W, 0.05, D, m.floor, 0, -0.025, 0));
    g.add(box(W, H, 0.08, m.panel, 0, H / 2, -D / 2));
    g.add(box(0.08, H, D, m.panel, -W / 2, H / 2, 0));
    for (let x = -W / 2 + 1.2; x < W / 2 - 0.1; x += 1.2) g.add(box(0.006, H, 0.004, m.dark, x, H / 2, -D / 2 + 0.042));
    for (let z = -D / 2 + 1.2; z < D / 2 - 0.1; z += 1.2) g.add(box(0.004, H, 0.006, m.dark, -W / 2 + 0.042, H / 2, z));
    // coving strip
    g.add(box(W, 0.012, 0.01, m.amber, 0, 0.1, -D / 2 + 0.045));
    g.add(box(0.01, 0.012, D, m.amber, -W / 2 + 0.045, 0.1, 0));
    return g;
  }

  function buildCleanRoom(k, m) {
    const { box, group, flow } = k;
    const W = 4, D = 3.2, H = 2.7;
    const g = roomShell(k, m, W, D, H);
    const ticks = [];
    for (const [hx, hz] of [[-0.9, -0.5], [0.9, -0.5], [-0.9, 0.9], [0.9, 0.9]]) {
      g.add(box(0.9, 0.18, 0.9, m.panel, hx, H + 0.09, hz, 0.01));
      g.add(box(0.82, 0.02, 0.82, m.hepa, hx, H - 0.01, hz));
      const f = flow({ count: 110, w: 0.8, d: 0.8, x: hx, z: hz, top: H - 0.03, bottom: 0.02, speed: 0.6 });
      g.add(f);
      ticks.push(f.userData.tick);
    }
    const door = buildDoor(k, m, { style: 'scientific' });
    door.position.set(1.2, 0, -D / 2 + 0.05);
    g.add(door);
    // viewing window
    g.add(box(1.0, 0.7, 0.1, m.dark, -0.7, 1.45, -D / 2, 0.01));
    g.add(box(0.94, 0.64, 0.104, m.glass, -0.7, 1.45, -D / 2));
    // pass box through side wall
    g.add(box(0.1, 0.5, 0.5, m.steel, -W / 2, 1.2, 0.6, 0.01));
    g.add(box(0.12, 0.28, 0.28, m.glass, -W / 2, 1.2, 0.6));
    const t = buildTable(k, m, { finish: 'ss' });
    t.position.set(-0.4, 0, 0.5);
    g.add(t);
    g.userData.ticks = ticks.concat(door.userData.tick);
    g.userData.toggle = door.userData.toggle;
    g.userData.hint = 'Tap to open the door';
    return g;
  }

  function buildOT(k, m) {
    const { box, cyl, group } = k;
    const W = 4.4, D = 3.6, H = 2.9;
    const g = roomShell(k, m, W, D, H);
    const laf = buildLafUnit(k, m, { ceiling: true });
    laf.position.set(0.2, 0, 0.1);
    g.add(laf);
    // wall control panel and X-ray viewer
    g.add(box(0.9, 0.55, 0.03, m.screen, -1.1, 1.5, -D / 2 + 0.06, 0.01));
    g.add(box(0.7, 0.5, 0.03, m.panel, 0.9, 1.55, -D / 2 + 0.06, 0.01));
    g.add(box(0.64, 0.44, 0.034, m.hepa, 0.9, 1.55, -D / 2 + 0.06));
    // pendant
    g.add(cyl(0.05, 0.05, 0.7, m.steel, -1.4, H - 0.35, 0.6));
    g.add(box(0.3, 0.6, 0.3, m.panel, -1.4, H - 1.0, 0.6, 0.02));
    g.add(box(0.31, 0.03, 0.31, m.amberGlow, -1.4, H - 0.72, 0.6));
    const door = buildDoor(k, m, { style: 'general' });
    door.position.set(-W / 2 + 0.07, 0, -0.2);
    door.rotation.y = Math.PI / 2;
    g.add(door);
    g.userData.ticks = laf.userData.ticks.concat(door.userData.tick);
    g.userData.toggle = door.userData.toggle;
    g.userData.hint = 'Tap to open the doors';
    return g;
  }

  function buildBench(k, m) {
    const { box, cyl, group } = k;
    const L = 1.5;
    const g = group();
    g.add(box(L, 0.05, 0.4, m.steel, 0, 0.47, 0, 0.012));
    for (const sx of [-1, 1]) {
      g.add(box(0.04, 0.45, 0.04, m.steel, sx * (L / 2 - 0.05), 0.225, 0.15));
      g.add(box(0.04, 0.45, 0.04, m.steel, sx * (L / 2 - 0.05), 0.225, -0.15));
      g.add(box(0.04, 0.04, 0.34, m.steel, sx * (L / 2 - 0.05), 0.04, 0));
    }
    // shoe racks
    for (const y of [0.13, 0.29]) for (let i = -2; i <= 2; i++) g.add(box(L - 0.14, 0.015, 0.02, m.steel, 0, y, i * 0.07));
    // crossover divider
    g.add(box(L, 0.04, 0.04, m.amber, 0, 0.9, 0, 0.012));
    for (const sx of [-1, 1]) g.add(box(0.04, 0.42, 0.04, m.steel, sx * (L / 2 - 0.05), 0.7, 0));
    // pedal bin
    const bx = L / 2 + 0.24;
    g.add(cyl(0.17, 0.15, 0.5, m.steelV, bx, 0.25, 0));
    g.add(cyl(0.175, 0.175, 0.04, m.steel, bx, 0.51, 0));
    g.add(box(0.12, 0.02, 0.1, m.dark, bx, 0.02, 0.2, 0.006));
    g.add(box(0.08, 0.04, 0.2, m.steel, L / 2 + 0.04, 0.4, 0));
    return g;
  }

  function buildCollector(k, m) {
    const { box, cyl, group, tube } = k;
    const g = group();
    g.add(box(0.6, 0.75, 0.6, m.steel, 0, 0.5, 0, 0.02));
    g.add(cyl(0.26, 0.26, 0.55, m.steelV, 0, 1.15, 0));
    g.add(cyl(0.28, 0.28, 0.05, m.dark, 0, 1.45, 0));
    g.add(cyl(0.16, 0.18, 0.2, m.dark, 0, 1.57, 0));
    g.add(box(0.2, 0.14, 0.02, m.screen, 0, 0.72, 0.31));
    g.add(box(0.44, 0.012, 0.01, m.amberGlow, 0, 0.3, 0.305));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.05, 0.05, 0.04, m.rubber, sx * 0.24, 0.05, sz * 0.24).rotateZ(Math.PI / 2));
    g.add(tube([[0.26, 1.2, 0], [0.55, 1.3, 0.1], [0.8, 1.0, 0.35], [0.85, 0.6, 0.5]], 0.055, m.dark));
    const hood = cyl(0.07, 0.18, 0.2, m.steel, 0.85, 0.5, 0.5);
    g.add(hood);
    return g;
  }

  function buildScrubber(k, m, o = {}) {
    const { box, group, tube } = k;
    const W = 1.2, D = 0.55, top = 0.95;
    const g = group();
    if (!o.foot) g.add(box(2.0, 2.3, 0.06, m.panel, 0, 1.15, -D / 2 - 0.05, 0.01));
    // basin walls
    g.add(box(W, 0.3, 0.02, m.steel, 0, top - 0.15, D / 2, 0.006));
    g.add(box(0.02, 0.3, D, m.steel, -W / 2, top - 0.15, 0, 0.006));
    g.add(box(0.02, 0.3, D, m.steel, W / 2, top - 0.15, 0, 0.006));
    g.add(box(W, 0.02, D, m.steel, 0, top - 0.3, 0));
    g.add(box(W + 0.04, 0.03, 0.05, m.steel, 0, top, D / 2, 0.01));
    g.add(box(W * 0.42, 0.012, D - 0.06, m.grille, W * 0.27, top - 0.06, 0.01));
    // splash-back
    g.add(box(W, 0.6, 0.03, m.steelV, 0, top + 0.15, -D / 2, 0.006));
    g.add(box(W, 0.012, 0.035, m.amber, 0, top + 0.44, -D / 2));
    // taps
    for (const tx of [-0.3, 0.3]) g.add(tube([[tx, top + 0.1, -D / 2 + 0.02], [tx, top + 0.35, -D / 2 + 0.06], [tx, top + 0.38, -D / 2 + 0.2], [tx, top + 0.25, -D / 2 + 0.26]], 0.014, m.steel));
    if (o.foot) {
      g.add(box(W, top - 0.3, D - 0.02, m.steel, 0, (top - 0.3) / 2, -0.01, 0.01));
      g.add(box(0.4, 0.45, 0.01, m.steelV, 0, 0.35, D / 2 - 0.01, 0.004));
      for (const px of [-0.3, 0.3]) g.add(box(0.1, 0.03, 0.14, m.dark, px, 0.03, D / 2 + 0.05, 0.008));
    } else {
      g.add(box(W * 0.9, 0.2, 0.2, m.steel, 0, top - 0.42, -D / 2 + 0.1, 0.01));
      g.add(box(0.05, 0.05, 0.02, m.dark, 0, top + 0.3, -D / 2 + 0.02));
    }
    return g;
  }

  function buildCubicle(k, m) {
    const { box, cyl, group } = k;
    const W = 0.95, D = 0.55, H = 1.95;
    const g = group();
    g.add(box(W, H, D, m.steel, 0, H / 2 + 0.08, 0, 0.012));
    const f = D / 2 + 0.006;
    // upper doors with vision panels
    for (const sx of [-1, 1]) {
      const x = sx * W / 4;
      g.add(box(W / 2 - 0.02, 1.2, 0.012, m.steelV, x, 1.4, f, 0.006));
      g.add(box(0.26, 0.4, 0.016, m.dark, x, 1.72, f, 0.01));
      g.add(box(0.22, 0.36, 0.02, m.glass, x, 1.72, f));
      g.add(box(0.03, 0.2, 0.03, m.steel, -sx * 0.04, 1.28, f + 0.015, 0.008));
      g.add(box(W / 2 - 0.02, 0.62, 0.012, m.steelV, x, 0.44, f, 0.006));
      g.add(box(0.07, 0.02, 0.03, m.steel, -sx * 0.06, 0.64, f + 0.015, 0.008));
    }
    g.add(box(W - 0.02, 0.02, 0.014, m.amber, 0, 0.79, f));
    // garments inside, visible through the glass
    for (let i = 0; i < 5; i++) g.add(box(0.14, 0.45, 0.02, m.fabric, -0.3 + i * 0.15, 1.62, 0, 0.01));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(cyl(0.035, 0.035, 0.05, m.panel, sx * (W / 2 - 0.08), 0.03, sz * (D / 2 - 0.08)));
    return g;
  }

  const builders = {
    door: buildDoor,
    passbox: buildPassbox,
    table: buildTable,
    laf: (k, m, o) => (o.reverse ? buildBooth(k, m, { table: false }) : buildLafUnit(k, m, o)),
    booth: buildBooth,
    ahu: buildAhu,
    cleanroom: buildCleanRoom,
    ot: buildOT,
    bench: buildBench,
    collector: buildCollector,
    scrubber: buildScrubber,
    cubicle: buildCubicle,
  };

  /* ---------- product viewer ---------- */

  async function mountModel(container, type, options = {}) {
    if (!supported()) throw new Error('WebGL unavailable');
    const L = await libs();
    if (!container.isConnected) return { dispose() {} };
    const st = createStage(L, container, { exposure: 1.05, fov: 30 });
    const { THREE, scene, camera, ticks } = st;
    const m = makeMaterials(THREE);
    const k = makeKit(L, m);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(AMBER, 1.2);
    rim.position.set(-4, 2, -3);
    scene.add(rim);

    const holder = new THREE.Group();
    scene.add(holder);
    let model = null;
    let modelTicks = [];
    let radius = 1;
    let center = new THREE.Vector3();

    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: m.shadow, transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    scene.add(shadow);

    const setModel = (t, o) => {
      if (model) {
        holder.remove(model);
        model.traverse((c) => c.geometry && c.geometry.dispose());
      }
      model = (builders[t] || buildTable)(k, m, o || {});
      holder.add(model);
      modelTicks = [];
      if (model.userData.tick) modelTicks.push(model.userData.tick);
      if (model.userData.ticks) modelTicks.push(...model.userData.ticks);
      model.traverse((c) => c !== model && c.userData.tick && c.isPoints && !modelTicks.includes(c.userData.tick) && modelTicks.push(c.userData.tick));
      const bb = new THREE.Box3().setFromObject(model);
      const sphere = bb.getBoundingSphere(new THREE.Sphere());
      center = sphere.center;
      radius = sphere.radius;
      model.position.set(-center.x, -bb.min.y, -center.z);
      center = new THREE.Vector3(0, (bb.max.y - bb.min.y) / 2, 0);
      const size = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.4;
      shadow.scale.set(size, size, 1);
      zoom = 1;
      container.dataset.hint = model.userData.hint || '';
    };

    // orbit
    let yaw = options.yaw ?? -0.55;
    let pitch = options.pitch ?? 0.28;
    let zoom = 1;
    let vyaw = 0;
    let dragging = false;
    let moved = 0;
    let last = null;
    let idle = 0;
    const el = st.renderer.domElement;
    el.style.touchAction = 'pan-y';
    el.addEventListener('pointerdown', (e) => {
      dragging = true;
      moved = 0;
      last = [e.clientX, e.clientY];
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - last[0];
      const dy = e.clientY - last[1];
      moved += Math.abs(dx) + Math.abs(dy);
      last = [e.clientX, e.clientY];
      vyaw = -dx * 0.006;
      yaw += vyaw;
      pitch = Math.max(-0.05, Math.min(0.9, pitch + dy * 0.004));
      idle = 0;
    });
    const up = () => {
      if (dragging && moved < 6 && model && model.userData.toggle) model.userData.toggle();
      dragging = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => (dragging = false));
    el.addEventListener(
      'wheel',
      (e) => {
        // Plain wheel keeps scrolling the page; pinch (ctrl+wheel) zooms.
        if (!e.ctrlKey) return;
        e.preventDefault();
        zoom = Math.max(0.55, Math.min(1.6, zoom * (1 + e.deltaY * 0.001)));
      },
      { passive: false }
    );

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    ticks.push((dt) => {
      if (!dragging) {
        idle += dt;
        yaw += vyaw;
        vyaw *= 0.92;
        if (!reduced && idle > 1.2) yaw += dt * 0.18;
      }
      const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.05 * zoom * Math.max(1, 1.2 / camera.aspect);
      camera.position.set(
        center.x + Math.sin(yaw) * Math.cos(pitch) * dist,
        center.y + Math.sin(pitch) * dist,
        center.z + Math.cos(yaw) * Math.cos(pitch) * dist
      );
      camera.lookAt(center);
      modelTicks.forEach((f) => f(dt));
    });

    setModel(type, options);

    return {
      setModel,
      toggle: () => model && model.userData.toggle && model.userData.toggle(),
      zoomBy: (f) => (zoom = Math.max(0.55, Math.min(1.6, zoom * f))),
      dispose: st.dispose,
    };
  }

  /* ---------- hero: steel doorway into a clean room ---------- */

  async function mountHero(container, opts = {}) {
    if (!supported()) throw new Error('WebGL unavailable');
    const L = await libs();
    if (!container.isConnected) return { dispose() {}, setProgress() {} };
    const st = createStage(L, container, { exposure: 1.0, fov: 40 });
    const { THREE, scene, camera, ticks } = st;
    const m = makeMaterials(THREE);
    const k = makeKit(L, m);
    const { box, flow, group } = k;
    scene.fog = new THREE.Fog(0x07090c, 7, 22);

    scene.add(new THREE.HemisphereLight(0x9fb6cc, 0x0a0c10, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(3, 4, 6);
    scene.add(key);
    const warm = new THREE.PointLight(AMBER, 12, 8, 2);
    warm.position.set(-2.5, 2.6, 2);
    scene.add(warm);

    // floor
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0e1217, metalness: 0.7, roughness: 0.35 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(40, 80, AMBER, 0x1d242d);
    grid.material.transparent = true;
    grid.material.opacity = 0.18;
    grid.position.y = 0.002;
    scene.add(grid);

    // wall with an opening
    const OW = 1.9, OH = 2.3, WH = 5, WW = 14;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a2028, metalness: 0.6, roughness: 0.5, map: brushed(THREE, '#3a424c', true) });
    scene.add(box((WW - OW) / 2, WH, 0.3, wallMat, -(OW / 2 + (WW - OW) / 4), WH / 2, 0));
    scene.add(box((WW - OW) / 2, WH, 0.3, wallMat, OW / 2 + (WW - OW) / 4, WH / 2, 0));
    scene.add(box(OW, WH - OH, 0.3, wallMat, 0, OH + (WH - OH) / 2, 0));
    // panel seams and an amber reveal around the doorway
    for (let x = -6; x <= 6; x += 1.5) if (Math.abs(x) > 1.2) scene.add(box(0.01, WH, 0.01, m.dark, x, WH / 2, 0.155));
    scene.add(box(OW + 0.3, 0.03, 0.02, m.amberGlow, 0, OH + 0.16, 0.16));

    const door = buildDoor(k, m, { style: 'general' });
    door.scale.setScalar(OH / 2.2);
    door.position.set(0, 0, 0.08);
    scene.add(door);

    // the clean room behind
    const room = group();
    room.position.z = -0.15;
    const roomMat = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.55, metalness: 0.05, side: THREE.BackSide });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 7), roomMat);
    shell.position.set(0, 1.6, -3.5);
    room.add(shell);
    room.add(box(7, 0.02, 7, m.floor, 0, 0.01, -3.5));
    for (let x = -2; x <= 2; x += 2)
      for (let z = -1.5; z >= -5.5; z -= 2) {
        room.add(box(1.2, 0.03, 1.2, m.hepa, x, 3.18, z));
      }
    const inside = flow({ count: 900, w: 6, d: 6, z: -3.5, top: 3.15, bottom: 0.02, speed: 0.9, size: 0.02 });
    room.add(inside);
    const glow = new THREE.PointLight(0xdff2ff, 30, 12, 1.6);
    glow.position.set(0, 2.6, -2.5);
    room.add(glow);
    // SS work table and pass box inside for depth cues
    const table = buildTable(k, m, { finish: 'ss' });
    table.position.set(-1.6, 0, -3.2);
    table.rotation.y = 0.5;
    room.add(table);
    const pb = buildPassbox(k, m, { dynamic: true });
    pb.position.set(2.2, 0, -5.9);
    room.add(pb);
    scene.add(room);

    // loose dust outside the clean zone
    const dust = flow({
      count: 260, w: 12, d: 8, z: 4, top: 4.5, bottom: 0, speed: 0.06, size: 0.025, color: 0xd9b27a,
      bend: (p, i, dt) => {
        p[i * 3] += Math.sin(p[i * 3 + 1] * 2 + i) * dt * 0.08;
      },
    });
    dust.material.opacity = 0.45;
    scene.add(dust);

    let progress = 0;
    let smooth = 0;
    let mx = 0, my = 0, sx = 0, sy = 0;
    const onMove = (e) => {
      mx = (e.clientX / window.innerWidth) * 2 - 1;
      my = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onMove, { passive: true });

    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const reduced = opts.reduced;
    if (reduced) progress = 0.35;

    ticks.push((dt, t) => {
      smooth += (progress - smooth) * Math.min(1, dt * 5);
      sx += (mx - sx) * Math.min(1, dt * 3);
      sy += (my - sy) * Math.min(1, dt * 3);
      const openT = ease(clamp(smooth / 0.45));
      door.userData.setOpen(openT);
      door.userData.tick(1);
      const dolly = ease(clamp((smooth - 0.3) / 0.7));
      const narrow = camera.aspect < 0.9;
      const z0 = narrow ? 9.5 : 6.2;
      camera.position.set(sx * 0.5 * (1 - dolly) + Math.sin(t * 0.3) * 0.05, 1.45 - sy * 0.25 * (1 - dolly) + dolly * 0.1, z0 - dolly * (z0 + 1.8));
      camera.lookAt(0, 1.3 + dolly * 0.25, -3);
      glow.intensity = 6 + openT * 34;
      inside.material.opacity = 0.2 + openT * 0.7;
      inside.userData.tick(dt);
      dust.userData.tick(dt);
      pb.userData.ticks.forEach((f) => f(dt));
    });

    return {
      setProgress: (p) => {
        if (!reduced) progress = p;
      },
      dispose: () => {
        window.removeEventListener('pointermove', onMove);
        st.dispose();
      },
    };
  }

  window.SAD3D = { supported, mountModel, mountHero };
})();
