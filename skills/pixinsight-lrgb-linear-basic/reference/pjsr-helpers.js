// PJSR helpers for pixinsight-lrgb-linear-basic. Pass this file to run_pjsr as
//   include: ["<absolute path of this file>"]
// and write only the calls in `code`. ES5 only: PixInsight evals this in the same scope as `code`.
// MIT License, Copyright (c) 2026 Min Xie.

function mtf(m, x) { if (x <= 0) return 0; if (x >= 1) return 1; return (m - 1) * x / ((2 * m - 1) * x - m); }
function closeId(id) { var w = ImageWindow.windowById(id); if (!w.isNull) w.forceClose(); }
function ub(a, v) { var lo = 0, hi = a.length; while (lo < hi) { var mid = (lo + hi) >> 1; if (a[mid] <= v) lo = mid + 1; else hi = mid; } return lo; }
function lb(a, v) { var lo = 0, hi = a.length; while (lo < hi) { var mid = (lo + hi) >> 1; if (a[mid] < v) lo = mid + 1; else hi = mid; } return lo; }

// Median of channel c inside the box r = [x0, y0, x1, y1].
function boxMed(id, r, c) {
  var img = ImageWindow.windowById(id).mainView.image;
  img.selectedRect = new Rect(r[0], r[1], r[2], r[3]); img.selectedChannel = c;
  var v = img.median(); img.resetSelections(); return v;
}

// Registration borders: pixels to remove per side (L, R, T, B) where a band is zero/NaN or departs
// more than 5% from the median a little further in. Run on each unmodified master; maxDepth about 60.
function scanBorders(id, maxDepth) {
  var img = ImageWindow.windowById(id).mainView.image, W = img.width, H = img.height, res = {};
  function band(side, d0, d1) {
    var vals = [], zero = 0, n = 0, along = (side == "L" || side == "R") ? H : W, a = Math.floor(along * 0.2), b = Math.floor(along * 0.8);
    for (var d = d0; d < d1; ++d) for (var t = a; t < b; t += 7) {
      var x, y; if (side == "L") { x = d; y = t; } else if (side == "R") { x = W - 1 - d; y = t; } else if (side == "T") { x = t; y = d; } else { x = t; y = H - 1 - d; }
      var v = img.sample(x, y, 0); n++; if (v <= 1e-9 || v !== v) zero++; else vals.push(v);
    }
    vals.sort(function (p, q) { return p - q; }); return { zero: zero / n, med: vals.length ? vals[vals.length >> 1] : 0 };
  }
  ["L", "R", "T", "B"].forEach(function (s) {
    var ref = band(s, 60, 100).med, cut = 0;
    for (var d = 0; d < maxDepth; d += 2) { var bd = band(s, d, d + 2); if (bd.zero > 0.01 || (bd.med > 0 && Math.abs(bd.med / ref - 1) > 0.05)) cut = d + 2; }
    res[s] = cut;
  });
  return res;
}

// The standard linked auto-STF, the way PixInsight's AutoStretch computes it: per channel median and
// MADN = 1.4826 MAD; shadows c0 = mean(median - 2.8 MADN), midtones m = mtf(target, mean(median) - c0).
// Display = mtf(m, clamp((x - c0) / (1 - c0))). target 0.25 is the standard.
function autoSTF(id, target) {
  var img = ImageWindow.windowById(id).mainView.image, W = img.width, H = img.height, st = 4, nc = img.numberOfChannels >= 3 ? 3 : 1;
  var n = Math.ceil(W / st) * Math.ceil(H / st), c0 = 0, mm = 0;
  for (var c = 0; c < nc; ++c) {
    var a = new Float32Array(n), k = 0;
    for (var y = 0; y < H; y += st) for (var x = 0; x < W; x += st) a[k++] = img.sample(x, y, c);
    a.sort();
    var md = a[n >> 1], lo = 0, hi = 1;
    for (var it = 0; it < 50; ++it) { var d = (lo + hi) / 2; if (ub(a, md + d) - lb(a, md - d) >= n / 2) hi = d; else lo = d; }
    c0 += md - 2.8 * 1.4826 * hi; mm += md;
  }
  c0 = Math.min(1, Math.max(0, c0 / nc)); mm /= nc;
  return { c0: c0, mm: mm, m: mtf(target, mm - c0) };
}

// Low-signal tiles spread over the frame: tile medians of the channel mean, the lowest `pct` kept,
// then picked farthest-first so they cover the frame. Returns { tiles: [{x0, y0, med, mad}], nTiles, cut }.
function findSkyTiles(id, opts) {
  opts = opts || {};
  var tile = opts.tile || 256, margin = opts.margin || 40, keep = opts.keep || 6, pct = opts.pct || 0.2, st = opts.stride || 4;
  var img = ImageWindow.windowById(id).mainView.image, W = img.width, H = img.height, nc = img.numberOfChannels >= 3 ? 3 : 1, tiles = [];
  for (var y0 = margin; y0 + tile <= H - margin; y0 += tile) for (var x0 = margin; x0 + tile <= W - margin; x0 += tile) {
    var vals = [];
    for (var y = y0; y < y0 + tile; y += st) for (var x = x0; x < x0 + tile; x += st) {
      var s = 0; for (var c = 0; c < nc; ++c) s += img.sample(x, y, c); vals.push(s / nc);
    }
    vals.sort(function (a, b) { return a - b; });
    var md = vals[vals.length >> 1], dev = vals.map(function (v) { return Math.abs(v - md); }).sort(function (a, b) { return a - b; });
    tiles.push({ x0: x0, y0: y0, med: md, mad: dev[dev.length >> 1] });
  }
  var meds = tiles.map(function (t) { return t.med; }).sort(function (a, b) { return a - b; });
  var cut = meds[Math.floor(meds.length * pct)];
  var cand = tiles.filter(function (t) { return t.med <= cut; }).sort(function (a, b) { return a.med - b.med; }), picked = [];
  while (cand.length && picked.length < keep) {
    var best = 0, bd = -1;
    for (var i = 0; i < cand.length; ++i) {
      var d = picked.length ? Math.min.apply(null, picked.map(function (p) { return Math.hypot(p.x0 - cand[i].x0, p.y0 - cand[i].y0); })) : 1e9 - cand[i].med * 1e6;
      if (d > bd) { bd = d; best = i; }
    }
    picked.push(cand.splice(best, 1)[0]);
  }
  return { tiles: picked, nTiles: tiles.length, cut: cut };
}

// Mean over the tiles of each channel's tile median.
function skyMedians(id, tiles, size) {
  size = size || 256;
  var nc = ImageWindow.windowById(id).mainView.image.numberOfChannels, med = [];
  for (var c = 0; c < nc; ++c) med.push(0);
  tiles.forEach(function (t) { for (var c = 0; c < nc; ++c) med[c] += boxMed(id, [t.x0, t.y0, t.x0 + size, t.y0 + size], c) / tiles.length; });
  return med;
}

// A display copy `outId` of `id` through one fixed STF (from autoSTF). For previews only; it never
// feeds back into the processing.
function stfCopy(id, outId, s) {
  closeId(outId);
  var P = new PixelMath;
  P.useSingleExpression = true;
  P.expression = "mtf(" + s.m + ", max(0, min(1, ($T - " + s.c0 + ")/(1 - " + s.c0 + "))))";
  P.rescale = false; P.truncate = true; P.truncateLower = 0; P.truncateUpper = 1;
  P.createNewImage = true; P.showNewImage = true; P.newImageId = outId;
  P.executeOn(ImageWindow.windowById(id).mainView); processEvents();
}

// Embed the STF s in view `id`, save it as XISF at `path` (forward slashes), reopen and read it back.
// Returns { set, back, same }.
function saveWithSTF(id, path, s) {
  var w = ImageWindow.windowById(id), row = [s.m, s.c0, 1, 0, 1];
  w.mainView.stf = [row, row, row, [0.5, 0, 1, 0, 1]];
  var dir = File.extractDrive(path) + File.extractDirectory(path);
  if (!File.directoryExists(dir)) File.createDirectory(dir, true);
  w.saveAs(path, false, false, false, false);
  var re = ImageWindow.open(path), back = re[0].mainView.stf[0].slice(0, 5); re[0].forceClose();
  var same = true; for (var i = 0; i < 5; ++i) if (Math.abs(back[i] - row[i]) > 1e-9) same = false;
  return { set: row, back: back, same: same };
}

// Add a constant per channel in place: off = [dR, dG, dB]. Values are clamped at 0 and not above.
function addOffsets(id, off) {
  var P = new PixelMath;
  P.useSingleExpression = false;
  P.expression = "max(0, $T + " + off[0] + ")";
  P.expression1 = "max(0, $T + " + off[1] + ")";
  P.expression2 = "max(0, $T + " + off[2] + ")";
  P.rescale = false; P.truncate = false; P.createNewImage = false;
  P.executeOn(ImageWindow.windowById(id).mainView); processEvents();
}

// Sky leveling in one call, in place: measure the sky-tile medians of `id`, add offsets that bring R and
// B to G, and measure again. The offsets never leave PixInsight.
function levelSky(id, tiles, size) {
  var before = skyMedians(id, tiles, size), off = [before[1] - before[0], 0, before[1] - before[2]];
  addOffsets(id, off);
  var after = skyMedians(id, tiles, size), g = after[1];
  return { before: before, offsets: off, after: after,
           rgPct: 100 * Math.abs(after[0] - g) / g, bgPct: 100 * Math.abs(after[2] - g) / g,
           gShiftPct: 100 * Math.abs(g - before[1]) / before[1] };
}

// Pixel offset between two plate-solved views: the image points of `refId` (centre and four points
// at 40% of the half-size) mapped to the sky and back into `id`. Returns the largest offset in px.
function solutionOffset(refId, id) {
  var a = ImageWindow.windowById(refId), b = ImageWindow.windowById(id), W = a.mainView.image.width, H = a.mainView.image.height, worst = 0;
  [[0.5, 0.5], [0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]].forEach(function (f) {
    var p = new Point(W * f[0], H * f[1]), sky = a.imageToCelestial(p), q = b.celestialToImage(sky);
    worst = Math.max(worst, Math.hypot(q.x - p.x, q.y - p.y));
  });
  return worst;
}
