/* Three.js scenes: the scroll-driven hero doorway and procedural product models.
 *
 * Each product model is built to match the product photo on the site: proportions,
 * colours, door/handle/hinge placement and fittings. Units are metres.
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
    const disposables = [];
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
      disposables.forEach((d) => d.dispose());
      envTex.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };

    return { THREE, renderer, scene, camera, ticks, onResize, disposables, dispose };
  }

  /* ---------- textures & materials ---------- */

  function canvasTexture(THREE, w, h, draw, srgb = true) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }

  function brushed(THREE, base, vertical) {
    const t = canvasTexture(THREE, 512, 512, (g, s) => {
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

  function woodTexture(THREE) {
    return canvasTexture(THREE, 512, 512, (g, s) => {
      g.fillStyle = '#a9642a';
      g.fillRect(0, 0, s, s);
      for (let i = 0; i < 260; i++) {
        const a = Math.random() * 0.16;
        g.fillStyle = Math.random() < 0.55 ? `rgba(118,60,18,${a})` : `rgba(236,172,96,${a})`;
        g.fillRect(Math.random() * s, 0, Math.random() * 3 + 0.5, s);
      }
      for (let i = 0; i < 36; i++) {
        g.strokeStyle = `rgba(104,52,14,${Math.random() * 0.14})`;
        g.lineWidth = 1 + Math.random() * 2;
        g.beginPath();
        let x = Math.random() * s;
        g.moveTo(x, 0);
        for (let y = 0; y <= s; y += 32) {
          x += (Math.random() - 0.5) * 6;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    });
  }

  function finsTexture(THREE) {
    return canvasTexture(THREE, 256, 256, (g, w, h) => {
      g.fillStyle = '#b8743a';
      g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 4) {
        g.fillStyle = '#d7dbde';
        g.fillRect(x, 0, 2, h);
      }
    });
  }

  function dotTexture(THREE) {
    return canvasTexture(THREE, 64, 64, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)');
      r.addColorStop(0.35, 'rgba(255,255,255,0.45)');
      r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    });
  }

  function shadowTexture(THREE) {
    return canvasTexture(THREE, 256, 256, (g, s) => {
      const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      r.addColorStop(0, 'rgba(0,0,0,0.55)');
      r.addColorStop(0.55, 'rgba(0,0,0,0.18)');
      r.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = r;
      g.fillRect(0, 0, s, s);
    });
  }

  // 16 x 16 staggered holes per tile
  function perforated(THREE, bg, hole) {
    return canvasTexture(THREE, 256, 256, (g, s) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, s, s);
      g.fillStyle = hole;
      const n = 16;
      const step = s / n;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          g.beginPath();
          g.arc(x * step + step / 2 + (y % 2 ? step / 4 : 0), y * step + step / 2, step * 0.24, 0, Math.PI * 2);
          g.fill();
        }
    });
  }

  function makeMaterials(THREE) {
    const std = (p) => new THREE.MeshStandardMaterial(p);
    const phys = (p) => new THREE.MeshPhysicalMaterial(p);
    return {
      steel: std({ color: 0xe6eaee, metalness: 0.88, roughness: 0.28, map: brushed(THREE, '#cfd4d9') }),
      steelV: std({ color: 0xe6eaee, metalness: 0.88, roughness: 0.26, map: brushed(THREE, '#cfd4d9', true) }),
      ssInner: std({ color: 0xb9c1c8, metalness: 0.8, roughness: 0.38 }),
      alu: std({ color: 0xd5d9dd, metalness: 0.8, roughness: 0.3 }),
      dark: std({ color: 0x2f353d, metalness: 0.6, roughness: 0.45 }),
      black: std({ color: 0x17191c, metalness: 0.25, roughness: 0.5 }),
      rubber: std({ color: 0x141619, roughness: 0.85 }),
      amber: std({ color: AMBER, metalness: 0.5, roughness: 0.3 }),
      amberGlow: std({ color: AMBER, emissive: AMBER, emissiveIntensity: 1.4 }),
      glass: phys({ color: 0xcfe2ee, roughness: 0.04, transparent: true, opacity: 0.34, envMapIntensity: 1.6, depthWrite: false }),
      backdrop: std({ color: 0xe6edf3, emissive: 0xcfdbe6, emissiveIntensity: 0.55, roughness: 0.9 }),
      glassDark: phys({ color: 0x0f151c, roughness: 0.05, transparent: true, opacity: 0.85, envMapIntensity: 1.4 }),
      acrylic: phys({ color: 0xd4ebf8, roughness: 0.08, transparent: true, opacity: 0.2, depthWrite: false, side: THREE.DoubleSide }),
      strip: phys({ color: 0xa9d6f2, roughness: 0.1, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }),
      hepa: std({ color: 0xf6f9fc, emissive: 0xd9efff, emissiveIntensity: 0.55, roughness: 0.6, map: perforated(THREE, '#f1f5f9', '#b9c7d3') }),
      led: std({ color: 0xffffff, emissive: 0xf4faff, emissiveIntensity: 1.6 }),
      dial: std({ color: 0xf6f6f2, roughness: 0.4 }),
      screen: std({ color: 0x0b1620, emissive: 0x2bb3ff, emissiveIntensity: 0.9 }),
      ledGreen: std({ color: 0x22ff88, emissive: 0x22ff88, emissiveIntensity: 2 }),
      ledRed: std({ color: 0xff3b3b, emissive: 0xff3b3b, emissiveIntensity: 2 }),
      ledAmber: std({ color: 0xffb020, emissive: 0xffb020, emissiveIntensity: 2 }),
      floor: std({ color: 0xa4aeb8, metalness: 0.25, roughness: 0.12 }),
      mattress: std({ color: 0x2c5364, roughness: 0.7 }),
      copper: std({ color: 0xc27a45, metalness: 0.9, roughness: 0.35 }),
      fabric: std({ color: 0x8cc0dc, roughness: 0.9 }),
      wood: std({ color: 0xe6c3a0, roughness: 0.6, metalness: 0.02, map: woodTexture(THREE) }),
      fins: std({ color: 0xffffff, metalness: 0.55, roughness: 0.4, map: finsTexture(THREE) }),
      perfTex: perforated(THREE, '#dfe4e8', '#2b3137'),
      dot: dotTexture(THREE),
      shadow: shadowTexture(THREE),
    };
  }

  /* ---------- building kit ---------- */

  function makeKit(L, m, disposables) {
    const { THREE, RoundedBoxGeometry } = L;
    disposables.push(m.perfTex);
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
    const cylZ = (r, len, mat, x = 0, y = 0, z = 0) => {
      const c = cyl(r, r, len, mat, x, y, z);
      c.rotation.x = Math.PI / 2;
      return c;
    };
    const cylX = (r, len, mat, x = 0, y = 0, z = 0) => {
      const c = cyl(r, r, len, mat, x, y, z);
      c.rotation.z = Math.PI / 2;
      return c;
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

    const paints = new Map();
    const paint = (hex, rough = 0.4, metal = 0.2) => {
      const key = hex + '/' + rough + '/' + metal;
      if (!paints.has(key)) paints.set(key, new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal, envMapIntensity: 0.55 }));
      return paints.get(key);
    };
    // perforated sheet sized so holes stay ~pitch apart whatever the panel size
    const perf = (w, h, pitch = 0.022) => {
      const t = m.perfTex.clone();
      t.needsUpdate = true;
      t.repeat.set(w / (pitch * 16), h / (pitch * 16));
      return new THREE.MeshStandardMaterial({ color: 0xe8ecef, metalness: 0.78, roughness: 0.32, map: t });
    };
    // flat panel lying in the XY plane (bottom at y=0, centred on x) with rectangular openings
    const slab = (w, h, t, mat, holes = []) => {
      const g = group();
      const add = (x0, x1, y0, y1) => {
        if (x1 - x0 > 1e-4 && y1 - y0 > 1e-4) g.add(box(x1 - x0, y1 - y0, t, mat, (x0 + x1) / 2, (y0 + y1) / 2, 0));
      };
      let x = -w / 2;
      [...holes].sort((a, b) => a.x0 - b.x0).forEach((o) => {
        add(x, o.x0, 0, h);
        add(o.x0, o.x1, 0, o.y0);
        add(o.x0, o.x1, o.y1, h);
        x = o.x1;
      });
      add(x, w / 2, 0, h);
      return g;
    };
    // glass pane with rubber gasket filling an opening made by slab()
    const glaze = (o, t, glass = m.glass, gasket = m.rubber) => {
      const w = o.x1 - o.x0;
      const h = o.y1 - o.y0;
      const cx = (o.x0 + o.x1) / 2;
      const cy = (o.y0 + o.y1) / 2;
      const e = 0.014;
      return group(
        box(w, h, 0.008, glass, cx, cy, 0),
        box(w, e, t + 0.008, gasket, cx, o.y0 + e / 2, 0),
        box(w, e, t + 0.008, gasket, cx, o.y1 - e / 2, 0),
        box(e, h, t + 0.008, gasket, o.x0 + e / 2, cy, 0),
        box(e, h, t + 0.008, gasket, o.x1 - e / 2, cy, 0)
      );
    };
    // extruded side profile: points are [z, y] pairs, extruded along x
    const prism = (pts, t, mat) => {
      const s = new THREE.Shape();
      pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
      const geo = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false });
      geo.translate(0, 0, -t / 2);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.y = Math.PI / 2;
      return mesh;
    };
    // D-shaped pull handle protruding towards +z
    const dHandle = (len, mat = m.steel, vertical = true) => {
      const g = group(vertical ? box(0.022, len, 0.022, mat, 0, 0, 0.055, 0.008) : box(len, 0.022, 0.022, mat, 0, 0, 0.055, 0.008));
      for (const s of [-1, 1]) g.add(vertical ? box(0.018, 0.018, 0.05, mat, 0, s * (len / 2 - 0.02), 0.028) : box(0.018, 0.018, 0.05, mat, s * (len / 2 - 0.02), 0, 0.028));
      return g;
    };
    // lever handle; arm points towards dir (+1 right, -1 left)
    const lever = (dir, mat = m.steel) =>
      group(cylZ(0.032, 0.012, mat, 0, 0, 0.006), cylZ(0.012, 0.05, mat, 0, 0, 0.03), box(0.13, 0.022, 0.022, mat, dir * 0.055, 0, 0.055, 0.009));
    const gauge = (r = 0.06) => {
      const needle = box(r * 0.75, 0.006, 0.004, m.dark, r * 0.2, 0.012, 0.04);
      needle.rotation.z = 0.6;
      return group(cylZ(r, 0.035, m.dark, 0, 0, 0.0175), cylZ(r * 0.84, 0.037, m.dial, 0, 0, 0.019), needle);
    };
    const castor = (x, z, wheel = m.rubber) => {
      const w = cyl(0.04, 0.04, 0.028, wheel, x, 0.042, z);
      w.rotation.x = Math.PI / 2;
      return group(box(0.075, 0.012, 0.075, m.steel, x, 0.106, z), box(0.05, 0.05, 0.036, m.steel, x, 0.078, z), w);
    };
    // bullet foot: tapered leg end
    const foot = (x, z, h = 0.1) => cyl(0.022, 0.014, h, m.steel, x, h / 2, z, 20);
    const louvre = (w, h, n, mat = m.alu, frameMat = m.alu) => {
      const fw = 0.025;
      const g = group(
        box(w, fw, 0.06, frameMat, 0, h / 2 - fw / 2, 0),
        box(w, fw, 0.06, frameMat, 0, -h / 2 + fw / 2, 0),
        box(fw, h, 0.06, frameMat, -w / 2 + fw / 2, 0, 0),
        box(fw, h, 0.06, frameMat, w / 2 - fw / 2, 0, 0),
        box(w - 2 * fw, h - 2 * fw, 0.004, m.black, 0, 0, -0.02)
      );
      const step = (h - 2 * fw) / n;
      for (let i = 0; i < n; i++) {
        const s = box(w - 2 * fw, step * 1.15, 0.008, mat, 0, -h / 2 + fw + step * (i + 0.5), 0.004);
        s.rotation.x = -0.65;
        g.add(s);
      }
      return g;
    };
    // text painted on a surface
    const label = (text, w, h, { bg = 'transparent', fg = '#ffffff', weight = 700 } = {}) => {
      const t = canvasTexture(THREE, 512, Math.round((512 * h) / w), (g, cw, ch) => {
        if (bg !== 'transparent') {
          g.fillStyle = bg;
          g.fillRect(0, 0, cw, ch);
        }
        g.fillStyle = fg;
        g.font = `${weight} ${Math.round(ch * 0.62)}px Inter, Arial, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(text, cw / 2, ch / 2 + 2);
      });
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, transparent: bg === 'transparent' }));
    };
    // callout tag that always faces the camera (used on the HVAC cut-away)
    const tag = (text, x, y, z) => {
      const probe = document.createElement('canvas').getContext('2d');
      probe.font = '600 44px Inter, Arial, sans-serif';
      const cw = Math.ceil(probe.measureText(text).width + 36);
      const t = canvasTexture(THREE, cw, 70, (g, w, h) => {
        g.fillStyle = '#d7262d';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#ffffff';
        g.font = '600 44px Inter, Arial, sans-serif';
        g.textBaseline = 'middle';
        g.fillText(text, 18, h / 2 + 2);
      });
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false }));
      s.scale.set((0.16 * cw) / 70, 0.16, 1);
      s.position.set(x, y, z);
      s.renderOrder = 10;
      return s;
    };

    // particles drifting through a box [x0,x1,y0,y1,z0,z1] along an axis (0 x, 1 y, 2 z)
    const flow = (o) => {
      const { count = 300, box: b, axis = 1, dir = -1, color = AIR, size = 0.018, speed = 0.55, bend, opacity = 0.85 } = o;
      const lo = [b[0], b[2], b[4]];
      const hi = [b[1], b[3], b[5]];
      const pos = new Float32Array(count * 3);
      const seed = new Float32Array(count);
      const reset = (i, anywhere) => {
        for (let a = 0; a < 3; a++) pos[i * 3 + a] = lo[a] + Math.random() * (hi[a] - lo[a]);
        if (!anywhere) pos[i * 3 + axis] = dir < 0 ? hi[axis] : lo[axis];
      };
      for (let i = 0; i < count; i++) {
        reset(i, true);
        seed[i] = 0.6 + Math.random() * 0.8;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const mat = new THREE.PointsMaterial({ color, size, map: m.dot, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });
      const pts = new THREE.Points(geo, mat);
      const span = hi[axis] - lo[axis];
      pts.userData.tick = (dt) => {
        for (let i = 0; i < count; i++) {
          pos[i * 3 + axis] += dir * speed * seed[i] * dt;
          if (bend) bend(pos, i, dt, dir < 0 ? (pos[i * 3 + axis] - lo[axis]) / span : (hi[axis] - pos[i * 3 + axis]) / span);
          for (let a = 0; a < 3; a++) {
            if (pos[i * 3 + a] < lo[a] - 1e-3 || pos[i * 3 + a] > hi[a] + 1e-3) {
              reset(i, false);
              break;
            }
          }
        }
        geo.attributes.position.needsUpdate = true;
      };
      return pts;
    };

    return { THREE, box, cyl, cylZ, cylX, sphere, tube, group, paint, perf, slab, glaze, prism, dHandle, lever, gauge, castor, foot, louvre, label, tag, flow };
  }

  // Hinged doors that swing open on tap. doors: [{ pivot, sign, max }]
  function openable(g, doors, hint, onTick) {
    let open = 0;
    let target = 0;
    g.userData.toggle = () => (target = target > 0.5 ? 0 : 1);
    g.userData.setOpen = (v) => (target = v);
    g.userData.hint = hint;
    (g.userData.ticks = g.userData.ticks || []).push((dt) => {
      open += (target - open) * Math.min(1, dt * 4);
      doors.forEach((d) => (d.pivot.rotation[d.axis || 'y'] = d.sign * open * (d.max || 1.4)));
      if (onTick) onTick(open);
    });
  }

  const addTicks = (g, ...fs) => (g.userData.ticks = (g.userData.ticks || []).concat(fs));
  const flowTick = (p) => p.userData.tick;

  /* ---------- doors (Metal Doors product) ---------- */

  const DOOR_STYLES = {
    // grey double doorset with large vision panels (main Metal Doors photo)
    scientific: { leaves: [0.62, 0.62], H: 2.15, color: 0x8f8b83, frame: 0x8f8b83, wall: 0xe6e6e2, win: (w) => ({ x0: -w * 0.34, x1: w * 0.34, y0: 1.02, y1: 1.84 }), lever: [0] },
    // blue clean room double door with square windows, kick plates and closers
    cleanroom: { leaves: [0.62, 0.62], H: 2.1, color: 0x1f6fd1, frame: 0xeef1f4, wall: 0xf1f3f5, win: () => ({ x0: -0.17, x1: 0.17, y0: 1.32, y1: 1.66 }), kick: true, closer: [0, 1], pull: [0, 1] },
    cleanroomSingle: { leaves: [0.95], hinge: -1, H: 2.1, color: 0x1f6fd1, frame: 0xeef1f4, wall: 0xf1f3f5, win: () => ({ x0: -0.16, x1: 0.16, y0: 1.32, y1: 1.66 }), kick: true, closer: [0], pull: [0] },
    // red fire exit door with panic bar
    fire: { leaves: [0.95], hinge: 1, H: 2.1, color: 0xd11f1f, frame: 0xc41c1c, wall: 0xf0efec, panic: true, sign: 'FIRE EXIT' },
    // white general door: narrow fixed leaf + main leaf with dark vision panel, pull handle, closer
    general: { leaves: [1.0], hinge: -1, H: 2.1, color: 0xefefeb, frame: 0xe7e7e3, wall: 0xf4f4f2, win: () => ({ x0: -0.13, x1: 0.13, y0: 1.1, y1: 1.92 }), darkGlass: true, closer: [0], pull: [0], lock: true },
    // wood-finish door with narrow vision panel and aluminium frame
    decorative: { leaves: [0.95], hinge: 1, H: 2.1, wood: true, frameMetal: true, wall: 0xe5d8c6, win: (w) => ({ x0: -w / 2 + 0.2, x1: -w / 2 + 0.36, y0: 1.2, y1: 1.86 }), lever: [0] },
    // red wall-mounted shaft / fire hose cabinet with narrow windows
    shaft: { leaves: [0.48, 0.48], H: 1.5, color: 0xd11f1f, frame: 0xc41c1c, wall: 0xe2dcd8, cabinet: true, win: (w, i) => (i === 0 ? { x0: -w / 2 + 0.07, x1: -w / 2 + 0.25, y0: 0.38, y1: 1.22 } : { x0: w / 2 - 0.25, x1: w / 2 - 0.07, y0: 0.38, y1: 1.22 }) },
  };

  function buildDoor(k, m, o = {}) {
    const { box, cyl, group, slab, glaze, paint, lever, dHandle, label, THREE } = k;
    const st = DOOR_STYLES[o.style] || DOOR_STYLES.scientific;
    const H = st.H;
    const T = 0.05;
    const fw = st.cabinet ? 0.045 : 0.07;
    const fd = st.cabinet ? 0.28 : 0.16;
    const W = st.leaves.reduce((a, b) => a + b, 0);
    const leafMat = st.wood ? m.wood : paint(st.color, 0.36, 0.25);
    const frameMat = st.frameMetal ? m.alu : paint(st.frame, 0.4, 0.25);
    const y0 = st.cabinet ? 0.6 : 0;
    const zf = st.cabinet ? T / 2 - fd / 2 : 0;
    const g = group();

    // frame (a full box for the cabinet)
    const jambH = st.cabinet ? H + 2 * fw : H + fw;
    const jambY = st.cabinet ? y0 + H / 2 : y0 + (H + fw) / 2;
    for (const s of [-1, 1]) g.add(box(fw, jambH, fd, frameMat, s * (W / 2 + fw / 2), jambY, zf));
    g.add(box(W + 2 * fw, fw, fd, frameMat, 0, y0 + H + fw / 2, zf));
    if (st.cabinet) {
      g.add(box(W + 2 * fw, fw, fd, frameMat, 0, y0 - fw / 2, zf));
      g.add(box(W, H, 0.01, paint(0x8e1616, 0.6, 0.1), 0, y0 + H / 2, T / 2 - fd + 0.005));
      const reel = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.05, 12, 36), paint(0xc41c1c, 0.5, 0.1));
      reel.position.set(0, y0 + H * 0.56, -0.1);
      g.add(reel, k.cylZ(0.08, 0.14, m.steel, 0, y0 + H * 0.56, -0.12));
      g.add(box(0.06, 0.06, 0.006, paint(0xf2f2f2), W / 2 - 0.09, y0 + 0.12, T / 2 + 0.004));
    }

    const doors = [];
    let xs = -W / 2;
    st.leaves.forEach((w, i) => {
      const side = st.leaves.length === 1 ? st.hinge ?? -1 : i === 0 ? -1 : 1;
      const pivot = group();
      pivot.position.set(side < 0 ? xs : xs + w, y0, 0);
      const leaf = group();
      leaf.position.x = -side * (w / 2);
      pivot.add(leaf);
      const lw = w - 0.006;
      const lh = H - 0.01;
      const win = st.win && st.win(lw, i);
      const s = slab(lw, lh, T, leafMat, win ? [win] : []);
      s.position.y = 0.005;
      leaf.add(s);
      if (win) {
        const gz = glaze(win, T, st.darkGlass ? m.glassDark : m.glass);
        gz.position.y = 0.005;
        leaf.add(gz);
      }
      const front = T / 2;
      const hingeX = side * (lw / 2);
      const free = -side * (lw / 2);
      for (const hy of st.cabinet ? [0.18, lh - 0.18] : [0.25, lh / 2 + 0.1, lh - 0.25]) {
        leaf.add(cyl(0.012, 0.012, 0.1, st.cabinet ? m.dark : m.steel, hingeX, hy, front + 0.004));
      }
      if (st.lever && st.lever.includes(i)) {
        const lv = lever(side);
        lv.position.set(free + side * 0.075, 1.0, front);
        leaf.add(lv);
      }
      if (st.pull && st.pull.includes(i)) {
        const h = dHandle(st.leaves.length > 1 && st.kick ? 0.2 : 0.32);
        h.position.set(free + side * 0.07, 1.05, front);
        leaf.add(h);
      }
      if (st.lock) leaf.add(k.cylZ(0.016, 0.02, m.steel, free + side * 0.07, 0.86, front + 0.01));
      if (st.closer && st.closer.includes(i)) {
        leaf.add(box(0.28, 0.055, 0.06, m.alu, side * (lw / 2 - 0.22), lh - 0.06, front + 0.03, 0.01));
        leaf.add(box(0.24, 0.016, 0.016, m.dark, side * (lw / 2 - 0.2), lh - 0.015, front + 0.075));
      }
      if (st.kick) leaf.add(box(lw - 0.03, 0.28, 0.004, m.steel, 0, 0.16, front + 0.002));
      if (st.panic) {
        leaf.add(box(lw * 0.76, 0.04, 0.045, m.steel, 0, 1.0, front + 0.065, 0.012));
        for (const s2 of [-1, 1]) leaf.add(box(0.09, 0.1, 0.07, m.steel, s2 * lw * 0.4, 1.0, front + 0.035, 0.01));
      }
      if (st.sign) {
        const lb = label(st.sign, 0.62, 0.12);
        lb.position.set(0, 1.62, front + 0.002);
        leaf.add(lb);
      }
      if (st.cabinet) leaf.add(box(0.022, 0.08, 0.03, m.black, free + side * 0.045, lh * 0.5, front + 0.015, 0.006));
      g.add(pivot);
      // cabinets swing outwards, room doors swing inwards
      doors.push({ pivot, sign: st.cabinet ? side : -side, max: 1.35 });
      xs += w;
    });

    // surrounding wall so the doorset reads in context, as photographed
    if (!o.noWall) {
      const wallMat = paint(st.wall, 0.85, 0.02);
      if (st.cabinet) {
        g.add(box(1.8, 2.4, 0.08, wallMat, 0, 1.2, T / 2 - 0.035 - 0.04));
      } else {
        const ww = 0.45;
        const wh = H + fw + 0.3;
        for (const s of [-1, 1]) g.add(box(ww, wh, 0.12, wallMat, s * (W / 2 + fw + ww / 2), wh / 2, 0));
        g.add(box(W + 2 * fw, wh - H - fw, 0.12, wallMat, 0, H + fw + (wh - H - fw) / 2, 0));
        const reach = Math.max(...st.leaves) + 0.12;
        g.add(box(W + 0.4, H + 0.2, 0.02, m.backdrop, 0, (H + 0.2) / 2, -reach));
      }
    }
    g.userData.size = { w: W + 2 * fw, h: H + fw };
    g.userData.view = { yaw: -0.38, pitch: 0.12 };
    openable(g, doors, st.cabinet ? 'Tap to open the cabinet' : 'Tap to open the door');
    return g;
  }

  /* ---------- pass boxes ---------- */

  // Static pass box: square flange, recessed door with centred window, handle left, hinges right
  function buildPassStatic(k, m) {
    const { box, group, slab, glaze, dHandle, sphere, cyl } = k;
    const FW = 0.84, FH = 0.88, DW = 0.64, DH = 0.68, D = 0.6;
    const cy = FH / 2;
    const yb = (FH - DH) / 2;
    const g = group();
    // hollow chamber
    g.add(box(DW + 0.04, 0.02, D, m.steel, 0, yb - 0.01, 0), box(DW + 0.04, 0.02, D, m.steel, 0, yb + DH + 0.01, 0));
    g.add(box(0.02, DH, D, m.steel, -DW / 2 - 0.01, cy, 0), box(0.02, DH, D, m.steel, DW / 2 + 0.01, cy, 0));
    // flanges with folded edges, both faces
    for (const zs of [1, -1]) {
      const f = slab(FW, FH, 0.02, m.steelV, [{ x0: -DW / 2, x1: DW / 2, y0: yb, y1: yb + DH }]);
      f.position.z = zs * (D / 2 + 0.01);
      g.add(f);
      const zr = zs * (D / 2 + 0.035);
      g.add(box(FW, 0.02, 0.05, m.steel, 0, 0.01, zr), box(FW, 0.02, 0.05, m.steel, 0, FH - 0.01, zr));
      g.add(box(0.02, FH, 0.05, m.steel, -FW / 2 + 0.01, cy, zr), box(0.02, FH, 0.05, m.steel, FW / 2 - 0.01, cy, zr));
    }
    const dw = DW - 0.02;
    const dh = DH - 0.02;
    const win = { x0: -0.125, x1: 0.125, y0: dh * 0.3, y1: dh * 0.71 };
    const makeDoor = () => {
      const leaf = group(slab(dw, dh, 0.03, m.steelV, [win]), glaze(win, 0.03));
      const h = dHandle(0.2);
      h.position.set(-dw / 2 + 0.07, dh * 0.52, 0.015);
      leaf.add(h);
      for (const hy of [dh * 0.86, dh * 0.13]) {
        leaf.add(box(0.05, 0.07, 0.035, m.steel, dw / 2 + 0.012, hy, 0.03, 0.008));
        leaf.add(cyl(0.013, 0.013, 0.1, m.steel, dw / 2 + 0.036, hy, 0.05));
      }
      return leaf;
    };
    // front door hinged on the right
    const pivot = group();
    pivot.position.set(dw / 2, yb + 0.01, D / 2 - 0.005);
    const front = makeDoor();
    front.position.x = -dw / 2;
    pivot.add(front);
    g.add(pivot);
    const back = makeDoor();
    back.rotation.y = Math.PI;
    back.position.set(0, yb + 0.01, -D / 2 + 0.005);
    g.add(back);
    // interlock indicator on the left of the flange
    g.add(box(0.045, 0.09, 0.02, m.dark, -FW / 2 + 0.06, cy, D / 2 + 0.03, 0.005));
    const led = sphere(0.01, m.ledAmber, -FW / 2 + 0.06, cy + 0.02, D / 2 + 0.042);
    g.add(led);
    openable(g, [{ pivot, sign: 1, max: 1.6 }], 'Tap to test the interlock', (v) => (led.material = v > 0.05 ? m.ledRed : m.ledAmber));
    g.userData.size = { w: FW, h: FH, open: { w: DW, h: DH, y0: yb } };
    g.userData.view = { yaw: -0.45, pitch: 0.15 };
    return g;
  }

  // Dynamic pass box (non-FLP): tall flange, gauge panel on top, door below with window
  function buildPassDynamic(k, m) {
    const { box, group, slab, glaze, dHandle, sphere, cyl, gauge, flow } = k;
    const FW = 0.8, FH = 1.64, D = 0.66;
    const DW = 0.7, DH = 1.02, yb = 0.07;
    const topY0 = yb + DH + 0.05;
    const topH = FH - topY0 - 0.05;
    const g = group();
    // chamber (hollow) and plenum (solid)
    g.add(box(DW + 0.04, 0.02, D, m.steel, 0, yb - 0.01, 0), box(DW + 0.04, 0.02, D, m.steel, 0, yb + DH + 0.01, 0));
    g.add(box(0.02, DH, D, m.steel, -DW / 2 - 0.01, yb + DH / 2, 0), box(0.02, DH, D, m.steel, DW / 2 + 0.01, yb + DH / 2, 0));
    g.add(box(DW, topH + 0.04, D - 0.04, m.steel, 0, topY0 + topH / 2, 0));
    g.add(box(DW - 0.04, 0.012, D - 0.08, m.hepa, 0, yb + DH - 0.01, 0));
    for (const zs of [1, -1]) {
      const f = slab(FW, FH, 0.02, m.steelV, [{ x0: -DW / 2, x1: DW / 2, y0: yb, y1: yb + DH }]);
      f.position.z = zs * (D / 2 + 0.01);
      g.add(f);
    }
    // top panel with differential pressure gauge
    g.add(box(DW, topH, 0.015, m.steel, 0, topY0 + topH / 2, D / 2 + 0.028, 0.004));
    const gg = gauge(0.07);
    gg.position.set(0, topY0 + topH * 0.58, D / 2 + 0.035);
    g.add(gg);
    // door hinged on the left, handle right
    const dw = DW - 0.02;
    const dh = DH - 0.02;
    const win = { x0: -0.16, x1: 0.16, y0: dh * 0.37, y1: dh * 0.68 };
    const makeDoor = () => {
      const leaf = group(slab(dw, dh, 0.03, m.steelV, [win]), glaze(win, 0.03));
      const h = dHandle(0.18);
      h.position.set(dw / 2 - 0.08, dh * 0.5, 0.015);
      leaf.add(h);
      for (const hy of [dh * 0.93, dh * 0.07]) {
        leaf.add(box(0.05, 0.08, 0.035, m.steel, -dw / 2 - 0.012, hy, 0.03, 0.008));
        leaf.add(cyl(0.013, 0.013, 0.11, m.steel, -dw / 2 - 0.036, hy, 0.05));
      }
      return leaf;
    };
    const pivot = group();
    pivot.position.set(-dw / 2, yb + 0.01, D / 2 + 0.005);
    const front = makeDoor();
    front.position.x = dw / 2;
    pivot.add(front);
    g.add(pivot);
    const back = makeDoor();
    back.rotation.y = Math.PI;
    back.position.set(0, yb + 0.01, -D / 2 - 0.005);
    g.add(back);
    // interlock switch on the right edge of the flange
    g.add(box(0.035, 0.1, 0.03, m.dark, FW / 2 - 0.022, yb + DH * 0.8, D / 2 + 0.035, 0.005));
    const led = sphere(0.009, m.ledGreen, FW / 2 - 0.022, yb + DH * 0.8 + 0.025, D / 2 + 0.052);
    g.add(led);
    const f = flow({ count: 140, box: [-DW / 2 + 0.06, DW / 2 - 0.06, yb + 0.05, yb + DH - 0.04, -D / 2 + 0.08, D / 2 - 0.08], size: 0.016, speed: 0.4 });
    g.add(f);
    addTicks(g, flowTick(f));
    openable(g, [{ pivot, sign: -1, max: 1.6 }], 'Tap to test the interlock', (v) => (led.material = v > 0.05 ? m.ledRed : m.ledGreen));
    g.userData.view = { yaw: -0.42, pitch: 0.12 };
    return g;
  }

  // Dynamic three-leaf pass box (FLP): cube with plenum on top and three windowed doors
  function buildPassThree(k, m, o = {}) {
    const { box, group, slab, glaze, cyl, perf, flow, THREE } = k;
    const S = 0.84, CH = 0.8, PH = 0.52;
    const DW = 0.6, DH = 0.64, dy = 0.08;
    const g = group();
    // plenum
    g.add(box(S, PH, S, m.steelV, 0, CH + PH / 2, 0, 0.008));
    g.add(box(S + 0.012, 0.03, S + 0.012, m.steel, 0, CH + 0.005, 0));
    g.add(box(0.12, 0.07, 0.006, m.steel, -0.22, CH + PH * 0.72, S / 2 + 0.004));
    g.add(box(0.13, 0.13, 0.006, perf(0.13, 0.13, 0.012), S / 2 + 0.004, CH + PH * 0.72, -0.05).rotateY(Math.PI / 2));
    g.add(box(0.07, 0.12, 0.1, paint(k, 0x7d858c), S / 2 + 0.04, CH + PH * 0.42, 0.12, 0.01));
    g.add(k.cylX(0.022, 0.06, m.steel, S / 2 + 0.1, CH + PH * 0.42, 0.12));
    // chamber faces: front, right, left have doors; back is plain
    const faces = [
      { ry: 0, door: true },
      { ry: Math.PI / 2, door: true },
      { ry: -Math.PI / 2, door: true },
      { ry: Math.PI, door: false },
    ];
    const win = { x0: -0.15, x1: 0.15, y0: DH * 0.3, y1: DH * 0.78 };
    let frontPivot = null;
    faces.forEach((fc, i) => {
      const face = group();
      face.rotation.y = fc.ry;
      const wall = slab(S, CH, 0.02, m.steelV, fc.door ? [{ x0: -DW / 2, x1: DW / 2, y0: dy, y1: dy + DH }] : []);
      wall.position.z = S / 2 - 0.01;
      face.add(wall);
      if (fc.door) {
        // raised rim around the opening
        const rz = S / 2 + 0.01;
        face.add(box(DW + 0.06, 0.03, 0.025, m.steel, 0, dy - 0.015, rz), box(DW + 0.06, 0.03, 0.025, m.steel, 0, dy + DH + 0.015, rz));
        face.add(box(0.03, DH, 0.025, m.steel, -DW / 2 - 0.015, dy + DH / 2, rz), box(0.03, DH, 0.025, m.steel, DW / 2 + 0.015, dy + DH / 2, rz));
        const pivot = group();
        pivot.position.set(-DW / 2 + 0.005, dy + 0.005, S / 2 + 0.005);
        const leaf = group(slab(DW - 0.01, DH - 0.01, 0.025, m.steelV, [win]), glaze(win, 0.025));
        leaf.position.x = (DW - 0.01) / 2;
        leaf.add(box(0.03, 0.09, 0.035, m.steel, (DW - 0.01) / 2 - 0.05, DH * 0.55, 0.03, 0.008));
        for (const hy of [DH * 0.85, DH * 0.15]) leaf.add(cyl(0.012, 0.012, 0.08, m.steel, -(DW - 0.01) / 2 - 0.01, hy, 0.025));
        pivot.add(leaf);
        face.add(pivot);
        if (i === 0) frontPivot = pivot;
      }
      g.add(face);
    });
    g.add(box(S - 0.04, 0.02, S - 0.04, m.ssInner, 0, 0.01, 0));
    g.add(box(S - 0.06, 0.012, S - 0.06, m.hepa, 0, CH - 0.01, 0));
    const f = flow({ count: 150, box: [-S / 2 + 0.08, S / 2 - 0.08, 0.05, CH - 0.03, -S / 2 + 0.08, S / 2 - 0.08], size: 0.016, speed: 0.4 });
    g.add(f);
    addTicks(g, flowTick(f));
    openable(g, [{ pivot: frontPivot, sign: -1, max: 1.5 }], 'Tap to open a door');
    g.userData.view = { yaw: -0.62, pitch: 0.22 };
    return g;
  }

  function paint(k, hex) {
    return k.paint(hex, 0.45, 0.3);
  }

  /* ---------- furniture ---------- */

  // SS work table: long cabinet with two bays of double doors, legs with bullet feet, raised rim
  function buildTableSS(k, m) {
    const { box, group, dHandle, foot, cyl } = k;
    const L = 2.0, D = 0.62, top = 0.9, yb = 0.14;
    const g = group();
    g.add(box(L, 0.035, D, m.steel, 0, top - 0.0175, 0));
    g.add(box(L, 0.03, 0.02, m.steel, 0, top + 0.015, D / 2 - 0.01), box(L, 0.03, 0.02, m.steel, 0, top + 0.015, -D / 2 + 0.01));
    g.add(box(0.02, 0.03, D, m.steel, -L / 2 + 0.01, top + 0.015, 0), box(0.02, 0.03, D, m.steel, L / 2 - 0.01, top + 0.015, 0));
    // carcass
    g.add(box(L - 0.04, top - 0.035 - yb, D - 0.04, m.ssInner, 0, (top - 0.035 + yb) / 2, -0.01));
    for (const x of [-L / 2 + 0.02, 0, L / 2 - 0.02])
      for (const z of [-D / 2 + 0.02, D / 2 - 0.02]) {
        g.add(box(0.04, top - 0.035 - 0.08, 0.04, m.steel, x, (top - 0.035 + 0.08) / 2, z));
        g.add(foot(x, z, 0.08));
      }
    g.add(box(L, 0.04, 0.04, m.steel, 0, yb, D / 2 - 0.02), box(L, 0.04, 0.04, m.steel, 0, top - 0.055, D / 2 - 0.02));
    // four doors
    const dh = top - 0.075 - yb - 0.03;
    const doors = [];
    for (const bay of [-1, 1]) {
      const bx0 = bay < 0 ? -L / 2 + 0.04 : 0.02;
      const bw = L / 2 - 0.06;
      for (const s of [-1, 1]) {
        const w = bw / 2 - 0.004;
        const hingeX = s < 0 ? bx0 : bx0 + bw;
        const pivot = group();
        pivot.position.set(hingeX, yb + 0.025, D / 2 + 0.002);
        const leaf = group(box(w, dh, 0.018, m.steelV, 0, dh / 2, 0, 0.004));
        leaf.position.x = -s * (w / 2);
        const h = dHandle(0.14);
        h.position.set(-s * (w / 2 - 0.05), dh * 0.62, 0.009);
        leaf.add(h);
        for (const hy of [0.08, dh - 0.08]) leaf.add(cyl(0.009, 0.009, 0.06, m.steel, s * (w / 2), hy, 0.012));
        pivot.add(leaf);
        g.add(pivot);
        if (bay < 0) doors.push({ pivot, sign: s, max: 1.5 });
      }
    }
    openable(g, doors, 'Tap to open the doors');
    g.userData.view = { yaw: -0.3, pitch: 0.18 };
    return g;
  }

  // GI work table: two off-white pedestal units on castors, grey drawer over a door
  function buildPedestals(k, m) {
    const { box, group, castor, cylZ, paint: p } = k;
    const W = 0.6, D = 0.6, yb = 0.11, top = 0.95;
    const body = p(0xe8e7e2, 0.5, 0.15);
    const drawer = p(0x979ea4, 0.45, 0.25);
    const g = group();
    const doors = [];
    for (const s of [-1, 1]) {
      const cx = s * (W / 2 + 0.004);
      const u = group();
      u.position.x = cx;
      u.add(box(W, top - yb, D, body, 0, (top + yb) / 2, 0, 0.004));
      u.add(box(W + 0.012, 0.035, D + 0.012, body, 0, top + 0.017, 0, 0.006));
      for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) for (const z of [-D / 2 + 0.06, D / 2 - 0.06]) u.add(castor(x, z));
      // drawer with lock and pull
      u.add(box(W - 0.03, 0.19, 0.02, drawer, 0, top - 0.115, D / 2 + 0.01, 0.004));
      u.add(cylZ(0.012, 0.03, m.steel, 0.02, top - 0.075, D / 2 + 0.03));
      u.add(box(0.1, 0.03, 0.03, m.steel, 0.02, top - 0.13, D / 2 + 0.03, 0.006));
      // door with recessed pull and lock
      const dh = top - 0.22 - yb - 0.03;
      const pivot = group();
      pivot.position.set(W / 2 - 0.016, yb + 0.02, D / 2 + 0.002);
      const leaf = group(box(W - 0.032, dh, 0.015, body, 0, dh / 2, 0, 0.004));
      leaf.position.x = -(W - 0.032) / 2;
      leaf.add(box(0.1, 0.045, 0.012, m.black, -(W - 0.032) / 2 + 0.12, dh - 0.12, 0.004));
      leaf.add(box(0.085, 0.012, 0.02, m.steel, -(W - 0.032) / 2 + 0.12, dh - 0.1, 0.012));
      leaf.add(cylZ(0.011, 0.02, m.steel, -(W - 0.032) / 2 + 0.12, dh - 0.05, 0.01));
      pivot.add(leaf);
      u.add(pivot);
      doors.push({ pivot, sign: 1, max: 1.7 });
      g.add(u);
    }
    openable(g, doors, 'Tap to open the doors');
    g.userData.view = { yaw: -0.35, pitch: 0.2 };
    return g;
  }

  // Crossover bench: white cubby unit with SS interior and two flip-up bin lids on top
  function buildBench(k, m) {
    const { box, group, slab, paint: p, THREE } = k;
    const L = 1.45, D = 0.78, yb = 0.1, top = 0.86;
    const white = p(0xf4f4f1, 0.45, 0.1);
    const g = group();
    // top with two bin openings
    const holes = [
      { x0: -0.62, x1: -0.16, y0: 0.2, y1: 0.58 },
      { x0: 0.16, x1: 0.62, y0: 0.2, y1: 0.58 },
    ];
    const tp = slab(L, D, 0.03, white, holes);
    tp.rotation.x = -Math.PI / 2;
    tp.position.set(0, top, D / 2);
    g.add(tp);
    // bin liners
    for (const hl of holes) {
      const cx = (hl.x0 + hl.x1) / 2;
      const w = hl.x1 - hl.x0;
      const cz = D / 2 - (hl.y0 + hl.y1) / 2;
      const d = hl.y1 - hl.y0;
      g.add(box(w, 0.012, d, m.ssInner, cx, top - 0.3, cz));
      g.add(box(w, 0.3, 0.012, m.ssInner, cx, top - 0.15, cz - d / 2), box(w, 0.3, 0.012, m.ssInner, cx, top - 0.15, cz + d / 2));
      g.add(box(0.012, 0.3, d, m.ssInner, cx - w / 2, top - 0.15, cz), box(0.012, 0.3, d, m.ssInner, cx + w / 2, top - 0.15, cz));
    }
    // carcass
    g.add(box(0.04, top - yb, D, white, -L / 2 + 0.02, (top + yb) / 2, 0), box(0.04, top - yb, D, white, L / 2 - 0.02, (top + yb) / 2, 0));
    g.add(box(L, 0.04, D, white, 0, yb + 0.02, 0));
    g.add(box(L - 0.08, 0.025, D, m.ssInner, 0, (top + yb) / 2, 0));
    g.add(box(0.04, top - yb - 0.03, D, white, 0, (top + yb) / 2, 0));
    g.add(box(L - 0.08, top - yb - 0.05, 0.015, m.steelV, 0, (top + yb) / 2, 0));
    // white face frames on both sides (it is a crossover unit)
    for (const zs of [1, -1]) {
      const z = zs * (D / 2 - 0.012);
      g.add(box(L, 0.07, 0.025, white, 0, top - 0.05, z), box(L, 0.06, 0.025, white, 0, (top + yb) / 2, z), box(L, 0.06, 0.025, white, 0, yb + 0.04, z));
      g.add(box(0.07, top - yb, 0.025, white, 0, (top + yb) / 2, z));
    }
    // bullet feet splayed outwards
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const f = k.cyl(0.022, 0.012, 0.11, m.steel, sx * (L / 2 - 0.05), 0.055, sz * (D / 2 - 0.06), 20);
        f.rotation.z = sx * 0.18;
        g.add(f);
      }
    // flip-up lids hinged at the back edge of each opening
    const lids = [];
    for (const hl of holes) {
      const cx = (hl.x0 + hl.x1) / 2;
      const w = hl.x1 - hl.x0;
      const d = hl.y1 - hl.y0;
      const pivot = group();
      pivot.position.set(cx, top + 0.016, D / 2 - hl.y1);
      const lid = group(box(w + 0.02, 0.008, d + 0.02, m.steel, 0, 0, d / 2));
      lid.add(box(0.05, 0.06, 0.008, m.steel, 0, 0.03, d + 0.012));
      pivot.add(lid);
      g.add(pivot);
      lids.push({ pivot, axis: 'x', sign: -1, max: 1.25 });
    }
    openable(g, lids, 'Tap to open or close the bin lids');
    g.userData.setOpen(1);
    g.userData.view = { yaw: -0.28, pitch: 0.32 };
    return g;
  }

  // Garment cubicle: tall SS cabinet, windowed upper doors, lower storage, castors
  function buildCubicle(k, m) {
    const { box, group, slab, glaze, castor, cylZ, paint: p } = k;
    const W = 0.95, D = 0.55, yb = 0.11, H = 1.9;
    const g = group();
    const top = yb + H;
    g.add(box(W, 0.02, D, m.steel, 0, yb + 0.01, 0), box(W + 0.02, 0.04, D + 0.02, m.steel, 0, top + 0.02, 0, 0.004));
    g.add(box(W, H, 0.02, m.steelV, 0, yb + H / 2, -D / 2 + 0.01));
    g.add(box(0.02, H, D, m.steelV, -W / 2 + 0.01, yb + H / 2, 0), box(0.02, H, D, m.steelV, W / 2 - 0.01, yb + H / 2, 0));
    const split = yb + 0.66;
    g.add(box(W, 0.03, D, m.steel, 0, split, 0));
    g.add(box(W - 0.04, 0.012, D - 0.04, m.ssInner, 0, yb + 0.35, 0));
    // hanging garments inside
    g.add(k.cylX(0.01, W - 0.06, m.steel, 0, top - 0.12, 0));
    for (let i = 0; i < 6; i++) g.add(box(0.12, 0.62, 0.02, m.fabric, -0.34 + i * 0.135, top - 0.46, (i % 2) * 0.03, 0.01));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(castor(sx * (W / 2 - 0.08), sz * (D / 2 - 0.08), p(0xf0f0ee, 0.5, 0.1)));
    const doors = [];
    const uh = top - split - 0.02;
    const lh = split - yb - 0.03;
    for (const s of [-1, 1]) {
      const w = W / 2 - 0.012;
      const mk = (y, h, upper) => {
        const pivot = group();
        pivot.position.set(s * (W / 2 - 0.004), y, D / 2 + 0.002);
        const win = upper ? { x0: -0.12, x1: 0.12, y0: h - 0.42, y1: h - 0.1 } : null;
        const leaf = group(slab(w, h, 0.02, m.steelV, win ? [win] : []));
        if (win) leaf.add(glaze(win, 0.02, m.glass));
        leaf.position.x = -s * (w / 2);
        if (upper) {
          leaf.add(box(0.04, 0.26, 0.012, m.black, -s * (w / 2 - 0.05), h - 0.64, 0.008, 0.006));
          leaf.add(box(0.016, 0.22, 0.02, m.steel, -s * (w / 2 - 0.05), h - 0.64, 0.02, 0.006));
        } else {
          leaf.add(cylZ(0.014, 0.04, m.steel, -s * (w / 2 - 0.05), h - 0.08, 0.02));
        }
        for (const hy of upper ? [0.12, h / 2, h - 0.12] : [0.1, h - 0.1]) leaf.add(box(0.02, 0.06, 0.02, m.steel, s * (w / 2 + 0.004), hy, 0.01));
        pivot.add(leaf);
        g.add(pivot);
        return pivot;
      };
      doors.push({ pivot: mk(split + 0.015, uh, true), sign: s, max: 1.5 });
      mk(yb + 0.02, lh, false);
    }
    openable(g, doors, 'Tap to open the doors');
    g.userData.view = { yaw: -0.5, pitch: 0.12 };
    return g;
  }

  // Wall-mounted surgical scrub sink: tapered trough, basin + perforated drain tray, tall splash-back, taps
  function buildScrubWall(k, m) {
    const { box, group, prism, perf, tube, cylZ, cyl } = k;
    const W = 1.1, D = 0.55, rim = 0.36;
    const g = group();
    const zb = -D / 2;
    // trough sides (tapered profile)
    const prof = [[zb, 0], [zb + D - 0.2, 0], [zb + D, rim - 0.12], [zb + D, rim], [zb, rim]];
    for (const s of [-1, 1]) {
      const p = prism(prof, 0.02, m.steel);
      p.position.x = s * (W / 2 - 0.01);
      g.add(p);
    }
    g.add(box(W, 0.12, 0.02, m.steelV, 0, rim - 0.06, zb + D - 0.01));
    const slope = box(W, Math.hypot(0.2, rim - 0.12), 0.02, m.steelV, 0, (rim - 0.12) / 2, zb + D - 0.1 - 0.01);
    slope.rotation.x = Math.atan2(0.2, rim - 0.12);
    g.add(slope);
    g.add(box(W, 0.02, D - 0.2, m.steel, 0, 0.01, zb + (D - 0.2) / 2));
    g.add(box(W + 0.02, 0.03, 0.045, m.steel, 0, rim, zb + D + 0.012, 0.006));
    // perforated drain tray over the right half
    const tw = W * 0.46;
    g.add(box(tw, 0.012, D - 0.07, perf(tw, D - 0.07, 0.02), W / 2 - tw / 2 - 0.02, rim - 0.05, zb + (D - 0.07) / 2 + 0.03));
    g.add(box(0.015, 0.05, D - 0.07, m.steel, W / 2 - tw - 0.02, rim - 0.035, zb + (D - 0.07) / 2 + 0.03));
    // splash-back with folded top and angled side wings
    const bh = 0.55;
    g.add(box(W, bh + rim, 0.022, m.steelV, 0, (bh + rim) / 2, zb + 0.011));
    g.add(box(W, 0.02, 0.07, m.steel, 0, rim + bh, zb + 0.035));
    for (const s of [-1, 1]) {
      const wing = box(0.02, bh, 0.09, m.steel, s * (W / 2 - 0.01), rim + bh / 2, zb + 0.045);
      wing.rotation.y = s * 0.2;
      g.add(wing);
    }
    for (const x of [-0.45, 0, 0.45]) g.add(cylZ(0.009, 0.004, m.dark, x, rim + bh - 0.07, zb + 0.024));
    // elbow tap (left) and gooseneck tap (right)
    g.add(cylZ(0.03, 0.02, m.steel, -0.28, rim + 0.14, zb + 0.03), cyl(0.014, 0.014, 0.1, m.steel, -0.28, rim + 0.19, zb + 0.06));
    g.add(tube([[-0.28, rim + 0.2, zb + 0.06], [-0.28, rim + 0.22, zb + 0.12], [-0.28, rim + 0.17, zb + 0.16]], 0.011, m.steel));
    const elbow = box(0.1, 0.016, 0.016, m.steel, -0.24, rim + 0.25, zb + 0.06, 0.006);
    elbow.rotation.z = 0.35;
    g.add(elbow);
    g.add(cylZ(0.03, 0.02, m.steel, 0.12, rim + 0.08, zb + 0.03));
    g.add(tube([[0.12, rim + 0.08, zb + 0.05], [0.12, rim + 0.38, zb + 0.06], [0.12, rim + 0.43, zb + 0.13], [0.12, rim + 0.3, zb + 0.2]], 0.014, m.steel));
    g.add(box(0.12, 0.016, 0.016, m.steel, 0.12, rim + 0.2, zb + 0.08, 0.006));
    g.userData.view = { yaw: -0.3, pitch: 0.35 };
    return g;
  }

  // Floor-standing scrub sink with foot pedals and a service panel
  function buildScrubFoot(k, m) {
    const { box, group, tube, cylZ, cyl } = k;
    const W = 0.95, D = 0.6, rim = 0.92;
    const g = group();
    g.add(box(0.02, rim, D, m.steelV, -W / 2 + 0.01, rim / 2, 0), box(0.02, rim, D, m.steelV, W / 2 - 0.01, rim / 2, 0));
    g.add(box(W, rim, 0.02, m.steelV, 0, rim / 2, -D / 2 + 0.01));
    g.add(box(W, rim - 0.14, 0.02, m.steelV, 0, (rim - 0.14) / 2, D / 2 - 0.01));
    g.add(box(W, 0.14, 0.025, m.steel, 0, rim - 0.07, D / 2 - 0.005));
    g.add(box(W + 0.02, 0.025, 0.04, m.steel, 0, rim, D / 2 + 0.005, 0.006));
    g.add(box(W - 0.04, 0.02, D - 0.04, m.ssInner, 0, rim - 0.24, 0));
    // splash-back and taps
    g.add(box(W, 0.34, 0.02, m.steelV, 0, rim + 0.17, -D / 2 + 0.01));
    g.add(box(W, 0.02, 0.06, m.steel, 0, rim + 0.34, -D / 2 + 0.03));
    for (const x of [-0.24, 0.24]) {
      g.add(cylZ(0.028, 0.02, m.steel, x, rim + 0.22, -D / 2 + 0.03));
      g.add(tube([[x, rim + 0.22, -D / 2 + 0.03], [x, rim + 0.22, -D / 2 + 0.11], [x, rim + 0.15, -D / 2 + 0.13]], 0.012, m.steel));
    }
    g.add(box(0.03, 0.62, 0.03, m.steel, W / 2 + 0.03, rim + 0.02, -D / 2 + 0.06));
    // service panel with raised frame
    const px = 0.36, py0 = 0.12, py1 = 0.72;
    const fz = D / 2 + 0.006;
    g.add(box(px, 0.03, 0.012, m.steel, 0, py0, fz), box(px, 0.03, 0.012, m.steel, 0, py1, fz));
    g.add(box(0.03, py1 - py0, 0.012, m.steel, -px / 2, (py0 + py1) / 2, fz), box(0.03, py1 - py0, 0.012, m.steel, px / 2, (py0 + py1) / 2, fz));
    g.add(box(px - 0.06, py1 - py0 - 0.06, 0.006, m.steel, 0, (py0 + py1) / 2, fz - 0.002));
    for (const x of [-0.2, 0.2]) g.add(box(0.006, rim - 0.16, 0.006, m.dark, x * 1.6, (rim - 0.16) / 2 + 0.02, D / 2 + 0.001));
    // foot pedals
    for (const x of [-0.33, 0.33]) {
      g.add(box(0.06, 0.09, 0.05, m.steel, x, 0.1, D / 2 + 0.025, 0.008));
      const pd = box(0.08, 0.016, 0.13, m.steel, x, 0.05, D / 2 + 0.08, 0.006);
      pd.rotation.x = -0.25;
      g.add(pd);
    }
    g.userData.view = { yaw: -0.3, pitch: 0.2 };
    return g;
  }

  /* ---------- airflow & dust ---------- */

  // Mobile LAF: SS cabinet on red castors, control panel on top, clear work zone, storage below
  function buildMobileLaf(k, m) {
    const { box, group, castor, dHandle, gauge, perf, paint: p, flow } = k;
    const W = 1.25, D = 0.75, yb = 0.11;
    const c0 = yb, c1 = 0.58, w1 = 1.28, t0 = 1.52, t1 = 1.96;
    const g = group();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(castor(sx * (W / 2 - 0.08), sz * (D / 2 - 0.08), p(0xd12a2a, 0.5, 0.1)));
    // lower storage cabinet with two doors
    g.add(box(W, c1 - c0, D, m.steelV, 0, (c0 + c1) / 2, 0, 0.004));
    for (const s of [-1, 1]) {
      g.add(box(W / 2 - 0.03, c1 - c0 - 0.06, 0.012, m.steelV, s * (W / 4), (c0 + c1) / 2, D / 2 + 0.006, 0.003));
      const h = dHandle(0.18);
      h.position.set(s * 0.07, (c0 + c1) / 2 + 0.04, D / 2 + 0.012);
      g.add(h);
    }
    // work zone: SS sides and back, clear side screens at the front
    g.add(box(0.02, w1 - c1, D, m.steelV, -W / 2 + 0.01, (c1 + w1) / 2, 0), box(0.02, w1 - c1, D, m.steelV, W / 2 - 0.01, (c1 + w1) / 2, 0));
    g.add(box(W, w1 - c1, 0.02, m.steelV, 0, (c1 + w1) / 2, -D / 2 + 0.01));
    g.add(box(W - 0.04, 0.02, D - 0.02, m.steel, 0, c1 + 0.01, 0));
    for (const s of [-1, 1]) g.add(box(0.36, w1 - c1 - 0.02, 0.006, m.acrylic, s * (W / 2 - 0.2), (c1 + w1) / 2, D / 2 - 0.02));
    // light band and top control section
    g.add(box(W, t0 - w1, D, m.steelV, 0, (w1 + t0) / 2, 0, 0.004));
    g.add(box(W - 0.02, 0.012, 0.01, m.steel, 0, w1 + 0.02, D / 2 + 0.004), box(W - 0.02, 0.012, 0.01, m.steel, 0, t0 - 0.02, D / 2 + 0.004));
    g.add(box(W - 0.06, 0.012, D - 0.06, m.hepa, 0, w1 - 0.006, 0));
    g.add(box(W, t1 - t0, D, m.steelV, 0, (t0 + t1) / 2, 0, 0.006));
    const fz = D / 2 + 0.004;
    g.add(box(0.05, 0.05, 0.012, m.black, -0.5, t0 + 0.3, fz), box(0.05, 0.05, 0.012, m.black, -0.43, t0 + 0.3, fz));
    g.add(box(0.07, 0.07, 0.012, m.black, -0.3, t0 + 0.3, fz));
    g.add(box(0.44, 0.19, 0.02, m.dark, 0, t0 + 0.26, fz), box(0.4, 0.15, 0.024, perf(0.4, 0.15, 0.012), 0, t0 + 0.26, fz));
    const gg = gauge(0.065);
    gg.position.set(0.45, t0 + 0.28, fz);
    g.add(gg);
    const f = flow({ count: 260, box: [-W / 2 + 0.06, W / 2 - 0.06, c1 + 0.04, w1 - 0.03, -D / 2 + 0.06, D / 2 - 0.06], speed: 0.55 });
    g.add(f);
    addTicks(g, flowTick(f));
    g.userData.view = { yaw: -0.35, pitch: 0.12 };
    return g;
  }

  // Dispensing booth: SS walls, front fascia with grille, clear strip curtain, return grille at the back
  function buildBooth(k, m) {
    const { box, group, perf, flow, THREE } = k;
    const W = 2.0, D = 2.0, H = 2.5, oh = 2.08;
    const g = group();
    for (const s of [-1, 1]) {
      g.add(box(0.08, H, D, m.steelV, s * (W / 2 - 0.04), H / 2, 0));
      for (let z = -D / 2 + 0.33; z < D / 2 - 0.1; z += 0.33) g.add(box(0.004, H, 0.006, m.dark, s * (W / 2 + 0.001), H / 2, z));
      g.add(box(0.12, H, 0.1, m.steel, s * (W / 2 - 0.06), H / 2, D / 2 - 0.05));
    }
    g.add(box(W, 0.06, D, m.steel, 0, H + 0.03, 0));
    g.add(box(W - 0.24, H - oh, 0.08, m.steel, 0, oh + (H - oh) / 2, D / 2 - 0.04));
    g.add(box(0.9, 0.07, 0.01, perf(0.9, 0.07, 0.012), 0.35, H - 0.07, D / 2 + 0.002));
    // back wall with return grille
    g.add(box(W - 0.16, oh, 0.06, m.steelV, 0, oh / 2, -D / 2 + 0.03));
    g.add(box(W - 0.3, 0.55, 0.012, perf(W - 0.3, 0.55), 0, 0.4, -D / 2 + 0.066));
    g.add(box(W - 0.16, 0.03, D - 0.1, m.steel, 0, 0.015, 0));
    g.add(box(W - 0.2, 0.012, D - 0.25, m.hepa, 0, oh - 0.006, -0.05));
    // clear PVC strip curtain across the opening
    const n = 9;
    const cw = (W - 0.24) / n;
    for (let i = 0; i < n; i++) {
      const s = box(cw * 1.05, oh - 0.1, 0.004, m.strip, -W / 2 + 0.12 + cw * (i + 0.5), (oh + 0.1) / 2, D / 2 - 0.1 - (i % 2) * 0.006);
      s.rotation.y = (i % 2 ? 1 : -1) * 0.03;
      g.add(s);
    }
    const lamp = new THREE.PointLight(0x9fd8ff, 1.2, 3.5, 1.5);
    lamp.position.set(0, oh - 0.3, 0);
    g.add(lamp);
    const f = flow({
      count: 460, box: [-W / 2 + 0.12, W / 2 - 0.12, 0.08, oh - 0.04, -D / 2 + 0.08, D / 2 - 0.15], speed: 0.75,
      bend: (p, i, dt, h) => {
        if (h < 0.35) p[i * 3 + 2] -= (0.35 - h) * 2.4 * dt;
      },
    });
    g.add(f);
    addTicks(g, flowTick(f));
    g.userData.view = { yaw: -0.6, pitch: 0.18 };
    return g;
  }

  // Reverse LAF: bench-top unit on an open SS stand, canopy on top, perforated return panel at the back
  function buildReverseLaf(k, m) {
    const { box, group, perf, paint: p, flow } = k;
    const W = 1.8, D = 0.75, st = 0.85, top = 1.53;
    const g = group();
    // stand
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        g.add(box(0.04, st, 0.04, m.steel, sx * (W / 2 - 0.05), st / 2, sz * (D / 2 - 0.05)));
        g.add(k.foot(sx * (W / 2 - 0.05), sz * (D / 2 - 0.05), 0.03));
      }
    for (const y of [0.2, st - 0.02]) {
      for (const sz of [-1, 1]) g.add(box(W - 0.1, 0.035, 0.035, m.steel, 0, y, sz * (D / 2 - 0.05)));
      for (const sx of [-1, 1]) g.add(box(0.035, 0.035, D - 0.1, m.steel, sx * (W / 2 - 0.05), y, 0));
    }
    g.add(box(0.035, 0.035, D - 0.1, m.steel, 0, 0.2, 0));
    // work cabinet
    g.add(box(W, 0.03, D, m.steel, 0, st + 0.015, 0));
    g.add(box(W, top - st, 0.02, m.steelV, 0, (st + top) / 2, -D / 2 + 0.01));
    g.add(box(W - 0.1, 0.18, 0.008, perf(W - 0.1, 0.18), 0, st + 0.25, -D / 2 + 0.025));
    for (const s of [-1, 1]) g.add(box(0.02, top - st, D, m.steelV, s * (W / 2 - 0.01), (st + top) / 2, 0));
    // canopy, light fitting and controls
    g.add(box(W + 0.04, 0.45, D + 0.04, m.steelV, 0, top + 0.225, 0, 0.006));
    g.add(box(W - 0.06, 0.012, D - 0.12, m.hepa, 0, top - 0.006, 0.02));
    g.add(box(W * 0.62, 0.045, 0.06, m.led, -0.1, top - 0.05, -D / 2 + 0.08));
    g.add(box(W * 0.62 + 0.04, 0.02, 0.07, m.steel, -0.1, top - 0.02, -D / 2 + 0.08));
    g.add(box(0.08, 0.08, 0.012, p(0xf2f2f0), 0.62, st + 0.42, -D / 2 + 0.025), box(0.08, 0.08, 0.012, p(0xf2f2f0), 0.72, st + 0.42, -D / 2 + 0.025));
    g.add(box(0.03, 0.02, 0.015, m.black, 0.62, st + 0.42, -D / 2 + 0.034));
    const f = flow({
      count: 380, box: [-W / 2 + 0.06, W / 2 - 0.06, st + 0.04, top - 0.03, -D / 2 + 0.04, D / 2 - 0.04], speed: 0.6,
      bend: (pp, i, dt, h) => {
        if (h < 0.5) pp[i * 3 + 2] -= (0.5 - h) * 2.2 * dt;
      },
    });
    g.add(f);
    addTicks(g, flowTick(f));
    g.userData.view = { yaw: -0.4, pitch: 0.2 };
    return g;
  }

  // OT LAF: ceiling plenum photographed face-up; perforated diffuser panels on an SS face plate
  function buildOtLaf(k, m, o = {}) {
    const { box, group, perf, flow } = k;
    const X = 1.6, Z = 2.6, C = 0.3;
    const g = group();
    g.add(box(X, C, Z, m.steel, 0, C / 2, 0));
    const fy = C + 0.003;
    g.add(box(X, 0.006, Z, m.steel, 0, C, 0));
    const panel = (x0, x1, z0, z1) => {
      const w = x1 - x0;
      const d = z1 - z0;
      g.add(box(w, 0.006, d, perf(w, d, 0.04), (x0 + x1) / 2, fy, (z0 + z1) / 2));
      g.add(box(w + 0.03, 0.004, d + 0.03, m.dark, (x0 + x1) / 2, fy - 0.001, (z0 + z1) / 2));
    };
    panel(-0.66, 0.66, 0.2, 1.18); // large near panel
    panel(-0.66, -0.4, -0.38, 0.1); // perforated strips either side of a plain centre
    panel(0.4, 0.66, -0.38, 0.1);
    g.add(box(0.76, 0.006, 0.48, m.steelV, 0, fy + 0.001, -0.14));
    panel(-0.55, 0.55, -1.16, -0.48); // far panel
    // grooves and raised lip
    for (const z of [0.15, -0.43]) g.add(box(X - 0.1, 0.004, 0.01, m.dark, 0, fy + 0.002, z));
    g.add(box(X, 0.025, 0.03, m.steel, 0, C + 0.012, Z / 2 - 0.015), box(X, 0.025, 0.03, m.steel, 0, C + 0.012, -Z / 2 + 0.015));
    g.add(box(0.03, 0.025, Z, m.steel, X / 2 - 0.015, C + 0.012, 0), box(0.03, 0.025, Z, m.steel, -X / 2 + 0.015, C + 0.012, 0));
    // air leaving the diffusers
    const reach = o.inRoom ? 2.6 : 0.9;
    const f1 = flow({ count: o.inRoom ? 380 : 220, box: [-0.62, 0.62, C + 0.01, C + reach, 0.22, 1.16], axis: 1, dir: 1, speed: 0.5, opacity: o.inRoom ? 0.85 : 0.6 });
    const f2 = flow({ count: o.inRoom ? 240 : 140, box: [-0.52, 0.52, C + 0.01, C + reach, -1.14, -0.5], axis: 1, dir: 1, speed: 0.5, opacity: o.inRoom ? 0.85 : 0.6 });
    g.add(f1, f2);
    addTicks(g, flowTick(f1), flowTick(f2));
    g.userData.view = { yaw: -0.2, pitch: 0.72 };
    return g;
  }

  // Portable dust collector: SS cabinet on castors, fan drum and outlet on top, inlet box, side motor
  function buildCollector(k, m) {
    const { box, group, castor, cyl, cylX, paint: p } = k;
    const W = 0.55, D = 0.55, yb = 0.11, H = 0.85;
    const g = group();
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(castor(sx * (W / 2 - 0.06), sz * (D / 2 - 0.06), p(0x8a9096, 0.6, 0.2)));
    g.add(box(W, H, D, m.steelV, 0, yb + H / 2, 0, 0.006));
    // front access door, hinged right, with latches on the left
    g.add(box(0.34, 0.66, 0.014, m.steelV, 0.08, yb + 0.4, D / 2 + 0.007, 0.004));
    for (const hy of [yb + 0.15, yb + 0.65]) g.add(box(0.03, 0.06, 0.03, m.steel, 0.26, hy, D / 2 + 0.015, 0.006));
    for (const hy of [yb + 0.25, yb + 0.55]) g.add(box(0.05, 0.03, 0.03, m.steel, -0.1, hy, D / 2 + 0.02, 0.006));
    // inlet box at the top left
    g.add(box(0.26, 0.3, 0.38, m.steel, -W / 2 - 0.12, yb + H - 0.2, 0, 0.006));
    g.add(box(0.005, 0.24, 0.32, m.black, -W / 2 - 0.25, yb + H - 0.2, 0));
    // fan drum and square outlet with angled hood
    g.add(cyl(0.21, 0.21, 0.18, m.steelV, 0, yb + H + 0.09, 0, 40));
    g.add(cyl(0.22, 0.22, 0.02, m.steel, 0, yb + H + 0.01, 0, 40));
    g.add(box(0.28, 0.26, 0.28, m.steelV, 0, yb + H + 0.31, 0, 0.004));
    const hood = box(0.3, 0.012, 0.34, m.steel, 0, yb + H + 0.46, 0.02);
    hood.rotation.x = 0.25;
    g.add(hood);
    // motor with terminal box on the left side
    const motor = p(0x7f97aa, 0.4, 0.3);
    g.add(box(0.03, 0.2, 0.2, m.steel, -W / 2 - 0.015, yb + 0.26, 0.1));
    g.add(cylX(0.085, 0.22, motor, -W / 2 - 0.14, yb + 0.26, 0.1));
    g.add(cylX(0.07, 0.04, m.dark, -W / 2 - 0.27, yb + 0.26, 0.1));
    g.add(box(0.09, 0.07, 0.09, motor, -W / 2 - 0.14, yb + 0.37, 0.1, 0.008));
    g.userData.view = { yaw: -0.55, pitch: 0.15 };
    return g;
  }

  /* ---------- air handling ---------- */

  // AHU: panelled casing on aluminium profiles. decks 1 = blue single decker, 2 = orange double decker
  function buildAhu(k, m, o = {}) {
    const { box, group, cylZ, louvre, paint: p } = k;
    const decks = o.decks || 2;
    const g = group();
    const fans = [];
    const block = (x0, sections, H, D, y0, color, viewport) => {
      const L = sections.reduce((a, b) => a + b, 0);
      const mat = p(color, 0.55, 0.04);
      g.add(box(L, H, D, mat, x0 + L / 2, y0 + H / 2, 0));
      let x = x0;
      sections.forEach((len, i) => {
        const fz = D / 2 + 0.012;
        g.add(box(len - 0.05, H - 0.05, 0.02, mat, x + len / 2, y0 + H / 2, fz - 0.002, 0.004));
        g.add(box(0.035, H, 0.03, m.alu, x + 0.0175, y0 + H / 2, fz));
        if (i % 2 === 1 || len > 0.55) {
          const hx = x + len - 0.08;
          for (const hy of [y0 + H * 0.28, y0 + H * 0.72]) g.add(box(0.03, 0.09, 0.03, m.black, hx, hy, fz + 0.015, 0.006));
          for (const hy of [y0 + 0.1, y0 + H - 0.1]) g.add(box(0.02, 0.06, 0.02, m.black, x + 0.05, hy, fz + 0.01));
        }
        g.add(box(0.08, 0.04, 0.006, m.alu, x + len / 2, y0 + H - 0.07, fz + 0.002));
        if (viewport === i) {
          const cx = x + len / 2;
          const cy = y0 + H / 2;
          g.add(cylZ(0.11, 0.03, m.alu, cx, cy, fz + 0.01), cylZ(0.085, 0.035, m.glassDark, cx, cy, fz + 0.012));
          const fan = group();
          for (let b = 0; b < 5; b++) {
            const arm = group(box(0.07, 0.022, 0.006, m.steel, 0.035, 0, 0));
            arm.rotation.z = (b / 5) * Math.PI * 2;
            fan.add(arm);
          }
          fan.position.set(cx, cy, fz + 0.034);
          g.add(fan);
          fans.push(fan);
        }
        x += len;
      });
      g.add(box(0.035, H, 0.03, m.alu, x - 0.0175, y0 + H / 2, D / 2 + 0.012));
      g.add(box(L, 0.035, 0.03, m.alu, x0 + L / 2, y0 + H - 0.0175, D / 2 + 0.012), box(L, 0.035, 0.03, m.alu, x0 + L / 2, y0 + 0.0175, D / 2 + 0.012));
      return L;
    };
    if (decks === 1) {
      const secs = [0.45, 0.75, 0.6, 0.75, 0.6, 0.55, 0.5];
      const L = secs.reduce((a, b) => a + b, 0);
      g.add(box(L + 0.02, 0.08, 1.22, m.black, 0, 0.04, 0));
      block(-L / 2, secs, 0.95, 1.2, 0.08, 0x0068d0, 3);
      g.userData.view = { yaw: -0.3, pitch: 0.18 };
    } else {
      const L = 2.2;
      const H = 0.9;
      const base = 0.08;
      g.add(box(L + 0.95, base, 1.32, m.alu, 0.475, base / 2, 0));
      block(-L / 2, [0.55, 0.55, 0.55, 0.55], H, 1.3, base, 0xe35200, null);
      block(-L / 2, [0.55, 0.55, 0.55, 0.55], H, 1.3, base + H, 0xe35200, 0);
      block(L / 2, [0.45, 0.45], H, 1.2, base, 0xe35200, 0);
      // louvred dampers on the inlet end and duct connections on top
      for (const y of [base + H * 0.5, base + H * 1.5]) {
        const lv = louvre(0.7, 0.45, 5);
        lv.rotation.y = -Math.PI / 2;
        lv.position.set(-L / 2 - 0.14, y, 0);
        g.add(lv, box(0.14, 0.5, 0.75, m.alu, -L / 2 - 0.07, y, 0));
      }
      g.add(box(0.55, 0.14, 0.45, m.alu, -L / 2 + 0.4, base + 2 * H + 0.07, 0));
      g.add(box(0.45, 0.12, 0.4, m.alu, L / 2 + 0.45, base + H + 0.06, 0));
      g.userData.view = { yaw: -0.5, pitch: 0.2 };
    }
    addTicks(g, (dt) => fans.forEach((f) => (f.rotation.z -= dt * 7)));
    return g;
  }

  // HVAC: cut-away air handler with fan, motor, coil, filter, mixing box, dampers and ducts
  function buildHvac(k, m) {
    const { box, group, cylZ, louvre, tag, flow, tube, paint: p, THREE } = k;
    const casing = p(0xcfd3d7, 0.45, 0.35);
    const x0 = -1.6, x1 = 1.6, y0 = 0.12, y1 = 1.12, D = 1.0;
    const g = group();
    g.add(box(x1 - x0, 0.1, D, m.dark, 0, 0.06, 0));
    g.add(box(x1 - x0, y1 - y0, 0.02, casing, 0, (y0 + y1) / 2, -D / 2 + 0.01));
    g.add(box(x1 - x0, 0.02, D, casing, 0, y1, 0), box(x1 - x0, 0.02, D, casing, 0, y0, 0));
    g.add(box(0.02, y1 - y0, D, casing, x0, (y0 + y1) / 2, 0));
    g.add(box(0.02, y1 - y0, D, casing, x1, (y0 + y1) / 2, 0));
    // front edge profiles show the cut-away
    for (const x of [x0, -0.5, -0.1, 0.35, x1]) g.add(box(0.03, y1 - y0, 0.03, m.alu, x, (y0 + y1) / 2, D / 2));
    g.add(box(x1 - x0, 0.03, 0.03, m.alu, 0, y1, D / 2), box(x1 - x0, 0.03, 0.03, m.alu, 0, y0, D / 2));
    // supply duct
    g.add(box(0.5, 0.45, 0.5, casing, x0 - 0.25, 0.8, 0), box(0.005, 0.4, 0.45, m.black, x0 - 0.5, 0.8, 0));
    // fan blower (scroll + wheel) and belt-driven motor
    g.add(cylZ(0.34, 0.45, casing, -1.05, 0.62, -0.1));
    g.add(box(0.45, 0.3, 0.45, casing, -1.3, 0.85, -0.1));
    const wheel = group(cylZ(0.26, 0.02, m.dark, 0, 0, 0));
    for (let i = 0; i < 12; i++) {
      const b = box(0.2, 0.02, 0.03, m.steel, 0.14, 0, 0.01);
      const arm = group(b);
      arm.rotation.z = (i / 12) * Math.PI * 2;
      wheel.add(arm);
    }
    wheel.position.set(-1.05, 0.62, 0.14);
    g.add(wheel);
    const motorMat = p(0x56606a, 0.4, 0.4);
    g.add(cylZ(0.1, 0.26, motorMat, -0.72, 0.3, 0.02), cylZ(0.045, 0.03, m.dark, -0.72, 0.3, 0.17));
    const belt = tube([[-0.72, 0.345, 0.18], [-0.9, 0.5, 0.18], [-1.05, 0.66, 0.18], [-1.02, 0.58, 0.18], [-0.86, 0.43, 0.18], [-0.72, 0.255, 0.18]], 0.008, m.black);
    g.add(belt);
    // cooling coil with copper headers
    g.add(box(0.3, 0.86, 0.9, m.fins, -0.3, 0.62, -0.02));
    for (const y of [0.3, 0.5]) g.add(cylZ(0.025, 0.4, m.copper, -0.22, y, 0.45));
    g.add(box(0.04, 0.8, 0.04, m.copper, -0.16, 0.62, 0.42));
    // pleated primary filter
    for (let i = 0; i < 14; i++) {
      const pl = box(0.012, 0.86, 0.08, p(0xf1f1ee, 0.9, 0), 0.12 + (i % 2) * 0.03, 0.62, -0.44 + i * 0.066);
      pl.rotation.y = (i % 2 ? 1 : -1) * 0.5;
      g.add(pl);
    }
    g.add(box(0.1, 0.9, 0.02, m.alu, 0.13, 0.62, 0.44), box(0.1, 0.9, 0.02, m.alu, 0.13, 0.62, -0.46));
    // mixing box: top damper to return duct, fresh air + return louvres on the end
    const top = louvre(0.55, 0.5, 5);
    top.rotation.x = -Math.PI / 2;
    top.position.set(0.95, y1 + 0.03, 0);
    g.add(top);
    g.add(box(0.6, 0.42, 0.55, casing, 0.95, y1 + 0.27, 0));
    g.add(box(1.1, 0.4, 0.55, casing, 0.5, y1 + 0.68, 0), box(0.005, 0.34, 0.5, m.black, -0.055, y1 + 0.68, 0));
    for (const [y, h] of [[0.83, 0.42], [0.36, 0.38]]) {
      const lv = louvre(0.7, h, 4);
      lv.rotation.y = Math.PI / 2;
      lv.position.set(x1 + 0.035, y, 0);
      g.add(lv);
    }
    // callouts as in the diagram
    g.add(tag('Supply', x0 - 0.35, 1.15, 0.2), tag('Fan Blower', -1.15, 1.35, 0.35), tag('Fan Motor', -0.62, 0.05, 0.55));
    g.add(tag('Cooling Coil', -0.3, 1.33, 0.5), tag('Primary Filter', 0.15, 0.0, 0.55), tag('Mixing Box', 0.95, 0.4, 0.55));
    g.add(tag('Damper', 1.35, 1.35, 0.3), tag('Return', 0.2, 2.1, 0), tag('Fresh Air', x1 + 0.35, 1.15, 0.2), tag('Return', x1 + 0.35, 0.2, 0.2));
    // air moving through towards the supply duct
    const f = flow({ count: 360, box: [x0 - 0.45, x1, 0.2, 1.05, -0.4, 0.4], axis: 0, dir: -1, speed: 0.9, size: 0.02 });
    g.add(f);
    addTicks(g, flowTick(f), (dt) => (wheel.rotation.z -= dt * 6));
    g.userData.view = { yaw: 0.28, pitch: 0.22 };
    return g;
  }

  /* ---------- rooms ---------- */

  function roomShell(k, m, W, D, H, openingsBack, openingsLeft) {
    const { box, group, slab, paint: p } = k;
    const wallMat = p(0xf1f3f5, 0.6, 0.05);
    const g = group();
    g.add(box(W, 0.04, D, m.floor, 0, -0.02, 0));
    const back = slab(W, H, 0.08, wallMat, openingsBack);
    back.position.z = -D / 2;
    const left = slab(D, H, 0.08, wallMat, openingsLeft);
    left.rotation.y = Math.PI / 2;
    left.position.x = -W / 2;
    g.add(back, left);
    const clear = (x, list) => !list.some((o) => x > o.x0 - 0.02 && x < o.x1 + 0.02);
    for (let x = -W / 2 + 1; x < W / 2; x += 1) if (clear(x, openingsBack)) g.add(box(0.005, H, 0.004, p(0xc9ced3), x, H / 2, -D / 2 + 0.042));
    for (let z = -D / 2 + 1; z < D / 2; z += 1) if (clear(-z, openingsLeft)) g.add(box(0.004, H, 0.005, p(0xc9ced3), -W / 2 + 0.042, H / 2, z));
    // coving strip at the floor
    g.add(box(W, 0.08, 0.04, p(0xd9dde1), 0, 0.04, -D / 2 + 0.06), box(0.04, 0.08, D, p(0xd9dde1), -W / 2 + 0.06, 0.04, 0));
    return g;
  }

  // Clean room corridor: white panels, blue doors, flush view window, LED ceiling panels
  function buildCleanRoom(k, m) {
    const { box, group, glaze, flow } = k;
    const W = 4.2, D = 3.6, H = 2.7;
    const dbl = buildDoor(k, m, { style: 'cleanroom', noWall: true });
    const sgl = buildDoor(k, m, { style: 'cleanroomSingle', noWall: true });
    const dw = dbl.userData.size.w;
    const sw = sgl.userData.size.w;
    const winL = { x0: -1.3, x1: -0.3, y0: 0.95, y1: 1.85 };
    const g = roomShell(k, m, W, D, H, [{ x0: -dw / 2, x1: dw / 2, y0: 0, y1: dbl.userData.size.h }], [{ x0: 0.5, x1: 0.5 + sw, y0: 0, y1: sgl.userData.size.h }, winL]);
    dbl.position.set(0, 0, -D / 2);
    g.add(dbl);
    // left wall runs along z; its local x maps to -z
    sgl.rotation.y = Math.PI / 2;
    sgl.position.set(-W / 2, 0, -(0.5 + sw / 2));
    g.add(sgl);
    const win = glaze(winL, 0.08, m.glass, k.paint(0xdfe3e7));
    win.rotation.y = Math.PI / 2;
    win.position.x = -W / 2;
    g.add(win);
    for (const z of [-1.1, 0, 1.1]) g.add(box(0.6, 0.03, 0.6, m.led, 0, H - 0.02, z), box(0.66, 0.02, 0.66, k.paint(0xe9ecef), 0, H, z));
    const f = flow({ count: 260, box: [-W / 2 + 0.2, W / 2 - 0.2, 0.02, H - 0.05, -D / 2 + 0.2, D / 2 - 0.2], speed: 0.55, opacity: 0.6 });
    g.add(f);
    addTicks(g, flowTick(f), ...dbl.userData.ticks, ...sgl.userData.ticks);
    g.userData.toggle = () => (dbl.userData.toggle(), sgl.userData.toggle());
    g.userData.hint = 'Tap to open the doors';
    g.userData.view = { yaw: 0.6, pitch: 0.32 };
    return g;
  }

  // Modular OT: panelled room fitted with the company's own OT LAF, scrub sink, pass box and garment cubicle
  function buildOT(k, m) {
    const { box, cyl, group } = k;
    const W = 4.6, D = 4.0, H = 3.0;
    const door = buildDoor(k, m, { style: 'cleanroom', noWall: true });
    const pb = buildPassStatic(k, m);
    const pbs = pb.userData.size;
    const pbX = 0.45, pbY = 0.85;
    const dw = door.userData.size.w;
    const g = roomShell(k, m, W, D, H, [{ x0: pbX - pbs.open.w / 2, x1: pbX + pbs.open.w / 2, y0: pbY + pbs.open.y0, y1: pbY + pbs.open.y0 + pbs.open.h }], [{ x0: -0.6, x1: -0.6 + dw, y0: 0, y1: door.userData.size.h }]);
    // ceiling OT LAF, flipped face-down
    const laf = buildOtLaf(k, m, { inRoom: true });
    laf.rotation.x = Math.PI;
    laf.position.set(0.3, H + 0.3, 0.3);
    g.add(laf);
    // operating table
    g.add(cyl(0.28, 0.4, 0.6, m.dark, 0.3, 0.3, 0.3), cyl(0.08, 0.08, 0.25, m.steel, 0.3, 0.72, 0.3));
    g.add(box(0.55, 0.08, 1.95, m.steel, 0.3, 0.88, 0.3, 0.02), box(0.5, 0.08, 1.85, m.mattress, 0.3, 0.96, 0.3, 0.03));
    // surgical light on an arm
    g.add(cyl(0.02, 0.02, 0.55, m.steel, 1.0, H - 0.6, 0.5));
    const lamp = cyl(0.3, 0.22, 0.1, k.paint(0xf2f4f6), 1.0, H - 0.92, 0.5);
    lamp.rotation.z = 0.3;
    g.add(lamp);
    // wall fittings
    pb.position.set(pbX, pbY, -D / 2);
    g.add(pb);
    const scrub = buildScrubWall(k, m);
    scrub.position.set(-1.3, 0.55, -D / 2 + 0.32);
    g.add(scrub);
    const cub = buildCubicle(k, m);
    cub.position.set(1.65, 0, -D / 2 + 0.33);
    g.add(cub);
    door.rotation.y = Math.PI / 2;
    door.position.set(-W / 2, 0, 0.6 - dw / 2);
    g.add(door);
    g.add(box(0.03, 0.55, 0.9, m.screen, -W / 2 + 0.06, 1.55, -1.2, 0.01));
    g.add(box(0.03, 0.5, 0.7, k.paint(0xf2f4f6), -W / 2 + 0.06, 1.55, 1.45, 0.01), box(0.035, 0.44, 0.64, m.led, -W / 2 + 0.06, 1.55, 1.45));
    addTicks(g, ...laf.userData.ticks, ...door.userData.ticks, ...pb.userData.ticks, ...cub.userData.ticks);
    g.userData.toggle = () => (door.userData.toggle(), pb.userData.toggle());
    g.userData.hint = 'Tap to open the door and pass box';
    g.userData.view = { yaw: 0.62, pitch: 0.34 };
    return g;
  }

  const builders = {
    door: buildDoor,
    passbox: (k, m, o) => (o.type === 'dynamic' ? buildPassDynamic(k, m, o) : buildPassStatic(k, m, o)),
    passbox3: buildPassThree,
    table: buildTableSS,
    pedestal: buildPedestals,
    bench: buildBench,
    cubicle: buildCubicle,
    scrubber: buildScrubWall,
    footscrubber: buildScrubFoot,
    mobilelaf: buildMobileLaf,
    booth: buildBooth,
    reverselaf: buildReverseLaf,
    otlaf: buildOtLaf,
    collector: buildCollector,
    ahu: buildAhu,
    hvac: buildHvac,
    cleanroom: buildCleanRoom,
    ot: buildOT,
  };

  /* ---------- product viewer ---------- */

  async function mountModel(container, type, options = {}) {
    if (!supported()) throw new Error('WebGL unavailable');
    const L = await libs();
    if (!container.isConnected) return { dispose() {} };
    const st = createStage(L, container, { exposure: 0.95, fov: 30 });
    const { THREE, scene, camera, ticks } = st;
    const m = makeMaterials(THREE);
    const k = makeKit(L, m, st.disposables);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.25);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.35);
    fill.position.set(-3, 2, 4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(AMBER, 1.0);
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

    let yaw = -0.55;
    let pitch = 0.28;
    let zoom = 1;
    let vyaw = 0;

    const setModel = (t, o) => {
      if (model) {
        holder.remove(model);
        model.traverse((c) => {
          if (c.geometry) c.geometry.dispose();
          if (c.isPoints || c.isSprite) c.material.dispose();
        });
      }
      model = (builders[t] || buildTableSS)(k, m, o || {});
      holder.add(model);
      modelTicks = [...(model.userData.ticks || [])];
      const bb = new THREE.Box3().setFromObject(model);
      const sphere = bb.getBoundingSphere(new THREE.Sphere());
      radius = sphere.radius;
      model.position.set(-sphere.center.x, -bb.min.y, -sphere.center.z);
      center = new THREE.Vector3(0, (bb.max.y - bb.min.y) / 2, 0);
      const size = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z) * 1.4;
      shadow.scale.set(size, size, 1);
      const v = model.userData.view || {};
      yaw = options.yaw ?? v.yaw ?? -0.55;
      pitch = options.pitch ?? v.pitch ?? 0.28;
      zoom = 1;
      vyaw = 0;
      container.dataset.hint = model.userData.hint || '';
    };

    // orbit
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
      pitch = Math.max(-0.1, Math.min(1.2, pitch + dy * 0.004));
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
        zoom = Math.max(0.45, Math.min(1.6, zoom * (1 + e.deltaY * 0.001)));
      },
      { passive: false }
    );

    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    ticks.push((dt) => {
      if (!dragging) {
        idle += dt;
        yaw += vyaw;
        vyaw *= 0.92;
        if (!reduced && idle > 2.5) yaw += dt * 0.15;
      }
      const dist = (radius / Math.sin((camera.fov * Math.PI) / 360)) * 1.02 * zoom * Math.max(1, 1.2 / camera.aspect);
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
      zoomBy: (f) => (zoom = Math.max(0.45, Math.min(1.6, zoom * f))),
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
    const k = makeKit(L, m, st.disposables);
    const { box, flow, group } = k;
    scene.fog = new THREE.Fog(0x07090c, 7, 22);

    scene.add(new THREE.HemisphereLight(0x9fb6cc, 0x0a0c10, 0.35));
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(3, 4, 6);
    scene.add(key);
    const warm = new THREE.PointLight(AMBER, 12, 8, 2);
    warm.position.set(-2.5, 2.6, 2);
    scene.add(warm);

    const floorMat = new THREE.MeshStandardMaterial({ color: 0x0e1217, metalness: 0.7, roughness: 0.35 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), floorMat);
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    const grid = new THREE.GridHelper(40, 80, AMBER, 0x1d242d);
    grid.material.transparent = true;
    grid.material.opacity = 0.18;
    grid.position.y = 0.002;
    scene.add(grid);

    // the company's grey double doorset, set into a dark steel wall
    const door = buildDoor(k, m, { style: 'scientific', noWall: true });
    const scale = 1.08;
    door.scale.setScalar(scale);
    door.position.set(0, 0, 0.08);
    scene.add(door);
    const OW = door.userData.size.w * scale;
    const OH = door.userData.size.h * scale;
    const WH = 5, WW = 14;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a2028, metalness: 0.6, roughness: 0.5, map: brushed(THREE, '#3a424c', true) });
    scene.add(box((WW - OW) / 2, WH, 0.3, wallMat, -(OW / 2 + (WW - OW) / 4), WH / 2, 0));
    scene.add(box((WW - OW) / 2, WH, 0.3, wallMat, OW / 2 + (WW - OW) / 4, WH / 2, 0));
    scene.add(box(OW, WH - OH, 0.3, wallMat, 0, OH + (WH - OH) / 2, 0));
    for (let x = -6; x <= 6; x += 1.5) if (Math.abs(x) > 1.2) scene.add(box(0.01, WH, 0.01, m.dark, x, WH / 2, 0.155));
    scene.add(box(OW + 0.3, 0.03, 0.02, m.amberGlow, 0, OH + 0.16, 0.16));

    // the clean room behind
    const room = group();
    room.position.z = -0.15;
    const roomMat = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.55, metalness: 0.05, side: THREE.BackSide });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(7, 3.2, 7), roomMat);
    shell.position.set(0, 1.6, -3.5);
    room.add(shell);
    room.add(box(7, 0.02, 7, m.floor, 0, 0.01, -3.5));
    for (let x = -2; x <= 2; x += 2)
      for (let z = -1.5; z >= -5.5; z -= 2) room.add(box(1.2, 0.03, 1.2, m.hepa, x, 3.18, z));
    const inside = flow({ count: 900, box: [-3, 3, 0.02, 3.15, -6.5, -0.5], speed: 0.9, size: 0.02 });
    room.add(inside);
    const glow = new THREE.PointLight(0xdff2ff, 30, 12, 1.6);
    glow.position.set(0, 2.6, -2.5);
    room.add(glow);
    const table = buildTableSS(k, m);
    table.position.set(-1.7, 0, -3.4);
    table.rotation.y = 0.5;
    room.add(table);
    const pb = buildPassDynamic(k, m);
    pb.position.set(2.2, 0, -5.9);
    room.add(pb);
    const cub = buildCubicle(k, m);
    cub.position.set(-2.6, 0, -5.8);
    room.add(cub);
    scene.add(room);

    // loose dust outside the clean zone
    const dust = flow({
      count: 260, box: [-6, 6, 0, 4.5, 0, 8], speed: 0.06, size: 0.025, color: 0xd9b27a, opacity: 0.45,
      bend: (p, i, dt) => {
        p[i * 3] += Math.sin(p[i * 3 + 1] * 2 + i) * dt * 0.08;
      },
    });
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
    const pbTicks = pb.userData.ticks || [];

    ticks.push((dt, t) => {
      smooth += (progress - smooth) * Math.min(1, dt * 5);
      sx += (mx - sx) * Math.min(1, dt * 3);
      sy += (my - sy) * Math.min(1, dt * 3);
      const openT = ease(clamp(smooth / 0.45));
      door.userData.setOpen(openT);
      door.userData.ticks.forEach((f) => f(1));
      const dolly = ease(clamp((smooth - 0.3) / 0.7));
      const narrow = camera.aspect < 0.9;
      const z0 = narrow ? 9.5 : 6.2;
      camera.position.set(sx * 0.5 * (1 - dolly) + Math.sin(t * 0.3) * 0.05, 1.45 - sy * 0.25 * (1 - dolly) + dolly * 0.1, z0 - dolly * (z0 + 1.8));
      camera.lookAt(0, 1.3 + dolly * 0.25, -3);
      glow.intensity = 6 + openT * 34;
      inside.material.opacity = 0.2 + openT * 0.7;
      inside.userData.tick(dt);
      dust.userData.tick(dt);
      pbTicks.forEach((f) => f(dt));
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
