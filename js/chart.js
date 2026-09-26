/* ============================================================
 * chart.js —— 体重趋势 SVG 图（手写，无外部库）
 *  - 实际体重：2px 蓝线 + ≥8px 圆点（2px 表面色环）
 *  - 推荐增重区间带：浅绿语境填充（文字标签承载含义）
 *  - 孕前体重参考线：墨灰细线 + 直接标注
 *  - 悬停/点按：十字线吸附最近数据点 + HTML tooltip
 *  - 文字一律用墨色 token，不用系列色；单序列无需图例框
 * 遵循 dataviz 方法：2px 线、r≥4 点、≥24px 命中区、选择性直接标注
 * ============================================================ */
var Chart = (function () {

  var W = 360, H = 264;                       /* viewBox */
  var ML = 44, MR = 14, MT = 20, MB = 30;     /* 边距 */
  var PW = W - ML - MR, PH = H - MT - MB;     /* 绘图区 */

  var C = {
    surface: '#fcfcfb',
    line: '#2a78d6',            /* 实际体重（唯一数据系列） */
    bandFill: 'rgba(143,208,176,0.30)',
    bandEdge: 'rgba(78,159,120,0.55)',
    grid: '#e1e0d9',
    axis: '#c3c2b7',
    mute: '#898781',            /* 轴文字/参考线（墨色 token） */
    ink: '#52514e',             /* 二级文字 */
    crosshair: 'rgba(61,58,56,0.22)',
    ring: '#fcfcfb'
  };

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function niceTicks(lo, hi, n) {
    var span = hi - lo;
    if (span <= 0) span = 1;
    var step = Math.pow(10, Math.floor(Math.log(span / n) / Math.LN10));
    var err = span / n / step;
    if (err >= 7.5) step *= 10; else if (err >= 3.5) step *= 5; else if (err >= 1.5) step *= 2;
    var ticks = [];
    for (var v = Math.ceil(lo / step) * step; v <= hi + step * 0.001; v += step) {
      ticks.push(Math.round(v * 100) / 100);
    }
    return ticks;
  }

  function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  /* ============ 主渲染 ============ */
  /* state: { weights:[{date,kg,note}], lmp, preWeight, bc } bc=Calc.bmiClass 结果或 null */
  function render(container, state) {
    var weights = (state.weights || []).slice();
    var lmp = state.lmp;
    var pre = state.preWeight ? Number(state.preWeight) : null;
    var bc = state.bc || null;

    container.innerHTML = '';
    container.style.position = 'relative';

    /* ---- 空状态 ---- */
    if (!weights.length) {
      var empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = '还没有体重记录';
      container.appendChild(empty);
      return null;
    }

    /* ---- 数据点（孕天 -> kg） ---- */
    var pts = [];
    weights.forEach(function (w) {
      var kg = Number(w.kg);
      if (!w.date || !isFinite(kg)) return;
      pts.push({ date: w.date, day: Calc.diffDays(w.date, lmp), kg: kg, note: w.note || '' });
    });
    pts.sort(function (a, b) { return a.day - b.day; });
    if (!pts.length) {
      var empty2 = document.createElement('div');
      empty2.className = 'chart-empty';
      empty2.textContent = '还没有体重记录';
      container.appendChild(empty2);
      return null;
    }

    /* ---- 坐标域 ---- */
    var xmin = Math.min(-30, pts[0].day);
    var xmax = Math.max(294, pts[pts.length - 1].day);
    var ymin = Infinity, ymax = -Infinity;
    pts.forEach(function (p) { ymin = Math.min(ymin, p.kg); ymax = Math.max(ymax, p.kg); });
    if (pre !== null) { ymin = Math.min(ymin, pre); ymax = Math.max(ymax, pre); }
    /* 推荐带上界也要纳入（仅在有 BMI 分类时） */
    var hasBand = false;
    if (bc && pre !== null) {
      hasBand = true;
      for (var g = 0; g <= 294; g += 7) {
        var b = Calc.gainBand(g, bc);
        if (!b) continue;
        ymin = Math.min(ymin, pre + b.lo);
        ymax = Math.max(ymax, pre + b.hi);
      }
    }
    var pad = (ymax - ymin) < 4 ? 2 : 1.5;
    ymin = Math.floor((ymin - pad) * 2) / 2;
    ymax = Math.ceil((ymax + pad) * 2) / 2;

    function X(day) { return ML + (day - xmin) / (xmax - xmin) * PW; }
    function Y(kg) { return MT + (ymax - kg) / (ymax - ymin) * PH; }

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', '孕期体重趋势图');

    var parts = [];

    /* ---- 横向网格线 + Y 轴刻度 ---- */
    var yticks = niceTicks(ymin, ymax, 5);
    yticks.forEach(function (v) {
      parts.push('<line x1="' + ML + '" y1="' + Y(v).toFixed(1) + '" x2="' + (W - MR) + '" y2="' + Y(v).toFixed(1) + '" stroke="' + C.grid + '" stroke-width="1"/>');
      parts.push('<text x="' + (ML - 6) + '" y="' + (Y(v) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" fill="' + C.mute + '">' + v + '</text>');
    });

    /* ---- 推荐区间带 ---- */
    if (hasBand) {
      var bandPts = [];
      for (g = 0; g <= 294; g += 7) {
        var bd = Calc.gainBand(g, bc);
        if (!bd) continue;
        bandPts.push({ g: g, lo: pre + bd.lo, hi: pre + bd.hi });
      }
      var poly = '';
      bandPts.forEach(function (b) { poly += X(b.g).toFixed(1) + ',' + Y(b.hi).toFixed(1) + ' '; });
      for (var i = bandPts.length - 1; i >= 0; i--) poly += X(bandPts[i].g).toFixed(1) + ',' + Y(bandPts[i].lo).toFixed(1) + ' ';
      parts.push('<polygon points="' + poly.trim() + '" fill="' + C.bandFill + '"/>');
      /* 上下边界线 */
      var loPts = '', hiPts = '';
      bandPts.forEach(function (b) {
        loPts += X(b.g).toFixed(1) + ',' + Y(b.lo).toFixed(1) + ' ';
        hiPts += X(b.g).toFixed(1) + ',' + Y(b.hi).toFixed(1) + ' ';
      });
      parts.push('<polyline points="' + loPts.trim() + '" fill="none" stroke="' + C.bandEdge + '" stroke-width="1"/>');
      parts.push('<polyline points="' + hiPts.trim() + '" fill="none" stroke="' + C.bandEdge + '" stroke-width="1"/>');
      /* 带内标注（墨色文字承载含义） */
      var labX = X(Math.min(294, Math.max(0, xmax - 150)));
      var labY = Y(pre + (bc.totalMin + bc.totalMax) / 2);
      parts.push('<text x="' + labX.toFixed(1) + '" y="' + labY.toFixed(1) + '" font-size="9.5" fill="' + C.mute + '">推荐增重区间</text>');
    }

    /* ---- 孕前体重参考线 ---- */
    if (pre !== null && xmin <= 0 && xmax >= 0) {
      parts.push('<line x1="' + ML + '" y1="' + Y(pre).toFixed(1) + '" x2="' + (W - MR) + '" y2="' + Y(pre).toFixed(1) + '" stroke="' + C.axis + '" stroke-width="1"/>');
      parts.push('<text x="' + (W - MR - 4) + '" y="' + (Y(pre) - 4).toFixed(1) + '" text-anchor="end" font-size="9.5" fill="' + C.mute + '">孕前 ' + fmt1(pre) + 'kg</text>');
    }

    /* ---- X 轴刻度（孕周） ---- */
    var xWeekTicks = [];
    var wkStart = Math.ceil(xmin / 7) * 7;
    for (var wk = wkStart; wk <= xmax; wk += 7) {
      xWeekTicks.push(wk);
    }
    xWeekTicks.forEach(function (d) {
      var isMajor = (d % 56 === 0);
      parts.push('<line x1="' + X(d).toFixed(1) + '" y1="' + MT + '" x2="' + X(d).toFixed(1) + '" y2="' + (MT + PH) + '" stroke="' + C.grid + '" stroke-width="1"/>');
      parts.push('<line x1="' + X(d).toFixed(1) + '" y1="' + (MT + PH) + '" x2="' + X(d).toFixed(1) + '" y2="' + (MT + PH + 4) + '" stroke="' + C.axis + '" stroke-width="1"/>');
      var label = (d % 56 === 0) ? (d / 7) + '周' : '';
      if (d === 0) label = '0周(LMP)';
      if (label && isMajor) {
        parts.push('<text x="' + X(d).toFixed(1) + '" y="' + (MT + PH + 15) + '" text-anchor="middle" font-size="9.5" fill="' + C.mute + '">' + label + '</text>');
      }
    });

    /* ---- 实际体重折线 ---- */
    if (pts.length > 1) {
      var linePts = '';
      pts.forEach(function (p) { linePts += X(p.day).toFixed(1) + ',' + Y(p.kg).toFixed(1) + ' '; });
      parts.push('<polyline points="' + linePts.trim() + '" fill="none" stroke="' + C.line + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
    }

    /* ---- 系列标识（单序列不用图例框，用线键标注） ---- */
    parts.push('<line x1="' + (ML + 2) + '" y1="14" x2="' + (ML + 14) + '" y2="14" stroke="' + C.line + '" stroke-width="2" stroke-linecap="round"/>');
    parts.push('<text x="' + (ML + 18) + '" y="17" font-size="9.5" fill="' + C.ink + '">实际体重</text>');

    /* ---- 数据点 + 命中区 ---- */
    var circles = [];
    pts.forEach(function (p, idx) {
      var cx = X(p.day), cy = Y(p.kg);
      /* 2px 表面色环 + 填充点（r≥4） */
      parts.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="6.5" fill="' + C.ring + '"/>');
      parts.push('<circle class="pt-dot" data-i="' + idx + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="4.5" fill="' + C.line + '"/>');
      /* ≥24px 透明命中区 */
      parts.push('<circle class="pt-hit" data-i="' + idx + '" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="12" fill="transparent"/>');
      circles.push({ i: idx, x: cx, y: cy });
    });

    /* ---- 最新点直接标注（选择性：只标端点） ---- */
    var last = pts[pts.length - 1];
    var lastX = X(last.day), lastY = Y(last.kg);
    var labelAnchor = 'start', labelX = lastX + 8;
    if (lastX > W - MR - 60) { labelAnchor = 'end'; labelX = lastX - 8; }
    parts.push('<text x="' + labelX.toFixed(1) + '" y="' + (lastY - 7).toFixed(1) + '" text-anchor="' + labelAnchor + '" font-size="10" font-weight="700" fill="' + C.ink + '">' + fmt1(last.kg) + 'kg</text>');

    /* ---- 十字线（默认隐藏） ---- */
    parts.push('<line id="chart-cross" x1="0" y1="' + MT + '" x2="0" y2="' + (MT + PH) + '" stroke="' + C.crosshair + '" stroke-width="1" visibility="hidden"/>');

    svg.innerHTML = parts.join('');

    /* ---- HTML tooltip ---- */
    var tip = document.createElement('div');
    tip.className = 'chart-tip hidden';
    container.appendChild(tip);
    container.appendChild(svg);

    var cross = svg.querySelector('#chart-cross');

    function showTip(i) {
      var p = pts[i];
      if (!p) return;
      var g = Calc.ga(p.date, lmp);
      var delta = '';
      if (i > 0) {
        var d = Math.round((p.kg - pts[i - 1].kg) * 10) / 10;
        delta = '较上次 ' + (d >= 0 ? '+' : '') + d.toFixed(1) + 'kg';
      }
      tip.innerHTML = '';
      var rows = [
        ['日期', p.date + ' · ' + g.label],
        ['体重', p.kg.toFixed(1) + 'kg']
      ];
      if (delta) rows.push(['变化', delta]);
      if (p.note) rows.push(['备注', p.note]);
      rows.forEach(function (r) {
        var row = document.createElement('div');
        row.className = 'chart-tip-row';
        var k = document.createElement('span');
        k.className = 'chart-tip-k';
        k.textContent = r[0];
        var v = document.createElement('span');
        v.className = 'chart-tip-v';
        v.textContent = r[1];
        row.appendChild(k); row.appendChild(v);
        tip.appendChild(row);
      });
      tip.classList.remove('hidden');
      var box = container.getBoundingClientRect();
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var px = (circles[i].x / W) * box.width;
      var py = (circles[i].y / H) * box.height;
      var left = px + 14;
      if (left + tw > box.width - 4) left = px - tw - 14;
      var top = py - th - 10;
      if (top < 0) top = py + 14;
      tip.style.left = Math.max(2, left) + 'px';
      tip.style.top = top + 'px';
      /* 十字线吸附 */
      cross.setAttribute('x1', circles[i].x.toFixed(1));
      cross.setAttribute('x2', circles[i].x.toFixed(1));
      cross.setAttribute('visibility', 'visible');
    }
    function hideTip() {
      tip.classList.add('hidden');
      cross.setAttribute('visibility', 'hidden');
    }

    function nearest(evt) {
      var rect = svg.getBoundingClientRect();
      var mx = (evt.clientX - rect.left) / rect.width * W;
      var best = -1, bestD = 1e9;
      for (var i = 0; i < circles.length; i++) {
        var d = Math.abs(circles[i].x - mx);
        if (d < bestD) { bestD = d; best = i; }
      }
      return bestD <= 24 ? best : -1;
    }

    svg.addEventListener('pointermove', function (evt) {
      var i = nearest(evt);
      if (i >= 0) showTip(i); else hideTip();
    });
    svg.addEventListener('pointerleave', hideTip);
    svg.addEventListener('click', function (evt) {
      var i = nearest(evt);
      if (i >= 0) showTip(i); else hideTip();
    });

    return { svg: svg, tip: tip };
  }

  return { render: render };
})();
