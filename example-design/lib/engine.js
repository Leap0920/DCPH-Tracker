/*
  Red Strings — shared renderer for the four design prototypes.

  Architecture (fixed for all four variants, per the perf review):
  - ONE Canvas 2D surface, full repaint per frame, viewport-culled. No WebGL,
    no layered canvases, no DOM/SVG label overlay.
  - Labels are baked ImageBitmap-style sprites drawn in SCREEN space at a
    constant device size, so they never scale with the camera and never smear.
    Placement is greedy over 4 candidate offsets in priority order, with
    hysteresis so a label that already has a slot keeps it while panning.
  - Everything expensive is baked once at load: node art, portrait grades,
    label plates, glow sprites, noise tiles. Nothing in the frame loop runs a
    filter, a blur, or a shadow.
  - DPR capped at 2.
  - React-free by construction; this file is the reference implementation the
    eventual React port wraps.

  The theme object owns all art direction. See theme-a.js … theme-d.js.
*/
(function (global) {
  "use strict";

  var DPR_CAP = 2;
  /*
    Node sprites bake at SPRITE_S device pixels per world unit and are drawn at
    CSS size (P / (SPRITE_S * dpr)) * k, which puts the art at exactly r*k on
    screen and lands 1:1 device pixels at k = SPRITE_S. SPRITE_PAD is the margin
    around the art that holds glows, rings and drop shadows.
  */
  var SPRITE_S = 2.0;
  var SPRITE_PAD = 1.5;
  var SPRITE_CAP = 320;
  var MAX_LABELS = 120;
  var DRIFT_AMP = 2.6;
  var CAM_TAU = 90;
  var PAN_INERTIA_MS = 150;
  var IDLE_PARK_MS = 4200;
  var TAP_SLOP = 9;
  var TAP_MS = 420;

  /* ── small math ─────────────────────────────────────────────────── */
  function clamp(v, a, b) {
    return v < a ? a : v > b ? b : v;
  }
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }
  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }
  function easeOutQuint(t) {
    return 1 - Math.pow(1 - t, 5);
  }
  function hash32(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function rand01(seed, salt) {
    var x = (seed ^ Math.imul(salt + 1, 2654435761)) >>> 0;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  }
  function hexToRgb(hex) {
    var h = hex.replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    var c = hexToRgb(hex);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
  }

  /* ── tracked text (canvas letterSpacing is patchy; do it by hand) ── */
  function measureTracked(ctx, text, tracking) {
    if (!text) return 0;
    var w = 0;
    for (var i = 0; i < text.length; i++) w += ctx.measureText(text[i]).width + tracking;
    return w - tracking;
  }
  function paintTracked(ctx, text, x, y, tracking, mode) {
    var cx = x;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (mode === "stroke") ctx.strokeText(ch, cx, y);
      else ctx.fillText(ch, cx, y);
      cx += ctx.measureText(ch).width + tracking;
    }
  }
  function setFont(ctx, font) {
    ctx.font = font;
  }
  function setCaps(ctx, on) {
    try {
      ctx.fontVariantCaps = on ? "small-caps" : "normal";
    } catch (e) {
      /* older engines ignore it */
    }
  }

  /* ── graph model ────────────────────────────────────────────────── */
  function buildGraph(data) {
    var nodes = data.nodes.map(function (n, i) {
      return {
        i: i,
        id: n.id,
        name: n.name,
        label: n.label,
        aliases: n.aliases,
        role: n.role,
        affiliation: n.affiliation,
        faction: n.faction,
        bio: n.bio,
        img: n.img,
        bx: n.x,
        by: n.y,
        degree: 0,
        r: 12,
        tier: 2,
        seed: hash32(n.id),
        ox: 0,
        oy: 0,
        sx: 0,
        sy: 0,
        sr: 12,
        sprite: null,
        portrait: null,
        labelSprite: null,
        labelOff: -1,
        visible: false,
        alpha: 1,
        enter: 0
      };
    });
    var byId = {};
    nodes.forEach(function (n) {
      byId[n.id] = n;
    });

    var edges = [];
    data.edges.forEach(function (e) {
      var a = byId[e.s],
        b = byId[e.t];
      if (!a || !b) return;
      a.degree++;
      b.degree++;
      edges.push({
        id: e.id,
        a: a,
        b: b,
        type: e.type,
        detail: e.detail,
        curvature: 0,
        alpha: 1,
        emphasis: 0
      });
    });

    // Parallel threads between one pair bow to alternating sides.
    var pairs = {};
    edges.forEach(function (e) {
      var key = e.a.i < e.b.i ? e.a.i + "|" + e.b.i : e.b.i + "|" + e.a.i;
      (pairs[key] || (pairs[key] = [])).push(e);
    });
    Object.keys(pairs).forEach(function (key) {
      var group = pairs[key];
      group.forEach(function (e, idx) {
        var off = idx - (group.length - 1) / 2;
        e.curvature = off === 0 ? 0.16 : (off < 0 ? -1 : 1) * (0.16 + Math.abs(off) * 0.22);
        // A lone thread can take its bow from the relationship type instead;
        // parallel siblings must alternate sides to stay distinguishable.
        e.solo = group.length === 1;
      });
    });

    nodes.forEach(function (n) {
      n.r = nodeRadius(n);
      n.tier = n.r >= 20 ? 0 : n.r >= 16 ? 1 : 2;
      n.adj = [];
    });
    edges.forEach(function (e, ei) {
      e.a.adj.push(ei);
      e.b.adj.push(ei);
    });

    // Content bounds drive the establishing shot — fitting the authored 2600x1900
    // canvas would leave a third of the frame empty.
    var minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    nodes.forEach(function (n) {
      minX = Math.min(minX, n.bx - n.r);
      minY = Math.min(minY, n.by - n.r);
      maxX = Math.max(maxX, n.bx + n.r);
      maxY = Math.max(maxY, n.by + n.r);
    });

    return {
      nodes: nodes,
      edges: edges,
      byId: byId,
      bounds: { minX: minX, minY: minY, maxX: maxX, maxY: maxY },
      hub: byId[data.hub] || nodes[0]
    };
  }

  function nodeRadius(n) {
    if (n.id === "conan-edogawa") return 26;
    if (
      n.id === "ran-mouri" ||
      n.id === "ai-haibara" ||
      n.id === "kogoro-mouri" ||
      n.id === "heiji-hattori" ||
      n.id === "kaitou-kid" ||
      n.id === "tooru-amuro" ||
      n.id === "shuichi-akai" ||
      n.id === "gin"
    )
      return 20;
    if (
      n.id === "vermouth" ||
      n.id === "inspector-megure" ||
      n.id === "officer-sato" ||
      n.id === "officer-takagi" ||
      n.id === "kazuha-toyama" ||
      n.id === "professor-agasa" ||
      n.id === "yusaku-kudo" ||
      n.id === "yukiko-kudo" ||
      n.id === "vodka" ||
      n.id === "jodie-starling" ||
      n.id === "sonoko-suzuki"
    )
      return 16;
    return Math.min(11 + Math.min(n.degree * 0.6, 5), 15);
  }

  /* ── portrait grading (bake-time only, never per frame) ─────────── */
  function gradePortrait(canvas, opts) {
    var w = canvas.width,
      h = canvas.height;
    if (!w || !h) return canvas;
    var ctx = canvas.getContext("2d", { willReadFrequently: true });
    var data;
    try {
      data = ctx.getImageData(0, 0, w, h);
    } catch (e) {
      return canvas; // tainted (file://) — keep the ungraded draw
    }
    var px = data.data;
    var dark = hexToRgb(opts.dark || "#000000");
    var light = hexToRgb(opts.light || "#ffffff");
    var contrast = opts.contrast == null ? 1 : opts.contrast;
    var gamma = opts.gamma == null ? 1 : opts.gamma;
    var mix = opts.mix == null ? 1 : opts.mix;
    var lift = opts.lift == null ? 0 : opts.lift;
    for (var i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      var r = px[i] / 255,
        g = px[i + 1] / 255,
        b = px[i + 2] / 255;
      var l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      l = clamp((l - 0.5) * contrast + 0.5 + lift, 0, 1);
      if (gamma !== 1) l = Math.pow(l, gamma);
      var nr = (dark[0] + (light[0] - dark[0]) * l) / 255;
      var ng = (dark[1] + (light[1] - dark[1]) * l) / 255;
      var nb = (dark[2] + (light[2] - dark[2]) * l) / 255;
      px[i] = (r + (nr - r) * mix) * 255;
      px[i + 1] = (g + (ng - g) * mix) * 255;
      px[i + 2] = (b + (nb - b) * mix) * 255;
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function makeCanvas(w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  /* Handed to every theme callback (and exported as DCPHEngine.utils) so a
     theme never has to reach for a global or reimplement bake-time helpers. */
  var THEME_UTILS = {
    clamp: clamp,
    lerp: lerp,
    easeOutCubic: easeOutCubic,
    easeOutQuint: easeOutQuint,
    hash32: hash32,
    rand01: rand01,
    hexToRgb: hexToRgb,
    rgba: rgba,
    makeCanvas: makeCanvas,
    roundRect: roundRect,
    gradePortrait: gradePortrait,
    setFont: setFont,
    setCaps: setCaps,
    measureTracked: measureTracked,
    paintTracked: paintTracked
  };

  /* ── engine ─────────────────────────────────────────────────────── */
  function create(cfg) {
    var data = cfg.data || global.DCPH_DATA;
    var theme = cfg.theme;
    var root = cfg.root;
    var canvas = cfg.canvas;
    var bgEl = cfg.bg;
    var veilEl = cfg.veil;
    var dossierEl = cfg.dossier;
    var slots = cfg.slots || {};
    var a11yEl = cfg.a11y;
    var imgBase = cfg.imgBase || "../public/characters/";

    var ctx = canvas.getContext("2d");
    var graph = buildGraph(data);
    var nodes = graph.nodes,
      edges = graph.edges;
    /*
      nodeScale is how large a theme draws its marks. It is applied here rather
      than inside buildGraph because that graph is cached and shared: baking a
      theme's scale into it would leak one variant's proportions into the next.
      Tier is a statement about importance, so it is already fixed from the
      unscaled radius -- scaling first would silently promote every node into a
      heavier label band. Recomputed from nodeRadius each time, so this stays
      idempotent across repeated create() calls on the cached graph.
    */
    if (theme.nodeScale && theme.nodeScale !== 1) {
      nodes.forEach(function (n) {
        n.r = nodeRadius(n) * theme.nodeScale;
      });
    }
    var reduced = global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var vw = 0,
      vh = 0,
      dpr = 1;
    var cam = { x: 0, y: 0, k: 1 };
    var target = { x: 0, y: 0, k: 1 };
    var homeCam = { x: 0, y: 0, k: 1 };
    var kMin = 0.2,
      kMax = 4;

    var selected = null;
    var hovered = null;
    var focusId = null;
    var filterType = null;
    var searchQuery = "";
    var matches = null; // Set of node ids
    var gesture = false;
    var parked = false;
    var rafId = 0;
    var t0 = performance.now();
    var introT = 0;
    var lastPoke = 0;
    var lastFrame = 0;
    var labelBand = -1;
    var paintError = false;
    var legendOpen = false;

    /* interaction */
    var pointers = new Map();
    var scratchPts = [];
    var panRef = null;
    var dragNode = null;
    var pinch = null;
    var didDrag = false;
    var tapConsumed = false;
    var downAt = 0;
    var downPos = { x: 0, y: 0 };
    var vel = { x: 0, y: 0 };
    var history = [];

    /* baked assets */
    var noiseTile = null;
    var spritesReady = 0;
    var bgBand = null;
    var measure = makeCanvas(8, 8).getContext("2d");

    var listeners = [];

    function on(el, ev, fn, opts) {
      el.addEventListener(ev, fn, opts);
      listeners.push([el, ev, fn, opts]);
    }

    /* ── noise tile: baked once, handed to CSS as a repeating pattern ── */
    function bakeNoise() {
      var size = 200;
      var nz = theme.noise || { color: [255, 255, 255], alpha: 0.05 };
      var block = nz.block || 2;
      var c = makeCanvas(size, size);
      var cx = c.getContext("2d");
      var img = cx.createImageData(size, size);
      var d = img.data;
      var col = nz.color || [255, 255, 255];
      var aMax = nz.alpha == null ? 0.05 : nz.alpha;
      // Blocky low-frequency grain reads as paper/cork tooth; pure per-pixel
      // randomness reads as television static.
      var cells = Math.ceil(size / block);
      var field = new Float32Array(cells * cells);
      for (var k = 0; k < field.length; k++) field[k] = Math.random();
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var i = (y * size + x) * 4;
          var v = field[(((y / block) | 0) * cells) + ((x / block) | 0)];
          var a = v * 0.72 + Math.random() * 0.28;
          if (Math.random() < 0.06) a = Math.random(); // occasional speck
          d[i] = col[0];
          d[i + 1] = col[1];
          d[i + 2] = col[2];
          d[i + 3] = a * aMax * 255;
        }
      }
      cx.putImageData(img, 0, 0);
      return c.toDataURL("image/png");
    }

    /* ── label sprites ─────────────────────────────────────────────── */
    function labelText(n) {
      var t = theme.label.text ? theme.label.text(n) : n.label;
      if (theme.label.upper) t = t.toUpperCase();
      return t;
    }

    function bakeLabel(n) {
      var L = theme.label;
      var size = typeof L.size === "function" ? L.size(n) : L.size;
      var weight = typeof L.weight === "function" ? L.weight(n) : L.weight;
      var family = L.family;
      var font = weight + " " + size + "px " + family;
      var tracking = (L.tracking || 0) * size;
      var text = labelText(n);

      setFont(measure, font);
      setCaps(measure, !!L.smallCaps);
      var tw = measureTracked(measure, text, tracking);

      var plate = L.plate ? L.plate(n) : null;
      var halo = L.halo ? L.halo(n) : null;
      var padX = (plate ? plate.padX : 0) + (halo ? halo.width : 0) + 3;
      var padY = (plate ? plate.padY : 0) + (halo ? halo.width : 0) + 3;
      var lineH = size * 1.34;
      var w = Math.ceil(tw + padX * 2);
      var h = Math.ceil(lineH + padY * 2);

      var c = makeCanvas(w * dpr, h * dpr);
      var cx = c.getContext("2d");
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setFont(cx, font);
      setCaps(cx, !!L.smallCaps);
      cx.textBaseline = "middle";

      if (plate) {
        if (plate.shadow) {
          cx.save();
          cx.shadowColor = plate.shadow;
          cx.shadowBlur = plate.shadowBlur || 6;
          cx.shadowOffsetY = plate.shadowY || 2;
          cx.fillStyle = plate.bg;
          roundRect(cx, padX * 0.35, padY * 0.35, w - padX * 0.7, h - padY * 0.7, plate.radius);
          cx.fill();
          cx.restore();
        }
        cx.fillStyle = plate.bg;
        roundRect(cx, padX * 0.35, padY * 0.35, w - padX * 0.7, h - padY * 0.7, plate.radius);
        cx.fill();
        if (plate.border) {
          cx.strokeStyle = plate.border;
          cx.lineWidth = plate.borderWidth || 1;
          roundRect(
            cx,
            padX * 0.35 + 0.5,
            padY * 0.35 + 0.5,
            w - padX * 0.7 - 1,
            h - padY * 0.7 - 1,
            plate.radius
          );
          cx.stroke();
        }
        if (plate.rule) {
          cx.strokeStyle = plate.rule;
          cx.lineWidth = 1;
          cx.beginPath();
          cx.moveTo(padX * 0.35, h - padY * 0.35 - 2.5);
          cx.lineTo(w - padX * 0.35, h - padY * 0.35 - 2.5);
          cx.stroke();
        }
      }

      var tx = padX;
      var ty = h / 2;
      if (halo) {
        cx.lineJoin = "round";
        cx.lineWidth = halo.width;
        cx.strokeStyle = halo.color;
        paintTracked(cx, text, tx, ty, tracking, "stroke");
      }
      cx.fillStyle = typeof L.color === "function" ? L.color(n) : L.color;
      paintTracked(cx, text, tx, ty, tracking, "fill");

      n.labelSprite = { canvas: c, w: w, h: h };
    }

    function bakeAllLabels() {
      for (var i = 0; i < nodes.length; i++) bakeLabel(nodes[i]);
      labelBand = currentLabelBand();
    }

    /* ── node sprites ──────────────────────────────────────────────── */
    function nodeSpritePx(n) {
      return Math.min(SPRITE_CAP, Math.ceil(2 * SPRITE_S * n.r * dpr * SPRITE_PAD));
    }

    /** CSS size to draw a node sprite at, for a given camera zoom. */
    function spriteCssSize(n, k) {
      if (!n.sprite) return 0;
      return (n.sprite.width / (SPRITE_S * dpr)) * k;
    }

    function bakeNode(n) {
      var px = nodeSpritePx(n);
      n.sprite = theme.bakeNode(n, px, {
        dpr: dpr,
        unit: SPRITE_S * dpr, // device px per world unit
        pad: SPRITE_PAD,
        portrait: n.portrait,
        faction: data.factions[n.faction] || { hue: "#888888", short: "—", label: "—" },
        graph: graph,
        makeCanvas: makeCanvas,
        roundRect: roundRect,
        rgba: rgba,
        hexToRgb: hexToRgb,
        gradePortrait: gradePortrait,
        setFont: setFont,
        setCaps: setCaps,
        measureTracked: measureTracked,
        paintTracked: paintTracked
      });
    }

    function bakeAllNodes() {
      for (var i = 0; i < nodes.length; i++) bakeNode(nodes[i]);
    }

    /* ── portrait loading, chunked so first paint is never blocked ── */
    var portraitQueue = [];
    function loadPortraits() {
      nodes.forEach(function (n) {
        if (!n.img) return;
        var im = new Image();
        im.decoding = "async";
        im.onload = function () {
          portraitQueue.push([n, im]);
          /*
            Waking here is load-bearing. The idle park fires after ~4s, and on a
            slow connection the portraits are still arriving at that point — so
            without this the queue is filled AFTER the loop has stopped and the
            board sits there as 95 empty mounts until the user happens to move
            something. That is exactly the failure this had.
          */
          wake();
        };
        im.onerror = function () {
          n.img = null;
        };
        im.src = imgBase + encodeURIComponent(n.img);
      });
    }

    function drainPortraits(budget) {
      var done = 0;
      while (portraitQueue.length && done < budget) {
        var item = portraitQueue.shift();
        var n = item[0],
          im = item[1];
        var size = Math.max(48, Math.min(256, Math.round(nodeSpritePx(n) * 0.6)));
        var c = makeCanvas(size, size);
        var cx = c.getContext("2d");
        var s = Math.max(size / im.width, size / im.height);
        var dw = im.width * s,
          dh = im.height * s;
        cx.drawImage(im, (size - dw) / 2, (size - dh) / 2, dw, dh);
        /*
          The theme gets to grade the portrait before it is handed to bakeNode.
          This is the hook that turns 94 wildly inconsistent photographs into
          one material, and it is the reason `gradePortrait` is in the theme
          contract at all — for a while it was documented but never invoked.
        */
        if (theme.gradePortrait) theme.gradePortrait(c, n, THEME_UTILS);
        n.portrait = c;
        bakeNode(n);
        spritesReady++;
        done++;
      }
      if (done) {
        var el = slots.hud && slots.hud.querySelector("[data-progress]");
        if (el) el.textContent = spritesReady + "/" + nodes.filter(function (x) { return x.img; }).length;
      }
    }

    /* ── camera ────────────────────────────────────────────────────── */
    /*
      Labels are drawn at a constant *device* size, so the margin a nameplate
      needs around the outermost node is a screen-space constant — not a world
      one. Subtracting that halo from the usable rect before fitting is
      therefore exact, and closed-form:

        k = min((usableW - 2*haloX) / contentW, (usableH - 2*haloY) / contentH)

      `theme.safe` reserves the strips the chrome panels occupy, so the
      establishing shot never hides a node under the title card or the search
      field. Without both of these the outer names get clipped by the frame
      edge, which is the failure the served SVG graph already shipped with.
    */
    function computeHome() {
      var b = graph.bounds;
      var band = theme.camera || {};
      var mobile = vw < 768;
      /*
        `safe` may be a plain object or a function of the viewport. It has to be
        able to vary: the chrome is not the same shape at 390px as at 1440px
        (a cartouche becomes a full-width banner, a legend tray is dropped
        entirely), so a single static inset either reserves space that no
        longer exists or misses space that now does. Getting it wrong is not
        subtle -- the cluster ends up centred in the wrong rectangle and the
        establishing shot is visibly off-centre with dead space at the bottom.
      */
      var sf = typeof theme.safe === "function" ? theme.safe(vw, vh) || {} : theme.safe || {};
      var ux = sf.left || 0,
        uy = sf.top || 0;
      var uw = Math.max(200, vw - ux - (sf.right || 0));
      var uh = Math.max(200, vh - uy - (sf.bottom || 0));
      var haloX = band.labelPadX == null ? 52 : band.labelPadX;
      var haloY = band.labelPadY == null ? 28 : band.labelPadY;
      var cw = b.maxX - b.minX,
        ch = b.maxY - b.minY;
      var fitK = Math.max(
        0.12,
        Math.min((uw - 2 * haloX) / cw, (uh - 2 * haloY) / ch)
      );
      /*
        On a phone the graph is far wider than it is tall, so fitting the whole
        thing at once makes every node unreadably small. The mobile shot
        therefore fills the available HEIGHT and lets the user pan sideways.
        Filling the height matters: at a lower zoom the cluster is centred in a
        tall rectangle and leaves dead bands above and below it, which reads as
        a layout mistake rather than as room to pan. mobileK is a floor, so a
        theme can still ask for more room than the height fill would give.
      */
      var kFill = uh / ch;
      var k = mobile
        ? clamp(
            Math.max(fitK, band.mobileK || 0.5, Math.min(kFill, band.mobileMax || 0.95)),
            band.mobileMin || 0.28,
            band.mobileMax || 0.95
          )
        : clamp(fitK, band.desktopMin || 0.3, band.desktopMax || 1.25);
      var ax = band.anchorX == null ? 0.5 : band.anchorX;
      var ay = band.anchorY == null ? 0.5 : band.anchorY;
      var x, y;
      var fits = cw * k <= uw && ch * k <= uh;
      if (fits) {
        x = ux + (uw - cw * k) / 2 - b.minX * k;
        y = uy + (uh - ch * k) / 2 - b.minY * k;
        // Nudge toward the composition anchor, but never far enough to push
        // content (plus its label halo) out of the usable rect.
        var loX = ux + haloX - b.minX * k,
          hiX = ux + uw - haloX - b.maxX * k;
        var loY = uy + haloY - b.minY * k,
          hiY = uy + uh - haloY - b.maxY * k;
        if (hiX > loX) x = clamp(ux + ax * uw - graph.hub.bx * k, loX, hiX);
        if (hiY > loY) y = clamp(uy + ay * uh - graph.hub.by * k, loY, hiY);
      } else {
        x = ux + (band.anchorX == null ? 0.42 : band.anchorX) * uw - graph.hub.bx * k;
        y = uy + (band.anchorY == null ? 0.52 : band.anchorY) * uh - graph.hub.by * k;
      }
      homeCam = { x: x, y: y, k: k };
      kMin = Math.min(fitK * 0.75, k * 0.55);
      kMax = 4;
      return homeCam;
    }

    function home(instant) {
      var h = computeHome();
      target.x = h.x;
      target.y = h.y;
      target.k = h.k;
      if (instant) {
        cam.x = h.x;
        cam.y = h.y;
        cam.k = h.k;
      }
      schedule();
    }

    function zoomAt(sx, sy, factor, smooth) {
      var k2 = clamp(target.k * factor, kMin, kMax);
      if (k2 === target.k) return;
      var wx = (sx - target.x) / target.k;
      var wy = (sy - target.y) / target.k;
      target.k = k2;
      target.x = sx - wx * k2;
      target.y = sy - wy * k2;
      if (!smooth) {
        cam.k = k2;
        cam.x = target.x;
        cam.y = target.y;
      }
      schedule();
    }

    function focusNode(n, opts) {
      var k = clamp((opts && opts.k) || 1.35, kMin, kMax);
      var ax = opts && opts.ax != null ? opts.ax : vw < 768 ? 0.5 : 0.62;
      var ay = opts && opts.ay != null ? opts.ay : vw < 768 ? 0.32 : 0.5;
      target.k = k;
      target.x = ax * vw - n.bx * k;
      target.y = ay * vh - n.by * k;
      schedule();
    }

    function wake() {
      parked = false;
      lastPoke = performance.now();
      schedule();
    }

    /* ── selection / filter / search ───────────────────────────────── */
    function neighborSet(n) {
      var set = {};
      set[n.id] = 1;
      edges.forEach(function (e) {
        if (e.a === n) set[e.b.id] = 1;
        else if (e.b === n) set[e.a.id] = 1;
      });
      return set;
    }

    function select(n, opts) {
      selected = n;
      focusId = n ? n.id : null;
      renderDossier();
      updateA11yFocus();
      if (n && !(opts && opts.noFocus)) focusNode(n, opts);
      else schedule();
      if (cfg.onSelect) cfg.onSelect(n);
    }

    function setFilter(type) {
      filterType = filterType === type ? null : type;
      // A live filter has to leave the key readable, so opening one opens the
      // tray even if the user had it collapsed.
      if (filterType) legendOpen = true;
      renderLegend();
      schedule();
    }

    function setSearch(q) {
      searchQuery = q || "";
      var needle = searchQuery.trim().toLowerCase();
      if (!needle) {
        matches = null;
      } else {
        matches = {};
        nodes.forEach(function (n) {
          if (
            n.name.toLowerCase().indexOf(needle) >= 0 ||
            n.label.toLowerCase().indexOf(needle) >= 0 ||
            n.role.toLowerCase().indexOf(needle) >= 0 ||
            n.affiliation.toLowerCase().indexOf(needle) >= 0 ||
            n.aliases.some(function (a) {
              return a.toLowerCase().indexOf(needle) >= 0;
            })
          )
            matches[n.id] = 1;
        });
      }
      renderSearch();
      schedule();
    }

    /* ── frame loop ────────────────────────────────────────────────── */
    /*
      `stepping` suspends the rAF chain while tick() drives frames by hand.
      A headless or occluded tab throttles requestAnimationFrame to nothing,
      which makes the board look broken when it is merely unpainted: the
      portraits never drain and no label is ever placed. tick() advances the
      loop on a synthetic clock instead, so a screenshot can be taken of a
      settled board without depending on the compositor.
    */
    var stepping = false;
    function schedule() {
      if (stepping) return;
      if (!rafId) rafId = requestAnimationFrame(frame);
    }

    /*
      A container that measures ~zero at mount is the normal case in a React
      tree: the route renders before layout settles, the panel is still
      collapsed, or the tab is offscreen. Such a reading is NOT a viewport of
      1x1 — it means "not measurable yet", and committing it is destructive:
      it bakes every label and node sprite at 1x1 and re-homes the camera to
      k=0.5, and nothing ever undoes that, because the later real measurement
      looks like an ordinary resize and only re-bakes, never re-homes the
      already-corrupted camera.

      So a degenerate reading is refused outright and we keep asking until the
      box is real. The ResizeObserver alone is not enough here: it fires on
      box changes, and a container that was never laid out can go straight
      from "no box" to its final size in a way that leaves the observer's
      initial 0x0 notification as the only one we ever see. The interval also
      survives a hidden tab, where rAF is throttled away entirely.
    */
    var sizeWatchId = 0;
    var resizeCount = 0;
    var frameCount = 0;
    function armSizeWatch() {
      if (sizeWatchId) return;
      sizeWatchId = setInterval(function () {
        if (resize()) {
          clearInterval(sizeWatchId);
          sizeWatchId = 0;
          schedule();
        }
      }, 150);
    }
    function resize() {
      resizeCount++;
      var rect = root.getBoundingClientRect();
      var w = Math.round(rect.width);
      var h = Math.round(rect.height);
      if (w <= 1 || h <= 1) {
        armSizeWatch();
        return false;
      }
      var d = Math.min(global.devicePixelRatio || 1, DPR_CAP);
      if (w === vw && h === vh && d === dpr) return false;
      if (sizeWatchId) {
        clearInterval(sizeWatchId);
        sizeWatchId = 0;
      }
      vw = w;
      vh = h;
      dpr = d;
      canvas.width = Math.round(vw * dpr);
      canvas.height = Math.round(vh * dpr);
      canvas.style.width = vw + "px";
      canvas.style.height = vh + "px";
      // Label and node sprites are baked at device resolution.
      bakeAllLabels();
      bakeAllNodes();
      bgBand = null;
      var wasHome = Math.abs(cam.k - homeCam.k) < 0.001;
      if (wasHome) home(true);
      else home(false);
      return true;
    }

    function currentLabelBand() {
      var k = cam.k;
      if (k < 0.3) return 0;
      if (k < 0.55) return 1;
      return 2;
    }

    function updatePositions(now, dt) {
      var t = now / 1000;
      var amp = reduced || gesture ? 0 : DRIFT_AMP;
      var i, n;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        if (amp > 0) {
          var p1 = rand01(n.seed, 1) * 6.283;
          var p2 = rand01(n.seed, 2) * 6.283;
          var s1 = 0.28 + rand01(n.seed, 3) * 0.22;
          var s2 = 0.19 + rand01(n.seed, 4) * 0.18;
          n.dx = Math.sin(t * s1 + p1) * amp;
          n.dy = Math.cos(t * s2 + p2) * amp * 0.8;
        } else {
          n.dx = n.dy = 0;
        }
      }
      // Anti-collision: two Gauss-Seidel passes, offset decays home.
      if (cam.k > 0.34) {
        for (var pass = 0; pass < 2; pass++) {
          for (i = 0; i < nodes.length; i++) {
            var a = nodes[i];
            var axp = a.bx + a.ox;
            var ayp = a.by + a.oy;
            for (var j = i + 1; j < nodes.length; j++) {
              var b = nodes[j];
              var dx = b.bx + b.ox - axp;
              var dy = b.by + b.oy - ayp;
              var rr = a.r + b.r + 2;
              var d2 = dx * dx + dy * dy;
              if (d2 >= rr * rr || d2 < 0.0001) continue;
              var d = Math.sqrt(d2);
              var push = (rr - d) * 0.5;
              var ux = dx / d,
                uy = dy / d;
              a.ox -= ux * push;
              a.oy -= uy * push;
              b.ox += ux * push;
              b.oy += uy * push;
            }
          }
        }
        var cap = 16;
        for (i = 0; i < nodes.length; i++) {
          n = nodes[i];
          n.ox = clamp(n.ox, -cap, cap);
          n.oy = clamp(n.oy, -cap, cap);
          n.ox *= 0.995;
          n.oy *= 0.995;
        }
      }
      // Project to screen.
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        var wx = n.bx + n.ox + n.dx;
        var wy = n.by + n.oy + n.dy;
        n.sx = wx * cam.k + cam.x;
        n.sy = wy * cam.k + cam.y;
        n.sr = n.r * cam.k;
        n.visible = n.sx > -80 && n.sx < vw + 80 && n.sy > -80 && n.sy < vh + 80;
      }
    }

    function updateEmphasis() {
      var keep = selected ? neighborSet(selected) : null;
      var i, n;
      for (i = 0; i < nodes.length; i++) {
        n = nodes[i];
        var on = true;
        if (keep) on = !!keep[n.id];
        if (filterType) {
          // incidence is O(degree) via the cached adjacency, not O(edges)
          var inc = false;
          for (var a = 0; a < n.adj.length; a++) {
            if (edges[n.adj[a]].type === filterType) {
              inc = true;
              break;
            }
          }
          if (!inc) on = false;
        }
        n.alpha = on ? 1 : 0.15;
      }
      for (i = 0; i < edges.length; i++) {
        var eg = edges[i];
        var vis = !filterType || eg.type === filterType;
        // With a selection live, keep the induced neighbourhood subgraph.
        if (keep) vis = vis && !!keep[eg.a.id] && !!keep[eg.b.id];
        eg.alpha = vis ? 1 : 0.055;
        eg.emphasis = keep && keep[eg.a.id] && keep[eg.b.id] ? 1 : 0;
      }
    }

    function frame(now) {
      rafId = 0;
      frameCount++;
      var dt = Math.min(64, Math.max(0, now - (lastFrame || now)));
      lastFrame = now;

      // camera glide
      var a = reduced ? 1 : 1 - Math.exp(-dt / CAM_TAU);
      cam.x += (target.x - cam.x) * a;
      cam.y += (target.y - cam.y) * a;
      cam.k += (target.k - cam.k) * a;
      if (Math.abs(target.x - cam.x) < 0.05 && Math.abs(target.y - cam.y) < 0.05 && Math.abs(target.k - cam.k) < 0.0004) {
        cam.x = target.x;
        cam.y = target.y;
        cam.k = target.k;
      }

      if (introT < 1) introT = clamp(introT + dt / (reduced ? 1 : 900), 0, 1);

      drainPortraits(5);
      updatePositions(now, dt);
      updateEmphasis();
      /*
        A throwing theme callback must not be able to stop the board dead. The
        first failure is reported loudly (once, with its stack) and then the
        loop keeps running, so a broken draw pass degrades to a frozen-looking
        layer instead of a canvas that never repaints again.
      */
      try {
        paint(now, dt);
      } catch (err) {
        if (!paintError) {
          paintError = true;
          console.error("DCPHEngine: paint failed", err);
        }
      }

      var band = currentLabelBand();
      if (band !== labelBand) labelBand = band;

      // idle park: stop the loop entirely once nothing is moving
      var settled =
        Math.abs(target.x - cam.x) < 0.1 &&
        Math.abs(target.y - cam.y) < 0.1 &&
        Math.abs(target.k - cam.k) < 0.001 &&
        !gesture &&
        !portraitQueue.length;
      if (reduced || (settled && now - lastPoke > IDLE_PARK_MS && introT >= 1)) {
        parked = true;
        return;
      }
      schedule();
    }

    function paint(now, dt) {
      var t = now / 1000;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, vw, vh);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (theme.beforeWorld)
        theme.beforeWorld(ctx, {
          vw: vw,
          vh: vh,
          cam: cam,
          dpr: dpr,
          t: t,
          dt: dt,
          selected: selected,
          hovered: hovered,
          filterType: filterType,
          focusId: focusId,
          graph: graph,
          data: data
        });

      drawEdges(t, now);
      drawNodes(t, now);
      drawLabels();

      if (theme.afterWorld)
        theme.afterWorld(ctx, {
          vw: vw,
          vh: vh,
          cam: cam,
          dpr: dpr,
          t: t,
          dt: dt,
          selected: selected,
          hovered: hovered,
          filterType: filterType,
          graph: graph,
          data: data
        });

      moveBackground();
    }

    function moveBackground() {
      if (!theme.bgMotion || theme.bgMotion.mode !== "world" || !bgEl) return;
      var tile = theme.bgMotion.tile;
      var band = Math.round(clamp(cam.k, 0.3, 3) * 4) / 4;
      var tilePx = tile * band;
      if (bgBand !== band) {
        bgBand = band;
        /*
          `layers` lets a theme stack the SAME grain tile at several scales —
          fine tooth over coarse mottle is what makes a surface read as paper
          or cork rather than as noise. Every layer stays world-anchored, which
          a single background-size cannot express.
        */
        var layers = theme.bgMotion.layers;
        if (layers && layers.length) {
          var sizes = [];
          for (var li = 0; li < layers.length; li++) sizes.push(tilePx * layers[li] + "px");
          bgEl.style.backgroundSize = sizes.join(", ");
        } else {
          bgEl.style.backgroundSize = tilePx + "px " + tilePx + "px";
        }
        if (theme.bgMotion.secondSize) {
          bgEl.style.setProperty("--tile2", tilePx * theme.bgMotion.secondSize + "px");
        }
      }
      var ox = ((cam.x % tilePx) + tilePx) % tilePx;
      var oy = ((cam.y % tilePx) + tilePx) % tilePx;
      bgEl.style.transform = "translate3d(" + ox.toFixed(1) + "px," + oy.toFixed(1) + "px,0)";
    }

    function drawEdges(t, now) {
      var margin = 90;
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var aN = e.a,
          bN = e.b;
        if (
          (aN.sx < -margin && bN.sx < -margin) ||
          (aN.sx > vw + margin && bN.sx > vw + margin) ||
          (aN.sy < -margin && bN.sy < -margin) ||
          (aN.sy > vh + margin && bN.sy > vh + margin)
        )
          continue;
        var alpha = e.alpha;
        if (introT < 1) alpha *= clamp((introT - 0.25) / 0.6, 0, 1);
        if (alpha < 0.012) continue;
        theme.drawEdge(ctx, e, {
          alpha: alpha,
          k: cam.k,
          t: t,
          emphasis: e.emphasis,
          selected: selected,
          hovered: hovered,
          filterType: filterType,
          focused: focusId
        });
      }
    }

    function drawNodes(t, now) {
      // Two passes instead of a sort: dimmed first so emphasised nodes paint on
      // top, with zero per-frame allocation.
      for (var pass = 0; pass < 2; pass++) {
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (!n.visible) continue;
          var isTop = n.alpha > 0.5 || n === selected;
          if ((pass === 0) === isTop) continue;
          var enter = reduced ? 1 : clamp((introT * 1400 - i * 5) / 700, 0, 1);
          var scale = reduced ? 1 : 0.55 + 0.45 * easeOutQuint(enter);
          var alpha = n.alpha * (reduced ? 1 : clamp(enter * 1.6, 0, 1));
          if (alpha < 0.02) continue;
          theme.drawNode(ctx, n, {
            alpha: alpha,
            scale: scale,
            k: cam.k,
            t: t,
            size: spriteCssSize(n, cam.k) * scale,
            screenR: n.sr * scale,
            selected: n === selected,
            hovered: n === hovered,
            focused: n.id === focusId,
            isMatch: matches ? !!matches[n.id] : false,
            hasFilter: !!filterType,
            dimmed: n.alpha < 1,
            dpr: dpr
          });
        }
      }
    }

    /* ── label placement: greedy, 4 candidates, hysteresis ─────────── */
    var placed = [];
    function drawLabels() {
      if (introT < 1 && !reduced && introT < 0.5) return;
      var L = theme.label;
      var band = currentLabelBand();
      placed.length = 0;
      var cand = [];
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n.visible || !n.labelSprite) continue;
        if (n.tier === 1 && band < 1) continue;
        if (n.tier === 2 && band < 2) continue;
        var forced =
          n === selected ||
          n === hovered ||
          n.id === focusId ||
          (matches && matches[n.id]);
        if (n.tier === 2 && band < 2 && !forced) continue;
        if (n.alpha < 0.5 && !forced) continue;
        var pri = forced ? 100 : n === selected ? 90 : 40 - n.tier * 10 + n.degree * 0.1;
        cand.push([n, pri]);
      }
      cand.sort(function (p, q) {
        return q[1] - p[1];
      });

      var offs = L.offsets || [0, 1, 2, 3];
      var drawn = 0;
      for (var c = 0; c < cand.length && drawn < MAX_LABELS; c++) {
        var node = cand[c][0];
        var sp = node.labelSprite;
        // Constant device size — the whole point of screen-space labels.
        var w = sp.w,
          h = sp.h;
        var gap = node.sr + (L.gap == null ? 7 : L.gap);
        var rects = [
          [node.sx - w / 2, node.sy + gap, w, h],
          [node.sx - w / 2, node.sy - gap - h, w, h],
          [node.sx + gap, node.sy - h / 2, w, h],
          [node.sx - gap - w, node.sy - h / 2, w, h]
        ];
        var chosen = -1;
        // hysteresis: keep last winning offset when it still fits
        var first = node.labelOff >= 0 ? node.labelOff : offs[0];
        var tryOrder = [first].concat(
          offs.filter(function (o) {
            return o !== first;
          })
        );
        for (var oi = 0; oi < tryOrder.length; oi++) {
          var r = rects[tryOrder[oi]];
          /*
            A nameplate must be entirely on screen. The old tolerance let a
            label overhang the frame by 40px, which is only ever visible as a
            name sliced in half at the edge -- it never reads as "there is more
            graph over there", because the graph itself is what says that.
            Dropping the label is the better failure: the node is still there
            and the name returns as soon as it is panned into view.
          */
          if (r[0] < 0 || r[0] + r[2] > vw || r[1] < 0 || r[1] + r[3] > vh) continue;
          if (!collides(r)) {
            chosen = tryOrder[oi];
            break;
          }
        }
        if (chosen < 0) continue;
        node.labelOff = chosen;
        var rect = rects[chosen];
        placed.push(rect);
        var forced2 = node === selected || node === hovered || (matches && matches[node.id]);
        var la = node.alpha < 1 && !forced2 ? 0.55 : 1;
        ctx.globalAlpha = la;
        if (chosen !== 0 && (L.leader !== false)) {
          ctx.strokeStyle = L.leaderColor || "rgba(255,255,255,0.28)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(node.sx, node.sy + (chosen === 1 ? -node.sr * 0.6 : 0));
          ctx.lineTo(rect[0] + rect[2] / 2, rect[1] + rect[3] / 2);
          ctx.stroke();
        }
        ctx.drawImage(sp.canvas, rect[0], rect[1], w, h);
        ctx.globalAlpha = 1;
        drawn++;
      }
      var hudN = slots.hud && slots.hud.querySelector("[data-labels]");
      if (hudN) hudN.textContent = drawn;
    }

    function collides(r) {
      for (var i = 0; i < placed.length; i++) {
        var p = placed[i];
        if (r[0] < p[0] + p[2] && r[0] + r[2] > p[0] && r[1] < p[1] + p[3] && r[1] + r[3] > p[1]) return true;
      }
      return false;
    }

    /* ── input ─────────────────────────────────────────────────────── */
    function localPoint(ev) {
      var rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    }

    function hitTest(sx, sy) {
      var best = null,
        bestD = Infinity;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n.visible) continue;
        var dx = sx - n.sx,
          dy = sy - n.sy;
        var d = Math.sqrt(dx * dx + dy * dy);
        var hit = Math.max(n.sr + 6, 14);
        if (d < hit && d < bestD) {
          best = n;
          bestD = d;
        }
      }
      return best;
    }

    function beginPinch() {
      scratchPts.length = 0;
      pointers.forEach(function (p) {
        scratchPts.push(p);
      });
      var p0 = scratchPts[0],
        p1 = scratchPts[1];
      if (!p0 || !p1) return;
      var mx = (p0.x + p1.x) / 2,
        my = (p0.y + p1.y) / 2;
      pinch = {
        d: Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1,
        mx: mx,
        my: my,
        wx: (mx - cam.x) / cam.k,
        wy: (my - cam.y) / cam.k,
        k: cam.k
      };
      gesture = true;
      vel.x = vel.y = 0;
    }

    function onPointerDown(ev) {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      var p = localPoint(ev);
      pointers.set(ev.pointerId, { x: p.x, y: p.y, type: ev.pointerType });
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (e) {}
      wake();
      if (pointers.size === 2) {
        dragNode = null;
        panRef = null;
        beginPinch();
        return;
      }
      if (pointers.size > 2) return;
      // A tap must stop an in-flight glide exactly, so anchor the target on the
      // current visual position rather than letting inertia carry on.
      target.x = cam.x;
      target.y = cam.y;
      target.k = cam.k;
      var n = hitTest(p.x, p.y);
      didDrag = false;
      downAt = performance.now();
      downPos = { x: p.x, y: p.y };
      history.length = 0;
      history.push({ x: p.x, y: p.y, t: downAt });
      if (n) {
        dragNode = n;
        dragNode._dragStart = { x: n.bx, y: n.by };
        dragNode._down = { x: p.x, y: p.y };
        gesture = true;
      } else {
        panRef = { x: p.x, y: p.y, cx: cam.x, cy: cam.y };
        gesture = true;
      }
    }

    function onPointerMove(ev) {
      var rec = pointers.get(ev.pointerId);
      var p = localPoint(ev);
      if (!rec) {
        // plain hover
        if (pointers.size === 0) {
          var h = hitTest(p.x, p.y);
          if (h !== hovered) {
            hovered = h;
            canvas.style.cursor = h ? "pointer" : "grab";
            schedule();
          }
        }
        return;
      }
      rec.x = p.x;
      rec.y = p.y;
      var now = performance.now();
      history.push({ x: p.x, y: p.y, t: now });
      if (history.length > 8) history.shift();

      if (pointers.size >= 2 && pinch) {
        scratchPts.length = 0;
        pointers.forEach(function (q) {
          scratchPts.push(q);
        });
        var p0 = scratchPts[0],
          p1 = scratchPts[1];
        var d = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
        var mx = (p0.x + p1.x) / 2,
          my = (p0.y + p1.y) / 2;
        var k = clamp(pinch.k * (d / pinch.d), kMin, kMax);
        cam.k = target.k = k;
        cam.x = target.x = mx - pinch.wx * k;
        cam.y = target.y = my - pinch.wy * k;
        didDrag = true;
        schedule();
        return;
      }

      if (dragNode) {
        var dx = (p.x - dragNode._down.x) / cam.k;
        var dy = (p.y - dragNode._down.y) / cam.k;
        if (Math.abs(p.x - downPos.x) > TAP_SLOP || Math.abs(p.y - downPos.y) > TAP_SLOP) didDrag = true;
        dragNode.bx = dragNode._dragStart.x + dx;
        dragNode.by = dragNode._dragStart.y + dy;
        dragNode.ox = dragNode.oy = 0;
        schedule();
        return;
      }

      if (panRef) {
        var ddx = p.x - panRef.x;
        var ddy = p.y - panRef.y;
        if (Math.abs(ddx) > TAP_SLOP || Math.abs(ddy) > TAP_SLOP) didDrag = true;
        cam.x = target.x = panRef.cx + ddx;
        cam.y = target.y = panRef.cy + ddy;
        schedule();
      }
    }

    function onPointerUp(ev) {
      var rec = pointers.get(ev.pointerId);
      pointers.delete(ev.pointerId);
      try {
        canvas.releasePointerCapture(ev.pointerId);
      } catch (e) {}

      if (pointers.size >= 2) {
        beginPinch();
        return;
      }
      if (pointers.size === 1) {
        var rest = null;
        pointers.forEach(function (q) {
          rest = q;
        });
        pinch = null;
        panRef = { x: rest.x, y: rest.y, cx: cam.x, cy: cam.y };
        return;
      }
      pinch = null;
      var wasNode = dragNode;
      var wasPan = panRef;
      dragNode = null;
      panRef = null;
      gesture = false;
      lastPoke = performance.now();

      var now = performance.now();
      var isTap = !didDrag && now - downAt < TAP_MS;
      if (isTap) {
        if (wasNode) {
          select(wasNode);
          tapConsumed = true;
        } else {
          var n = hitTest(downPos.x, downPos.y);
          if (n) {
            select(n);
            tapConsumed = true;
          } else if (selected) {
            select(null);
          }
        }
      } else if (wasPan && !reduced) {
        // Projected inertia into the camera target.
        var v = velocity();
        target.x = cam.x + v.x * PAN_INERTIA_MS;
        target.y = cam.y + v.y * PAN_INERTIA_MS;
      }
      schedule();
    }

    function velocity() {
      if (history.length < 2) return { x: 0, y: 0 };
      var last = history[history.length - 1];
      var ref = null;
      for (var i = history.length - 2; i >= 0; i--) {
        if (last.t - history[i].t >= 70) {
          ref = history[i];
          break;
        }
      }
      if (!ref) ref = history[0];
      var dt = Math.max(1, last.t - ref.t);
      return { x: (last.x - ref.x) / dt * 16.6, y: (last.y - ref.y) / dt * 16.6 };
    }

    function onWheel(ev) {
      ev.preventDefault();
      wake();
      var p = localPoint(ev);
      var unit = ev.deltaMode === 2 ? 400 : ev.deltaMode === 1 ? 16 : 1;
      var dy = ev.deltaY * unit;
      var gain = ev.ctrlKey ? 0.0075 : 0.0016;
      zoomAt(p.x, p.y, Math.exp(-clamp(dy, -220, 220) * gain), true);
    }

    function onKey(ev) {
      if (ev.target && /INPUT|TEXTAREA/.test(ev.target.tagName)) return;
      if (ev.key === "Escape") {
        if (selected) select(null);
        else if (filterType) setFilter(filterType);
      } else if (ev.key === "+" || ev.key === "=") zoomAt(vw / 2, vh / 2, 1.35, true);
      else if (ev.key === "-" || ev.key === "_") zoomAt(vw / 2, vh / 2, 1 / 1.35, true);
      else if (ev.key === "0") home(false);
      else if (ev.key === "f" || ev.key === "F") {
        if (graph.hub) select(graph.hub);
      }
    }

    /* ── chrome ────────────────────────────────────────────────────── */
    var TYPES = ["romance", "family", "friendship", "rivalry", "mentor", "colleague", "secret_identity", "adversary"];
    var TYPE_LABEL = {
      romance: "Romance",
      family: "Family",
      friendship: "Friendship",
      rivalry: "Rivalry",
      mentor: "Mentor",
      colleague: "Colleague",
      secret_identity: "Secret Identity",
      adversary: "Adversary"
    };

    function typeCount(t) {
      var c = 0;
      for (var i = 0; i < edges.length; i++) if (edges[i].type === t) c++;
      return c;
    }

    /*
      The legend is a key, so each swatch has to be a truthful sample of the
      thread it names: same bow, same dash, same knot, same cord highlight.
      A row of flat colour chips would teach nothing about a graph whose types
      are distinguished by geometry as much as by hue.
    */
    function swatchSvg(type) {
      var s = theme.edgeStyle ? theme.edgeStyle(type) : { color: "#fff", width: 2 };
      var w = Math.max(1, Math.min(5.5, s.width));
      var bow = s.bow || 0;
      var cy = 5 + bow * 20;
      var qy = 2.5 + cy * 0.5; // curve's own y at t = 0.5
      var d = bow === 0 ? "M2 5 H28" : "M2 5 Q15 " + cy.toFixed(1) + " 28 5";
      var dash = s.dash ? ' stroke-dasharray="' + s.dash.join(" ") + '"' : "";
      var g =
        '<path d="' + d + '" stroke="' + s.color + '" stroke-width="' + w.toFixed(1) +
        '" stroke-linecap="round" fill="none"' + dash + " />";
      if (s.cord) {
        g +=
          '<path d="' + d + '" stroke="rgba(255,255,255,0.42)" stroke-width="' +
          Math.max(0.6, w * 0.26).toFixed(1) +
          '" stroke-linecap="round" fill="none" transform="translate(0,-0.8)"' + dash + " />";
      }
      if (s.knot === "loop")
        g += '<circle cx="15" cy="' + qy.toFixed(1) + '" r="2.3" fill="none" stroke="' +
          s.color + '" stroke-width="1.2" />';
      else if (s.knot === "pin")
        g += '<circle cx="15" cy="' + qy.toFixed(1) + '" r="1.7" fill="' + s.color + '" />';
      else if (s.knot === "cross")
        g += '<path d="M12.5 ' + (qy - 2.5).toFixed(1) + 'L17.5 ' + (qy + 2.5).toFixed(1) +
          'M17.5 ' + (qy - 2.5).toFixed(1) + 'L12.5 ' + (qy + 2.5).toFixed(1) +
          '" stroke="' + s.color + '" stroke-width="1.3" stroke-linecap="round" />';
      else if (s.knot === "arrow")
        g += '<path d="M24 2.4L27.6 5L24 7.6" fill="none" stroke="' + s.color +
          '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />';
      return '<svg viewBox="0 0 30 10" width="30" height="10" aria-hidden="true">' + g + "</svg>";
    }

    function renderLegend() {
      var host = slots.legend;
      if (!host) return;
      /*
        The panel wrapper belongs to the engine, not the theme: every variant
        styles `.legend` as its own material (card, key box, tray), and a
        legendHead() that had to remember to open the div got it wrong.

        The tray also starts COLLAPSED, behind a small pinned tab. An open key
        panel is ~250x240 of opaque material and, in a graph this evenly dense,
        there is no corner of the board where it hides nothing — so it would
        either cost ~20% of the establishing zoom to reserve a column for it,
        or bury two characters. Collapsed, it costs a tab; opened, it is a
        deliberate act and hiding a node for as long as you read the key is
        exactly what a hand-held card does. This also matches the shipped app,
        where the legend is a popover behind the filter chip.
      */
      var collapsed = theme.legendCollapsible !== false && !legendOpen;
      var html =
        '<div class="legend-wrap' + (collapsed ? "" : " is-open") + '">' +
        '<button type="button" class="legend__tab" data-legend-toggle aria-expanded="' +
        (collapsed ? "false" : "true") +
        '">' +
        (theme.legendTab
          ? theme.legendTab()
          : '<span class="legend__tab-label">Thread key</span>') +
        "</button>" +
        '<div class="legend">' +
        (theme.legendHead ? theme.legendHead() : '<div class="legend__head">Threads</div>') +
        '<ul class="legend__list">';
      for (var i = 0; i < TYPES.length; i++) {
        var t = TYPES[i];
        html +=
          '<li><button type="button" class="legend__item' +
          (filterType === t ? " is-active" : "") +
          '" data-type="' +
          t +
          '" aria-pressed="' +
          (filterType === t) +
          '">' +
          '<span class="legend__swatch">' +
          swatchSvg(t) +
          "</span>" +
          '<span class="legend__label">' +
          (theme.typeLabel ? theme.typeLabel(t) : TYPE_LABEL[t]) +
          "</span>" +
          '<span class="legend__count">' +
          typeCount(t) +
          "</span>" +
          "</button></li>";
      }
      html += "</ul>";
      if (filterType) html += '<button type="button" class="legend__clear">Clear filter</button>';
      host.innerHTML = html + "</div></div>";
    }

    function renderTools() {
      var host = slots.tools;
      if (!host) return;
      host.innerHTML =
        '<div class="tools">' +
        '<button type="button" class="tools__btn" data-act="out" aria-label="Zoom out">–</button>' +
        '<span class="tools__k" data-k>100%</span>' +
        '<button type="button" class="tools__btn" data-act="in" aria-label="Zoom in">+</button>' +
        '<button type="button" class="tools__btn tools__btn--wide" data-act="home">Reset</button>' +
        "</div>";
    }

    function renderSearch() {
      var host = slots.search;
      if (!host) return;
      var results = "";
      if (matches) {
        var ids = Object.keys(matches);
        results =
          '<ul class="search__results" role="listbox">' +
          (ids.length
            ? ids
                .slice(0, 8)
                .map(function (id) {
                  var n = graph.byId[id];
                  return (
                    '<li><button type="button" class="search__hit" data-id="' +
                    id +
                    '"><span class="search__dot" style="background:' +
                    (data.factions[n.faction] || {}).hue +
                    '"></span><span class="search__name">' +
                    n.label +
                    '</span><span class="search__role">' +
                    n.role +
                    "</span></button></li>"
                  );
                })
                .join("")
            : '<li class="search__none">No character matches.</li>') +
          "</ul>";
      }
      host.innerHTML =
        (theme.searchHead ? theme.searchHead() : "") +
        '<div class="search">' +
        '<input class="search__input" type="search" placeholder="' +
        (theme.searchPlaceholder || "Search the cast") +
        '" value="' +
        searchQuery.replace(/"/g, "&quot;") +
        '" aria-label="Search characters" />' +
        "</div>" +
        results;
    }

    function renderHud() {
      var host = slots.hud;
      if (!host) return;
      host.innerHTML = theme.hud
        ? theme.hud()
        : '<div class="hud"><span class="hud__row">zoom <b data-k>100%</b></span>' +
          '<span class="hud__row">labels <b data-labels>0</b></span>' +
          '<span class="hud__row">portraits <b data-progress>0/0</b></span></div>';
    }

    function renderTitle() {
      var host = slots.title;
      if (!host) return;
      host.innerHTML = theme.title();
    }

    function renderDossier() {
      if (!dossierEl) return;
      if (!selected) {
        dossierEl.classList.remove("is-open");
        dossierEl.innerHTML = "";
        dossierEl.setAttribute("aria-hidden", "true");
        return;
      }
      var n = selected;
      var inc = [];
      edges.forEach(function (e) {
        if (e.a === n) inc.push({ e: e, other: e.b, dir: "out" });
        else if (e.b === n) inc.push({ e: e, other: e.a, dir: "in" });
      });
      inc.sort(function (p, q) {
        return q.other.degree - p.other.degree;
      });
      var fac = data.factions[n.faction] || { label: "—", hue: "#888" };
      dossierEl.innerHTML = theme.dossier({
        node: n,
        faction: fac,
        threads: inc,
        typeLabel: TYPE_LABEL,
        swatch: swatchSvg,
        edgeStyle: theme.edgeStyle,
        esc: esc
      });
      dossierEl.classList.add("is-open");
      dossierEl.setAttribute("aria-hidden", "false");
    }

    function esc(s) {
      return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    function renderA11y() {
      if (!a11yEl) return;
      var html = "";
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        html +=
          '<li><button type="button" class="a11y__node" data-id="' +
          n.id +
          '">' +
          esc(n.name) +
          " — " +
          esc(n.role) +
          ", " +
          n.degree +
          " threads</button></li>";
      }
      a11yEl.innerHTML = html;
    }

    function updateA11yFocus() {
      if (!a11yEl) return;
      var btns = a11yEl.querySelectorAll("[data-id]");
      for (var i = 0; i < btns.length; i++) {
        btns[i].setAttribute("aria-current", selected && btns[i].getAttribute("data-id") === selected.id ? "true" : "false");
      }
    }

    /* chrome wiring (delegated) */
    function wireChrome() {
      on(root, "click", function (ev) {
        var t = ev.target;
        if (t.closest && t.closest("[data-legend-toggle]")) {
          legendOpen = !legendOpen;
          renderLegend();
          schedule();
          return;
        }
        var legendBtn = t.closest && t.closest(".legend__item");
        if (legendBtn) {
          setFilter(legendBtn.getAttribute("data-type"));
          return;
        }
        if (t.closest && t.closest(".legend__clear")) {
          filterType = null;
          renderLegend();
          schedule();
          return;
        }
        var toolBtn = t.closest && t.closest(".tools__btn");
        if (toolBtn) {
          var act = toolBtn.getAttribute("data-act");
          if (act === "in") zoomAt(vw / 2, vh / 2, 1.35, true);
          else if (act === "out") zoomAt(vw / 2, vh / 2, 1 / 1.35, true);
          else home(false);
          return;
        }
        var hit = t.closest && t.closest(".search__hit");
        if (hit) {
          var n = graph.byId[hit.getAttribute("data-id")];
          if (n) select(n, { k: Math.max(1.1, cam.k) });
          return;
        }
        var a11yBtn = t.closest && t.closest(".a11y__node");
        if (a11yBtn) {
          var an = graph.byId[a11yBtn.getAttribute("data-id")];
          if (an) {
            hovered = an;
            select(an);
          }
          return;
        }
        if (t.closest && t.closest(".dossier__close")) {
          select(null);
          return;
        }
        var thread = t.closest && t.closest("[data-goto]");
        if (thread) {
          var tn = graph.byId[thread.getAttribute("data-goto")];
          if (tn) select(tn);
        }
      });

      on(root, "input", function (ev) {
        if (ev.target && ev.target.classList.contains("search__input")) {
          setSearch(ev.target.value);
        }
      });

      on(root, "pointerover", function (ev) {
        var a11yBtn = ev.target.closest && ev.target.closest(".a11y__node");
        if (a11yBtn) {
          var n = graph.byId[a11yBtn.getAttribute("data-id")];
          if (n) {
            hovered = n;
            schedule();
          }
        }
      });

      on(root, "focusin", function (ev) {
        var a11yBtn = ev.target.closest && ev.target.closest(".a11y__node");
        if (a11yBtn) {
          var n = graph.byId[a11yBtn.getAttribute("data-id")];
          if (n) {
            hovered = n;
            focusNode(n);
          }
        }
      });
    }

    /* ── boot ──────────────────────────────────────────────────────── */
    function updateHudK() {
      var el = slots.tools && slots.tools.querySelector("[data-k]");
      if (el) el.textContent = Math.round(cam.k * 100) + "%";
      var el2 = slots.hud && slots.hud.querySelector("[data-k]");
      if (el2) el2.textContent = Math.round(cam.k * 100) + "%";
    }

    var hudTimer = setInterval(updateHudK, 120);

    function start() {
      // The noise tile is generated once and handed to CSS, never re-rendered.
      root.style.setProperty("--noise", 'url("' + bakeNoise() + '")');
      loadPortraits();
      bakeAllNodes();
      renderTitle();
      renderLegend();
      renderTools();
      renderSearch();
      renderHud();
      renderA11y();
      wireChrome();

      on(canvas, "pointerdown", onPointerDown);
      on(canvas, "pointermove", onPointerMove);
      on(canvas, "pointerup", onPointerUp);
      on(canvas, "pointercancel", onPointerUp);
      on(canvas, "pointerleave", function (ev) {
        if (pointers.size === 0 && hovered) {
          hovered = null;
          schedule();
        }
      });
      on(canvas, "wheel", onWheel, { passive: false });
      on(canvas, "contextmenu", function (ev) {
        ev.preventDefault();
      });
      on(global, "keydown", onKey);
      on(global, "blur", function () {
        pointers.clear();
        gesture = false;
        panRef = dragNode = pinch = null;
      });
      on(document, "visibilitychange", function () {
        if (document.hidden) parked = true;
        else wake();
      });

      var ro = new ResizeObserver(function () {
        if (resize()) schedule();
      });
      ro.observe(root);
      listeners.push([null, "ro", ro, null]);

      resize();
      home(true);
      lastPoke = performance.now();
      schedule();

      /*
        Both label AND node sprites are baked before webfonts land on a cold
        load, and node art routinely carries type (faction codes, seal glyphs,
        plate identifiers). So the font-ready pass has to re-bake nodes too, or
        the first paint silently ships a fallback face in every one of them.
        Guarded because `loadingdone` fires more than once and re-baking 95
        sprites is not free.
      */
      var fontsBaked = false;
      function fontsReady() {
        if (fontsBaked) return;
        fontsBaked = true;
        bakeAllLabels();
        bakeAllNodes();
        schedule();
      }
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(fontsReady);
        if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", fontsReady);
      } else {
        setTimeout(fontsReady, 400);
      }

      // second pass after images settle
      setTimeout(function () {
        resize();
        wake();
      }, 600);
    }

    start();

    return {
      select: select,
      focus: function (id) {
        var n = graph.byId[id];
        if (n) select(n);
      },
      home: home,
      setFilter: setFilter,
      setSearch: setSearch,
      graph: graph,
      theme: theme,
      /*
        QA surface. vw/vh/dpr are what the renderer actually believes the
        viewport to be — which is the only way to tell a layout bug from a
        paint bug from the outside, since a canvas that was never sized
        looks identical to one that painted nothing.
      */
      stats: function () {
        return {
          k: cam.k,
          labels: placed.length,
          portraits: spritesReady,
          vw: vw,
          vh: vh,
          dpr: dpr,
          resizes: resizeCount,
          frames: frameCount,
          queued: portraitQueue.length,
          parked: parked,
          /*
            Union of every nameplate rect placed this frame, in screen space.
            A label is allowed to overhang the frame by a small tolerance, so
            "is anything clipped" cannot be answered from the camera alone --
            this is the measurement that says whether the establishing fit and
            the label halo actually agree with each other.
          */
          labelBounds: (function () {
            if (!placed.length) return null;
            var l = Infinity,
              t = Infinity,
              r = -Infinity,
              b = -Infinity;
            for (var i = 0; i < placed.length; i++) {
              var q = placed[i];
              if (q[0] < l) l = q[0];
              if (q[1] < t) t = q[1];
              if (q[0] + q[2] > r) r = q[0] + q[2];
              if (q[1] + q[3] > b) b = q[1] + q[3];
            }
            return [Math.round(l), Math.round(t), Math.round(r), Math.round(b)];
          })(),
          /*
            The individual nameplate rects, not just their union. A test that
            samples the canvas has to know where the ink it is NOT looking for
            lives, and every nameplate is opaque plate plus halo.
          */
          labelRects: placed.map(function (q) {
            return [q[0], q[1], q[2], q[3]];
          }),
          rect: [Math.round(root.getBoundingClientRect().width), Math.round(root.getBoundingClientRect().height)]
        };
      },
      /*
        Advance the loop n frames on a synthetic clock. Headless QA only: an
        occluded or headless tab throttles rAF to nothing, so without this a
        screenshot pass can only ever capture the first frame — no portraits
        drained, no labels placed — and the board looks broken when it is
        merely unpainted. Real browsers never call it.
      */
      tick: function (n, stepMs) {
        var step = stepMs || 16.7;
        // Seed from whichever is later so the synthetic clock never runs
        // backwards into the previous frame's timestamp: a negative dt would
        // invert the camera easing and push the view away from its target.
        var t = Math.max(performance.now(), lastFrame);
        stepping = true;
        try {
          for (var i = 0; i < (n || 1); i++) {
            t += step;
            frame(t);
          }
        } finally {
          stepping = false;
        }
        wake();
      },
      destroy: function () {
        clearInterval(hudTimer);
        clearInterval(sizeWatchId);
        sizeWatchId = 0;
        if (rafId) cancelAnimationFrame(rafId);
        listeners.forEach(function (l) {
          if (l[0] === null) l[2].disconnect();
          else l[0].removeEventListener(l[1], l[2], l[3]);
        });
      }
    };
  }

  global.DCPHEngine = {
    create: create,
    utils: THEME_UTILS
  };
})(window);
