/* ============================================================
 * app.js —— 全部 UI 逻辑
 * 登录 → 日历/详情弹层/体重/建议/设置 五个模块
 * 权限：未登录仅登录页；亲友只读+提建议；咕嘟全功能
 * ============================================================ */
var App = (function () {

  var Auth = Storage.Auth;

  /* ================= 状态 ================= */
  var state = {
    settings: null,
    weights: [],
    events: [],
    suggestions: [],
    viewYear: 0, viewMonth: 0,
    selectedDate: null,
    selectedRole: null,
    loginFails: 0,
    loginLockUntil: 0,
    initialOpened: false
  };

  /* ================= 工具 ================= */
  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1); }

  /* 桌面端（≥720px）：详情内联在日历下方；手机端：底部弹层 */
  function isDesktop() {
    return window.matchMedia && window.matchMedia('(min-width: 720px)').matches;
  }

  /* 记录人显示名：local 模式存角色名；cloud 模式存哈希 */
  function byName(createdBy) {
    if (!createdBy) return '';
    if (createdBy === 'family' || createdBy === 'owner') return CFG.USERS[createdBy].name;
    for (var k in CFG.USERS) {
      if (CFG.USERS.hasOwnProperty(k) && CFG.USERS[k].hash === createdBy) return CFG.USERS[k].name;
    }
    return '访客';
  }

  /* ================= 登录 ================= */
  function initLogin() {
    var roleBtns = $('login-roles').querySelectorAll('.role-btn');
    roleBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var role = btn.getAttribute('data-role');
        if (role === 'family') {
          /* 亲友免密：点击即进 */
          state.selectedRole = 'family';
          roleBtns.forEach(function (b) { b.classList.remove('selected'); });
          btn.classList.add('selected');
          $('login-error').textContent = '';
          Auth.login('family', null);
          enterApp();
          return;
        }
        /* 咕嘟：需要密码 */
        state.selectedRole = 'owner';
        roleBtns.forEach(function (b) { b.classList.remove('selected'); });
        btn.classList.add('selected');
        $('login-error').textContent = '';
        $('login-pwd').classList.remove('hidden');
        $('login-btn').classList.remove('hidden');
        $('login-pwd').focus();
      });
    });
    $('login-btn').addEventListener('click', doLogin);
    $('login-pwd').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') doLogin();
    });
    /* 密码框只在选择「咕嘟」后出现 */
    $('login-pwd').classList.add('hidden');
    $('login-btn').classList.add('hidden');
  }

  function doLogin() {
    var errEl = $('login-error');
    if (Date.now() < state.loginLockUntil) {
      errEl.textContent = '尝试次数过多，请 ' + Math.ceil((state.loginLockUntil - Date.now()) / 1000) + ' 秒后再试';
      return;
    }
    if (state.selectedRole !== 'owner') return;
    var pwd = $('login-pwd').value;
    if (!pwd) {
      errEl.textContent = '请输入密码';
      return;
    }
    var user = CFG.USERS.owner;
    SHA.hash(pwd).then(function (hex) {
      if (hex === user.hash) {
        state.loginFails = 0;
        errEl.textContent = '';
        $('login-pwd').value = '';
        /* 凭证传「密码原文」而非哈希：哈希是公开的，服务端只认原文 */
        Auth.login('owner', pwd);
        enterApp();
      } else {
        state.loginFails++;
        if (state.loginFails >= 3) {
          state.loginLockUntil = Date.now() + 30000;
          state.loginFails = 0;
          errEl.textContent = '密码连续错误，请 30 秒后再试';
        } else {
          errEl.textContent = '密码不正确，请重试';
        }
      }
    });
  }

  function showLogin() {
    $('login-view').classList.remove('hidden');
    $('app-view').classList.add('hidden');
    $('detail-panel').classList.add('hidden');
    $('detail-mask').classList.add('hidden');
  }

  function logout() {
    Auth.clear();
    closeDetail();
    state.settings = null;
    state.weights = [];
    state.events = [];
    state.suggestions = [];
    showLogin();
  }

  /* ================= 进入应用 ================= */
  function enterApp() {
    $('login-view').classList.add('hidden');
    $('app-view').classList.remove('hidden');
    $('user-name').textContent = '当前：' + Auth.name;
    $('settings-role').textContent = Auth.name + (Auth.isOwner() ? '（咕嘟·可编辑）' : '（亲友·只读）');
    switchTab('calendar');
    loadData();
  }

  function loadData() {
    Promise.all([Storage.getSettings(), Storage.listWeights(), Storage.listEvents(), Storage.listSuggestions()])
      .then(function (rs) {
        state.settings = rs[0] || {};
        if (!state.settings.lmp) state.settings.lmp = CFG.DEFAULT_LMP;
        state.weights = rs[1] || [];
        state.events = rs[2] || [];
        state.suggestions = rs[3] || [];
        showOffline(Storage.offline);
        renderAll();
        /* 桌面端首次进入：自动展示今天的详情（显示在日历下方） */
        if (!state.initialOpened && isDesktop()) {
          state.initialOpened = true;
          openDetail(Calc.todayStr());
        }
      })
      .catch(function (e) {
        if (e && e.code === 'NOT_LOGIN') { showLogin(); return; }
        if (e && e.code === 'OFFLINE') { return; }
        toast((e && e.message) || '加载失败');
      });
  }

  function refreshData() {
    loadData();
  }

  function showOffline(on) {
    $('offline-banner').classList.toggle('hidden', !on);
  }

  /* ================= 渲染总入口 ================= */
  function renderAll() {
    renderTodayCard();
    renderCalendar();
    renderWeightPage();
    renderSuggestPage();
    renderSettings();
  }

  /* ================= 今日卡 ================= */
  function renderTodayCard() {
    var today = Calc.todayStr();
    var lmp = state.settings.lmp;
    var g = Calc.ga(today, lmp);
    $('today-date').textContent = today + ' · ' + Calc.weekdayCN(today);
    $('today-ga').textContent = g.label;
    var stage = Calc.stageOf(g.days);
    var stageEl = $('today-stage');
    stageEl.textContent = stage.name;
    stageEl.className = 'today-stage ' + stage.id;
    var pct = Math.max(0, Math.min(100, Math.round(g.days / 280 * 100)));
    $('progress-fill').style.width = pct + '%';
    $('today-edd').textContent = '预产期 ' + Calc.edd(lmp) + ' · 还有 ' + Calc.daysToEdd(today, lmp) + ' 天';
    var next = Calc.nextPrenatal(today, lmp);
    if (next) {
      $('today-next-check').textContent = '下次产检：' + next.item.name + '（' + next.dateStart + ' 起，还有 ' + next.daysLeft + ' 天）';
    } else {
      $('today-next-check').textContent = '产检已全部完成，静待发动';
    }
  }

  /* ================= 日历 ================= */
  function initCalendar() {
    var today = Calc.todayStr();
    state.viewYear = +today.slice(0, 4);
    state.viewMonth = +today.slice(5, 7);
    $('cal-prev').addEventListener('click', function () {
      state.viewMonth--;
      if (state.viewMonth < 1) { state.viewMonth = 12; state.viewYear--; }
      renderCalendar();
    });
    $('cal-next').addEventListener('click', function () {
      state.viewMonth++;
      if (state.viewMonth > 12) { state.viewMonth = 1; state.viewYear++; }
      renderCalendar();
    });
    $('cal-grid').addEventListener('click', function (e) {
      var cell = e.target.closest ? e.target.closest('.cal-cell') : null;
      if (!cell) return;
      if (cell.classList.contains('off')) return;
      openDetail(cell.getAttribute('data-date'));
    });
  }

  function weightByDate() {
    var m = {};
    state.weights.forEach(function (w) { m[w.date] = w; });
    return m;
  }
  function eventsByDate() {
    var m = {};
    state.events.forEach(function (e) {
      if (!m[e.date]) m[e.date] = [];
      m[e.date].push(e);
    });
    return m;
  }

  function renderCalendar() {
    if (!state.settings || !state.settings.lmp) return; /* 数据未加载完 */
    var lmp = state.settings.lmp;
    var today = Calc.todayStr();
    var wMap = weightByDate();
    var eMap = eventsByDate();
    var minDate = Calc.addDays(lmp, CFG.BROWSE_MIN_DAYS);
    var maxDate = Calc.addDays(lmp, CFG.BROWSE_MAX_DAYS);

    $('cal-month-label').textContent = state.viewYear + ' 年 ' + state.viewMonth + ' 月';

    /* 当月第一天是周几（0=周日） */
    var firstDow = (Calc.toDayNum(state.viewYear + '-' + Calc.pad2(state.viewMonth) + '-01') + 4) % 7;
    var daysInMonth = new Date(Date.UTC(state.viewYear, state.viewMonth, 0)).getUTCDate();

    var grid = $('cal-grid');
    grid.innerHTML = '';
    /* 前置空白格 */
    for (var i = 0; i < firstDow; i++) {
      grid.appendChild(el('div', 'cal-cell off', ''));
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var date = state.viewYear + '-' + Calc.pad2(state.viewMonth) + '-' + Calc.pad2(d);
      var inRange = date >= minDate && date <= maxDate;
      var cell = el('div', 'cal-cell' + (inRange ? ' clickable' : ' off'));
      cell.setAttribute('data-date', date);
      if (inRange && date === today) cell.classList.add('today');
      if (inRange && date === state.selectedDate) cell.classList.add('selected');

      var dayEl = el('div', 'cal-day', String(d));
      cell.appendChild(dayEl);

      if (inRange) {
        var dots = el('div', 'cal-dots', '');
        var hasW = wMap[date];
        var hasCheck = Calc.inPrenatalWindow(date, lmp);
        var hasEvent = false;
        var evs = eMap[date] || [];
        for (var j = 0; j < evs.length; j++) {
          if (evs[j].type === 'checkup') hasCheck = true;
          if (evs[j].type === 'event') hasEvent = true;
        }
        if (hasW) dots.appendChild(el('i', 'dot dot-weight', ''));
        if (hasCheck) dots.appendChild(el('i', 'dot dot-check', ''));
        if (hasEvent) dots.appendChild(el('i', 'dot dot-event', ''));
        if (dots.childNodes.length) cell.appendChild(dots);
      }
      grid.appendChild(cell);
    }
  }

  /* ================= 详情弹层 ================= */
  function initDetail() {
    $('detail-close').addEventListener('click', closeDetail);
    $('detail-mask').addEventListener('click', closeDetail);
  }

  function openDetail(date) {
    state.selectedDate = date;
    renderCalendar();
    var lmp = state.settings.lmp;
    var g = Calc.ga(date, lmp);
    $('detail-date').textContent = date + ' · ' + Calc.weekdayCN(date);
    $('detail-ga').textContent = g.label;

    var body = $('detail-body');
    body.innerHTML = '';
    body.appendChild(sectionTips(date, lmp, g));
    body.appendChild(sectionPrenatal(date, lmp));
    body.appendChild(sectionEvents(date));
    body.appendChild(sectionWeight(date));
    body.appendChild(sectionBabyMom(g));
    body.appendChild(sectionFood(g, date));
    body.appendChild(sectionLife(g));
    body.appendChild(sectionSource());

    $('detail-panel').classList.remove('hidden');
    $('detail-mask').classList.remove('hidden');
    $('detail-hint').classList.add('hidden');
    body.scrollTop = 0;
    /* 桌面端：把日历下方的详情滚入视野 */
    if (isDesktop()) {
      $('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function closeDetail() {
    $('detail-panel').classList.add('hidden');
    $('detail-mask').classList.add('hidden');
    state.selectedDate = null;
    $('detail-hint').classList.toggle('hidden', !isDesktop());
    renderCalendar();
  }

  /* ① 本周提醒 */
  function sectionTips(date, lmp, g) {
    var sec = el('div', 'detail-section');
    var wc = Calc.weekContent(g.days);
    if (wc) {
      sec.appendChild(el('h3', '', '📌 本周提醒（' + wc.title + ' · ' + wc.size + '）'));
      var ul = el('ul');
      wc.tips.forEach(function (t) { ul.appendChild(el('li', '', t)); });
      sec.appendChild(ul);
    } else {
      sec.appendChild(el('h3', '', '📌 提醒'));
      sec.appendChild(el('div', '', '今天是末次月经前的日期，还没有孕期内容。'));
    }
    return sec;
  }

  /* ② 产检 */
  function sectionPrenatal(date, lmp) {
    var sec = el('div', 'detail-section');
    sec.appendChild(el('h3', '', '🏥 产检提醒'));
    var mp = Calc.matchPrenatal(date, lmp);

    if (!mp.active.length && !mp.upcoming.length) {
      sec.appendChild(el('div', '', '当前没有处于窗口期或未来 4 周内的产检。'));
    }
    mp.active.forEach(function (r) {
      sec.appendChild(pCheckCard(r, 'active', date));
    });
    mp.upcoming.forEach(function (r) {
      sec.appendChild(pCheckCard(r, 'upcoming', date));
    });

    /* 咕嘟自定义的检查提醒 */
    var eMap = eventsByDate();
    var evs = (eMap[date] || []).filter(function (e) { return e.type === 'checkup'; });
    evs.forEach(function (e) {
      var card = el('div', 'p-check active');
      card.appendChild(el('div', 'name', '✍️ ' + e.title));
      if (e.detail) card.appendChild(el('div', 'items', e.detail));
      if (Auth.isOwner()) {
        var ops = el('div', 'ops');
        var del = el('button', 'btn-sm btn-danger', '删除');
        del.addEventListener('click', function () {
          confirmModal('删除这条检查提醒？', function () {
            Storage.deleteEvent(e.id).then(function () {
              toast('已删除');
              refreshData();
            }).catch(function (err) { toast(err.message); });
          });
        });
        ops.appendChild(del);
        card.appendChild(ops);
      }
      sec.appendChild(card);
    });

    if (mp.past.length) {
      var det = el('details', '', '');
      var sum = el('summary', '', '查看已过期产检（' + mp.past.length + '）');
      det.appendChild(sum);
      mp.past.forEach(function (r) { det.appendChild(pCheckCard(r, 'past', date)); });
      sec.appendChild(det);
    }

    var freq = el('details', '', '');
    freq.appendChild(el('summary', '', '产检频率对照（中国 / WHO / ACOG）'));
    var ul = el('ul');
    CONTENT.prenatalFrequency.forEach(function (f) {
      ul.appendChild(el('li', '', f.range + '：' + f.freq + '（' + CONTENT.sources[f.src].short + '）'));
    });
    freq.appendChild(ul);
    sec.appendChild(freq);
    return sec;
  }

  function pCheckCard(r, cls, date) {
    var it = r.item;
    var card = el('div', 'p-check ' + cls);
    var nameRow = el('div', 'name', it.name);
    nameRow.appendChild(el('span', 'tag ' + (it.must ? 'tag-must' : 'tag-opt'), it.must ? '必查' : '备查'));
    if (it.src === 'cn2018') nameRow.appendChild(el('span', 'tag tag-who', '中国指南'));
    card.appendChild(nameRow);
    var rangeTxt = r.dateStart + ' ~ ' + r.dateEnd;
    if (cls === 'active') rangeTxt += '（应做）';
    else if (cls === 'upcoming') rangeTxt += '（' + r.daysLeft + ' 天后开始）';
    else rangeTxt += '（已过期）';
    card.appendChild(el('div', 'range', rangeTxt));
    card.appendChild(el('div', 'items', it.items.join('；')));
    if (it.note) card.appendChild(el('div', 'items', '提示：' + it.note));
    return card;
  }

  /* ③ 今日事项 */
  function sectionEvents(date) {
    var sec = el('div', 'detail-section');
    var h = el('h3', '', '📋 今日事项');
    if (Auth.isOwner()) {
      var addBtn = el('button', 'btn-sm', '＋ 添加');
      addBtn.addEventListener('click', function () { openEventModal(date, null); });
      h.appendChild(addBtn);
    }
    sec.appendChild(h);
    var eMap = eventsByDate();
    var evs = (eMap[date] || []).filter(function (e) { return e.type === 'event'; });
    if (!evs.length) {
      sec.appendChild(el('div', 'empty-tip', Auth.isOwner() ? '今天还没有安排，点"添加"记一笔' : '今天没有安排'));
    }
    evs.forEach(function (e) {
      var card = el('div', 'detail-event');
      card.appendChild(el('div', 'name', e.title));
      if (e.detail) card.appendChild(el('div', 'desc', e.detail));
      if (Auth.isOwner()) {
        var ops = el('div', 'ops');
        var edit = el('button', 'btn-sm', '编辑');
        edit.addEventListener('click', function () { openEventModal(date, e); });
        var del = el('button', 'btn-sm btn-danger', '删除');
        del.addEventListener('click', function () {
          confirmModal('删除这条事项？', function () {
            Storage.deleteEvent(e.id).then(function () { toast('已删除'); refreshData(); }).catch(function (err) { toast(err.message); });
          });
        });
        ops.appendChild(edit);
        ops.appendChild(del);
        card.appendChild(ops);
      }
      sec.appendChild(card);
    });
    return sec;
  }

  /* ④ 今日体重 */
  function sectionWeight(date) {
    var sec = el('div', 'detail-section');
    sec.appendChild(el('h3', '', '⚖️ 今日体重'));
    var wMap = weightByDate();
    var w = wMap[date];
    if (w) {
      var card = el('div', 'weight-of-day');
      card.appendChild(el('div', 'kg', fmt1(w.kg) + ' kg'));
      if (w.note) card.appendChild(el('div', '', '备注：' + w.note));
      card.appendChild(el('div', '', '记录人：' + byName(w.entered_by)));
      if (Auth.isOwner()) {
        var ops = el('div', 'ops');
        var edit = el('button', 'btn-sm', '修改');
        edit.addEventListener('click', function () { openWeightModal(w); });
        var del = el('button', 'btn-sm btn-danger', '删除');
        del.addEventListener('click', function () {
          confirmModal('删除 ' + date + ' 的体重记录？', function () {
            Storage.deleteWeight(w.id).then(function () { toast('已删除'); refreshData(); }).catch(function (err) { toast(err.message); });
          });
        });
        ops.appendChild(edit);
        ops.appendChild(del);
        card.appendChild(ops);
      }
      sec.appendChild(card);
    } else if (Auth.isOwner()) {
      var form = el('div', 'form-card');
      form.appendChild(el('h3', '', '记录当日体重'));
      var kg = el('input', '', '');
      kg.type = 'number'; kg.step = '0.1'; kg.min = '20'; kg.max = '200'; kg.inputMode = 'decimal';
      kg.placeholder = '体重 kg';
      var note = el('input', '', '');
      note.type = 'text'; note.placeholder = '备注（可选）';
      var save = el('button', 'btn-primary btn-block', '保存');
      save.style.marginTop = '10px';
      save.addEventListener('click', function () {
        submitWeight(date, kg.value, note.value);
      });
      form.appendChild(kg);
      form.appendChild(note);
      form.appendChild(save);
      sec.appendChild(form);
    } else {
      sec.appendChild(el('div', 'empty-tip', '该日没有体重记录'));
    }
    return sec;
  }

  /* ⑤ 宝宝发育 ⑥ 妈妈变化 */
  function sectionBabyMom(g) {
    var sec = el('div', 'detail-section');
    var wc = Calc.weekContent(g.days);
    if (!wc) return sec;
    sec.appendChild(el('h3', '', '👶 宝宝发育（' + wc.title + ' · ' + wc.size + '）'));
    var ul1 = el('ul');
    wc.baby.forEach(function (t) { ul1.appendChild(el('li', '', t)); });
    sec.appendChild(ul1);
    sec.appendChild(el('h3', '', '🤰 妈妈变化'));
    var ul2 = el('ul');
    wc.mom.forEach(function (t) { ul2.appendChild(el('li', '', t)); });
    sec.appendChild(ul2);
    return sec;
  }

  /* ⑦ 饮食 */
  function sectionFood(g, date) {
    var sec = el('div', 'detail-section');
    sec.appendChild(el('h3', '', '🍽️ 饮食'));

    var stage = Calc.stageOf(g.days);

    /* 本阶段忌口：医学建议 + 民间说法分层展示 */
    var avoid = CONTENT.food.avoidByStage[stage.id] || [];
    if (avoid.length) {
      sec.appendChild(el('div', 'list-title', '本阶段忌口'));
      var medItems = avoid.filter(function (f) { return f.src !== 'folk'; });
      var folkItems = avoid.filter(function (f) { return f.src === 'folk'; });
      if (medItems.length) {
        var ul = el('ul');
        medItems.forEach(function (f) {
          var li = el('li', '', f.name + '：' + f.why);
          li.appendChild(el('span', 'src-tag', '（' + CONTENT.sources[f.src].short + '）'));
          ul.appendChild(li);
        });
        sec.appendChild(ul);
      }
      if (folkItems.length) {
        sec.appendChild(el('div', 'list-title', '民间传统忌口（证据有限）'));
        var ul2 = el('ul');
        folkItems.forEach(function (f) {
          var li = el('li', '', f.name + '：' + f.why);
          li.appendChild(el('span', 'src-tag', '（' + CONTENT.sources[f.src].short + '）'));
          ul2.appendChild(li);
        });
        sec.appendChild(ul2);
        sec.appendChild(el('div', 'folk-note', '注：民间传统说法，现代医学证据有限，少量误食不必恐慌，如不适请咨询医生。'));
      }
    }

    /* 本阶段推荐 */
    var rec = CONTENT.food.recommendByStage[stage.id] || [];
    if (rec.length) {
      sec.appendChild(el('div', 'list-title', '本阶段推荐'));
      var ul3 = el('ul');
      rec.forEach(function (f) {
        var li = el('li', '', f.name + '：' + f.detail);
        li.appendChild(el('span', 'src-tag', '（' + CONTENT.sources[f.src].short + '）'));
        ul3.appendChild(li);
      });
      sec.appendChild(ul3);
    }

    /* 咕嘟自定义的饮食补充 */
    var eMap = eventsByDate();
    var foodEvs = (eMap[date] || []).filter(function (e) { return e.type === 'food'; });
    if (foodEvs.length) {
      sec.appendChild(el('div', 'list-title', '✍️ 咕嘟的饮食补充'));
      foodEvs.forEach(function (e) {
        var card = el('div', 'detail-event');
        card.appendChild(el('div', 'name', e.title));
        if (e.detail) card.appendChild(el('div', 'desc', e.detail));
        if (Auth.isOwner()) {
          var ops = el('div', 'ops');
          var del = el('button', 'btn-sm btn-danger', '删除');
          del.addEventListener('click', function () {
            confirmModal('删除这条饮食补充？', function () {
              Storage.deleteEvent(e.id).then(function () { toast('已删除'); refreshData(); }).catch(function (err) { toast(err.message); });
            });
          });
          ops.appendChild(del);
          card.appendChild(ops);
        }
        sec.appendChild(card);
      });
    }

    /* 全孕期通用禁忌（默认展开，按类别分组） */
    var det = el('details', '', '');
    det.setAttribute('open', '');
    det.appendChild(el('summary', '', '全孕期通用禁忌（按类别）'));
    CONTENT.food.alwaysAvoid.forEach(function (group) {
      det.appendChild(el('div', 'list-title', group.cat));
      var ul4 = el('ul');
      group.items.forEach(function (f) {
        var li = el('li', '', f.name + '：' + f.why);
        li.appendChild(el('span', 'src-tag', '（' + CONTENT.sources[f.src].short + '）'));
        ul4.appendChild(li);
      });
      det.appendChild(ul4);
    });
    sec.appendChild(det);

    /* 全孕期限量（默认展开） */
    var det2 = el('details', '', '');
    det2.setAttribute('open', '');
    det2.appendChild(el('summary', '', '全孕期限量（可以吃，注意量）'));
    var ul5 = el('ul');
    CONTENT.food.alwaysLimit.forEach(function (f) {
      var li = el('li', '', f.name + '：' + f.limit + '——' + f.why);
      li.appendChild(el('span', 'src-tag', '（' + CONTENT.sources[f.src].short + '）'));
      ul5.appendChild(li);
    });
    det2.appendChild(ul5);
    sec.appendChild(det2);

    return sec;
  }

  /* ⑧ 生活习惯 */
  function sectionLife(g) {
    var sec = el('div', 'detail-section');
    sec.appendChild(el('h3', '', '🛌 生活作息'));
    var stage = Calc.stageOf(g.days);
    sec.appendChild(el('div', 'list-title', stage.name + '重点'));
    var ul1 = el('ul');
    stage.lifestyle.forEach(function (t) { ul1.appendChild(el('li', '', t)); });
    sec.appendChild(ul1);
    var det = el('details', '', '');
    det.appendChild(el('summary', '', '通用作息建议（展开）'));
    var ul2 = el('ul');
    CONTENT.life.common.forEach(function (t) { ul2.appendChild(el('li', '', t)); });
    det.appendChild(ul2);
    sec.appendChild(det);
    return sec;
  }

  /* ⑨ 来源 */
  function sectionSource() {
    var sec = el('div', 'detail-section');
    sec.appendChild(el('h3', '', '📚 内容来源'));
    var div = el('div', 'sources-list');
    Object.keys(CONTENT.sources).forEach(function (k) {
      div.appendChild(el('div', '', '· ' + CONTENT.sources[k].text));
    });
    sec.appendChild(div);
    sec.appendChild(el('div', 'detail-source', '整理于 2026-09-25 · 仅供参考，以医生意见为准'));
    return sec;
  }

  /* ================= 体重提交与弹窗 ================= */
  function submitWeight(date, kgStr, note) {
    var kg = Number(kgStr);
    if (!isFinite(kg) || kg < 20 || kg > 200) {
      toast('请输入合理的体重数值（20-200 kg）');
      return;
    }
    var wMap = weightByDate();
    if (wMap[date]) {
      confirmModal(date + ' 已有体重记录 ' + fmt1(wMap[date].kg) + 'kg，是否覆盖？', function () {
        doSave();
      });
    } else {
      doSave();
    }
    function doSave() {
      Storage.saveWeight({ date: date, kg: Math.round(kg * 10) / 10, note: note || '' })
        .then(function () { toast('已保存'); refreshData(); })
        .catch(function (err) { toast(err.message); });
    }
  }

  function openWeightModal(w) {
    var card = $('modal-card');
    card.innerHTML = '';
    card.appendChild(el('h3', '', '修改 ' + w.date + ' 的体重'));
    var kg = el('input', '', '');
    kg.type = 'number'; kg.step = '0.1'; kg.min = '20'; kg.max = '200'; kg.inputMode = 'decimal';
    kg.value = w.kg;
    var note = el('input', '', '');
    note.type = 'text'; note.placeholder = '备注（可选）';
    note.value = w.note || '';
    card.appendChild(kg);
    card.appendChild(note);
    var ops = el('div', 'modal-ops');
    var cancel = el('button', 'btn-ghost', '取消');
    var ok = el('button', 'btn-primary', '保存');
    cancel.addEventListener('click', closeModal);
    ok.addEventListener('click', function () {
      var v = Number(kg.value);
      if (!isFinite(v) || v < 20 || v > 200) { toast('请输入合理的体重数值'); return; }
      Storage.updateWeight(w.id, { kg: Math.round(v * 10) / 10, note: note.value || '' })
        .then(function () { toast('已更新'); closeModal(); refreshData(); })
        .catch(function (err) { toast(err.message); });
    });
    ops.appendChild(cancel); ops.appendChild(ok);
    card.appendChild(ops);
    openModal();
  }

  /* ================= 事项弹窗（事项/饮食/检查） ================= */
  function openEventModal(date, ev) {
    var card = $('modal-card');
    card.innerHTML = '';
    card.appendChild(el('h3', '', ev ? '编辑内容' : '添加内容（' + date + '）'));

    var typeSel = el('select', '', '');
    ['event', 'food', 'checkup'].forEach(function (t) {
      var opt = document.createElement('option');
      opt.value = t;
      opt.textContent = { event: '事项', food: '饮食补充', checkup: '检查提醒' }[t];
      typeSel.appendChild(opt);
    });
    var title = el('input', '', '');
    title.type = 'text'; title.placeholder = '标题，如：产检 9:00 市妇幼';
    var detail = el('textarea', '', '');
    detail.rows = 3; detail.placeholder = '详情（可选）';
    var dateIn = el('input', '', '');
    dateIn.type = 'date';
    if (ev) {
      typeSel.value = ev.type || 'event';
      title.value = ev.title;
      detail.value = ev.detail || '';
      dateIn.value = ev.date;
    } else {
      dateIn.value = date;
    }
    card.appendChild(dateIn);
    card.appendChild(typeSel);
    card.appendChild(title);
    card.appendChild(detail);

    var ops = el('div', 'modal-ops');
    var cancel = el('button', 'btn-ghost', '取消');
    var ok = el('button', 'btn-primary', ev ? '保存修改' : '添加');
    cancel.addEventListener('click', closeModal);
    ok.addEventListener('click', function () {
      if (!title.value.trim()) { toast('请填写标题'); return; }
      if (!dateIn.value) { toast('请选择日期'); return; }
      var payload = { date: dateIn.value, title: title.value.trim(), detail: detail.value.trim(), type: typeSel.value };
      var p = ev
        ? Storage.updateEvent(ev.id, { date: payload.date, title: payload.title, detail: payload.detail })
        : Storage.addEvent(payload);
      p.then(function () { toast(ev ? '已更新' : '已添加'); closeModal(); refreshData(); })
        .catch(function (err) { toast(err.message); });
    });
    ops.appendChild(cancel); ops.appendChild(ok);
    card.appendChild(ops);
    openModal();
  }

  /* ================= 体重页 ================= */
  function renderWeightPage() {
    var lmp = state.settings.lmp;
    var height = Number(state.settings.height);
    var pre = Number(state.settings.preweight);
    var bc = Calc.bmiClass(height, pre);

    Chart.render($('chart-wrap'), { weights: state.weights, lmp: lmp, preWeight: pre, bc: bc });

    var note = $('chart-note');
    if (bc && pre) {
      note.textContent = '按孕前 BMI ' + bc.bmi + '（' + bc.name + '）：孕期总增重推荐 ' + bc.totalMin + '-' + bc.totalMax + 'kg，中晚期每周 ' + bc.rateMin + '-' + bc.rateMax + 'kg（WS/T 801-2022）';
    } else {
      note.textContent = '填写身高和孕前体重后，将显示推荐增重区间（仅咕嘟可在设置里填写）';
    }

    /* 表单：仅咕嘟 */
    var wrap = $('weight-form-wrap');
    wrap.innerHTML = '';
    if (Auth.isOwner()) {
      var form = el('div', 'form-card');
      form.appendChild(el('h3', '', '记录体重'));
      var row = el('div', 'field-row');
      var f1 = el('label', 'field');
      f1.appendChild(el('span', '', '日期'));
      var dateIn = el('input', '', '');
      dateIn.type = 'date';
      dateIn.value = Calc.todayStr();
      f1.appendChild(dateIn);
      var f2 = el('label', 'field');
      f2.appendChild(el('span', '', '体重（kg）'));
      var kgIn = el('input', '', '');
      kgIn.type = 'number'; kgIn.step = '0.1'; kgIn.min = '20'; kgIn.max = '200'; kgIn.inputMode = 'decimal';
      kgIn.placeholder = '如 55.2';
      f2.appendChild(kgIn);
      row.appendChild(f1); row.appendChild(f2);
      form.appendChild(row);
      var f3 = el('label', 'field');
      f3.appendChild(el('span', '', '备注（可选）'));
      var noteIn = el('input', '', '');
      noteIn.type = 'text'; noteIn.placeholder = '如：空腹、晨起';
      f3.appendChild(noteIn);
      form.appendChild(f3);
      var save = el('button', 'btn-primary btn-block', '保存体重');
      save.addEventListener('click', function () {
        submitWeight(dateIn.value, kgIn.value, noteIn.value);
      });
      form.appendChild(save);
      wrap.appendChild(form);
    } else {
      wrap.appendChild(el('div', 'login-tip', '体重由咕嘟记录，亲友可查看'));
    }

    /* 列表 */
    var list = $('weight-list');
    list.innerHTML = '';
    if (!state.weights.length) {
      list.appendChild(el('div', 'empty-tip', '还没有体重记录'));
      return;
    }
    var sorted = state.weights.slice().sort(function (a, b) { return b.date < a.date ? -1 : 1; });
    /* 较上次：找比当前日期小的最大日期记录 */
    sorted.forEach(function (w) {
      var prev = null;
      for (var i = 0; i < sorted.length; i++) {
        if (sorted[i].date < w.date && (!prev || sorted[i].date > prev.date)) prev = sorted[i];
      }
      var item = el('div', 'weight-item');
      var row1 = el('div', 'row1');
      var left = el('div');
      var g = Calc.ga(w.date, state.settings.lmp);
      left.appendChild(el('div', '', w.date + ' · ' + g.label));
      var kg = el('div', 'kg', fmt1(w.kg) + ' kg');
      if (prev) {
        var d = Math.round((w.kg - prev.kg) * 10) / 10;
        var delta = el('span', 'delta-' + (d > 0 ? 'up' : (d < 0 ? 'down' : 'flat')), '  ' + (d >= 0 ? '+' : '') + d.toFixed(1) + 'kg');
        delta.style.fontSize = '12px';
        delta.style.fontWeight = '400';
        kg.appendChild(delta);
      }
      left.appendChild(kg);
      row1.appendChild(left);
      if (Auth.isOwner()) {
        var ops = el('div', 'ops');
        var edit = el('button', 'btn-sm', '改');
        edit.addEventListener('click', function () { openWeightModal(w); });
        var del = el('button', 'btn-sm btn-danger', '删');
        del.addEventListener('click', function () {
          confirmModal('删除 ' + w.date + ' 的体重记录？', function () {
            Storage.deleteWeight(w.id).then(function () { toast('已删除'); refreshData(); }).catch(function (err) { toast(err.message); });
          });
        });
        ops.appendChild(edit); ops.appendChild(del);
        row1.appendChild(ops);
      }
      item.appendChild(row1);
      var meta = '';
      if (w.note) meta += '备注：' + w.note + '　';
      meta += '记录人：' + byName(w.entered_by);
      item.appendChild(el('div', 'meta', meta));
      list.appendChild(item);
    });
  }

  /* ================= 建议页 ================= */
  function renderSuggestPage() {
    var compose = $('suggest-compose');
    compose.innerHTML = '';
    var form = el('div', 'form-card');
    form.appendChild(el('h3', '', Auth.isOwner() ? '写一条备忘建议' : '给咕嘟提建议'));
    var row = el('div', 'field-row');
    var f1 = el('label', 'field');
    f1.appendChild(el('span', '', '关联日期（可选）'));
    var dateIn = el('input', '', '');
    dateIn.type = 'date';
    dateIn.value = Calc.todayStr();
    f1.appendChild(dateIn);
    row.appendChild(f1);
    form.appendChild(row);
    var f2 = el('label', 'field');
    f2.appendChild(el('span', '', '内容'));
    var text = el('textarea', '', '');
    text.rows = 4;
    text.placeholder = Auth.isOwner() ? '记录想法…' : '例如：建议多喝点水、早点睡，或帮忙准备待产包清单…';
    f2.appendChild(text);
    form.appendChild(f2);
    var send = el('button', 'btn-primary btn-block', '提交');
    send.addEventListener('click', function () {
      if (!text.value.trim()) { toast('请先写点内容'); return; }
      Storage.addSuggestion({ date: dateIn.value || Calc.todayStr(), content: text.value.trim() })
        .then(function () { toast('已提交'); refreshData(); })
        .catch(function (err) { toast(err.message); });
    });
    form.appendChild(send);
    compose.appendChild(form);

    var list = $('suggest-list');
    list.innerHTML = '';
    $('suggest-list-title').textContent = Auth.isOwner() ? '全部建议' : '我提过的建议';

    var badge = $('suggest-badge');
    if (Auth.isOwner()) {
      var news = state.suggestions.filter(function (s) { return s.status === 'new'; }).length;
      badge.classList.toggle('hidden', news === 0);
    } else {
      badge.classList.add('hidden');
    }

    if (!state.suggestions.length) {
      list.appendChild(el('div', 'empty-tip', '还没有建议'));
      return;
    }
    state.suggestions.forEach(function (s) {
      var item = el('div', 'suggest-item');
      var row1 = el('div', 'row1');
      var st = el('span', 'status ' + (s.status === 'done' ? 'status-done' : 'status-new'), s.status === 'done' ? '已处理' : '待处理');
      var ops = el('div', 'ops');
      if (Auth.isOwner()) {
        if (s.status !== 'done') {
          var done = el('button', 'btn-sm', '标记已处理');
          done.addEventListener('click', function () {
            Storage.updateSuggestion(s.id, { status: 'done' }).then(function () { toast('已标记'); refreshData(); }).catch(function (err) { toast(err.message); });
          });
          ops.appendChild(done);
        }
        var del = el('button', 'btn-sm btn-danger', '删除');
        del.addEventListener('click', function () {
          confirmModal('删除这条建议？', function () {
            Storage.deleteSuggestion(s.id).then(function () { toast('已删除'); refreshData(); }).catch(function (err) { toast(err.message); });
          });
        });
        ops.appendChild(del);
      }
      row1.appendChild(st);
      row1.appendChild(ops);
      item.appendChild(row1);
      item.appendChild(el('div', 'content', s.content));
      item.appendChild(el('div', 'meta', (s.date ? s.date + ' · ' : '') + byName(s.created_by)));
      list.appendChild(item);
    });
  }

  /* ================= 设置页 ================= */
  function renderSettings() {
    var isOwner = Auth.isOwner();

    /* 基础信息 */
    $('set-lmp').value = state.settings.lmp || CFG.DEFAULT_LMP;
    $('set-lmp').disabled = !isOwner;
    $('set-height').value = state.settings.height || '';
    $('set-height').disabled = !isOwner;
    $('set-preweight').value = state.settings.preweight || '';
    $('set-preweight').disabled = !isOwner;
    $('set-basic-save').disabled = !isOwner;

    /* BMI 信息与标准表 */
    var bmiInfo = $('bmi-info');
    var h = Number($('set-height').value);
    var p = Number($('set-preweight').value);
    var bc = Calc.bmiClass(h, p);
    if (bc) {
      bmiInfo.textContent = '你的孕前 BMI：' + bc.bmi + '（' + bc.name + '）→ 孕期总增重推荐 ' + bc.totalMin + '-' + bc.totalMax + ' kg，中晚期每周 ' + bc.rateMin + '-' + bc.rateMax + ' kg';
    } else {
      bmiInfo.textContent = '填写身高与孕前体重后自动计算（标准：WS/T 801-2022）';
    }
    var tbl = $('bmi-table');
    tbl.innerHTML = '';
    var table = el('table');
    var thead = el('thead');
    var hr = el('tr');
    ['孕前 BMI 分类', '总增长范围(kg)', '孕早期(kg)', '中晚期每周(kg/周)'].forEach(function (t) { hr.appendChild(el('th', '', t)); });
    thead.appendChild(hr);
    table.appendChild(thead);
    var tbody = el('tbody');
    var rows = [
      ['偏瘦  BMI<18.5', '11.0～16.0', '0～2.0', '0.37～0.56'],
      ['正常  18.5≤BMI<24', '8.0～14.0', '0～2.0', '0.26～0.48'],
      ['超重  24≤BMI<28', '7.0～11.0', '0～2.0', '0.22～0.37'],
      ['肥胖  BMI≥28', '5.0～9.0', '0～2.0', '0.15～0.30']
    ];
    var keys = ['thin', 'normal', 'over', 'obese'];
    rows.forEach(function (r, i) {
      var tr = el('tr');
      if (bc && bc.cls.key === keys[i]) tr.className = 'me';
      r.forEach(function (c) { tr.appendChild(el('td', '', c)); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tbl.appendChild(table);

    /* 权限显隐 */
    $('settings-backup').classList.toggle('hidden', !isOwner);
    $('settings-owner-tools').classList.toggle('hidden', !isOwner);
    $('settings-basic').querySelector('.settings-title').textContent = isOwner ? '基础信息（咕嘟可修改）' : '基础信息（仅咕嘟可修改）';

    /* 云状态 */
    var cs = $('cloud-status');
    if (Storage.mode === 'cloud') {
      cs.textContent = '云同步' + (Storage.offline ? '（当前离线，显示缓存）' : '（已连接）');
      $('cloud-retry').classList.remove('hidden');
    } else {
      cs.textContent = '本地模式（数据存本设备；配置 Supabase 后可多设备同步，见 README）';
      $('cloud-retry').classList.add('hidden');
    }

    /* 来源与免责声明 */
    var srcList = $('sources-list');
    srcList.innerHTML = '';
    Object.keys(CONTENT.sources).forEach(function (k) {
      srcList.appendChild(el('div', '', '· ' + CONTENT.sources[k].text));
    });
    $('disclaimer-text').textContent = CONTENT.disclaimer;
  }

  function initSettings() {
    $('set-basic-save').addEventListener('click', function () {
      if (!Auth.isOwner()) return;
      var patch = {
        lmp: $('set-lmp').value || CFG.DEFAULT_LMP,
        height: $('set-height').value,
        preweight: $('set-preweight').value
      };
      Storage.saveSettings(patch)
        .then(function () { toast('已保存'); refreshData(); })
        .catch(function (err) { toast(err.message); });
    });
    $('logout-btn').addEventListener('click', logout);
    $('logout-btn2').addEventListener('click', logout);
    $('export-btn').addEventListener('click', doExport);
    $('import-btn').addEventListener('click', function () { $('import-file').click(); });
    $('import-file').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var obj;
        try { obj = JSON.parse(reader.result); } catch (err) { toast('文件解析失败'); return; }
        confirmModal('导入会与现有数据合并（同日体重以导入文件为准），继续？', function () {
          Storage.importAll(obj)
            .then(function () { toast('导入完成'); refreshData(); })
            .catch(function (err) { toast(err.message); });
        });
      };
      reader.readAsText(f);
      e.target.value = '';
    });
    $('cloud-retry').addEventListener('click', function () {
      toast('正在重试连接云端…');
      refreshData();
    });
    $('selftest-btn').addEventListener('click', runSelfTest);
    $('hash-input').addEventListener('input', function () {
      var v = $('hash-input').value;
      var out = $('hash-output');
      if (!v) { out.textContent = ''; return; }
      SHA.hash(v).then(function (hex) {
        out.textContent = 'SHA-256：' + hex;
      });
    });
  }

  function doExport() {
    if (!Auth.isOwner()) return;
    Storage.exportAll().then(function (obj) {
      var blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '孕期日历备份-' + Calc.todayStr() + '.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      toast('备份已导出');
    }).catch(function (err) { toast(err.message); });
  }

  function runSelfTest() {
    var results = Calc.selfTest();
    var box = $('selftest-result');
    box.innerHTML = '';
    var pass = 0;
    results.forEach(function (r) {
      var line = el('div', r.ok ? 'ok' : 'fail', (r.ok ? '✔ ' : '✘ ') + r.name + (r.ok ? '' : '（实际：' + r.got + '，期望：' + r.want + '）'));
      box.appendChild(line);
      if (r.ok) pass++;
    });
    box.appendChild(el('div', pass === results.length ? 'ok' : 'fail', '自检结果：' + pass + '/' + results.length + ' 项通过'));
  }

  /* ================= 弹窗 ================= */
  function openModal() {
    $('modal').classList.remove('hidden');
    $('modal-mask').classList.remove('hidden');
  }
  function closeModal() {
    $('modal').classList.add('hidden');
    $('modal-mask').classList.add('hidden');
  }
  function confirmModal(msg, onOk) {
    var card = $('modal-card');
    card.innerHTML = '';
    card.appendChild(el('h3', '', '请确认'));
    card.appendChild(el('div', 'modal-msg', msg));
    var ops = el('div', 'modal-ops');
    var cancel = el('button', 'btn-ghost', '取消');
    var ok = el('button', 'btn-primary', '确定');
    cancel.addEventListener('click', closeModal);
    ok.addEventListener('click', function () { closeModal(); onOk(); });
    ops.appendChild(cancel); ops.appendChild(ok);
    card.appendChild(ops);
    openModal();
  }
  function initModal() {
    $('modal-mask').addEventListener('click', closeModal);
  }

  /* ================= Tab 切换 ================= */
  function initTabs() {
    var tabs = document.querySelectorAll('.tabbar .tab');
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        switchTab(t.getAttribute('data-tab'));
      });
    });
  }
  function switchTab(name) {
    closeDetail(); /* 切走时收起详情（桌面端详情在日历视图内） */
    var tabs = document.querySelectorAll('.tabbar .tab');
    tabs.forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === name);
    });
    ['calendar', 'weight', 'suggest', 'settings'].forEach(function (v) {
      $('view-' + v).classList.toggle('hidden', v !== name);
    });
    if (name === 'settings') renderSettings();
    if (name === 'suggest') renderSuggestPage();
    if (name === 'weight') renderWeightPage();
  }

  /* ================= 初始化 ================= */
  function init() {
    Storage.init();
    Storage.onError = function (e) {
      if (e && e.code === 'OFFLINE') showOffline(true);
      else if (e) toast(e.message);
    };
    initLogin();
    initCalendar();
    initDetail();
    initTabs();
    initSettings();
    initModal();

    if (Auth.restore()) {
      enterApp();
    } else {
      showLogin();
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return { refreshData: refreshData, _openDetail: openDetail, _enterApp: enterApp, _submitWeight: submitWeight };
})();
