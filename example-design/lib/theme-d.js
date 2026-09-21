/*
  Variant D — HANKO REGISTRY
  A Japanese family-registry document: a black urushi lacquer board with washi
  paper and vermilion seals. The graph is a koseki-like ledger of who is bound
  to whom — the characters are carved seal stamps (hanko), the threads are
  sumi-e brush strokes, and the chrome is paper pasted onto lacquer.

  Three rules shape everything here:

  1. THE BOARD IS BLACK, SO THE INK IS PALE. Sumi on lacquer would be
     invisible; what reads on a black ground is the ink a seal carver leaves
     when he lifts the paper — light, fibrous, laid down in one gesture. Every
     thread is therefore a light ink, and the two colours that matter are
     reserved: VERMILION is the seal red (the red string of fate, one thread
     type, and the stamps), GOLD MAKI-E is the family line and every fine rule.

  2. RELATIONSHIP TYPE IS THE BRUSH, NOT THE COLOUR. Eight types, told apart by
     weight, dryness (broken ink), the bow of the stroke and the terminal mark
     the brush leaves when it lifts — a pressed dot, a bar, a barbed hook, a
     chevron, a ring, a chop. Two of the eight are coloured; all eight separate
     in greyscale.

  3. NOTHING IS COMPUTED IN THE FRAME LOOP. Every colour string, dash array,
     gradient and texture is built at module scope or at bake time. drawEdge
     rebuilds one quadratic and restrokes it; drawNode blits and rings.
*/
(function (global) {
  "use strict";

  var U = global.DCPHEngine.utils;
  var clamp = U.clamp;
  var makeCanvas = U.makeCanvas;
  var roundRect = U.roundRect;
  var rand01 = U.rand01;

  var TAU = 6.283185307179586;

  /* ── palette ─────────────────────────────────────────────────────── */
  var C = {
    lacquer: "#0B0908",
    washi: "#E7DCC4",
    washiHi: "#F4EBD8",
    washiLo: "#CDBE9C",
    vermilion: "#D8382B",
    vermHi: "#EA5A4B",
    vermLo: "#982016",
    vermDeep: "#5E120C",
    gold: "#C9A227",
    goldHi: "#E7C95E",
    sumi: "#171310"
  };

  /* Pre-built strings. Building an rgba() per edge would allocate in the frame
     loop; every colour the loop needs already exists here. */
  var GOLD_LINE = "rgba(201,162,39,0.85)";
  var WASHI_LINE = "rgba(240,231,210,0.62)";
  var VERM_LINE = "rgba(216,56,43,0.92)";
  var RULE = "rgba(201,162,39,0.055)";
  var RULE_MAJOR = "rgba(201,162,39,0.115)";
  var FRAME = "rgba(201,162,39,0.16)";
  var FRAME_IN = "rgba(231,220,196,0.07)";
  var NO_DASH = [];
  var DASH_RIVALRY = [8, 5.5];
  var DASH_MENTOR = [11, 3.4, 2, 3.4];
  var DASH_COLLEAGUE = [1, 3.4];
  var DASH_SECRET = [5, 2.6];
  var DASH_ADVERSARY = [3.4, 2.4];
  var DASH_DUST = [1, 2.3];

  /*
    ── brush stock, one entry per relationship ─────────────────────────
    Each entry is a complete brush: three tones of the same ink (the bleed
    where the ink wicked into the lacquer, the belly, the core), the weight,
    the dryness, the bow, and the mark the brush leaves at each end.

      romance          vermilion, heavy, bowed out, pressed dots
      family           maki-e gold, dead straight, flecked, barred ends
      friendship       pale ink, light, slight bow, no marks
      rivalry          long-broken ink, bowed back, barbed hooks + chop
      mentor           dash-dot, deepest bow, chevron at the receiving end
      colleague        hairline broken ink, no marks
      secret_identity  doubled strand, bowed back, ringed ends + ring
      adversary        black core under a pale rim, chopped, barbed X ends
  */
  var TYPES = {
    romance: {
      core: "rgba(232,110,86,0.98)", mid: "rgba(216,56,43,0.60)", bleed: "rgba(216,56,43,0.16)",
      w: 2.5, bow: 0.16, mark: "dot", label: "Romance",
      key: { color: "#E4705A", width: 2.5, bow: 0.16, knot: "pin" }
    },
    family: {
      core: "rgba(240,214,120,0.95)", mid: "rgba(201,162,39,0.58)", bleed: "rgba(201,162,39,0.15)",
      w: 2.2, bow: 0, mark: "bar", fleck: "rgba(247,229,158,0.55)", label: "Family",
      key: { color: "#D9B23A", width: 2.2, bow: 0, knot: "pin" }
    },
    friendship: {
      core: "rgba(212,202,176,0.80)", mid: "rgba(212,202,176,0.36)", bleed: "rgba(212,202,176,0.10)",
      w: 1.15, bow: 0.085, mark: null, label: "Friendship",
      key: { color: "#CFC5AA", width: 1.15, bow: 0.085 }
    },
    rivalry: {
      core: "rgba(200,188,158,0.90)", mid: "rgba(200,188,158,0.42)", bleed: "rgba(200,188,158,0.11)",
      w: 1.7, bow: -0.21, mark: "hook", dash: DASH_RIVALRY, label: "Rivalry",
      key: { color: "#C6BA9E", width: 1.7, bow: -0.21, dash: DASH_RIVALRY, knot: "cross" }
    },
    mentor: {
      core: "rgba(226,216,190,0.92)", mid: "rgba(226,216,190,0.45)", bleed: "rgba(226,216,190,0.12)",
      w: 1.5, bow: 0.24, mark: "chevron", dash: DASH_MENTOR, label: "Mentor",
      key: { color: "#DED4BC", width: 1.5, bow: 0.24, dash: DASH_MENTOR, knot: "arrow" }
    },
    colleague: {
      core: "rgba(184,174,150,0.58)", mid: "rgba(184,174,150,0.24)", bleed: "rgba(184,174,150,0.06)",
      w: 0.85, bow: 0, mark: null, dash: DASH_COLLEAGUE, label: "Colleague",
      key: { color: "#B6AC92", width: 0.85, dash: DASH_COLLEAGUE }
    },
    secret_identity: {
      core: "rgba(198,186,158,0.86)", mid: "rgba(198,186,158,0.38)", bleed: "rgba(198,186,158,0.09)",
      w: 1.05, bow: -0.15, mark: "ring", dash: DASH_SECRET, twin: true, label: "Secret Identity",
      key: { color: "#C4B89C", width: 1.05, bow: -0.15, dash: DASH_SECRET, knot: "loop" }
    },
    adversary: {
      core: "rgba(8,6,5,0.97)", rim: "rgba(216,206,184,0.80)", bleed: "rgba(216,206,184,0.13)",
      w: 3.3, bow: 0.055, mark: "x", dash: DASH_ADVERSARY, label: "Adversary",
      key: { color: "#0E0B0A", width: 3.3, bow: 0.055, dash: DASH_ADVERSARY, knot: "cross", cord: true }
    }
  };

  var ORDER = [
    "romance", "family", "friendship", "rivalry", "mentor", "colleague", "secret_identity", "adversary"
  ];

  /*
    A seal's silhouette is cut by hand, so every character gets their own. The
    FAMILY (round, square, hexagon, octagon, lobed) comes from the faction —
    which is how affiliation survives a greyscale screenshot without spending
    a colour on it — and the chisel wobble comes from the node's stable seed.
  */
  var SHAPE = {
    JDL: "round", KUDO: "square", OSAKA: "oct", MOURI: "square", SUZUKI: "lobed",
    KID: "hex", TMPD: "square", POLICE: "square", PSB: "oct", FBI: "square",
    MI6: "oct", CIA: "round", BO: "hex", MIYANO: "lobed", CIVILIAN: "round"
  };

  /* ── washi fibre, baked once ─────────────────────────────────────── */
  /* Real washi has visible fibre. A flat beige fill reads as plastic, so one
     tile of strands and flecks is baked at module scope and laid over every
     paper surface the theme paints — the node wells included. */
  var FIBRE = (function () {
    var S = 96;
    var c = makeCanvas(S, S);
    var g = c.getContext("2d");
    var i, x, y, a, len;
    g.lineCap = "round";
    for (i = 0; i < 150; i++) {
      x = Math.random() * S;
      y = Math.random() * S;
      a = (Math.random() < 0.5 ? 0 : Math.PI / 2) + (Math.random() - 0.5) * 0.55;
      len = 5 + Math.random() * 28;
      g.strokeStyle = Math.random() < 0.55 ? "rgba(255,252,242,0.55)" : "rgba(122,100,64,0.26)";
      g.lineWidth = Math.random() < 0.28 ? 1.2 : 0.6;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
    for (i = 0; i < 120; i++) {
      g.fillStyle = "rgba(98,80,52,0.18)";
      g.fillRect(Math.random() * S, Math.random() * S, 1, 1);
    }
    return c;
  })();

  /* ── the carved edge ─────────────────────────────────────────────── */
  function polyK(a, N) {
    var seg = TAU / N;
    var m = a - Math.floor(a / seg) * seg;
    // normalised so the inradius and the circumradius straddle r
    return ((1 + 1 / Math.cos(seg / 2)) / 2) * (Math.cos(seg / 2) / Math.cos(m - seg / 2));
  }
  function baseK(a, fam) {
    if (fam === "square") {
      var c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a));
      return Math.pow(Math.pow(c, 4.5) + Math.pow(s, 4.5), -1 / 4.5) * 1.02;
    }
    if (fam === "hex") return polyK(a, 6);
    if (fam === "oct") return polyK(a, 8);
    if (fam === "lobed") return 1 + 0.05 * Math.cos(a * 8);
    return 1;
  }
  function angDiff(a, b) {
    var d = (a - b + Math.PI) % TAU;
    if (d < 0) d += TAU;
    return Math.abs(d - Math.PI);
  }
  /* The stone: one closed path, hand-cut. A character with aliases carries a
     chipped corner — the seal of someone registered under more than one name. */
  function sealOutline(ctx, r, n, fam, steps) {
    var seed = n.seed;
    var chip = n.aliases && n.aliases.length ? 1 : 0;
    var chipA = rand01(seed, 91) * TAU;
    var h1 = rand01(seed, 5) * TAU, h2 = rand01(seed, 9) * TAU;
    var i, a, k, rr, d;
    ctx.beginPath();
    for (i = 0; i < steps; i++) {
      a = (i / steps) * TAU;
      k = baseK(a, fam);
      k *= 1
        + (rand01(seed, i % 13) - 0.5) * 0.032
        + Math.sin(a * 3 + h1) * 0.013
        + Math.sin(a * 7 + h2) * 0.008;
      if (chip) {
        d = angDiff(a, chipA);
        if (d < 0.4) k -= 0.115 * (1 - d / 0.4);
      }
      rr = r * k;
      if (i) ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
  }

  /* An incised mark: where the carver cut the stone the paper shows through, so
     the glyph is light, with the shadow that falls into its own groove. */
  function carve(ctx, text, x, y, size, weight) {
    ctx.font = weight + " " + size.toFixed(1) + "px 'EB Garamond', Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(74,12,7,0.55)";
    ctx.fillText(text, x, y + size * 0.055);
    ctx.fillStyle = "rgba(248,239,219,0.93)";
    ctx.fillText(text, x, y);
  }

  function initials(label, count) {
    var parts = String(label).split(/[\s·]+/).filter(Boolean);
    var out = "";
    for (var i = 0; i < parts.length && out.length < count; i++) out += parts[i].charAt(0);
    if (!out) out = "?";
    return out.toUpperCase().slice(0, count);
  }

  /* ── the seal ────────────────────────────────────────────────────── */
  function bakeNode(n, px, h) {
    var c = h.makeCanvas(px, px);
    var ctx = c.getContext("2d");
    var R = n.r * h.unit;
    var A = R * 1.03; // the stone's radius
    var dpr = h.dpr;
    var seed = n.seed;
    var fam = SHAPE[n.faction] || "round";
    var tier = n.tier;
    var STEPS = 46;
    var i, a;

    ctx.save();
    ctx.translate(px * 0.5, px * 0.5);

    /* 1 — the shadow the seal casts on the lacquer: a pressed object sits in
       the board, not on it. Tight, so the silhouette stays cut. */
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.85)";
    ctx.shadowBlur = A * 0.30;
    ctx.shadowOffsetX = A * 0.04;
    ctx.shadowOffsetY = A * 0.085;
    ctx.fillStyle = C.vermDeep;
    sealOutline(ctx, A, n, fam, STEPS);
    ctx.fill();
    ctx.restore();

    /* 2 — the stone, lit from the upper left. */
    var g = ctx.createLinearGradient(-A, -A, A * 0.75, A);
    g.addColorStop(0, "#F4705A");
    g.addColorStop(0.38, "#DC4030");
    g.addColorStop(1, "#A3271B");
    sealOutline(ctx, A, n, fam, STEPS);
    ctx.fillStyle = g;
    ctx.fill();

    /* everything below is inside the stone's silhouette */
    ctx.save();
    sealOutline(ctx, A, n, fam, STEPS);
    ctx.clip();

    /* 3 — the stone's own mottle: five soft pools of deeper red */
    for (i = 0; i < 5; i++) {
      var ma = rand01(seed, 200 + i) * TAU;
      var mr = A * (0.2 + rand01(seed, 210 + i) * 0.75);
      var mx = Math.cos(ma) * mr, my = Math.sin(ma) * mr;
      var mg = ctx.createRadialGradient(mx, my, 0, mx, my, A * 0.62);
      mg.addColorStop(0, "rgba(116,18,11,0.20)");
      mg.addColorStop(1, "rgba(116,18,11,0)");
      ctx.fillStyle = mg;
      ctx.fillRect(-A, -A, A * 2, A * 2);
    }

    /* 4 — the chisel: wedge cuts round the rim, which is what stops the edge
       from reading as a vector circle. */
    var facets = 13 + Math.floor(rand01(seed, 300) * 9);
    ctx.lineWidth = Math.max(0.9, A * 0.055);
    ctx.strokeStyle = "rgba(255,206,186,0.20)";
    ctx.beginPath();
    for (i = 0; i < facets; i++) {
      a = (i / facets) * TAU + rand01(seed, 310 + i) * 0.16;
      var k0 = baseK(a, fam) * (0.70 + rand01(seed, 340 + i) * 0.12);
      var k1 = baseK(a, fam) * 0.995;
      ctx.moveTo(Math.cos(a) * A * k0, Math.sin(a) * A * k0);
      ctx.lineTo(Math.cos(a) * A * k1, Math.sin(a) * A * k1);
    }
    ctx.stroke();
    ctx.lineWidth = Math.max(0.9, A * 0.075);
    ctx.strokeStyle = "rgba(84,12,7,0.15)";
    ctx.beginPath();
    for (i = 0; i < facets; i++) {
      a = (i / facets) * TAU + 0.16 + rand01(seed, 370 + i) * 0.24;
      ctx.moveTo(Math.cos(a) * A * 0.52, Math.sin(a) * A * 0.52);
      ctx.lineTo(Math.cos(a) * A * 0.99, Math.sin(a) * A * 0.99);
    }
    ctx.stroke();

    /* 5 — the incised rim: the cut wall in shadow, the far wall catching light,
       then the contour the chisel actually left. */
    ctx.lineWidth = A * 0.19;
    ctx.strokeStyle = "rgba(84,12,7,0.52)";
    sealOutline(ctx, A, n, fam, STEPS);
    ctx.stroke();
    ctx.save();
    ctx.translate(A * 0.028, A * 0.046);
    ctx.lineWidth = A * 0.085;
    ctx.strokeStyle = "rgba(255,158,130,0.34)";
    sealOutline(ctx, A, n, fam, STEPS);
    ctx.stroke();
    ctx.restore();
    ctx.lineWidth = Math.max(1, A * 0.038);
    ctx.strokeStyle = "rgba(52,5,2,0.8)";
    sealOutline(ctx, A * 0.99, n, fam, STEPS);
    ctx.stroke();
    ctx.save();
    ctx.translate(-A * 0.024, -A * 0.034);
    ctx.lineWidth = Math.max(0.9, A * 0.03);
    ctx.strokeStyle = "rgba(255,204,182,0.5)";
    sealOutline(ctx, A * 0.975, n, fam, STEPS);
    ctx.stroke();
    ctx.restore();

    /* 6 — the portrait well: the inked impression, sunk into the stone */
    var wr = A * 0.60;
    var wy = -A * 0.175;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, wy, wr, 0, TAU);
    ctx.clip();
    if (h.portrait) {
      var s = Math.max((wr * 2) / h.portrait.width, (wr * 2) / h.portrait.height);
      var dw = h.portrait.width * s, dh = h.portrait.height * s;
      // faces sit high in these source stills, so the crop is biased upward
      ctx.drawImage(h.portrait, -dw / 2, wy - dh * 0.44, dw, dh);
      /* the print is pulled into the stone: a warm multiply, then a lift, so
         the portrait keeps its face but loses its own photography. */
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "rgba(246,190,150,0.34)";
      ctx.fillRect(-wr, wy - wr, wr * 2, wr * 2);
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(64,34,14,0.22)";
      ctx.fillRect(-wr, wy - wr, wr * 2, wr * 2);
      ctx.globalCompositeOperation = "source-over";
      var vg = ctx.createRadialGradient(0, wy, wr * 0.34, 0, wy, wr * 1.08);
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(64,12,5,0.42)");
      ctx.fillStyle = vg;
      ctx.fillRect(-wr, wy - wr, wr * 2, wr * 2);
    } else {
      ctx.fillStyle = "rgba(46,10,6,0.9)";
      ctx.fillRect(-wr, wy - wr, wr * 2, wr * 2);
      ctx.font = "600 " + (wr * 0.95).toFixed(1) + "px 'EB Garamond', Georgia, serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(240,228,204,0.5)";
      ctx.fillText(initials(n.label, 2), 0, wy);
    }
    /* the paper the print was pulled on */
    ctx.globalAlpha = 0.26;
    ctx.drawImage(FIBRE, -wr, wy - wr, wr * 2, wr * 2);
    ctx.globalAlpha = 1;
    ctx.restore();

    /* the well's cut edge */
    ctx.lineWidth = A * 0.115;
    ctx.strokeStyle = "rgba(72,10,5,0.68)";
    ctx.beginPath();
    ctx.arc(0, wy, wr, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = A * 0.045;
    ctx.strokeStyle = "rgba(255,172,142,0.42)";
    ctx.beginPath();
    ctx.arc(0, wy + A * 0.026, wr * 0.98, 0.45, 2.75);
    ctx.stroke();

    /* 7 — the name plate: a recess cut across the base of the stone, with the
       character's mark incised into it. */
    var wide = tier < 2;
    var bw = A * (wide ? 1.72 : 1.0);
    var bh = A * (wide ? 0.40 : 0.42);
    var by = A * 0.615;
    var pg = ctx.createLinearGradient(0, by - bh * 0.5, 0, by + bh * 0.5);
    pg.addColorStop(0, "rgba(108,16,10,0.6)");
    pg.addColorStop(1, "rgba(168,40,28,0.34)");
    ctx.fillStyle = pg;
    ctx.fillRect(-bw * 0.5, by - bh * 0.5, bw, bh);
    ctx.lineWidth = Math.max(0.9, A * 0.035);
    ctx.strokeStyle = "rgba(76,12,7,0.6)";
    ctx.beginPath();
    ctx.moveTo(-bw * 0.5, by - bh * 0.5);
    ctx.lineTo(bw * 0.5, by - bh * 0.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,158,130,0.3)";
    ctx.beginPath();
    ctx.moveTo(-bw * 0.5, by + bh * 0.5);
    ctx.lineTo(bw * 0.5, by + bh * 0.5);
    ctx.stroke();
    carve(ctx, initials(n.label, wide ? 2 : 1), 0, by, bh * 0.72, "600");

    ctx.restore(); /* end of the stone clip */

    /* 8 — tier accents. Gold maki-e is the highest-value mark on the board, so
       only the principal subject wears it; tier 1 wears a plain washi rule. */
    if (tier === 0) {
      ctx.save();
      ctx.setLineDash(DASH_DUST);
      ctx.lineDashOffset = Math.floor(rand01(seed, 400) * 6);
      ctx.beginPath();
      ctx.arc(0, 0, A * 1.13, 0, TAU);
      ctx.strokeStyle = "rgba(214,178,58,0.8)";
      ctx.lineWidth = Math.max(1.3, A * 0.042);
      ctx.stroke();
      ctx.setLineDash(NO_DASH);
      ctx.restore();
    } else if (tier === 1) {
      ctx.beginPath();
      ctx.arc(0, 0, A * 1.10, 0, TAU);
      ctx.strokeStyle = "rgba(231,220,196,0.34)";
      ctx.lineWidth = Math.max(0.9, A * 0.028);
      ctx.stroke();
    }

    ctx.restore();
    return c;
  }

  /* ── edge geometry: one quadratic, rebuilt from the node records ─── */
  var GX = {
    ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0, mx: 0, my: 0, nx: 0, ny: 0, span: 0,
    m0x: 0, m0y: 0, m1x: 0, m1y: 0, mcx: 0, mcy: 0,
    uax: 0, uay: 0, ubx: 0, uby: 0
  };

  /* off  — a parallel strand (the doubled secret-identity trace)
     wob  — the hand: a small sideways deviation of the belly of the stroke,
            which is what gives a brush edge its irregularity */
  function geom(e, off, wob) {
    var a = e.a, b = e.b;
    var dx = b.sx - a.sx, dy = b.sy - a.sy;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len;
    var nx = -uy, ny = ux;
    var ta = Math.min(a.sr * 0.96, len * 0.42);
    var tb = Math.min(b.sr * 0.96, len * 0.42);
    var x0 = a.sx + ux * ta, y0 = a.sy + uy * ta;
    var x1 = b.sx - ux * tb, y1 = b.sy - uy * tb;
    var mx = (x0 + x1) * 0.5, my = (y0 + y1) * 0.5;
    var sx = x1 - x0, sy = y1 - y0;
    var span = Math.sqrt(sx * sx + sy * sy) || 1;
    var d = TYPES[e.type];
    var bow = e.solo ? d.bow || 0 : e.curvature;
    var o = bow * span + (off || 0);
    var cxp = mx + nx * o, cyp = my + ny * o;
    var w = wob || 0;

    GX.ax = x0 + nx * (off || 0); GX.ay = y0 + ny * (off || 0);
    GX.bx = x1 + nx * (off || 0); GX.by = y1 + ny * (off || 0);
    GX.cx = cxp + nx * w; GX.cy = cyp + ny * w;
    GX.nx = nx; GX.ny = ny; GX.span = span;
    GX.uax = ux; GX.uay = uy; GX.ubx = ux; GX.uby = uy;
    GX.mx = (x0 + 2 * cxp + x1) * 0.25 + nx * (off || 0);
    GX.my = (y0 + 2 * cyp + y1) * 0.25 + ny * (off || 0);

    /* the belly of the stroke: the sub-curve on [0.24, 0.76], by de Casteljau,
       so the wide passes cover only the middle and the ends lift. */
    var t0 = 0.24, t1 = 0.76;
    var a1x = x0 + (cxp - x0) * t0, a1y = y0 + (cyp - y0) * t0;
    var b1x = cxp + (x1 - cxp) * t0, b1y = cyp + (y1 - cyp) * t0;
    var p0x = a1x + (b1x - a1x) * t0, p0y = a1y + (b1y - a1y) * t0;
    var u = (t1 - t0) / (1 - t0);
    GX.mcx = p0x + (b1x - p0x) * u;
    GX.mcy = p0y + (b1y - p0y) * u;
    GX.m0x = p0x; GX.m0y = p0y;
    GX.m1x = GX.mcx + ((b1x + (x1 - b1x) * u) - GX.mcx) * u;
    GX.m1y = GX.mcy + ((b1y + (y1 - b1y) * u) - GX.mcy) * u;
  }

  function fullPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(GX.ax, GX.ay);
    ctx.quadraticCurveTo(GX.cx, GX.cy, GX.bx, GX.by);
  }
  function bellyPath(ctx) {
    ctx.beginPath();
    ctx.moveTo(GX.m0x, GX.m0y);
    ctx.quadraticCurveTo(GX.mcx, GX.mcy, GX.m1x, GX.m1y);
  }

  /* ── the marks a brush leaves when it lifts ──────────────────────── */
  function crossAt(ctx, x, y, s) {
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s, y + s);
  }
  function marksPath(ctx, kind, s) {
    var ax = GX.ax, ay = GX.ay, bx = GX.bx, by = GX.by;
    var nx = GX.nx, ny = GX.ny;
    var ux = GX.uax, uy = GX.uay;
    ctx.beginPath();
    if (kind === "dot") {
      ctx.moveTo(ax + s, ay);
      ctx.arc(ax, ay, s, 0, TAU);
      ctx.moveTo(bx + s, by);
      ctx.arc(bx, by, s, 0, TAU);
    } else if (kind === "bar") {
      ctx.moveTo(ax - nx * s, ay - ny * s);
      ctx.lineTo(ax + nx * s, ay + ny * s);
      ctx.moveTo(bx - nx * s, by - ny * s);
      ctx.lineTo(bx + nx * s, by + ny * s);
      ctx.moveTo(GX.mx + s, GX.my);
      ctx.arc(GX.mx, GX.my, s, 0, TAU);
    } else if (kind === "hook") {
      // two barbs turned in on each other: an argument, not a direction
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax + ux * s * 0.9 + nx * s * 1.15, ay + uy * s * 0.9 + ny * s * 1.15);
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - ux * s * 0.9 + nx * s * 1.15, by - uy * s * 0.9 + ny * s * 1.15);
      crossAt(ctx, GX.mx, GX.my, s * 0.92);
    } else if (kind === "chevron") {
      // mentor: a single chevron where the teaching lands, a bar where it starts
      ctx.moveTo(bx - ux * s - nx * s * 0.82, by - uy * s - ny * s * 0.82);
      ctx.lineTo(bx, by);
      ctx.lineTo(bx - ux * s + nx * s * 0.82, by - uy * s + ny * s * 0.82);
      ctx.moveTo(ax - nx * s * 0.7, ay - ny * s * 0.7);
      ctx.lineTo(ax + nx * s * 0.7, ay + ny * s * 0.7);
    } else if (kind === "ring") {
      ctx.moveTo(ax + s * 0.86, ay);
      ctx.arc(ax, ay, s * 0.86, 0, TAU);
      ctx.moveTo(bx + s * 0.86, by);
      ctx.arc(bx, by, s * 0.86, 0, TAU);
      ctx.moveTo(GX.mx + s * 1.1, GX.my);
      ctx.arc(GX.mx, GX.my, s * 1.1, 0, TAU);
    } else if (kind === "x") {
      crossAt(ctx, ax, ay, s * 0.72);
      crossAt(ctx, bx, by, s * 0.72);
      crossAt(ctx, GX.mx, GX.my, s);
    }
  }

  /* ── selection: a seal being pressed ─────────────────────────────── */
  var press = 1;
  var lastSel = null;
  var pressedId = null;
  var REDUCED = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* down hard, then a small settle: the object is struck, not eased */
  function pressScale(p) {
    if (p >= 1) return 1;
    if (p < 0.27) return 1 - 0.15 * U.easeOutQuint(p / 0.27);
    var u = (p - 0.27) / 0.73;
    var c1 = 1.70158, c3 = c1 + 1;
    var back = 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
    return 0.85 + 0.15 * back;
  }

  /* ══ theme ═══════════════════════════════════════════════════════ */
  global.DCPH_THEME_D = {
    id: "d",
    name: "Hanko Registry",

    camera: {
      anchorX: 0.54, anchorY: 0.5, mobileK: 0.5,
      desktopMin: 0.3, desktopMax: 1.25,
      labelPadX: 58, labelPadY: 26
    },
    /* The vertical title slip down the left edge, the registry lookup at the
       top left, the seal key along the bottom and the tools top right.
       Measured off the panels themselves: the slip is 22+92 wide, the lookup
       22+46 tall, the key band 78 tall above an 18px margin, the tools 53. */
    safe: function (vw) {
      if (vw < 900) return { left: 80, right: 14, top: 92, bottom: 93 };
      return { left: 118, right: 30, top: 74, bottom: 98 };
    },
    bgMotion: { mode: "world", tile: 210, layers: [1, 2.6] },
    noise: { color: [236, 222, 192], alpha: 0.09, block: 3 },

    /*
      Once per frame: the press timer, and the ledger. The ledger is the page
      the registry is written on — fine gold rules incised into the lacquer,
      every fifth one heavier, plus the double frame of the page itself. It is
      drawn under the graph so the seals sit ON the ruled page like inlay.
      One path, two strokes, no allocation.
    */
    beforeWorld: function (ctx, st) {
      if (st.selected !== lastSel) {
        lastSel = st.selected;
        pressedId = st.selected ? st.selected.id : null;
        press = REDUCED ? 1 : 0;
      }
      if (pressedId && press < 1) {
        press = Math.min(1, press + st.dt / 360);
        if (press >= 1) pressedId = null;
      }

      var k = st.cam.k, cx = st.cam.x, cy = st.cam.y;
      var x0 = (-80 - cx) / k, x1 = (st.vw + 80 - cx) / k;
      var y0 = (-80 - cy) / k, y1 = (st.vh + 80 - cy) / k;
      var STEP = 132;
      if ((x1 - x0) / STEP > 260 || (y1 - y0) / STEP > 260) return;

      var i, x, y;
      var gx = Math.floor(x0 / STEP) * STEP;
      var gy = Math.floor(y0 / STEP) * STEP;

      ctx.save();
      ctx.lineWidth = 1;
      ctx.strokeStyle = RULE;
      ctx.beginPath();
      for (x = gx; x <= x1; x += STEP) {
        ctx.moveTo(x * k + cx, y0 * k + cy);
        ctx.lineTo(x * k + cx, y1 * k + cy);
      }
      for (y = gy; y <= y1; y += STEP) {
        ctx.moveTo(x0 * k + cx, y * k + cy);
        ctx.lineTo(x1 * k + cx, y * k + cy);
      }
      ctx.stroke();

      /* every fifth rule is the page's ruling */
      ctx.strokeStyle = RULE_MAJOR;
      ctx.beginPath();
      for (x = gx; x <= x1; x += STEP) {
        if (Math.round(x / STEP) % 5) continue;
        ctx.moveTo(x * k + cx, y0 * k + cy);
        ctx.lineTo(x * k + cx, y1 * k + cy);
      }
      for (y = gy; y <= y1; y += STEP) {
        if (Math.round(y / STEP) % 5) continue;
        ctx.moveTo(x0 * k + cx, y * k + cy);
        ctx.lineTo(x1 * k + cx, y * k + cy);
      }
      ctx.stroke();

      /* the page frame: a double gold rule around the whole register */
      var b = st.graph.bounds;
      var p0x = (b.minX - 62) * k + cx, p0y = (b.minY - 62) * k + cy;
      var p1x = (b.maxX + 62) * k + cx, p1y = (b.maxY + 62) * k + cy;
      if (p1x > -60 && p0x < st.vw + 60 && p1y > -60 && p0y < st.vh + 60) {
        ctx.strokeStyle = FRAME;
        ctx.beginPath();
        ctx.rect(p0x, p0y, p1x - p0x, p1y - p0y);
        ctx.stroke();
        ctx.strokeStyle = FRAME_IN;
        ctx.beginPath();
        ctx.rect(p0x + 5, p0y + 5, p1x - p0x - 10, p1y - p0y - 10);
        ctx.stroke();
        /* corner ticks, the way a register marks its margins */
        var cl = Math.min(30, Math.max(12, (p1x - p0x) * 0.03));
        ctx.strokeStyle = RULE_MAJOR;
        ctx.beginPath();
        ctx.moveTo(p0x, p0y + cl); ctx.lineTo(p0x, p0y); ctx.lineTo(p0x + cl, p0y);
        ctx.moveTo(p1x - cl, p0y); ctx.lineTo(p1x, p0y); ctx.lineTo(p1x, p0y + cl);
        ctx.moveTo(p1x, p1y - cl); ctx.lineTo(p1x, p1y); ctx.lineTo(p1x - cl, p1y);
        ctx.moveTo(p0x + cl, p1y); ctx.lineTo(p0x, p1y); ctx.lineTo(p0x, p1y - cl);
        ctx.stroke();
      }
      ctx.restore();
    },

    edgeStyle: function (t) {
      return TYPES[t].key;
    },
    typeLabel: function (t) {
      return TYPES[t].label;
    },

    /* Sepia, warm and low-contrast: the photograph has been printed onto the
       seal's paper, not pasted on top of it. */
    gradePortrait: function (canvas, n, h) {
      h.gradePortrait(canvas, {
        dark: "#3A1E0B",
        light: "#F6E6C6",
        contrast: 1.04,
        gamma: 0.98,
        mix: 0.72
      });
    },

    bakeNode: bakeNode,

    drawNode: function (ctx, n, st) {
      if (!n.sprite) return;
      var p = n.id === pressedId ? pressScale(press) : 1;
      var lift = st.hovered && !st.selected ? 1.035 : 1;
      var size = st.size * p * lift;
      ctx.save();
      ctx.globalAlpha = st.alpha;
      ctx.drawImage(n.sprite, n.sx - size * 0.5, n.sy - size * 0.5, size, size);

      var r = st.screenR * p;
      if (st.selected) {
        /* the checked entry: a gold rule round the seal and the four corner
           marks a registrar strikes beside it */
        ctx.globalAlpha = 0.92;
        ctx.strokeStyle = GOLD_LINE;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, r * 1.44, 0, TAU);
        ctx.stroke();
        var b = r * 1.78, t = r * 0.34;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.moveTo(n.sx - b, n.sy - b + t); ctx.lineTo(n.sx - b, n.sy - b); ctx.lineTo(n.sx - b + t, n.sy - b);
        ctx.moveTo(n.sx + b - t, n.sy - b); ctx.lineTo(n.sx + b, n.sy - b); ctx.lineTo(n.sx + b, n.sy - b + t);
        ctx.moveTo(n.sx + b, n.sy + b - t); ctx.lineTo(n.sx + b, n.sy + b); ctx.lineTo(n.sx + b - t, n.sy + b);
        ctx.moveTo(n.sx - b + t, n.sy + b); ctx.lineTo(n.sx - b, n.sy + b); ctx.lineTo(n.sx - b, n.sy + b - t);
        ctx.stroke();
      } else if (st.hovered || st.focused) {
        ctx.globalAlpha = 0.72;
        ctx.strokeStyle = WASHI_LINE;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, r * 1.28, 0, TAU);
        ctx.stroke();
      } else if (st.isMatch) {
        ctx.globalAlpha = 0.9;
        ctx.strokeStyle = VERM_LINE;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, r * 1.26, 0, TAU);
        ctx.stroke();
      }
      ctx.restore();
    },

    /*
      Sumi-e. One quadratic, restroked: the belly of the stroke is laid wide and
      faint, then narrower and denser, and the core runs the full length thin so
      the ends lift. That is a brush — a single even stroke is a pen.
    */
    drawEdge: function (ctx, e, st) {
      var d = TYPES[e.type];
      var emph = st.emphasis > 0;
      var alpha = st.alpha * (emph ? 1 : 0.92);
      if (alpha < 0.02) return;
      /* the brush is a physical object on the board, so it thickens a little
         with the camera instead of staying a hairline under magnification */
      var zs = clamp(0.88 + st.k * 0.26, 0.92, 1.95);
      var w = d.w * zs * (emph ? 1.28 : 1);
      var ms = Math.max(1.6, Math.min(w * 1.35, 4.4));
      /* the hand: a small deterministic deviation of the belly, so no two
         strokes have the same edge */
      var wob = (((e.a.seed ^ e.b.seed) & 15) / 15 - 0.5) * w * 0.85;

      ctx.save();
      if (d.dash) ctx.setLineDash(d.dash);

      geom(e, 0, wob);

      if (d.rim) {
        /* adversary: the only black ink on the board, so it is carried on a
           pale rim — a black cable with a lit edge. Chopped, heavy, barbed. */
        ctx.globalAlpha = alpha * 0.30;
        ctx.strokeStyle = d.bleed;
        ctx.lineWidth = w * 2.1;
        bellyPath(ctx);
        ctx.stroke();
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = d.rim;
        ctx.lineWidth = w * 1.1;
        fullPath(ctx);
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = d.core;
        ctx.lineWidth = w * 0.78;
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = d.rim;
        ctx.lineWidth = Math.max(1.1, w * 0.3);
        marksPath(ctx, d.mark, ms * 0.92);
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
        ctx.restore();
        return;
      }

      /* the deposit of ink: laid wide and faint, then narrower and denser, and
         then the core, which is drawn against it with the hand the other way,
         so the stroke has two edges instead of one outline */
      ctx.globalAlpha = alpha * 0.24;
      ctx.strokeStyle = d.bleed;
      ctx.lineWidth = w * 1.85;
      bellyPath(ctx);
      ctx.stroke();

      ctx.globalAlpha = alpha * 0.58;
      ctx.strokeStyle = d.mid;
      ctx.lineWidth = w * 1.14;
      ctx.stroke(); /* same path, restroked: no second geometry pass */

      geom(e, 0, -wob * 0.55);
      if (d.twin) {
        /* covert: a doubled strand, the second trace lighter and offset */
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = d.core;
        ctx.lineWidth = w * 0.58;
        fullPath(ctx);
        ctx.stroke();
        geom(e, Math.max(1.6, w * 2.3), -wob * 0.55);
        ctx.globalAlpha = alpha * 0.5;
        ctx.lineWidth = w * 0.44;
        fullPath(ctx);
        ctx.stroke();
      } else {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = d.core;
        ctx.lineWidth = w * 0.58;
        fullPath(ctx);
        ctx.stroke();
      }

      if (d.fleck) {
        /* maki-e: gold is sprinkled, never laid flat. A broken fine pass over
           the solid stroke is the cheapest honest fleck. */
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = d.fleck;
        ctx.lineWidth = Math.max(0.9, w * 0.42);
        ctx.setLineDash(DASH_DUST);
        ctx.lineDashOffset = (e.a.seed ^ e.b.seed) & 3;
        ctx.stroke();
        ctx.setLineDash(NO_DASH);
        ctx.lineDashOffset = 0;
      }

      if (d.mark) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = d.rim || d.core;
        ctx.lineWidth = Math.max(1.1, w * 0.42);
        marksPath(ctx, d.mark, ms);
        ctx.stroke();
      }
      ctx.restore();
    },

    /* ── labels: washi name plates, ruled like a register ───────────── */
    label: {
      family: "'EB Garamond', Georgia, 'Times New Roman', serif",
      size: function (n) {
        return n.tier === 0 ? 13.5 : n.tier === 1 ? 12.5 : 11.5;
      },
      weight: function (n) {
        return n.tier === 0 ? 700 : 600;
      },
      tracking: 0.015,
      color: function (n) {
        return n.tier === 2 ? "#453A2C" : C.sumi;
      },
      gap: 13,
      leaderColor: "rgba(231,220,196,0.34)",
      offsets: [0, 2, 1, 3],
      plate: function (n) {
        return {
          bg: n.tier === 2 ? "rgba(231,220,196,0.90)" : C.washi,
          border: n.tier === 2 ? "rgba(150,128,94,0.42)" : "rgba(150,128,94,0.62)",
          borderWidth: 1,
          radius: 1.5,
          padX: 8,
          padY: 4,
          shadow: "rgba(0,0,0,0.62)",
          shadowBlur: 6,
          shadowY: 2,
          rule: n.tier === 2 ? null : "rgba(150,128,94,0.45)"
        };
      }
    },

    /* ── chrome ────────────────────────────────────────────────────── */
    title: function () {
      var d = global.DCPH_DATA;
      return (
        '<div class="brand">' +
        '<div class="slip">' +
        '<div class="slip__seal" aria-hidden="true"><span>縁</span></div>' +
        '<div class="slip__cols">' +
        '<h1 class="slip__title">Red Strings</h1>' +
        '<p class="slip__sub">A registry of the bound</p>' +
        '<p class="slip__meta">Detective Conan PH &middot; ' + d.nodes.length + ' subjects &middot; ' +
        d.edges.length + ' threads</p>' +
        "</div>" +
        "</div>" +
        "</div>"
      );
    },

    legendHead: function () {
      return (
        '<div class="legend__head">' +
        '<span>Thread registry</span>' +
        '<em>eight entries &middot; read the brush, not the ink</em>' +
        "</div>"
      );
    },

    /* Collapsed: a washi tag with a red seal on it. */
    legendTab: function () {
      return (
        '<span class="legend__tab-seal" aria-hidden="true"><span>八</span></span>' +
        '<span class="legend__tab-label">Thread registry</span>' +
        '<span class="legend__tab-hint">8 entries</span>'
      );
    },

    searchPlaceholder: "name, alias or calling",
    searchHead: function () {
      return '<div class="search__head">Registry lookup</div>';
    },

    hud: function () {
      return (
        '<div class="hud">' +
        '<span class="hud__cell"><i>plate</i><b data-k>100%</b></span>' +
        '<span class="hud__cell"><i>names</i><b data-labels>0</b></span>' +
        '<span class="hud__cell"><i>prints</i><b data-progress>0/0</b></span>' +
        "</div>"
      );
    },

    /* ── dossier: a page out of the register ───────────────────────── */
    dossier: function (d) {
      var n = d.node;
      var fac = d.faction;
      var rows = "";
      for (var i = 0; i < d.threads.length; i++) {
        var t = d.threads[i];
        rows +=
          '<li><button type="button" class="thread" data-goto="' + t.other.id + '">' +
          '<span class="thread__no">' + (i < 9 ? "0" : "") + (i + 1) + "</span>" +
          '<span class="thread__swatch">' + d.swatch(t.e.type) + "</span>" +
          '<span class="thread__body">' +
          '<span class="thread__type">' + d.esc(d.typeLabel[t.e.type]) +
          '<em>' + (t.dir === "out" ? "out" : "in") + "</em></span>" +
          '<span class="thread__name">' + d.esc(t.other.label) + "</span>" +
          '<span class="thread__detail">' + d.esc(t.e.detail) + "</span>" +
          "</span></button></li>";
      }
      var reg = "REG. " + (n.i < 10 ? "00" : n.i < 100 ? "0" : "") + (n.i + 1);
      return (
        '<div class="file">' +
        '<button type="button" class="dossier__close" aria-label="Close registry page">&#10005;</button>' +
        '<div class="file__seal" aria-hidden="true"><span>' + d.esc(initials(n.label, 2)) + "</span></div>" +
        '<header class="file__head">' +
        '<span class="file__reg">' + reg + "</span>" +
        '<h2 class="file__name">' + d.esc(n.label) + "</h2>" +
        (n.aliases.length
          ? '<p class="file__alias">also registered as &mdash; ' + d.esc(n.aliases.join(" · ")) + "</p>"
          : "") +
        '<p class="file__role">' + d.esc(n.role) + "</p>" +
        '<p class="file__fac"><b>' + d.esc(fac.short || "—") + "</b><span>" + d.esc(fac.label) + "</span></p>" +
        "</header>" +
        '<p class="file__bio">' + d.esc(n.bio) + "</p>" +
        '<div class="file__rule"><span>Threads on record</span><em>' +
        d.threads.length + (d.threads.length === 1 ? " entry" : " entries") + "</em></div>" +
        '<ul class="file__threads">' + rows + "</ul>" +
        "</div>"
      );
    }
  };
})(window);
