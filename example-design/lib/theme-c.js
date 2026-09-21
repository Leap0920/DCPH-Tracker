/*
  Variant C — SIGNAL
  A cold-war signals-intelligence intercept console. The graph is not a map of
  people; it is a live take on a monitored network. Phosphor on glass, every
  thread a channel, every subject a targeting plate, and the whole board is
  being watched by someone who is not in the room.

  The rule that shapes everything here: RELATIONSHIP TYPE IS GEOMETRY.
  All eight channels run the same phosphor green — they are told apart only by
  line weight, dash rhythm, bow, the marker at each end and the glyph at the
  midpoint. Threat red is reserved for the Black Organization, whose threads
  are additionally the only braided, chopped, zig-zag paths on the board. A
  greyscale screenshot still separates all eight, and B.O. reads as the one
  thing that is not the system's colour.

  Per-frame discipline: every colour string, dash array and gradient is built
  at module scope or at bake time. The callbacks allocate nothing, rebuild the
  path rather than the geometry object, and stay inside four stroke calls.
*/
(function (global) {
  "use strict";

  var U = global.DCPHEngine.utils;
  var clamp = U.clamp;
  var makeCanvas = U.makeCanvas;
  var roundRect = U.roundRect;

  /* ── palette ─────────────────────────────────────────────────────── */
  var C = {
    plateHi: "#0A1D18",
    plateLo: "#040D0B",
    phos: "#7BE0B0",
    phosDim: "#4E8F74",
    amber: "#FFB020",
    threat: "#FF2D3F",
    ink: "#D8FBEC"
  };

  /* Pre-built strings. Building an rgba() per edge would allocate per frame,
     so every stroke colour the frame loop needs already exists. */
  var PH = C.phos;
  var PH_GLOW = "rgba(123,224,176,0.10)";
  var PH_LINE = "rgba(123,224,176,0.42)";
  var PH_SOFT = "rgba(123,224,176,0.22)";
  var PH_FAINT = "rgba(123,224,176,0.10)";
  var RED = C.threat;
  var RED_HI = "rgba(255,150,160,0.72)";
  var AMBER_LINE = "rgba(255,176,32,0.75)";
  var PLATE_EDGE = "rgba(123,224,176,0.46)";
  var PLATE_EDGE_BO = "rgba(255,45,63,0.62)";
  var BRACKET = "rgba(123,224,176,0.62)";
  var BRACKET_BO = "rgba(255,45,63,0.7)";

  /*
    ── channel stock ──────────────────────────────────────────────────
    One green, eight geometries. `width` / `dash` / `bow` / `knot` are handed
    to the engine's legend swatch, so the key is a real sample of the thread
    and not a colour chip. `ends` / `mid` / `twin` / `jagged` are the graph's
    own marker vocabulary.

      romance          solid, heavy, bowed out,   dot ends,  ring mid
      family           solid, heaviest, dead straight, bar ends, pin mid
      friendship       solid, thin, slight bow,   no markers
      rivalry          long-dash, bowed back,     converging chevrons, X mid
      mentor           dash-dot rhythm, deepest bow, single chevron at the target end
      colleague        hairline fine-dot telemetry, no markers, faint
      secret_identity  doubled solid trace (twin), bowed back, rings, ring mid
      adversary        RED, chopped, braided zig-zag, X ends, X mid
  */
  var TYPES = {
    romance: {
      color: PH, width: 2.3, bow: 0.17, knot: "loop", mid: "loop", ends: "dot", label: "Romance"
    },
    family: {
      color: PH, width: 3.4, bow: 0.0, knot: "pin", mid: "pin", ends: "bar", label: "Family"
    },
    friendship: {
      color: PH, width: 1.3, bow: 0.09, knot: null, mid: null, ends: null, alpha: 0.84,
      label: "Friendship"
    },
    rivalry: {
      color: PH, width: 1.8, dash: [10, 6], bow: -0.2, knot: "cross", mid: "cross", ends: "chev",
      alpha: 0.9, label: "Rivalry"
    },
    mentor: {
      color: PH, width: 1.9, dash: [13, 4, 2, 4], bow: 0.22, knot: "arrow", mid: null, ends: "arrow",
      label: "Mentor"
    },
    colleague: {
      color: PH, width: 0.85, dash: [1, 4], bow: 0.0, knot: null, mid: null, ends: null, alpha: 0.6,
      label: "Colleague"
    },
    secret_identity: {
      color: PH, width: 1.15, bow: -0.13, knot: "loop", mid: "loop", ends: "ring", twin: true,
      alpha: 0.95, label: "Secret Identity"
    },
    adversary: {
      color: RED, width: 3.0, dash: [2.5, 2.5], bow: 0.06, knot: "cross", mid: "cross", ends: "x",
      twin: true, jagged: true, label: "Adversary"
    }
  };

  var ORDER = [
    "romance", "family", "friendship", "rivalry", "mentor", "colleague", "secret_identity", "adversary"
  ];

  /*
    The one bloom sprite on the board. Built once at module scope — the frame
    loop only ever blits it, additively. Ring-shaped, so it haloes a plate
    instead of washing the feed inside it.
  */
  var GLOW = (function () {
    var S = 160;
    var c = makeCanvas(S, S);
    var g = c.getContext("2d");
    var rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0.0, "rgba(123,224,176,0.00)");
    rg.addColorStop(0.34, "rgba(123,224,176,0.00)");
    rg.addColorStop(0.5, "rgba(123,224,176,0.15)");
    rg.addColorStop(0.62, "rgba(123,224,176,0.30)");
    rg.addColorStop(0.78, "rgba(123,224,176,0.08)");
    rg.addColorStop(1.0, "rgba(123,224,176,0.00)");
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    return c;
  })();

  /* ── scratch geometry (module scope: the frame loop allocates nothing) ── */
  var GX = { ax: 0, ay: 0, bx: 0, by: 0, cx: 0, cy: 0, mx: 0, my: 0, nx: 0, ny: 0, span: 0 };

  /* Eased lock-on. 0 = nothing selected, 1 = reticle closed. */
  var lock = 0;
  var REDUCED = !!(global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches);

  /* ── edge geometry ───────────────────────────────────────────────── */
  /*
    One quadratic per thread, rebuilt from the node records rather than cached
    as an object, so nothing is allocated. `off` shifts the whole curve along
    its own normal — that is how a second strand becomes a parallel trace
    instead of a duplicate line.
  */
  function geom(e, off) {
    var a = e.a,
      b = e.b;
    var ax = a.sx,
      ay = a.sy,
      bx = b.sx,
      by = b.sy;
    var dx = bx - ax,
      dy = by - ay;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len,
      uy = dy / len;
    // Stop short of the plate, not of a circle: the plate is wider than it is
    // tall, so the trim is a touch generous and the thread reads as plugged in.
    var ta = Math.min(a.sr * 0.98, len * 0.42);
    var tb = Math.min(b.sr * 0.98, len * 0.42);
    var x0 = ax + ux * ta,
      y0 = ay + uy * ta;
    var x1 = bx - ux * tb,
      y1 = by - uy * tb;
    var nx = -uy,
      ny = ux;
    var mx = (x0 + x1) * 0.5,
      my = (y0 + y1) * 0.5;
    var sxx = x1 - x0,
      syy = y1 - y0;
    var span = Math.sqrt(sxx * sxx + syy * syy) || 1;
    var d = TYPES[e.type];
    // A lone thread takes its bow from the relationship type; parallel
    // siblings must alternate sides instead, or they would stack.
    var bow = e.solo ? d.bow || 0 : e.curvature;
    var o = bow * span;
    var o2 = off || 0;
    var cxp = mx + nx * o,
      cyp = my + ny * o;
    GX.ax = x0 + nx * o2;
    GX.ay = y0 + ny * o2;
    GX.bx = x1 + nx * o2;
    GX.by = y1 + ny * o2;
    GX.cx = cxp + nx * o2;
    GX.cy = cyp + ny * o2;
    // On-curve midpoint of a quadratic: (P0 + 2C + P1) / 4
    GX.mx = (x0 + 2 * cxp + x1) * 0.25 + nx * o2;
    GX.my = (y0 + 2 * cyp + y1) * 0.25 + ny * o2;
    GX.nx = nx;
    GX.ny = ny;
    GX.span = span;
  }

  function curvePath(ctx) {
    ctx.beginPath();
    ctx.moveTo(GX.ax, GX.ay);
    ctx.quadraticCurveTo(GX.cx, GX.cy, GX.bx, GX.by);
  }

  /* A chopped carrier: the same curve sampled as a hard polyline that
     alternates across the normal. Two of these in antiphase = a braid. */
  var JAG = 7;
  function jagPath(ctx, amp, phase, base) {
    var t, it, x, y, s;
    ctx.beginPath();
    for (var i = 0; i <= JAG; i++) {
      t = i / JAG;
      it = 1 - t;
      x = it * it * GX.ax + 2 * it * t * GX.cx + t * t * GX.bx;
      y = it * it * GX.ay + 2 * it * t * GX.cy + t * t * GX.by;
      s = i === 0 || i === JAG ? 0 : (i % 2 ? 1 : -1) * amp * (phase ? -1 : 1);
      s += base;
      x += GX.nx * s;
      y += GX.ny * s;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
  }

  /* ── markers: each draws into the current path, caller strokes or fills ── */
  function circleAt(ctx, x, y, r) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, 6.2832);
  }
  function barAt(ctx, x, y, nx, ny, s) {
    ctx.moveTo(x - nx * s, y - ny * s);
    ctx.lineTo(x + nx * s, y + ny * s);
  }
  function xAt(ctx, x, y, s) {
    ctx.moveTo(x - s, y - s);
    ctx.lineTo(x + s, y + s);
    ctx.moveTo(x + s, y - s);
    ctx.lineTo(x - s, y + s);
  }
  function chevAt(ctx, x, y, ang, s) {
    var c = Math.cos(ang),
      sn = Math.sin(ang);
    var px = -sn,
      py = c;
    var bx = x - c * s,
      by = y - sn * s;
    ctx.moveTo(bx + px * s * 0.8, by + py * s * 0.8);
    ctx.lineTo(x, y);
    ctx.lineTo(bx - px * s * 0.8, by - py * s * 0.8);
  }

  function endMarksPath(ctx, kind, s, nx, ny) {
    ctx.beginPath();
    if (kind === "dot") {
      circleAt(ctx, GX.ax, GX.ay, s * 0.72);
      circleAt(ctx, GX.bx, GX.by, s * 0.72);
    } else if (kind === "ring") {
      circleAt(ctx, GX.ax, GX.ay, s * 0.8);
      circleAt(ctx, GX.bx, GX.by, s * 0.8);
    } else if (kind === "bar") {
      barAt(ctx, GX.ax, GX.ay, nx, ny, s * 0.8);
      barAt(ctx, GX.bx, GX.by, nx, ny, s * 0.8);
    } else if (kind === "x") {
      xAt(ctx, GX.ax, GX.ay, s * 0.6);
      xAt(ctx, GX.bx, GX.by, s * 0.6);
    } else if (kind === "chev") {
      // rivalry: two barbs turned in on each other
      var dA = Math.atan2(GX.cy - GX.ay, GX.cx - GX.ax);
      var dB = Math.atan2(GX.by - GX.cy, GX.bx - GX.cx);
      chevAt(ctx, GX.ax + Math.cos(dA) * s * 0.5, GX.ay + Math.sin(dA) * s * 0.5, dA, s * 0.85);
      chevAt(ctx, GX.bx - Math.cos(dB) * s * 0.5, GX.by - Math.sin(dB) * s * 0.5, dB + Math.PI, s * 0.85);
    } else if (kind === "arrow") {
      // mentor: a directed downlink — one chevron at the receiving end
      var d2 = Math.atan2(GX.by - GX.cy, GX.bx - GX.cx);
      chevAt(ctx, GX.bx, GX.by, d2, s);
      barAt(ctx, GX.ax, GX.ay, nx, ny, s * 0.6);
    }
  }

  function midMarkPath(ctx, kind, s) {
    ctx.beginPath();
    if (kind === "loop") circleAt(ctx, GX.mx, GX.my, s * 0.9);
    else if (kind === "pin") circleAt(ctx, GX.mx, GX.my, s * 0.55);
    else if (kind === "cross") xAt(ctx, GX.mx, GX.my, s * 0.9);
  }

  /* ── plate art helpers (bake time only) ──────────────────────────── */
  /*
    The 94 source portraits are wildly inconsistent. Forcing them all through
    one hard green duotone is what turns them into one sensor material — the
    plate chrome then carries identity, and the thread carries the relation.

    The grade itself lives in this theme's `gradePortrait` hook, which the
    ENGINE now calls once per portrait, in place, before the portrait is handed
    to bakeNode. This helper therefore just passes the already-graded canvas
    through. It used to copy-and-grade here as well, which double-graded the
    feed the moment the engine started honouring the hook.
  */
  function gradedPortrait(n, h) {
    return h.portrait || null;
  }

  function pad3(v) {
    return v < 10 ? "00" + v : v < 100 ? "0" + v : "" + v;
  }
  /* The subject's bit code: six bits off the node's stable hash, never zero,
     printed on the plate's identifier strip and spelled out in the dossier. */
  function subjectCode(n) {
    return (n.seed % 63) + 1;
  }
  function bits6(v) {
    var s = "";
    for (var i = 5; i >= 0; i--) s += (v >> i) & 1;
    return s;
  }

  /* ── node art ────────────────────────────────────────────────────── */
  /*
    A targeting plate, not a disc. Size is data — the plate is always 1.98r
    wide by 1.86r tall, so `r` still means what it means everywhere else. What
    varies by tier is the trim: bracket length, whether the identifier strip
    carries a bit code, whether it carries the faction short-code at all.
  */
  function bakeNode(n, px, h) {
    var c = h.makeCanvas(px, px);
    var ctx = c.getContext("2d");
    var dpr = h.dpr;
    var R = n.r * h.unit;
    var fac = h.faction || {};
    var hue = fac.hue || C.phos;
    var short = fac.short || "---";
    var bo = n.faction === "BO";
    var tier = n.tier;

    var hw = R * 0.99,
      hh = R * 0.93;
    var band = clamp(R * 0.085, 2 * dpr, 7 * dpr);
    var strip = tier === 0 ? Math.max(9 * dpr, R * 0.28) : tier === 1 ? Math.max(7 * dpr, R * 0.23) : Math.max(4 * dpr, R * 0.17);
    var pad = Math.max(2.5 * dpr, R * 0.085);
    var tickLen = Math.max(2.4 * dpr, tier === 0 ? R * 0.22 : tier === 1 ? R * 0.18 : R * 0.14);
    var tickW = Math.max(1.5 * dpr, R * 0.045);
    var g = Math.max(1.5 * dpr, R * 0.05);

    ctx.save();
    ctx.translate(px / 2, px / 2);
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";

    /* 1 — outer targeting brackets, sitting proud of the plate */
    var bx0 = -hw - g,
      by0 = -hh - g,
      bx1 = hw + g,
      by1 = hh + g;
    ctx.lineWidth = tickW;
    ctx.strokeStyle = bo ? BRACKET_BO : BRACKET;
    ctx.beginPath();
    ctx.moveTo(bx0, by0 + tickLen);
    ctx.lineTo(bx0, by0);
    ctx.lineTo(bx0 + tickLen, by0);
    ctx.moveTo(bx1 - tickLen, by0);
    ctx.lineTo(bx1, by0);
    ctx.lineTo(bx1, by0 + tickLen);
    ctx.moveTo(bx1, by1 - tickLen);
    ctx.lineTo(bx1, by1);
    ctx.lineTo(bx1 - tickLen, by1);
    ctx.moveTo(bx0 + tickLen, by1);
    ctx.lineTo(bx0, by1);
    ctx.lineTo(bx0, by1 - tickLen);
    ctx.stroke();

    /* 2 — plate ground: glass, not paper */
    var rad = R * 0.07;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = R * 0.28;
    ctx.shadowOffsetY = R * 0.08;
    ctx.fillStyle = C.plateLo;
    roundRect(ctx, -hw, -hh, hw * 2, hh * 2, rad);
    ctx.fill();
    ctx.restore();

    var pg = ctx.createLinearGradient(-hw, -hh, hw * 0.4, hh);
    pg.addColorStop(0, C.plateHi);
    pg.addColorStop(0.46, "#081813");
    pg.addColorStop(1, C.plateLo);
    roundRect(ctx, -hw, -hh, hw * 2, hh * 2, rad);
    ctx.fillStyle = pg;
    ctx.fill();

    /* 3 — faction band down the left edge. Faction identity lives here, in
       the pip and in the dossier header — never in the thread. */
    ctx.save();
    roundRect(ctx, -hw, -hh, hw * 2, hh * 2, rad);
    ctx.clip();
    ctx.fillStyle = hue;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(-hw, -hh, band, hh * 2);
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(-hw + band, -hh, Math.max(1, band * 0.4), hh * 2);
    ctx.restore();

    /* 4 — the feed */
    var ax0 = -hw + band + pad,
      ay0 = -hh + pad;
    var ax1 = hw - pad,
      ay1 = hh - strip - pad;
    var aw = ax1 - ax0,
      ah = ay1 - ay0;
    var port = gradedPortrait(n, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ax0, ay0, aw, ah);
    ctx.clip();
    if (port) {
      var s = Math.max(aw / port.width, ah / port.height);
      var dw = port.width * s,
        dh = port.height * s;
      // bias the crop upward: faces sit high in these source stills
      ctx.drawImage(port, ax0 + (aw - dw) * 0.5, ay0 + (ah - dh) * 0.34, dw, dh);
      // one more pass of glass in front of the feed
      ctx.fillStyle = "rgba(2,12,9,0.40)";
      ctx.fillRect(ax0, ay0, aw, ah);
      var vg = ctx.createRadialGradient(
        ax0 + aw * 0.5,
        ay0 + ah * 0.44,
        Math.min(aw, ah) * 0.18,
        ax0 + aw * 0.5,
        ay0 + ah * 0.5,
        Math.max(aw, ah) * 0.74
      );
      vg.addColorStop(0, "rgba(0,0,0,0)");
      vg.addColorStop(1, "rgba(2,10,8,0.6)");
      ctx.fillStyle = vg;
      ctx.fillRect(ax0, ay0, aw, ah);
    } else {
      var fg = ctx.createLinearGradient(ax0, ay0, ax0, ay1);
      fg.addColorStop(0, "#0D2A21");
      fg.addColorStop(1, "#040C0A");
      ctx.fillStyle = fg;
      ctx.fillRect(ax0, ay0, aw, ah);
      ctx.strokeStyle = PH_FAINT;
      ctx.lineWidth = Math.max(1, dpr * 0.8);
      ctx.beginPath();
      for (var hx = ax0 - ah; hx < ax1; hx += Math.max(4, ah * 0.09)) {
        ctx.moveTo(hx, ay1);
        ctx.lineTo(hx + ah, ay0);
      }
      ctx.stroke();
      ctx.font = "600 " + (ah * 0.4).toFixed(1) + "px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(123,224,176,0.55)";
      ctx.fillText(pad3(n.i + 1), ax0 + aw / 2, ay0 + ah / 2);
    }
    /* the refresh structure of the tube, baked into the feed */
    ctx.globalAlpha = 0.17;
    ctx.fillStyle = "#010604";
    for (var yy = ay0; yy < ay1; yy += 3 * dpr) ctx.fillRect(ax0, yy, aw, Math.max(1, dpr * 0.85));
    ctx.globalAlpha = 1;
    ctx.restore();

    /* 5 — aperture frame with reticle ticks */
    ctx.strokeStyle = PH_SOFT;
    ctx.lineWidth = Math.max(1, dpr * 0.8);
    ctx.strokeRect(ax0 + 0.5, ay0 + 0.5, aw - 1, ah - 1);
    var tk = Math.min(aw, ah) * 0.16;
    ctx.beginPath();
    ctx.moveTo(ax0 + aw / 2, ay0);
    ctx.lineTo(ax0 + aw / 2, ay0 + tk);
    ctx.moveTo(ax0 + aw / 2, ay1);
    ctx.lineTo(ax0 + aw / 2, ay1 - tk);
    ctx.moveTo(ax0, ay0 + ah / 2);
    ctx.lineTo(ax0 + tk, ay0 + ah / 2);
    ctx.moveTo(ax1, ay0 + ah / 2);
    ctx.lineTo(ax1 - tk, ay0 + ah / 2);
    ctx.stroke();

    /* 6 — identifier strip: pip, bit code, faction short-code */
    var sy0 = hh - strip;
    var sx0 = -hw + band;
    ctx.fillStyle = "rgba(2,9,7,0.95)";
    ctx.fillRect(sx0, sy0, hw - band + hw, strip);
    ctx.strokeStyle = PH_SOFT;
    ctx.lineWidth = Math.max(1, dpr * 0.7);
    ctx.beginPath();
    ctx.moveTo(sx0, sy0 + 0.5);
    ctx.lineTo(hw, sy0 + 0.5);
    ctx.stroke();

    var ps = Math.max(2 * dpr, strip * 0.4);
    var pxx = sx0 + pad * 1.2;
    ctx.fillStyle = hue;
    ctx.fillRect(pxx, sy0 + (strip - ps) * 0.5, ps, ps);
    var cursor = pxx + ps + pad * 1.5;

    if (tier < 2) {
      var bits = subjectCode(n);
      var cellW = Math.max(1.4, strip * 0.1),
        cellH = strip * 0.46,
        stepX = cellW * 1.9;
      ctx.fillStyle = "rgba(123,224,176,0.8)";
      for (var bi = 0; bi < 6; bi++) {
        if (bits & (32 >> bi)) ctx.fillRect(cursor + bi * stepX, sy0 + (strip - cellH) * 0.5, cellW, cellH);
      }
      cursor += 6 * stepX;
    }

    if (tier === 0) {
      var fs = strip * 0.5;
      ctx.font = "600 " + fs.toFixed(1) + "px 'Archivo Narrow','Arial Narrow',sans-serif";
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(206,255,238,0.82)";
      ctx.fillText(short, hw - pad * 1.4, sy0 + strip * 0.56);
    }

    /* 7 — plate edge, then the glass sheen over everything inside it */
    roundRect(ctx, -hw, -hh, hw * 2, hh * 2, rad);
    ctx.strokeStyle = bo ? PLATE_EDGE_BO : PLATE_EDGE;
    ctx.lineWidth = Math.max(1, dpr * 0.9);
    ctx.stroke();

    ctx.save();
    roundRect(ctx, -hw, -hh, hw * 2, hh * 2, rad);
    ctx.clip();
    var sh = ctx.createLinearGradient(-hw, -hh, hw * 0.5, hh);
    sh.addColorStop(0, "rgba(198,255,236,0.10)");
    sh.addColorStop(0.3, "rgba(198,255,236,0.02)");
    sh.addColorStop(0.5, "rgba(198,255,236,0.00)");
    sh.addColorStop(1, "rgba(0,0,0,0.24)");
    ctx.fillStyle = sh;
    ctx.fillRect(-hw, -hh, hw * 2, hh * 2);
    if (bo) {
      // the one thing on the board that is not the system's colour: a red
      // corner chamfer, cut across the top-left of the plate
      ctx.strokeStyle = "rgba(255,45,63,0.9)";
      ctx.lineWidth = Math.max(2, R * 0.1);
      ctx.beginPath();
      ctx.moveTo(-hw, -hh + R * 0.34);
      ctx.lineTo(-hw + R * 0.34, -hh);
      ctx.stroke();
    }
    ctx.restore();

    ctx.restore();
    return c;
  }

  /* ── selection reticle: the console locking on ───────────────────── */
  function reticle(ctx, sx, sy, sr, lk) {
    var r = sr * (1.95 - 0.3 * lk);
    var tk = sr * 0.55;
    ctx.globalAlpha = 0.2 + 0.8 * lk;
    ctx.strokeStyle = PH;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, 6.2832);
    ctx.stroke();

    // the closing sweep, only while the lock is still taking
    if (lk < 0.999) {
      ctx.globalAlpha = 0.9;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.arc(sx, sy, r, -1.5708, -1.5708 + 6.2832 * lk);
      ctx.stroke();
    }

    ctx.globalAlpha = 0.2 + 0.8 * lk;
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(sx, sy - r);
    ctx.lineTo(sx, sy - r - tk);
    ctx.moveTo(sx, sy + r);
    ctx.lineTo(sx, sy + r + tk);
    ctx.moveTo(sx - r, sy);
    ctx.lineTo(sx - r - tk, sy);
    ctx.moveTo(sx + r, sy);
    ctx.lineTo(sx + r + tk, sy);
    ctx.stroke();

    var c0 = sr * 1.15,
      c1 = r + tk * 0.6;
    ctx.beginPath();
    ctx.moveTo(sx, sy - c0);
    ctx.lineTo(sx, sy - c1);
    ctx.moveTo(sx, sy + c0);
    ctx.lineTo(sx, sy + c1);
    ctx.moveTo(sx - c0, sy);
    ctx.lineTo(sx - c1, sy);
    ctx.moveTo(sx + c0, sy);
    ctx.lineTo(sx + c1, sy);
    ctx.stroke();

    var b = sr * (2.55 - 0.45 * lk);
    var bt = sr * 0.72;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(sx - b, sy - b + bt);
    ctx.lineTo(sx - b, sy - b);
    ctx.lineTo(sx - b + bt, sy - b);
    ctx.moveTo(sx + b - bt, sy - b);
    ctx.lineTo(sx + b, sy - b);
    ctx.lineTo(sx + b, sy - b + bt);
    ctx.moveTo(sx + b, sy + b - bt);
    ctx.lineTo(sx + b, sy + b);
    ctx.lineTo(sx + b - bt, sy + b);
    ctx.moveTo(sx - b + bt, sy + b);
    ctx.lineTo(sx - b, sy + b);
    ctx.lineTo(sx - b, sy + b - bt);
    ctx.stroke();
  }

  function bracketBox(ctx, sx, sy, b, bt, lw, a) {
    ctx.globalAlpha = a;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(sx - b, sy - b + bt);
    ctx.lineTo(sx - b, sy - b);
    ctx.lineTo(sx - b + bt, sy - b);
    ctx.moveTo(sx + b - bt, sy - b);
    ctx.lineTo(sx + b, sy - b);
    ctx.lineTo(sx + b, sy - b + bt);
    ctx.moveTo(sx + b, sy + b - bt);
    ctx.lineTo(sx + b, sy + b);
    ctx.lineTo(sx + b - bt, sy + b);
    ctx.moveTo(sx - b + bt, sy + b);
    ctx.lineTo(sx - b, sy + b);
    ctx.lineTo(sx - b, sy + b - bt);
    ctx.stroke();
  }

  /* ── legend tab: a channel indicator strip ───────────────────────── */
  function miniSwatch(t) {
    var d = TYPES[t];
    var w = Math.min(3.2, Math.max(1, d.width));
    var cy = 5 + (d.bow || 0) * 20;
    var qy = (10 + 2 * cy) / 4;
    var path = d.bow ? "M1 5 Q13 " + cy.toFixed(1) + " 25 5" : "M1 5 H25";
    var dash = d.dash ? ' stroke-dasharray="' + d.dash.join(" ") + '"' : "";
    var s =
      '<svg viewBox="0 0 26 10" width="26" height="10" aria-hidden="true">' +
      '<path d="' + path + '" stroke="' + d.color + '" stroke-width="' + w.toFixed(1) +
      '" fill="none" stroke-linecap="round"' + dash + "/>";
    if (d.twin) {
      s +=
        '<path d="' + path + '" stroke="rgba(206,255,238,0.55)" stroke-width="' +
        Math.max(0.6, w * 0.28).toFixed(1) + '" fill="none" transform="translate(0,-1.7)"' + dash + "/>";
    }
    if (d.knot === "loop")
      s += '<circle cx="13" cy="' + qy.toFixed(1) + '" r="2.1" fill="none" stroke="' + d.color + '" stroke-width="1.1"/>';
    else if (d.knot === "pin") s += '<circle cx="13" cy="' + qy.toFixed(1) + '" r="1.6" fill="' + d.color + '"/>';
    else if (d.knot === "cross")
      s +=
        '<path d="M10.6 ' + (qy - 2.4).toFixed(1) + 'L15.4 ' + (qy + 2.4).toFixed(1) +
        'M15.4 ' + (qy - 2.4).toFixed(1) + 'L10.6 ' + (qy + 2.4).toFixed(1) +
        '" stroke="' + d.color + '" stroke-width="1.3" stroke-linecap="round"/>';
    else if (d.knot === "arrow")
      s += '<path d="M21 2.6L24.8 5L21 7.4" fill="none" stroke="' + d.color +
        '" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';
    return s + "</svg>";
  }

  /* ══ theme ═══════════════════════════════════════════════════════ */
  global.DCPH_THEME_C = {
    id: "c",
    name: "Signal",

    camera: { anchorX: 0.44, anchorY: 0.46, mobileK: 0.5, desktopMax: 1.15 },
    // Strips the relay header, the channel key, the query field and the
    // telemetry bar occupy, so the establishing shot frames the take.
    safe: function (vw) {
      if (vw < 900) return { left: 16, right: 16, top: 122, bottom: 86 };
      return { left: 58, right: 34, top: 36, bottom: 82 };
    },
    bgMotion: { mode: "world", tile: 260 },
    noise: { color: [140, 232, 196], alpha: 0.13, block: 2 },

    /*
      Underlay: the monitored sector frame. One dashed boundary, one bracket
      pass and one tick pass — three strokes for the whole field, and the
      camera transform is already applied so it costs nothing to pan.
    */
    beforeWorld: function (ctx, st) {
      // Reduced motion parks the engine after a single frame, so the reticle
      // must snap closed rather than ease into a half-drawn lock.
      lock = REDUCED ? (st.selected ? 1 : 0) : lock + ((st.selected ? 1 : 0) - lock) * 0.2;
      if (lock < 0.002) lock = 0;

      var b = st.graph.bounds;
      var k = st.cam.k;
      var x0 = (b.minX - 70) * k + st.cam.x,
        y0 = (b.minY - 70) * k + st.cam.y;
      var x1 = (b.maxX + 70) * k + st.cam.x,
        y1 = (b.maxY + 70) * k + st.cam.y;
      if (x1 < -60 || x0 > st.vw + 60 || y1 < -60 || y0 > st.vh + 60) return;

      ctx.save();
      ctx.strokeStyle = PH;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.12;
      ctx.setLineDash([2, 7]);
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.stroke();
      ctx.setLineDash([]);

      var cl = Math.min(42, Math.max(16, (x1 - x0) * 0.045));
      ctx.globalAlpha = 0.34;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + cl);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x0 + cl, y0);
      ctx.moveTo(x1 - cl, y0);
      ctx.lineTo(x1, y0);
      ctx.lineTo(x1, y0 + cl);
      ctx.moveTo(x1, y1 - cl);
      ctx.lineTo(x1, y1);
      ctx.lineTo(x1 - cl, y1);
      ctx.moveTo(x0 + cl, y1);
      ctx.lineTo(x0, y1);
      ctx.lineTo(x0, y1 - cl);
      ctx.stroke();

      ctx.globalAlpha = 0.16;
      ctx.beginPath();
      var steps = 14,
        i,
        tx,
        ty;
      for (i = 1; i < steps; i++) {
        tx = x0 + ((x1 - x0) * i) / steps;
        ctx.moveTo(tx, y0);
        ctx.lineTo(tx, y0 + 8);
        ctx.moveTo(tx, y1);
        ctx.lineTo(tx, y1 - 8);
        ty = y0 + ((y1 - y0) * i) / steps;
        ctx.moveTo(x0, ty);
        ctx.lineTo(x0 + 8, ty);
        ctx.moveTo(x1, ty);
        ctx.lineTo(x1 - 8, ty);
      }
      ctx.stroke();
      ctx.restore();
    },

    /*
      Overlay: phosphor bloom (additive, pre-baked sprite) and the lock-on
      reticle. Nothing here creates a gradient or touches a filter.
    */
    afterWorld: function (ctx, st) {
      var k = st.cam.k;
      if (k > 0.44) {
        var ns = st.graph.nodes;
        var amp = clamp((k - 0.44) * 1.7, 0, 1) * 0.34;
        ctx.globalCompositeOperation = "lighter";
        for (var i = 0; i < ns.length; i++) {
          var n = ns[i];
          if (!n.visible) continue;
          var s = n.sr * 3.3;
          ctx.globalAlpha = amp * (n.alpha > 0.5 ? 1 : 0.22);
          ctx.drawImage(GLOW, n.sx - s * 0.5, n.sy - s * 0.5, s, s);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      if (st.selected) {
        ctx.strokeStyle = PH;
        reticle(ctx, st.selected.sx, st.selected.sy, st.selected.sr, lock);
      }
      ctx.globalAlpha = 1;
    },

    edgeStyle: function (t) {
      var d = TYPES[t];
      return {
        color: d.color,
        width: d.width,
        dash: d.dash,
        bow: d.bow,
        knot: d.knot,
        label: d.label
      };
    },
    typeLabel: function (t) {
      return TYPES[t].label;
    },

    /* The engine's own hook for baking a duotone. It never calls this (see
       report), so bakeNode does the grading itself through h.gradePortrait. */
    /*
      The room is dark and the tube is the only light, so the feed is graded
      DOWN, not up: gamma > 1 sinks the mid-tones, the light end stops well
      short of white, and the aperture gets one more dark wash at bake time.
    */
    gradePortrait: function (canvas, n, h) {
      h.gradePortrait(canvas, {
        dark: "#02100B",
        light: "#A8F5D2",
        contrast: 1.18,
        gamma: 1.45,
        lift: -0.03,
        mix: 0.97
      });
    },

    bakeNode: bakeNode,

    drawNode: function (ctx, n, st) {
      if (!n.sprite) return;
      ctx.save();
      ctx.globalAlpha = st.alpha;
      ctx.drawImage(n.sprite, n.sx - st.size / 2, n.sy - st.size / 2, st.size, st.size);
      // The plate art carries everything; the frame loop only adds the two
      // pieces of state that cannot be baked: a query hit and a hover.
      if (st.isMatch) {
        ctx.strokeStyle = AMBER_LINE;
        bracketBox(ctx, n.sx, n.sy, st.screenR * 2.2, st.screenR * 0.7, 1.4, Math.min(1, st.alpha + 0.3));
      } else if (st.hovered || st.focused) {
        ctx.strokeStyle = PH_LINE;
        bracketBox(ctx, n.sx, n.sy, st.screenR * 2.2, st.screenR * 0.7, 1.2, Math.min(1, st.alpha + 0.2));
      }
      ctx.restore();
    },

    drawEdge: function (ctx, e, st) {
      var d = TYPES[e.type];
      var emph = st.emphasis > 0;
      var alpha = st.alpha * (d.alpha || 1) * (emph ? 1 : 0.93);
      if (alpha < 0.02) return;
      var lw = d.width * (emph ? 1.26 : 1);
      var ms = Math.max(1.7, Math.min(lw * 1.5, 4.6));
      ctx.save();

      if (d.jagged) {
        /* THREAT. The only braided, chopped path on the board: two strands
           in antiphase, heavy dash, hard ends. */
        geom(e, 0);
        var amp = clamp(GX.span * 0.013, 1.1, 3.4);
        ctx.setLineDash(d.dash);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = RED;
        ctx.lineWidth = lw;
        jagPath(ctx, amp, 0, lw * 0.3);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = alpha * 0.5;
        ctx.strokeStyle = RED_HI;
        ctx.lineWidth = Math.max(0.7, lw * 0.26);
        jagPath(ctx, amp, 1, -lw * 0.3);
        ctx.stroke();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = RED;
        ctx.lineWidth = Math.max(1.2, lw * 0.5);
        endMarksPath(ctx, "x", ms, GX.nx, GX.ny);
        ctx.stroke();
        midMarkPath(ctx, "cross", ms);
        ctx.stroke();
        ctx.restore();
        return;
      }

      if (d.twin) {
        /* COVERT. A doubled trace — two thin parallel strands read as one
           instrument measuring something it should not be. */
        geom(e, 0);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = PH;
        ctx.lineWidth = lw;
        curvePath(ctx);
        ctx.stroke();
        geom(e, Math.max(1.5, lw * 2));
        ctx.globalAlpha = alpha * 0.55;
        ctx.lineWidth = Math.max(0.6, lw * 0.7);
        curvePath(ctx);
        ctx.stroke();
        geom(e, 0);
      } else {
        geom(e, 0);
        if (d.glow && st.k > 0.34) {
          ctx.globalAlpha = alpha * 0.8;
          ctx.strokeStyle = PH_GLOW;
          ctx.lineWidth = lw * 2.4 + 2.6;
          curvePath(ctx);
          ctx.stroke();
        }
        if (d.dash) ctx.setLineDash(d.dash);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = PH;
        ctx.lineWidth = lw;
        curvePath(ctx);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      if (d.ends) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = PH;
        ctx.lineWidth = Math.max(1.1, lw * 0.7);
        endMarksPath(ctx, d.ends, ms, GX.nx, GX.ny);
        if (d.ends === "dot") {
          ctx.fillStyle = PH;
          ctx.fill();
        } else ctx.stroke();
      }
      if (d.mid) {
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = PH;
        ctx.lineWidth = Math.max(1.1, lw * 0.7);
        midMarkPath(ctx, d.mid, ms);
        if (d.mid === "pin") {
          ctx.fillStyle = PH;
          ctx.fill();
        } else ctx.stroke();
      }
      ctx.restore();
    },

    /* ── labels: identifier tags, constant device size ─────────────── */
    label: {
      family: "'IBM Plex Mono', ui-monospace, monospace",
      size: function (n) {
        return n.tier === 0 ? 11 : n.tier === 1 ? 10.5 : 10;
      },
      weight: function (n) {
        return n.tier === 0 ? 600 : 500;
      },
      tracking: 0.075,
      upper: true,
      color: function (n) {
        return n.tier === 2 ? "#93D9BE" : "#D2FAE9";
      },
      gap: 9,
      leaderColor: "rgba(123,224,176,0.34)",
      offsets: [0, 2, 1, 3],
      plate: function (n) {
        return {
          bg: n.tier === 2 ? "rgba(4,13,11,0.82)" : "rgba(5,17,14,0.93)",
          border: n.tier === 2 ? "rgba(123,224,176,0.2)" : "rgba(123,224,176,0.4)",
          borderWidth: 1,
          radius: 1,
          padX: 5.5,
          padY: 3,
          shadow: "rgba(0,0,0,0.85)",
          shadowBlur: 5,
          shadowY: 2
        };
      }
    },

    /* ── chrome ────────────────────────────────────────────────────── */
    title: function () {
      var d = global.DCPH_DATA;
      return (
        '<div class="brand">' +
        '<div class="brand__bar">' +
        '<span class="brand__id">SIGINT // RELAY 07</span>' +
        '<span class="brand__live"><i></i>Live</span>' +
        "</div>" +
        '<h1 class="brand__title">Intercept<span>:</span> Beika Ward</h1>' +
        '<div class="brand__tele">' +
        "<span><b id=\"clock\">--:--:--Z</b></span>" +
        "<span>48.0 kS/s</span>" +
        "<span>" + d.nodes.length + " subj</span>" +
        "<span>" + d.edges.length + " lnk</span>" +
        "</div>" +
        "</div>"
      );
    },

    legendHead: function () {
      return (
        '<div class="legend__head">' +
        "<span>Channel key</span>" +
        "<em>CH 01 … 08 · read the geometry, not the colour</em>" +
        "</div>"
      );
    },

    /* Collapsed: the channel indicator. Eight real thread samples, so the
       key is readable without opening the tray. */
    legendTab: function () {
      var ch = "";
      for (var i = 0; i < ORDER.length; i++) ch += '<i class="legend__tab-ch">' + miniSwatch(ORDER[i]) + "</i>";
      return (
        '<span class="legend__tab-label">Signal key</span>' +
        '<span class="legend__tab-dots" aria-hidden="true">' + ch + "</span>" +
        '<span class="legend__tab-hint">8 ch</span>'
      );
    },

    searchPlaceholder: "subject, alias or role",
    searchHead: function () {
      return '<div class="search__head">Intercept query</div>';
    },

    hud: function () {
      return (
        '<div class="hud">' +
        '<span class="hud__cell"><i>grid</i><b data-k>100%</b></span>' +
        '<span class="hud__sep"></span>' +
        '<span class="hud__cell"><i>plates</i><b data-labels>0</b></span>' +
        '<span class="hud__sep"></span>' +
        '<span class="hud__cell"><i>sensors</i><b data-progress>0/0</b></span>' +
        "</div>"
      );
    },

    /* ── dossier: subject intercept file ───────────────────────────── */
    dossier: function (d) {
      var n = d.node;
      var code = "SUBJ-" + pad3(n.i + 1);
      var rows = "";
      for (var i = 0; i < d.threads.length; i++) {
        var t = d.threads[i];
        rows +=
          '<li><button type="button" class="thread thread--' + t.e.type + '" data-goto="' + t.other.id + '">' +
          '<span class="thread__no">' + (i < 9 ? "0" : "") + (i + 1) + "</span>" +
          '<span class="thread__swatch">' + d.swatch(t.e.type) + "</span>" +
          '<span class="thread__body">' +
          '<span class="thread__top">' +
          '<span class="thread__type">' + d.esc(d.typeLabel[t.e.type]) + "</span>" +
          '<span class="thread__name">' + d.esc(t.other.label) + "</span>" +
          "</span>" +
          '<span class="thread__detail">' + d.esc(t.e.detail) + "</span>" +
          "</span>" +
          '<span class="thread__dir">' + (t.dir === "out" ? "&#8594;" : "&#8592;") + "</span>" +
          "</button></li>";
      }
      return (
        '<div class="file">' +
        '<button type="button" class="dossier__close" aria-label="Close intercept file">&#10005;</button>' +
        '<header class="file__hd">' +
        '<div class="file__bar">' +
        '<span class="file__code">File // ' + code + "</span>" +
        '<span class="file__live"><i></i>Intercept active</span>' +
        "</div>" +
        '<h2 class="file__name">' + d.esc(n.label) + "</h2>" +
        (n.aliases.length ? '<p class="file__aka">aka &mdash; ' + d.esc(n.aliases.join(" / ")) + "</p>" : "") +
        '<div class="file__fac"><i style="background:' + d.faction.hue + '"></i>' +
        "<span>" + d.esc(d.faction.label) + "</span><b>" + d.esc(d.faction.short) + "</b></div>" +
        "</header>" +
        '<p class="file__role">' + d.esc(n.role) + "</p>" +
        '<section class="file__brief">' +
        '<span class="file__lbl">Intercepted brief</span>' +
        "<p>" + d.esc(n.bio) + "</p>" +
        "</section>" +
        '<div class="file__meta">' +
        "<span><i>bin</i>" + bits6(subjectCode(n)) + "</span>" +
        "<span><i>ch</i>" + d.esc(d.faction.short) + "-" + pad3(n.i + 1) + "</span>" +
        "<span><i>lnk</i>" + d.threads.length + "</span>" +
        "</div>" +
        '<div class="file__rule"><span>Signal log</span><em>' +
        d.threads.length + (d.threads.length === 1 ? " thread" : " threads") + "</em></div>" +
        '<ul class="file__threads">' + rows + "</ul>" +
        "</div>"
      );
    }
  };
})(window);
