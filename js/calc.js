/* ============================================================
 * calc.js —— 纯计算函数（不读写存储、不碰 DOM）
 * 日期约定：一律使用 'YYYY-MM-DD' 字符串 + 整数天序号，
 * 绝不用 new Date('YYYY-MM-DD')（会被解析成 UTC 午夜）与
 * toISOString()（东八区 8 点前会拿到昨天）。
 * ============================================================ */
var Calc = (function () {

  var DAY_MS = 86400000;

  /* ---------- 日期基础 ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function pad4(n) { return ('0000' + n).slice(-4); }

  /* 'YYYY-MM-DD' -> 整数天序号（UTC 纪元天） */
  function toDayNum(s) {
    var p = s.split('-');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / DAY_MS);
  }

  /* 天序号 -> 'YYYY-MM-DD' */
  function fromDayNum(n) {
    var d = new Date(n * DAY_MS);
    return pad4(d.getUTCFullYear()) + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
  }

  /* 本地"今天"（用本地年月日手拼，绝不走 UTC） */
  function todayStr() {
    var d = new Date();
    return pad4(d.getFullYear()) + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDays(dateStr, n) { return fromDayNum(toDayNum(dateStr) + n); }
  function diffDays(a, b) { return toDayNum(a) - toDayNum(b); } /* a - b */

  function weekdayCN(dateStr) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][(toDayNum(dateStr) + 4) % 7];
  }
  /* 1970-01-01 是周四（序号 0），其 weekday = 4；(n + 4) % 7 即星期几 */

  /* ---------- 孕周 ---------- */
  /* ga(dateStr, lmp) -> {days, weeks, rem, label, short} */
  function ga(dateStr, lmp) {
    var d = diffDays(dateStr, lmp);
    var weeks = Math.floor(d / 7);
    var rem = ((d % 7) + 7) % 7;
    var label;
    if (d < 0) label = '孕前 ' + (-d) + ' 天（末次月经前）';
    else label = '孕 ' + weeks + ' 周 + ' + rem + ' 天';
    return {
      days: d,
      weeks: weeks,
      rem: rem,
      label: label,
      short: weeks + 'w' + rem + 'd'
    };
  }

  function edd(lmp) { return addDays(lmp, 280); }        /* 预产期 */
  function daysToEdd(dateStr, lmp) { return 280 - diffDays(dateStr, lmp); }

  /* ---------- 阶段 ---------- */
  function stageOf(gDays) {
    var stages = CONTENT.stages;
    for (var i = 0; i < stages.length; i++) {
      if (gDays >= stages[i].fromDay && gDays <= stages[i].toDay) return stages[i];
    }
    return stages[2]; /* 超期一律按孕晚期 */
  }

  function weekContent(gDays) {
    if (gDays < 0) return null; /* LMP 之前不显示周内容 */
    var w = Math.floor(gDays / 7);
    return CONTENT.weeks[Math.min(w, 42)] || null;
  }

  /* ---------- 产检窗口匹配 ---------- */
  function itemDayRange(it) { return { s: it.sw * 7 + it.sd, e: it.ew * 7 + it.ed }; }

  /* -> { active:[], upcoming:[], past:[] } 每项 {item, dateStart, dateEnd, daysLeft, ended} */
  function matchPrenatal(dateStr, lmp) {
    var g = diffDays(dateStr, lmp);
    var active = [], upcoming = [], past = [];
    CONTENT.prenatal.forEach(function (it) {
      var r = itemDayRange(it);
      var rec = {
        item: it,
        dateStart: addDays(lmp, r.s),
        dateEnd: addDays(lmp, r.e),
        daysLeft: r.s - g,
        ended: g > r.e
      };
      if (g > r.e) past.push(rec);
      else if (g >= r.s) active.push(rec);
      else if (r.s - g <= 28) upcoming.push(rec);
    });
    return { active: active, upcoming: upcoming, past: past };
  }

  /* 下一次产检（任何未来窗口）-> {item, dateStart, daysLeft} | null */
  function nextPrenatal(dateStr, lmp) {
    var g = diffDays(dateStr, lmp);
    var best = null;
    CONTENT.prenatal.forEach(function (it) {
      var r = itemDayRange(it);
      if (r.s > g) {
        if (!best || r.s < best.start) best = { item: it, start: r.s };
      }
    });
    if (!best) return null;
    return { item: best.item, dateStart: addDays(lmp, best.start), daysLeft: best.start - g };
  }

  /* 某日期是否落在任一产检窗口内（日历橙点用） */
  function inPrenatalWindow(dateStr, lmp) {
    var g = diffDays(dateStr, lmp);
    for (var i = 0; i < CONTENT.prenatal.length; i++) {
      var r = itemDayRange(CONTENT.prenatal[i]);
      if (g >= r.s && g <= r.e) return true;
    }
    return false;
  }

  /* ---------- BMI 与推荐增重（WS/T 801-2022） ---------- */
  var BMI_CLASSES = [
    { key: 'thin',   name: '偏瘦',   maxBmi: 18.5, total: [11, 16], rate: [0.37, 0.56] },
    { key: 'normal', name: '正常',   maxBmi: 24.0, total: [8, 14],  rate: [0.26, 0.48] },
    { key: 'over',   name: '超重',   maxBmi: 28.0, total: [7, 11],  rate: [0.22, 0.37] },
    { key: 'obese',  name: '肥胖',   maxBmi: 999,  total: [5, 9],   rate: [0.15, 0.30] }
  ];

  function bmiClass(heightCm, preKg) {
    if (!heightCm || !preKg) return null;
    var m = heightCm / 100;
    var v = preKg / (m * m);
    for (var i = 0; i < BMI_CLASSES.length; i++) {
      if (v < BMI_CLASSES[i].maxBmi) {
        var c = BMI_CLASSES[i];
        return {
          bmi: Math.round(v * 10) / 10,
          cls: c,
          name: c.name,
          totalMin: c.total[0], totalMax: c.total[1],
          rateMin: c.rate[0], rateMax: c.rate[1]
        };
      }
    }
    return null;
  }

  /* 某孕天(g)累计推荐增重区间(kg) */
  function gainBand(g, bc) {
    if (!bc || g < 0) return null;
    if (g <= 97) return { lo: 0, hi: 2 };                 /* 孕早期总增 0-2kg */
    var w = (g - 98) / 7;                                  /* 14w0d 起算的周数 */
    var W = 26;                                            /* 14w0d -> 40w0d 共 26 周 */
    return {
      lo: Math.max(bc.rateMin * w, bc.totalMin * w / W),
      hi: Math.min(2 + bc.rateMax * w, bc.totalMax)
    };
  }

  /* ---------- 自检（设置页"运行自检"） ---------- */
  function selfTest() {
    var L = '2026-08-03';
    var results = [];
    function check(name, cond, got, want) {
      results.push({ name: name, ok: !!cond, got: got, want: want });
    }
    var g = ga('2026-09-25', L);
    check('今天孕周', g.weeks === 7 && g.rem === 4, g.label, '孕 7 周 + 4 天');
    check('距预产期', daysToEdd('2026-09-25', L) === 227, String(daysToEdd('2026-09-25', L)), '227 天');
    check('预产期', edd(L) === '2027-05-10', edd(L), '2027-05-10');
    check('LMP 当天', ga(L, L).weeks === 0 && ga(L, L).rem === 0, ga(L, L).label, '孕 0 周 + 0 天');
    check('建档窗口首日', diffDays('2026-09-14', L) === 42, addDays(L, 42), '2026-09-14');
    check('建档窗口末日', diffDays('2026-11-08', L) === 97, addDays(L, 97), '2026-11-08');
    check('大排畸首日 20w0d', diffDays('2026-12-21', L) === 140, String(diffDays('2026-12-21', L)), '140 天');
    check('孕晚期首日 28w0d', diffDays('2027-02-15', L) === 196, String(diffDays('2027-02-15', L)), '196 天');
    check('40 周整', diffDays('2027-05-10', L) === 280, String(diffDays('2027-05-10', L)), '280 天');
    check('42 周边界', diffDays('2027-05-24', L) === 294, String(diffDays('2027-05-24', L)), '294 天');
    var mp = matchPrenatal('2026-09-25', L);
    check('今天产检应做=建档', mp.active.length > 0 && mp.active[0].item.id === 'first', mp.active.map(function (a) { return a.item.id; }).join(','), 'first');
    var bc = bmiClass(160, 55);
    check('BMI 160/55=正常', bc && bc.name === '正常', bc ? bc.bmi + '/' + bc.name : 'null', '21.5/正常');
    check('BMI 总增范围', bc && bc.totalMin === 8 && bc.totalMax === 14, bc ? bc.totalMin + '-' + bc.totalMax : 'null', '8-14kg');
    var band40 = gainBand(280, bc);
    check('40周推荐带', band40 && band40.lo === 8 && band40.hi === 14, band40 ? band40.lo + '-' + band40.hi : 'null', '8-14kg');
    check('孕早期推荐带', (function () { var b = gainBand(53, bc); return b && b.lo === 0 && b.hi === 2; })(), '0-2', '0-2kg');
    check('星期换算', weekdayCN('2026-09-25') === '周五', weekdayCN('2026-09-25'), '周五');
    return results;
  }

  return {
    pad2: pad2,
    toDayNum: toDayNum,
    fromDayNum: fromDayNum,
    todayStr: todayStr,
    addDays: addDays,
    diffDays: diffDays,
    weekdayCN: weekdayCN,
    ga: ga,
    edd: edd,
    daysToEdd: daysToEdd,
    stageOf: stageOf,
    weekContent: weekContent,
    matchPrenatal: matchPrenatal,
    nextPrenatal: nextPrenatal,
    inPrenatalWindow: inPrenatalWindow,
    bmiClass: bmiClass,
    gainBand: gainBand,
    BMI_CLASSES: BMI_CLASSES,
    selfTest: selfTest
  };
})();
