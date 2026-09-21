/*
  Variant A — CASE BOARD
  A detective's evidence board in a dark room: cork, steel pins, manila photo
  mounts and crimson thread. The product's own "red strings" metaphor rendered
  as literal material, so the relationship type is carried by thread material,
  width, knot and bow — not by colour alone.
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
    room: "#14100C",
    board: "#2A2118",
    boardMottle: "#3A2C1E",
    manila: "#E8DCC8",
    manilaHi: "#F2E9D8",
    manilaLo: "#D6C6A8",
    manilaEdge: "#C2AE8A",
    ink: "#1A1410",
    inkDim: "#6B5B45",
    thread: "#C8102E",
    gold: "#D4AF37",
    kraft: "#8A7A5E"
  };

  /*
    Thread stock per relationship type.

    The board only ever stocks three kinds of string, the way a real evidence
    board does: CRIMSON for the bonds that drive the story, TWINE for the
    professional ones, and BLACK CORD — reserved for the Black Organization,
    because a cold hard black cable against warm cork says "these people are
    not like the others" before you read a single label.

    Everything else that separates the eight types is geometry, which is why
    the board survives a greyscale screenshot: `bow` (resting curvature),
    `dash`, `knot` and `width` are four independent channels.

    `alpha` and `cord` are material flags; `bow`/`dash`/`knot`/`width` are
    also consumed by the legend's swatch renderer, so the key is a real sample.
  */
  /*
    Thread stocks. Width is the primary weight channel and it has to survive
    the cork: the board ground is a dark brown, so anything below ~1.5px at
    low alpha disappears into the grain and the board reads as empty. The
    colleague web is by far the most numerous relation, so it sets the
    perceived density of the whole board -- it is the one thread that must be
    faint enough to sit behind the story and strong enough to be seen.
  */
  var TYPES = {
    romance: { color: "#E02636", width: 3.0, bow: 0.16, knot: "loop", label: "Romance" },
    family: { color: "#C8932F", width: 3.0, bow: 0.0, knot: "pin", ribbon: true, label: "Family" },
    friendship: { color: "#8A9BB0", width: 2.1, bow: 0.1, label: "Friendship" },
    rivalry: { color: "#9A85B8", width: 2.3, bow: -0.2, dash: [6, 4], label: "Rivalry" },
    mentor: { color: "#7A9A7E", width: 2.3, bow: 0.22, knot: "arrow", label: "Mentor" },
    colleague: { color: "#A29684", width: 1.5, bow: 0.0, alpha: 0.6, label: "Colleague" },
    secret_identity: { color: "#B87CA8", width: 1.9, bow: -0.14, dash: [1.5, 5], label: "Secret Identity" },
    adversary: { color: "#241E20", width: 3.7, bow: 0.05, knot: "cross", cord: true, label: "Adversary" }
  };

  /* Pin-head shape per faction — the fourth encoding channel, so affiliation
     survives a greyscale screenshot. */
  var PIN_SHAPE = {
    JDL: "round", KUDO: "round", OSAKA: "hex", MOURI: "hex", SUZUKI: "shield",
    KID: "star", TMPD: "square", POLICE: "square", PSB: "hex", FBI: "shield",
    MI6: "shield", CIA: "round", BO: "star", MIYANO: "round", CIVILIAN: "round"
  };

  var FACTION_INK = {
    JDL: "#1E8FA6", KUDO: "#2E7FA8", OSAKA: "#B06A2A", MOURI: "#1E8A7A",
    SUZUKI: "#A83A72", KID: "#4A5AA8", TMPD: "#B8862A", POLICE: "#8A6A2A",
    PSB: "#8A4FA8", FBI: "#6A5AA8", MI6: "#5A6AB8", CIA: "#5A6A72",
    BO: "#A81E2E", MIYANO: "#A8527A", CIVILIAN: "#4A7FA8"
  };

  function shade(hex, amt) {
    var c = U.hexToRgb(hex);
    var f = function (v) {
      return Math.round(clamp(amt > 0 ? v + (255 - v) * amt : v * (1 + amt), 0, 255));
    };
    return "rgb(" + f(c[0]) + "," + f(c[1]) + "," + f(c[2]) + ")";
  }

  /* ── pin heads ──────────────────────────────────────────────────── */
  function pinPath(ctx, x, y, r, shape) {
    ctx.beginPath();
    if (shape === "square") {
      roundRect(ctx, x - r, y - r, r * 2, r * 2, r * 0.28);
    } else if (shape === "hex") {
      for (var i = 0; i < 6; i++) {
        var a = (Math.PI / 3) * i - Math.PI / 2;
        var px = x + Math.cos(a) * r,
          py = y + Math.sin(a) * r;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.closePath();
    } else if (shape === "star") {
      for (var j = 0; j < 10; j++) {
        var a2 = (Math.PI / 5) * j - Math.PI / 2;
        var rr = j % 2 ? r * 0.48 : r;
        var qx = x + Math.cos(a2) * rr,
          qy = y + Math.sin(a2) * rr;
        if (j) ctx.lineTo(qx, qy);
        else ctx.moveTo(qx, qy);
      }
      ctx.closePath();
    } else if (shape === "shield") {
      ctx.moveTo(x - r, y - r * 0.82);
      ctx.lineTo(x + r, y - r * 0.82);
      ctx.lineTo(x + r, y + r * 0.18);
      ctx.quadraticCurveTo(x, y + r * 1.25, x - r, y + r * 0.18);
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, 6.2832);
    }
  }

  function drawPin(ctx, x, y, r, color, shape) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.55)";
    ctx.shadowBlur = r * 1.1;
    ctx.shadowOffsetX = r * 0.35;
    ctx.shadowOffsetY = r * 0.55;
    pinPath(ctx, x, y, r, shape);
    ctx.fillStyle = shade(color, -0.45);
    ctx.fill();
    ctx.restore();

    var g = ctx.createRadialGradient(x - r * 0.38, y - r * 0.45, r * 0.08, x, y, r * 1.15);
    g.addColorStop(0, shade(color, 0.62));
    g.addColorStop(0.5, color);
    g.addColorStop(1, shade(color, -0.42));
    pinPath(ctx, x, y, r, shape);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x - r * 0.3, y - r * 0.38, r * 0.26, 0, 6.2832);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fill();
  }

  /* ── thread geometry ────────────────────────────────────────────── */
  /* Eased 0..1: threads straighten when their subgraph is selected. */
  var tension = 0;

  /*
    Build the thread's quadratic into the current path.

    `dyOff` shifts the whole curve in screen pixels — used to lay a highlight
    or a shadow along one side of a thread, which is what turns a flat stroke
    into something that looks like it has a diameter. It must not be confused
    with the endpoint delta below. Naming the locals `dx`/`dy` here silently
    shadowed the parameter, so `o` became the edge's entire vertical span and
    every thread was drawn displaced by that much: horizontal threads landed
    correctly, steep ones did not, and the board read as a network that was
    subtly wrong rather than obviously broken.
  */
  function threadPath(ctx, a, b, e, st, sagScale, dyOff) {
    var ax = a.sx,
      ay = a.sy,
      bx = b.sx,
      by = b.sy;
    var ddx = bx - ax,
      ddy = by - ay;
    var len = Math.hypot(ddx, ddy) || 1;
    var ux = ddx / len,
      uy = ddy / len;
    var trimA = Math.min(a.sr * 0.94, len * 0.4);
    var trimB = Math.min(b.sr * 0.94, len * 0.4);
    var x0 = ax + ux * trimA,
      y0 = ay + uy * trimA;
    var x1 = bx - ux * trimB,
      y1 = by - uy * trimB;
    var mx = (x0 + x1) / 2,
      my = (y0 + y1) / 2;
    var span = Math.hypot(x1 - x0, y1 - y0) || 1;
    var curv = e.solo ? TYPES[e.type].bow || 0 : e.curvature;
    var off = curv * span;
    var cxp = mx + -uy * off;
    var cyp = my + ux * off;
    // gravity: a slack thread sags, a taut one does not
    var sag = clamp(span * 0.075, 5, 30) * (1 - tension) * sagScale;
    cyp += sag * 2;
    var o = dyOff || 0;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + o);
    ctx.quadraticCurveTo(cxp, cyp + o, x1, y1 + o);
    return { x0: x0, y0: y0, x1: x1, y1: y1, cx: cxp, cy: cyp, mx: mx, my: my, span: span };
  }

  function quadPoint(ax, ay, cx, cy, bx, by, t) {
    var it = 1 - t;
    return { x: it * it * ax + 2 * it * t * cx + t * t * bx, y: it * it * ay + 2 * it * t * cy + t * t * by };
  }

  global.DCPH_THEME_A = {
    id: "a",
    name: "Case Board",

    /*
      labelPad is the screen-space halo the establishing fit reserves around
      the outermost node, so a nameplate can never be cropped by the frame.
      It has to cover the WIDEST card, not a typical one: labels are placed on
      either side of their pin, so the leftmost node can carry its card out to
      the left and the reserved margin has to be a full card wide. At the
      default 52 the outer column of names sat about 8px off the frame edge.
    */
    camera: { anchorX: 0.42, anchorY: 0.5, mobileK: 0.5, desktopMax: 1.25, labelPadX: 70, labelPadY: 30 },
    // On a real board the photographs are the largest thing on the wall and
    // the slips of tape beside them are small. The default radius makes the
    // pinned photo smaller than its own caption, which inverts that.
    nodeScale: 1.25,
    // Strips the index card, pin tray, search slip and brass dials occupy, so
    // the establishing shot frames the board instead of sliding under them.
    /*
      Insets are measured from the live chrome, not guessed. At mobile the
      index card becomes a banner across the top and the search slip and brass
      dials share the bottom, so the usable rect is a tall narrow band and the
      desktop 18px ring would centre the cluster under the card.
    */
    safe: function (vw) {
      if (vw < 900) return { left: 14, right: 14, top: 118, bottom: 82 };
      return { left: 18, right: 18, top: 18, bottom: 18 };
    },
    bgMotion: { mode: "world", tile: 220 },
    // warm grain, baked into the tile that pans with the board
    noise: { color: [255, 236, 205], alpha: 0.22, block: 2 },

    /* Once per frame: ease the board's thread tension toward the selection. */
    beforeWorld: function (ctx, st) {
      tension += ((st.selected ? 1 : 0) - tension) * 0.16;
    },

    edgeStyle: function (t) {
      var d = TYPES[t];
      return {
        color: d.color,
        width: d.width,
        dash: d.dash,
        bow: d.bow,
        knot: d.knot,
        cord: d.cord,
        label: d.label
      };
    },
    typeLabel: function (t) {
      return TYPES[t].label;
    },

    gradePortrait: function (canvas, n, h) {
      h.gradePortrait(canvas, {
        dark: "#241A12",
        light: "#FBF1DE",
        contrast: 1.06,
        gamma: 1.04,
        mix: 0.42
      });
    },

    /* ── node: a mounted photograph held by a steel pin ───────────── */
    bakeNode: function (n, px, h) {
      var c = h.makeCanvas(px, px);
      var ctx = c.getContext("2d");
      var cx = px / 2,
        cy = px / 2;
      var R = n.r * h.unit;
      var fac = h.faction;
      var ink = FACTION_INK[n.faction] || "#8A8073";

      var w = R * 2;
      var ht = R * 2.1;
      var x = cx - w / 2,
        y = cy - ht / 2;
      var border = Math.max(1.6, R * 0.088);
      var rad = Math.max(1, R * 0.055);

      // cast shadow on the cork
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.62)";
      ctx.shadowBlur = R * 0.34;
      ctx.shadowOffsetX = R * 0.07;
      ctx.shadowOffsetY = R * 0.14;
      ctx.fillStyle = C.manila;
      roundRect(ctx, x, y, w, ht, rad);
      ctx.fill();
      ctx.restore();

      // manila stock
      var g = ctx.createLinearGradient(x, y, x + w * 0.6, y + ht);
      g.addColorStop(0, C.manilaHi);
      g.addColorStop(0.55, C.manila);
      g.addColorStop(1, C.manilaLo);
      roundRect(ctx, x, y, w, ht, rad);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = C.manilaEdge;
      ctx.lineWidth = Math.max(0.7, R * 0.022);
      ctx.stroke();

      // photo well (extra stock left at the bottom for the classic lip)
      var ix = x + border,
        iy = y + border;
      var iw = w - border * 2,
        ih = ht - border * 2 - R * 0.2;

      ctx.save();
      ctx.beginPath();
      ctx.rect(ix, iy, iw, ih);
      ctx.clip();
      if (n.portrait) {
        ctx.drawImage(n.portrait, ix, iy, iw, ih);
        // inner vignette so the chaotic source crops sit back in the mount
        var vg = ctx.createRadialGradient(ix + iw / 2, iy + ih * 0.45, iw * 0.15, ix + iw / 2, iy + ih / 2, iw * 0.78);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(26,18,10,0.5)");
        ctx.fillStyle = vg;
        ctx.fillRect(ix, iy, iw, ih);
      } else {
        var fg = ctx.createLinearGradient(ix, iy, ix, iy + ih);
        fg.addColorStop(0, shade(ink, 0.1));
        fg.addColorStop(1, shade(ink, -0.5));
        ctx.fillStyle = fg;
        ctx.fillRect(ix, iy, iw, ih);
        ctx.fillStyle = "rgba(255,255,255,0.86)";
        ctx.font = "700 " + ih * 0.46 + "px Inter, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(initials(n.label), ix + iw / 2, iy + ih / 2);
      }
      ctx.restore();

      // photo edge
      ctx.strokeStyle = "rgba(26,18,10,0.55)";
      ctx.lineWidth = Math.max(0.6, R * 0.02);
      ctx.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);

      // a concealed identity tears the mount corner
      if (n.aliases && n.aliases.length) {
        ctx.beginPath();
        ctx.moveTo(x + w, y + ht * 0.62);
        ctx.lineTo(x + w, y + ht);
        ctx.lineTo(x + w * 0.66, y + ht);
        ctx.closePath();
        ctx.fillStyle = "rgba(20,16,12,0.82)";
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x + w, y + ht * 0.62);
        ctx.lineTo(x + w * 0.66, y + ht);
        ctx.strokeStyle = "rgba(200,16,46,0.55)";
        ctx.lineWidth = Math.max(0.6, R * 0.03);
        ctx.stroke();
      }

      // pin head, top-centre, faction shape + ink
      drawPin(ctx, cx, y + border * 0.5, Math.max(3.4, R * 0.21), ink, PIN_SHAPE[n.faction] || "round");

      return c;
    },

    drawNode: function (ctx, n, st) {
      if (!n.sprite) return;
      ctx.save();
      ctx.globalAlpha = st.alpha;
      var lift = st.hovered || st.selected ? -st.screenR * 0.07 : 0;
      ctx.drawImage(n.sprite, n.sx - st.size / 2, n.sy - st.size / 2 + lift, st.size, st.size);

      var fac = (global.DCPH_DATA.factions[n.faction] || {}).hue || "#C8102E";
      if (st.selected) {
        ctx.globalCompositeOperation = "lighter";
        var g = ctx.createRadialGradient(n.sx, n.sy, st.screenR * 0.6, n.sx, n.sy, st.screenR * 2.4);
        g.addColorStop(0, "rgba(255,232,190,0.4)");
        g.addColorStop(1, "rgba(255,232,190,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, st.screenR * 2.4, 0, 6.2832);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      } else if (st.hovered || st.focused) {
        ctx.strokeStyle = "rgba(255,236,196,0.5)";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, st.screenR * 1.36, 0, 6.2832);
        ctx.stroke();
      } else if (st.isMatch) {
        ctx.strokeStyle = "rgba(200,16,46,0.85)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(n.sx, n.sy, st.screenR * 1.3, 0, 6.2832);
        ctx.stroke();
      }
      ctx.restore();
    },

    /* ── threads ──────────────────────────────────────────────────── */
    /*
      Three strokes over ONE path, then one more over a lifted path. The path
      is built twice per edge at most; the width changes are free because a
      stroke reuses the current path. That is what buys the round-cord read
      without a per-frame allocation or a second geometry pass.
    */
    drawEdge: function (ctx, e, st) {
      var def = TYPES[e.type];
      var isTaut = st.emphasis > 0;
      var alpha = st.alpha * (def.alpha || 1) * (isTaut ? 1 : 0.92);
      var lw = def.width * (isTaut ? 1.22 : 1);
      ctx.save();
      if (def.dash) ctx.setLineDash(def.dash);

      if (def.cord) {
        // black cord: a hard dark core with one pale specular edge. No bed
        // shadow — a black cable on dark cork already has all the contrast it
        // needs, and a shadow would only smear its silhouette.
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = def.color;
        ctx.lineWidth = lw;
        threadPath(ctx, e.a, e.b, e, st, 1);
        ctx.stroke();
        // The specular has to do all the separating work: black cord on dark
        // cork has no silhouette of its own, so the cold steel edge IS the
        // thread as far as the eye is concerned.
        ctx.globalAlpha = alpha * 0.66;
        ctx.strokeStyle = "#A6B4C0";
        ctx.lineWidth = Math.max(1, lw * 0.3);
        threadPath(ctx, e.a, e.b, e, st, 1, -lw * 0.28);
        ctx.stroke();
      } else {
        ctx.lineWidth = lw + 1.7;
        ctx.globalAlpha = alpha * 0.55;
        ctx.strokeStyle = "rgba(16,9,4,0.9)";
        threadPath(ctx, e.a, e.b, e, st, 1);
        ctx.stroke();

        ctx.lineWidth = lw + 0.7;
        ctx.strokeStyle = shade(def.color, -0.5);
        ctx.stroke();

        ctx.globalAlpha = alpha;
        ctx.strokeStyle = def.color;
        ctx.lineWidth = lw;
        ctx.stroke();

        if (def.width >= 1.8) {
          // top-light along the upper side of the cord
          ctx.globalAlpha = alpha * 0.38;
          ctx.strokeStyle = shade(def.color, 0.52);
          ctx.lineWidth = Math.max(0.7, lw * 0.28);
          threadPath(ctx, e.a, e.b, e, st, 1, -lw * 0.3);
          ctx.stroke();
        }
      }
      ctx.setLineDash([]);

      if (def.ribbon) {
        // a second, offset pass reads as woven ribbon rather than thread
        ctx.globalAlpha = alpha * 0.5;
        ctx.lineWidth = def.width * 0.42;
        ctx.strokeStyle = shade(def.color, 0.34);
        threadPath(ctx, e.a, e.b, e, st, 1);
        ctx.stroke();
      }

      if (!st.emphasis && e.type !== "colleague") {
        // knots / markers only read on the emphasised subgraph or at rest for
        // the loud types — keeps the idle board calm
        if (st.k > 0.42 || isTaut) {
          // markers need the on-curve geometry, and the last stroke above drew
          // a lifted path — so rebuild. Only knot types pay for this.
          var geom = threadPath(ctx, e.a, e.b, e, st, 1);
          ctx.globalAlpha = alpha * 0.95;
          // markers sit ON the thread, so a black cord needs a light marker
          ctx.strokeStyle = def.cord ? "#B9AE9E" : def.color;
          ctx.fillStyle = ctx.strokeStyle;
          if (def.knot === "loop") {
            knot(ctx, geom.x0, geom.y0, 3.1, "loop");
            knot(ctx, geom.x1, geom.y1, 3.1, "loop");
          } else if (def.knot === "pin") {
            knot(ctx, geom.x0, geom.y0, 2.6, "dot");
            knot(ctx, geom.x1, geom.y1, 2.6, "dot");
          } else if (def.knot === "arrow") {
            arrow(ctx, geom.x1, geom.y1, Math.atan2(geom.y1 - geom.my, geom.x1 - geom.mx), 5.4);
          } else if (def.knot === "cross") {
            var p = quadPoint(geom.x0, geom.y0, geom.cx, geom.cy, geom.x1, geom.y1, 0.5);
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(p.x - 4, p.y - 4);
            ctx.lineTo(p.x + 4, p.y + 4);
            ctx.moveTo(p.x + 4, p.y - 4);
            ctx.lineTo(p.x - 4, p.y + 4);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    },

    /* ── labels: manila plates ────────────────────────────────────── */
    /*
      Only the characters who carry the story get a physical index card; the
      rest of the cast is written straight onto the board.

      A board where all 95 names are cards is a wall of paper, because on dark
      cork the cream card is the highest-contrast object on screen and it
      out-shouts both the photographs and the thread — the two things anyone
      is actually reading. The cards are therefore the accent: roughly the
      fifteen people the case is about, against seventy names chalked onto the
      board and the whole cast of pinned photographs.
    */
    label: {
      family: "Inter, system-ui, sans-serif",
      size: function (n) {
        return n.tier === 0 ? 12 : n.tier === 1 ? 11 : 10.5;
      },
      weight: function (n) {
        return n.tier === 0 ? 700 : 600;
      },
      tracking: 0.012,
      color: function (n) {
        return n.tier === 2 ? "rgba(238,228,208,0.94)" : C.ink;
      },
      gap: 6,
      leaderColor: "rgba(232,220,200,0.4)",
      offsets: [0, 2, 1, 3],
      plate: function (n) {
        if (n.tier === 2) return null;
        return {
          bg: C.manila,
          border: C.manilaEdge,
          borderWidth: 1,
          radius: 2.5,
          padX: 5,
          padY: 2.5,
          shadow: "rgba(0,0,0,0.5)",
          shadowBlur: 4,
          shadowY: 2
        };
      },
      // Chalked names need to hold up where they cross a thread or a pin, so
      // they carry a dark stroke rather than a plate.
      halo: function (n) {
        return n.tier === 2 ? { color: "rgba(14,9,4,0.86)", width: 3.6 } : null;
      }
    },

    title: function () {
      return (
        '<div class="brand">' +
        '<div class="brand__card">' +
        '<span class="brand__case">Case File 001</span>' +
        '<h1 class="brand__title">The Red Strings</h1>' +
        '<p class="brand__sub">95 subjects · 153 threads · Beika Ward</p>' +
        "</div>" +
        "</div>"
      );
    },
    legendHead: function () {
      return '<div class="legend__head"><span>Spare Pins</span><em>tap to isolate a thread</em></div>';
    },
    /* Collapsed state: the spool label, plus one dot per thread stock so the
       three materials are still readable without opening the tray. */
    legendTab: function () {
      var order = ["romance", "family", "friendship", "rivalry", "mentor", "colleague", "secret_identity", "adversary"];
      var dots = order
        .map(function (t) {
          var d = TYPES[t];
          return (
            '<i style="background:' + d.color + (d.cord ? ";box-shadow:0 0 0 1px #A6B4C0 inset" : "") + '"></i>'
          );
        })
        .join("");
      return (
        '<span class="legend__tab-label">Spare Pins</span>' +
        '<span class="legend__tab-dots" aria-hidden="true">' + dots + "</span>" +
        '<span class="legend__tab-hint">8 threads</span>'
      );
    },
    searchPlaceholder: "Search the case board…",
    searchHead: function () {
      return '<div class="search__head">Subject index</div>';
    },
    hud: function () {
      return (
        '<div class="hud">' +
        '<span class="hud__row"><b data-k>100%</b></span>' +
        '<span class="hud__row"><b data-labels>0</b> plates</span>' +
        '<span class="hud__row"><b data-progress>0/0</b> prints</span>' +
        "</div>"
      );
    },

    dossier: function (d) {
      var n = d.node;
      var rows = d.threads
        .map(function (t) {
          var st = d.edgeStyle(t.e.type);
          return (
            '<li><button type="button" class="thread" data-goto="' +
            t.other.id +
            '">' +
            '<span class="thread__swatch">' +
            d.swatch(t.e.type) +
            "</span>" +
            '<span class="thread__body">' +
            '<span class="thread__type">' +
            d.typeLabel[t.e.type] +
            "</span>" +
            '<span class="thread__name">' +
            d.esc(t.other.label) +
            "</span>" +
            '<span class="thread__detail">' +
            d.esc(t.e.detail) +
            "</span>" +
            "</span></button></li>"
          );
        })
        .join("");
      return (
        '<div class="file">' +
        '<button type="button" class="dossier__close" aria-label="Close case file">✕</button>' +
        '<header class="file__head">' +
        '<span class="file__stamp">' +
        d.esc(d.faction.label) +
        "</span>" +
        '<h2 class="file__name">' +
        d.esc(n.label) +
        "</h2>" +
        (n.aliases.length ? '<p class="file__alias">also known as ' + d.esc(n.aliases.join(", ")) + "</p>" : "") +
        '<p class="file__role">' +
        d.esc(n.role) +
        "</p>" +
        "</header>" +
        '<p class="file__bio">' +
        d.esc(n.bio) +
        "</p>" +
        '<div class="file__rule"><span>' +
        d.threads.length +
        " threads on file</span></div>" +
        '<ul class="file__threads">' +
        rows +
        "</ul>" +
        "</div>"
      );
    }
  };

  /* ── markers ──────────────────────────────────────────────────────── */
  function knot(ctx, x, y, r, kind) {
    if (kind === "dot") {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.2832);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
  }
  function arrow(ctx, x, y, ang, size) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-size, -size * 0.52);
    ctx.lineTo(-size * 0.72, 0);
    ctx.lineTo(-size, size * 0.52);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  function initials(label) {
    var parts = label.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return label.slice(0, 2).toUpperCase();
  }
})(window);
