/*
  Variant B — CELESTIAL ATLAS
  A copperplate star chart on aged vellum. Every character is a catalogued
  body; every relationship is an "aspect" — the astrologer's term for an angle
  between two bodies — drawn as an engraved line between them.

  The conceit buys three things the other variants do not have:
    · each faction is a CONSTELLATION, and its members are joined by a faint
      figure line the way a star chart joins a figure's stars. Selecting a
      character lights their whole figure.
    · the portrait is an ENGRAVED MEDALLION, so 94 inconsistent photographs
      become one material through a hard sepia grade.
    · the caption sits directly on the paper in a vellum halo, the way names
      are printed on a real chart, rather than on a UI plate.
*/
(function (global) {
  "use strict";
  var U = global.DCPHEngine.utils;
  var clamp = U.clamp,
    rgba = U.rgba,
    makeCanvas = U.makeCanvas,
    roundRect = U.roundRect;

  /* ── palette ────────────────────────────────────────────────────── */
  var C = {
    vellum: "#EFE7D6",
    vellumHi: "#F6F0E2",
    vellumLo: "#DFD3B8",
    vellumEdge: "#C4B392",
    foxing: "#B9A276",
    ink: "#2A2418",
    inkFade: "#6B5F48",
    inkHair: "#8A7C60",
    gold: "#B8892F",
    goldHi: "#D9B24A",
    red: "#A8342E"
  };

  /*
    The eight aspects. Two channels beyond hue carry each one, because an
    engraved plate is read in one ink: WIDTH, DASH, BOW and the terminal
    MARKER (a star of a given magnitude, a barbed end, a cross). Old charts
    also used dotted lines for a conjectural relationship — which is exactly
    what a secret identity is.
  */
  var TYPES = {
    romance: { color: C.red, width: 2.2, bow: 0.14, knot: "star", label: "Romance" },
    family: { color: "#8A6A18", width: 2.6, bow: 0.0, knot: "star2", ribbon: true, label: "Family" },
    friendship: { color: "#3A4A5E", width: 1.5, bow: 0.1, knot: "dot", label: "Friendship" },
    rivalry: { color: "#5A4A6E", width: 1.7, bow: -0.18, dash: [7, 4], knot: "barb", label: "Rivalry" },
    mentor: { color: "#3E5A46", width: 1.7, bow: 0.2, knot: "arrow", label: "Mentor" },
    colleague: { color: C.inkFade, width: 1.0, bow: 0.0, alpha: 0.42, label: "Colleague" },
    secret_identity: { color: "#7A4A6A", width: 1.3, bow: -0.13, dash: [1, 4], knot: "hollow", label: "Secret Identity" },
    // 2.4 was too heavy on paper: near-black at that weight swamped the chart,
    // which is a real risk when the whole plate is one ink.
    adversary: { color: "#241E16", width: 1.9, bow: 0.04, knot: "cross", label: "Adversary" }
  };

  /* Faction → a Bayer-style Greek designation stamped at the head of each
     medallion. The fifth encoding channel, and the reason the chart reads as
     a catalogue rather than a scatter plot. */
  var GREEK = {
    JDL: "α", KUDO: "β", MOURI: "γ", TMPD: "δ", BO: "ε",
    FBI: "ζ", PSB: "η", OSAKA: "θ", POLICE: "ι", KID: "κ",
    SUZUKI: "λ", MIYANO: "μ", MI6: "ν", CIA: "ξ", CIVILIAN: "ο"
  };

  function shade(hex, amt) {
    var c = U.hexToRgb(hex);
    var f = function (v) {
      return Math.round(clamp(amt > 0 ? v + (255 - v) * amt : v * (1 + amt), 0, 255));
    };
    return "rgb(" + f(c[0]) + "," + f(c[1]) + "," + f(c[2]) + ")";
  }

  function initials(label) {
    var parts = String(label).split(/\s+/);
    return ((parts[0] || "?")[0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  /* ── constellation figures ──────────────────────────────────────── */
  /*
    One figure per faction: members ordered by angle around the faction's own
    centroid, then chained. That is a single closed circuit per constellation
    and it needs no solver — cheap, deterministic, and it genuinely looks like
    the stick figure on a star chart. Computed once per graph and cached.
  */
  var figureCache = null;
  var figureKey = null;

  function buildFigures(graph) {
    var byFac = {};
    for (var i = 0; i < graph.nodes.length; i++) {
      var n = graph.nodes[i];
      (byFac[n.faction] || (byFac[n.faction] = [])).push(n);
    }
    var out = [];
    for (var key in byFac) {
      var arr = byFac[key];
      if (arr.length < 3) continue;
      var cx = 0,
        cy = 0;
      for (var j = 0; j < arr.length; j++) {
        cx += arr[j].bx;
        cy += arr[j].by;
      }
      cx /= arr.length;
      cy /= arr.length;
      var sorted = arr.slice().sort(function (p, q) {
        return Math.atan2(p.by - cy, p.bx - cx) - Math.atan2(q.by - cy, q.bx - cx);
      });
      out.push({ key: key, members: sorted });
    }
    return out;
  }

  /* Appends one figure's closed circuit to the CURRENT path, so all fifteen
     rest-state figures are a single stroke call. */
  function appendFigure(ctx, f) {
    for (var j = 0; j < f.members.length; j++) {
      var n = f.members[j];
      if (!j) ctx.moveTo(n.sx, n.sy);
      else ctx.lineTo(n.sx, n.sy);
    }
    ctx.closePath();
  }

  function figures(graph) {
    if (figureKey === graph) return figureCache;
    figureKey = graph;
    figureCache = buildFigures(graph);
    return figureCache;
  }

  /* ── baked sprites ──────────────────────────────────────────────── */
  /*
    The plate-mark vignette under a selected medallion is a radial gradient,
    which is banned inside the frame loop. Baked once, blitted with `lighter`.
  */
  var glowSprite = null;
  function bakeGlow() {
    var S = 128;
    var c = makeCanvas(S, S);
    var cx = c.getContext("2d");
    var g = cx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, "rgba(184,137,47,0.55)");
    g.addColorStop(0.45, "rgba(184,137,47,0.16)");
    g.addColorStop(1, "rgba(184,137,47,0)");
    cx.fillStyle = g;
    cx.fillRect(0, 0, S, S);
    glowSprite = c;
  }

  /* ── markers ────────────────────────────────────────────────────── */
  function star(ctx, x, y, r, points, filled) {
    ctx.beginPath();
    for (var i = 0; i < points * 2; i++) {
      var a = (i / (points * 2)) * 6.2832 - Math.PI / 2;
      var rr = i % 2 ? r * 0.4 : r;
      var px = x + Math.cos(a) * rr,
        py = y + Math.sin(a) * rr;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    if (filled) ctx.fill();
    else ctx.stroke();
  }

  function arrow(ctx, x, y, ang, len) {
    ctx.beginPath();
    ctx.moveTo(x - Math.cos(ang - 0.4) * len, y - Math.sin(ang - 0.4) * len);
    ctx.lineTo(x, y);
    ctx.lineTo(x - Math.cos(ang + 0.4) * len, y - Math.sin(ang + 0.4) * len);
    ctx.stroke();
  }

  function quadPoint(ax, ay, cx, cy, bx, by, t) {
    var it = 1 - t;
    return { x: it * it * ax + 2 * it * t * cx + t * t * bx, y: it * it * ay + 2 * it * t * cy + t * t * by };
  }

  /* Engraved line between two bodies. Trims to the medallion rim, bows by the
     type's aspect, and sags very slightly — a line drawn on paper with a
     straightedge has no sag, so this sag is deliberately tiny. */
  function aspectPath(ctx, a, b, e, st, dy) {
    var ax = a.sx,
      ay = a.sy,
      bx = b.sx,
      by = b.sy;
    var dx = bx - ax,
      dy2 = by - ay;
    var len = Math.hypot(dx, dy2) || 1;
    var ux = dx / len,
      uy = dy2 / len;
    var ta = Math.min(a.sr * 1.02, len * 0.4);
    var tb = Math.min(b.sr * 1.02, len * 0.4);
    var x0 = ax + ux * ta,
      y0 = ay + uy * ta;
    var x1 = bx - ux * tb,
      y1 = by - uy * tb;
    var mx = (x0 + x1) / 2,
      my = (y0 + y1) / 2;
    var span = Math.hypot(x1 - x0, y1 - y0) || 1;
    var curv = e.solo ? TYPES[e.type].bow || 0 : e.curvature;
    var off = curv * span;
    var cxp = mx + -uy * off;
    var cyp = my + ux * off;
    var o = dy || 0;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + o);
    ctx.quadraticCurveTo(cxp, cyp + o, x1, y1 + o);
    return { x0: x0, y0: y0, x1: x1, y1: y1, cx: cxp, cy: cyp, mx: mx, my: my, span: span };
  }

  /* ── theme ──────────────────────────────────────────────────────── */
  global.DCPH_THEME_B = {
    id: "b",
    name: "Celestial Atlas",

    camera: { anchorX: 0.44, anchorY: 0.5, mobileK: 0.5, desktopMin: 0.32, desktopMax: 1.3 },
    // The chart is printed edge to edge; only a hair of margin, so the plate
    // mark stays just inside the frame.
    /*
      The cartouche is a full-width banner on a phone (114px tall against 20px
      of margin on the desktop), so the reserved top strip has to grow with it
      or the cluster is framed under the plate.
    */
    safe: function (vw) {
      if (vw < 900) return { left: 16, right: 16, top: 152, bottom: 89 };
      return { left: 16, right: 16, top: 16, bottom: 16 };
    },
    bgMotion: { mode: "world", tile: 200, layers: [1, 3.4] },
    // Warm tooth. Paper grain wants to be finer and softer than cork.
    noise: { color: [120, 96, 58], alpha: 0.13, block: 1 },

    gradePortrait: function (canvas, n, h) {
      h.gradePortrait(canvas, {
        dark: "#2A2014",
        light: "#F3E9D2",
        contrast: 1.28,
        gamma: 1.12,
        mix: 0.66
      });
    },

    /*
      Underlay: the copper plate mark, and the constellation figures. Drawn
      before the aspects so the figures sit under the graph like pencil work
      under ink — which is the order an engraver works in.
    */
    beforeWorld: function (ctx, st) {
      var b = st.graph.bounds;
      var k = st.cam.k;
      var pad = 96;
      var x0 = (b.minX - pad) * k + st.cam.x,
        y0 = (b.minY - pad) * k + st.cam.y;
      var x1 = (b.maxX + pad) * k + st.cam.x,
        y1 = (b.maxY + pad) * k + st.cam.y;

      // plate mark: the bevelled edge where the copper plate bit the paper
      ctx.save();
      ctx.strokeStyle = "rgba(122,100,66,0.42)";
      ctx.lineWidth = 1.4;
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.strokeStyle = "rgba(122,100,66,0.2)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x0 + 4.5, y0 + 4.5, x1 - x0 - 9, y1 - y0 - 9);
      ctx.restore();

      /*
        Constellation figures. At rest they are pencil under the ink — barely
        present, so they never compete with the aspects, which are the actual
        data. The moment a body is picked up, its own figure is drawn in red
        over everything else: you see which constellation you are standing in.
        Drawing all fifteen at full strength was the first version and it read
        as a second, lying set of relationships.
      */
      var figs = figures(st.graph);
      var hot = st.selected ? st.selected.faction : st.hovered ? st.hovered.faction : null;
      ctx.save();
      ctx.setLineDash([2, 7]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(107,95,72,0.085)";
      ctx.beginPath();
      for (var i = 0; i < figs.length; i++) {
        if (figs[i].key === hot) continue;
        appendFigure(ctx, figs[i]);
      }
      ctx.stroke();
      for (var h = 0; h < figs.length; h++) {
        if (figs[h].key !== hot) continue;
        ctx.strokeStyle = "rgba(168,52,46,0.62)";
        ctx.lineWidth = 1.3;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        appendFigure(ctx, figs[h]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    },

    /*
      Overlay: the paper's own shading. A faint warm bloom at the upper left
      where the page has been handled, and a hairline registration grid in the
      margin outside the plate — the printer's marks.
    */
    afterWorld: function (ctx, st) {
      var k = st.cam.k;
      var b = st.graph.bounds;
      var x0 = (b.minX - 96) * k + st.cam.x,
        y0 = (b.minY - 96) * k + st.cam.y;
      var x1 = (b.maxX + 96) * k + st.cam.x,
        y1 = (b.maxY + 96) * k + st.cam.y;

      // registration crosses in the four plate margins
      ctx.save();
      ctx.strokeStyle = "rgba(122,100,66,0.34)";
      ctx.lineWidth = 1;
      var m = 52;
      var pts = [
        [(x0 - m), (y0 + y1) / 2],
        [(x1 + m), (y0 + y1) / 2],
        [(x0 + x1) / 2, (y0 - m)],
        [(x0 + x1) / 2, (y1 + m)]
      ];
      for (var i = 0; i < 4; i++) {
        var px = pts[i][0],
          py = pts[i][1];
        ctx.beginPath();
        ctx.moveTo(px - 6, py);
        ctx.lineTo(px + 6, py);
        ctx.moveTo(px, py - 6);
        ctx.lineTo(px, py + 6);
        ctx.stroke();
      }
      ctx.restore();
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

    /* ── node: an engraved medallion ─────────────────────────────── */
    bakeNode: function (n, px, h) {
      var c = h.makeCanvas(px, px);
      var ctx = c.getContext("2d");
      var cx = px / 2,
        cy = px / 2;
      var R = n.r * h.unit;
      var fac = h.faction;
      var hue = fac.hue || C.gold;
      var greek = GREEK[n.faction] || "•";

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // shadow the medallion casts into the paper
      ctx.save();
      ctx.shadowColor = "rgba(60,44,20,0.42)";
      ctx.shadowBlur = R * 0.36;
      ctx.shadowOffsetY = R * 0.13;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.94, 0, 6.2832);
      ctx.fillStyle = C.vellum;
      ctx.fill();
      ctx.restore();

      // outer wash: the plate's background tone inside the medallion
      var wg = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.1, cx, cy, R);
      wg.addColorStop(0, C.vellumHi);
      wg.addColorStop(0.7, C.vellum);
      wg.addColorStop(1, C.vellumLo);
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.94, 0, 6.2832);
      ctx.fillStyle = wg;
      ctx.fill();

      // portrait aperture
      var ar = R * 0.68;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, ar, 0, 6.2832);
      ctx.clip();
      if (n.portrait) {
        ctx.drawImage(n.portrait, cx - ar, cy - ar, ar * 2, ar * 2);
        /*
          Engraved screen: fine horizontal hatching laid over the portrait, the
          way a plate shades a face. Kept deliberately light — the first pass
          hatched at 0.17 under a 0.55 vignette and every face went to mud. The
          hatching is here to unify the photographs, not to hide them.
        */
        ctx.globalAlpha = 0.1;
        ctx.strokeStyle = "#2A2014";
        ctx.lineWidth = Math.max(0.5, R * 0.014);
        for (var hy = -ar; hy < ar; hy += Math.max(1.6, R * 0.06)) {
          var half = Math.sqrt(Math.max(0, ar * ar - hy * hy));
          ctx.beginPath();
          ctx.moveTo(cx - half, cy + hy);
          ctx.lineTo(cx + half, cy + hy);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        var vg = ctx.createRadialGradient(cx, cy - ar * 0.25, ar * 0.42, cx, cy, ar * 1.05);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(42,32,20,0.34)");
        ctx.fillStyle = vg;
        ctx.fillRect(cx - ar, cy - ar, ar * 2, ar * 2);
      } else {
        ctx.fillStyle = shade(hue, -0.25);
        ctx.fillRect(cx - ar, cy - ar, ar * 2, ar * 2);
        ctx.fillStyle = "rgba(246,240,226,0.9)";
        ctx.font = "600 " + ar * 0.85 + "px 'EB Garamond', Georgia, serif";
        ctx.fillText(initials(n.label), cx, cy + ar * 0.04);
      }
      ctx.restore();

      // aperture rim
      ctx.beginPath();
      ctx.arc(cx, cy, ar, 0, 6.2832);
      ctx.strokeStyle = "rgba(42,32,20,0.7)";
      ctx.lineWidth = Math.max(0.7, R * 0.03);
      ctx.stroke();

      // the engraved ring: a heavy rule, a hairline, and radial shading ticks
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.94, 0, 6.2832);
      ctx.strokeStyle = "rgba(42,32,20,0.62)";
      ctx.lineWidth = Math.max(0.8, R * 0.035);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.86, 0, 6.2832);
      ctx.strokeStyle = "rgba(42,32,20,0.3)";
      ctx.lineWidth = Math.max(0.5, R * 0.018);
      ctx.stroke();

      /*
        The tier ring: the medallion's magnitude. A first-magnitude body gets a
        full ring of ticks; a faint one gets a quarter. This is the chart's own
        convention for brightness, reused here for narrative weight — and it is
        the encoding channel that survives when the whole plate is one ink.
      */
      var ticks = n.tier === 0 ? 48 : n.tier === 1 ? 32 : 20;
      var arc = n.tier === 0 ? 6.2832 : n.tier === 1 ? 4.712 : 3.1416;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R * 0.79, -Math.PI / 2, -Math.PI / 2 + arc);
      ctx.strokeStyle = "rgba(42,32,20,0.34)";
      ctx.lineWidth = Math.max(0.5, R * 0.016);
      for (var ti = 0; ti < ticks; ti++) {
        var a = -Math.PI / 2 + (arc * ti) / (ticks - 1 || 1);
        var ca = Math.cos(a),
          sa = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(cx + ca * R * 0.79, cy + sa * R * 0.79);
        ctx.lineTo(cx + ca * R * 0.9, cy + sa * R * 0.9);
        ctx.stroke();
      }
      ctx.restore();

      // Bayer designation, stamped at the head of the medallion
      var gr = Math.max(4.5, R * 0.3);
      ctx.beginPath();
      ctx.arc(cx, cy - R * 0.94, gr, 0, 6.2832);
      ctx.fillStyle = C.vellum;
      ctx.fill();
      ctx.strokeStyle = "rgba(42,32,20,0.55)";
      ctx.lineWidth = Math.max(0.6, R * 0.026);
      ctx.stroke();
      ctx.fillStyle = C.ink;
      ctx.font = Math.max(6, R * 0.4) + "px 'EB Garamond', Georgia, serif";
      ctx.fillText(greek, cx, cy - R * 0.94 + gr * 0.04);

      // a concealed identity gets the engraver's conjectural mark
      if (n.aliases && n.aliases.length) {
        ctx.beginPath();
        ctx.arc(cx, cy + R * 0.94, gr * 0.62, 0, 6.2832);
        ctx.fillStyle = C.red;
        ctx.fill();
      }

      return c;
    },

    drawNode: function (ctx, n, st) {
      if (!n.sprite) return;
      ctx.save();
      ctx.globalAlpha = st.alpha;
      ctx.drawImage(n.sprite, n.sx - st.size / 2, n.sy - st.size / 2, st.size, st.size);

      if (st.selected) {
        if (!glowSprite) bakeGlow();
        var gs = st.screenR * 5.2;
        ctx.globalCompositeOperation = "lighter";
        ctx.drawImage(glowSprite, n.sx - gs / 2, n.sy - gs / 2, gs, gs);
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = "rgba(168,52,46,0.85)";
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, st.screenR * 1.12, 0, 6.2832);
        ctx.stroke();
      } else if (st.hovered || st.focused) {
        ctx.strokeStyle = "rgba(42,32,20,0.6)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, st.screenR * 1.12, 0, 6.2832);
        ctx.stroke();
      } else if (st.isMatch) {
        ctx.strokeStyle = "rgba(168,52,46,0.75)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, st.screenR * 1.1, 0, 6.2832);
        ctx.stroke();
      }
      ctx.restore();
    },

    /* ── aspects ─────────────────────────────────────────────────── */
    /*
      An engraved line: a fine dark bed, the ink itself, and a pale highlight
      lifted one hair above it so the stroke reads as cut into the plate rather
      than drawn on it. Path built twice at most; widths restroke for free.
    */
    drawEdge: function (ctx, e, st) {
      var def = TYPES[e.type];
      var isTaut = st.emphasis > 0;
      var alpha = st.alpha * (def.alpha || 1) * (isTaut ? 1 : 0.94);
      var lw = def.width * (isTaut ? 1.18 : 1);
      ctx.save();
      if (def.dash) ctx.setLineDash(def.dash);

      ctx.lineWidth = lw + 1.5;
      ctx.globalAlpha = alpha * 0.3;
      ctx.strokeStyle = "rgba(120,100,66,0.85)";
      aspectPath(ctx, e.a, e.b, e, st, 0);
      ctx.stroke();

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = def.color;
      ctx.lineWidth = lw;
      ctx.stroke();

      if (def.ribbon) {
        // a route line: the second stroke makes family read as a ruled double
        ctx.globalAlpha = alpha * 0.75;
        ctx.lineWidth = Math.max(0.7, lw * 0.3);
        ctx.strokeStyle = C.goldHi;
        aspectPath(ctx, e.a, e.b, e, st, -lw * 0.42);
        ctx.stroke();
      } else if (def.width >= 1.5) {
        ctx.globalAlpha = alpha * 0.34;
        ctx.strokeStyle = C.vellumHi;
        ctx.lineWidth = Math.max(0.6, lw * 0.26);
        aspectPath(ctx, e.a, e.b, e, st, -lw * 0.3);
        ctx.stroke();
      }
      ctx.setLineDash([]);

      if (!st.emphasis && e.type !== "colleague" && (st.k > 0.42 || isTaut)) {
        var geom = aspectPath(ctx, e.a, e.b, e, st, 0);
        ctx.globalAlpha = alpha * 0.95;
        ctx.strokeStyle = def.color;
        ctx.fillStyle = def.color;
        var kr = Math.max(2.4, lw * 1.15);
        if (def.knot === "star") {
          star(ctx, geom.x0, geom.y0, kr * 1.5, 4, true);
          star(ctx, geom.x1, geom.y1, kr * 1.5, 4, true);
        } else if (def.knot === "star2") {
          star(ctx, geom.x0, geom.y0, kr * 1.7, 5, true);
          star(ctx, geom.x1, geom.y1, kr * 1.7, 5, true);
        } else if (def.knot === "dot") {
          ctx.beginPath();
          ctx.arc(geom.x0, geom.y0, kr * 0.62, 0, 6.2832);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(geom.x1, geom.y1, kr * 0.62, 0, 6.2832);
          ctx.fill();
        } else if (def.knot === "hollow") {
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.arc(geom.x0, geom.y0, kr * 0.8, 0, 6.2832);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(geom.x1, geom.y1, kr * 0.8, 0, 6.2832);
          ctx.stroke();
        } else if (def.knot === "barb") {
          var ab = Math.atan2(geom.y1 - geom.my, geom.x1 - geom.mx);
          arrow(ctx, geom.x1, geom.y1, ab, kr * 2.1);
        } else if (def.knot === "arrow") {
          var aa = Math.atan2(geom.y1 - geom.my, geom.x1 - geom.mx);
          ctx.lineWidth = 1.4;
          arrow(ctx, geom.x1, geom.y1, aa, kr * 2.4);
        } else if (def.knot === "cross") {
          var p = quadPoint(geom.x0, geom.y0, geom.cx, geom.cy, geom.x1, geom.y1, 0.5);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(p.x - kr * 1.4, p.y - kr * 1.4);
          ctx.lineTo(p.x + kr * 1.4, p.y + kr * 1.4);
          ctx.moveTo(p.x + kr * 1.4, p.y - kr * 1.4);
          ctx.lineTo(p.x - kr * 1.4, p.y + kr * 1.4);
          ctx.stroke();
        }
      }
      ctx.restore();
    },

    /* ── labels: captions printed on the paper ───────────────────── */
    /*
      No plate. On a real chart the name is set directly on the sheet, and the
      only thing keeping it legible over the engraving is a halo of bare paper
      behind the letters. That halo is also what makes the board read as
      printed rather than as a UI with labels.
    */
    label: {
      family: "'EB Garamond', Georgia, serif",
      size: function (n) {
        return n.tier === 0 ? 13 : n.tier === 1 ? 11.5 : 10.5;
      },
      weight: function (n) {
        return n.tier === 0 ? 600 : 500;
      },
      tracking: 0.014,
      color: C.ink,
      gap: 5,
      leaderColor: "rgba(107,95,72,0.5)",
      offsets: [0, 2, 1, 3],
      halo: function (n) {
        return { color: n.tier === 0 ? "rgba(243,237,224,0.96)" : "rgba(243,237,224,0.9)", width: n.tier === 0 ? 4.2 : 3.6 };
      }
    },

    title: function () {
      return (
        '<div class="brand">' +
        '<div class="cartouche">' +
        '<div class="cartouche__rule"></div>' +
        '<span class="cartouche__kicker">Plate VII · Beika Ward</span>' +
        '<h1 class="cartouche__title">A Celestial Atlas</h1>' +
        '<span class="cartouche__sub">of the figures bound to one another</span>' +
        '<div class="cartouche__rule cartouche__rule--low"></div>' +
        '<p class="cartouche__meta">95 bodies · 153 aspects · engraved 2026</p>' +
        "</div></div>"
      );
    },
    legendHead: function () {
      return (
        '<div class="legend__head"><span>A Key to the Aspects</span>' +
        "<em>the eight ways two bodies may stand</em></div>"
      );
    },
    legendTab: function () {
      var order = ["romance", "family", "friendship", "rivalry", "mentor", "colleague", "secret_identity", "adversary"];
      var marks = order
        .map(function (t) {
          var d = TYPES[t];
          return '<i style="color:' + d.color + '">' + (d.dash ? "┄" : d.bow ? "⌒" : "—") + "</i>";
        })
        .join("");
      return (
        '<span class="legend__tab-label">Key</span>' +
        '<span class="legend__tab-marks" aria-hidden="true">' + marks + "</span>" +
        '<span class="legend__tab-hint">8 aspects</span>'
      );
    },
    searchPlaceholder: "Index nominum — search the atlas…",
    searchHead: function () {
      return '<div class="search__head">Index Nominum</div>';
    },
    hud: function () {
      return (
        '<div class="hud">' +
        '<span class="hud__row">plate <b data-k>100%</b></span>' +
        '<span class="hud__sep">·</span>' +
        '<span class="hud__row"><b data-labels>0</b> captions</span>' +
        '<span class="hud__sep">·</span>' +
        '<span class="hud__row"><b data-progress>0/0</b> plates struck</span>' +
        '<span class="hud__bar" aria-hidden="true"></span>' +
        '<span class="hud__row">0 — 500 units</span>' +
        "</div>"
      );
    },

    dossier: function (d) {
      var n = d.node;
      var rows = d.threads
        .map(function (t) {
          return (
            '<li><button type="button" class="aspect" data-goto="' +
            t.other.id +
            '">' +
            '<span class="aspect__swatch">' +
            d.swatch(t.e.type) +
            "</span>" +
            '<span class="aspect__body">' +
            '<span class="aspect__type">' +
            d.typeLabel[t.e.type] +
            "</span>" +
            '<span class="aspect__name">' +
            d.esc(t.other.label) +
            "</span>" +
            '<span class="aspect__detail">' +
            d.esc(t.e.detail) +
            "</span>" +
            "</span></button></li>"
          );
        })
        .join("");
      return (
        '<div class="entry">' +
        '<button type="button" class="dossier__close" aria-label="Close entry">✕</button>' +
        '<div class="entry__rule"></div>' +
        '<span class="entry__greek">' +
        (GREEK[n.faction] || "•") +
        "</span>" +
        '<span class="entry__fac">' +
        d.esc(d.faction.label) +
        "</span>" +
        '<h2 class="entry__name">' +
        d.esc(n.label) +
        "</h2>" +
        (n.aliases.length ? '<p class="entry__alias">also engraved as ' + d.esc(n.aliases.join(", ")) + "</p>" : "") +
        '<p class="entry__role">' +
        d.esc(n.role) +
        "</p>" +
        '<p class="entry__bio">' +
        d.esc(n.bio) +
        "</p>" +
        '<div class="entry__rule"></div>' +
        '<div class="entry__count"><span>' +
        d.threads.length +
        " aspects recorded</span></div>" +
        '<ul class="entry__aspects">' +
        rows +
        "</ul>" +
        "</div>"
      );
    }
  };
})(window);
