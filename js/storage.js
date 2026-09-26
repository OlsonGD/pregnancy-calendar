/* ============================================================
 * storage.js —— 数据层 + 登录会话 + 权限
 *  - local 模式：localStorage（默认，无需任何账号）
 *  - cloud 模式：Supabase（config.js 填入 URL 与 anon key 后自动启用）
 *      读取 = PostgREST 直读（RLS 允许公开读，无需登录即可加载）
 *      写入 = 全部走 SECURITY DEFINER 函数 app_write（校验咕嘟密码哈希）
 *    所有设备读写同一个云数据库，实现跨设备同步
 *  - 云模式带本地缓存镜像：断网时可读最近一次数据
 *  - 权限语义（客户端拦截 + 服务端双重保障）：
 *      查看全部内容 = 亲友 / 咕嘟（亲友免密）
 *      提建议        = 亲友 / 咕嘟
 *      记录体重、编辑日历内容、管理建议、改设置 = 仅咕嘟
 * ============================================================ */
var Storage = (function () {

  /* ================= 登录会话 ================= */
  var SESSION_KEY = 'pc_session';

  var Auth = {
    role: null,          /* 'family' | 'owner' */
    key: null,           /* 咕嘟密码原文（云端写入凭证，服务端比对其哈希）；亲友为 null。
                            注意：这是明文密码，会随会话存在本机 localStorage 里。*/
    name: '',
    isOwner: function () { return this.role === 'owner'; },
    isLoggedIn: function () { return !!this.role; },
    /* perm: 'view' | 'suggest' | 'recordWeight' | 'editContent' | 'settings' */
    can: function (perm) {
      if (!this.role) return false;
      if (perm === 'view' || perm === 'suggest') return true;
      return this.isOwner();
    },
    login: function (role, key) {
      this.role = role;
      this.key = key || null;
      this.name = CFG.USERS[role].name;
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          role: role, key: this.key, name: this.name, ts: Date.now()
        }));
      } catch (e) {}
    },
    restore: function () {
      var raw = null;
      try { raw = localStorage.getItem(SESSION_KEY); } catch (e) {}
      if (!raw) return false;
      try {
        var s = JSON.parse(raw);
        var maxAge = CFG.SESSION_DAYS * 86400000;
        if (!s || !s.role || !CFG.USERS[s.role]) return false;
        if (Date.now() - s.ts > maxAge) { this.clear(); return false; }
        if (s.role === 'owner' && !s.key) return false;  /* 咕嘟会话必须带 key */
        this.role = s.role;
        this.key = s.key || null;
        this.name = s.name || CFG.USERS[s.role].name;
        return true;
      } catch (e) { return false; }
    },
    clear: function () {
      this.role = null; this.key = null; this.name = '';
      try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    }
  };

  /* ================= 工具 ================= */
  var K_WEIGHTS = 'pc_weights';
  var K_EVENTS = 'pc_events';
  var K_SUGGESTIONS = 'pc_suggestions';
  var K_SETTINGS = 'pc_settings';
  var CACHE_PREFIX = 'pc_cache_';

  function lsGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function genId() {
    return 'L' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function err(code, message) { return { code: code, message: message }; }
  function requireLoggedIn() {
    if (!Auth.isLoggedIn()) return err('NOT_LOGIN', '请先登录');
    return null;
  }
  function requireOwner() {
    var e = requireLoggedIn();
    if (e) return e;
    if (!Auth.isOwner()) return err('FORBIDDEN', '该操作仅咕嘟可以执行');
    return null;
  }
  function sortByDate(a, b) { return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0); }
  function sortByCreatedDesc(a, b) {
    var ta = a.created_at || 0, tb = b.created_at || 0;
    if (typeof ta === 'string') ta = Date.parse(ta) || 0;
    if (typeof tb === 'string') tb = Date.parse(tb) || 0;
    return tb - ta;
  }

  /* ================= 本地实现 ================= */
  var Local = {
    listWeights: function () {
      return Promise.resolve((lsGet(K_WEIGHTS) || []).slice().sort(sortByDate));
    },
    saveWeight: function (w) {
      var e = requireOwner(); if (e) return Promise.reject(e);
      var list = lsGet(K_WEIGHTS) || [];
      var found = null;
      for (var i = 0; i < list.length; i++) if (list[i].date === w.date) found = list[i];
      var rec;
      if (found) {
        found.kg = w.kg; found.note = w.note || ''; found.entered_by = 'owner';
        rec = found;
      } else {
        rec = { id: genId(), date: w.date, kg: w.kg, note: w.note || '', entered_by: 'owner', created_at: Date.now() };
        list.push(rec);
      }
      lsSet(K_WEIGHTS, list);
      return Promise.resolve(rec);
    },
    updateWeight: function (id, patch) {
      var e = requireOwner(); if (e) return Promise.reject(e);
      var list = lsGet(K_WEIGHTS) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          if (patch.kg !== undefined) list[i].kg = patch.kg;
          if (patch.note !== undefined) list[i].note = patch.note;
          lsSet(K_WEIGHTS, list);
          return Promise.resolve(list[i]);
        }
      }
      return Promise.reject(err('EMPTY', '记录不存在'));
    },
    deleteWeight: function (id) {
      var e = requireOwner(); if (e) return Promise.reject(e);
      var list = lsGet(K_WEIGHTS) || [];
      lsSet(K_WEIGHTS, list.filter(function (x) { return x.id !== id; }));
      return Promise.resolve(null);
    },
    listEvents: function () {
      return Promise.resolve((lsGet(K_EVENTS) || []).slice().sort(sortByDate));
    },
    addEvent: function (ev) {
      var e = requireOwner(); if (e) return Promise.reject(e);
      var list = lsGet(K_EVENTS) || [];
      var rec = {
        id: genId(), date: ev.date, title: ev.title, detail: ev.detail || '',
        type: ev.type || 'event', created_by: 'owner', created_at: Date.now()
      };
      list.push(rec);
      lsSet(K_EVENTS, list);
      return Promise.resolve(rec);
    },
    updateEvent: function (id, patch) {
      var e = requireOwner(); if (e) return Promise.reject(e);
      var list = lsGet(K_EVENTS) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          if (patch.title !== undefined) list[i].title = patch.title;
          if (patch.detail !== undefined) list[i].detail = patch.detail;
          if (patch.date !== undefined) list[i].date = patch.date;
          lsSet(K_EVENTS, list);
          return Promise.resolve(list[i]);
        }
      }
      return Promise.reject(err('EMPTY', '记录不存在'));
    },
    deleteEvent: function (id) {
      var e = requireOwner(); if (e) return Promise.reject(e);
      var list = lsGet(K_EVENTS) || [];
      lsSet(K_EVENTS, list.filter(function (x) { return x.id !== id; }));
      return Promise.resolve(null);
    },
    /* 亲友免密：建议对全体开放可见 */
    listSuggestions: function () {
      return Promise.resolve((lsGet(K_SUGGESTIONS) || []).slice().sort(sortByCreatedDesc));
    },
    addSuggestion: function (s) {
      var e = requireLoggedIn(); if (e) return Promise.reject(e);
      var list = lsGet(K_SUGGESTIONS) || [];
      var rec = {
        id: genId(), date: s.date, content: s.content,
        created_by: Auth.isOwner() ? 'owner' : 'family',
        status: 'new', created_at: Date.now(), updated_at: Date.now()
      };
      list.push(rec);
      lsSet(K_SUGGESTIONS, list);
      return Promise.resolve(rec);
    },
    updateSuggestion: function (id, patch) {
      var e = requireOwner(); if (e) return Promise.reject(e);
      var list = lsGet(K_SUGGESTIONS) || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          if (patch.status !== undefined) list[i].status = patch.status;
          list[i].updated_at = Date.now();
          lsSet(K_SUGGESTIONS, list);
          return Promise.resolve(list[i]);
        }
      }
      return Promise.reject(err('EMPTY', '记录不存在'));
    },
    deleteSuggestion: function (id) {
      var e = requireOwner(); if (e) return Promise.reject(e);
      var list = lsGet(K_SUGGESTIONS) || [];
      lsSet(K_SUGGESTIONS, list.filter(function (x) { return x.id !== id; }));
      return Promise.resolve(null);
    },
    getSettings: function () {
      return Promise.resolve(lsGet(K_SETTINGS) || { lmp: CFG.DEFAULT_LMP, height: '', preweight: '' });
    },
    saveSettings: function (patch) {
      var e = requireOwner(); if (e) return Promise.reject(e);
      var s = lsGet(K_SETTINGS) || { lmp: CFG.DEFAULT_LMP, height: '', preweight: '' };
      for (var k in patch) if (patch.hasOwnProperty(k)) s[k] = patch[k];
      lsSet(K_SETTINGS, s);
      return Promise.resolve(s);
    }
  };

  /* ================= 云端实现（Supabase） ================= */
  var Cloud = (function () {
    function base() { return String(CFG.SUPABASE_URL).replace(/\/$/, ''); }

    function headers() {
      return {
        'apikey': CFG.SUPABASE_ANON_KEY,
        'Authorization': 'Bearer ' + CFG.SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
      };
    }

    function mapError(status, e) {
      if (status === 401 || status === 403) return err('FORBIDDEN', '没有权限（可能是密钥不一致，请检查设置）');
      if (status === 404) return err('NO_TABLE', '云端数据表不存在：请先在 Supabase 执行 supabase-setup.sql');
      if (status === 400 && e && /does not exist/i.test(e.message || '')) {
        return err('NO_FUNC', '云端函数不存在：请先在 Supabase 执行 supabase-setup.sql');
      }
      if (e && e.code === '23505') return err('DUPLICATE', '记录已存在');
      if (e && e.code === '42501') return err('FORBIDDEN', '没有权限：密钥不正确');
      return err((e && e.code) || ('HTTP_' + status), (e && (e.message || e.hint)) || ('云端请求失败(' + status + ')'));
    }

    /* 读取：PostgREST 直读 */
    function sbGet(path) {
      return fetch(base() + '/rest/v1/' + path, { headers: headers() })
        .then(function (res) {
          if (res.ok) return res.json();
          return res.json().catch(function () { return {}; }).then(function (e) { throw mapError(res.status, e); });
        }, function () { throw err('NETWORK', '云端连接失败，请检查网络后重试'); });
    }

    /* 写入：统一走 SECURITY DEFINER 函数（密钥放在请求体，不触发 CORS 预检问题） */
    function sbWrite(op, table, data) {
      return fetch(base() + '/rest/v1/rpc/app_write', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ p_key: Auth.key || '', p_op: op, p_table: table, p_data: data || {} })
      }).then(function (res) {
        if (res.ok) return res.json();
        return res.json().catch(function () { return {}; }).then(function (e) { throw mapError(res.status, e); });
      }, function () { throw err('NETWORK', '云端连接失败，请检查网络后重试'); });
    }

    function cacheSet(key, val) { lsSet(key, val); }
    function cacheGet(key) { return lsGet(key); }

    function readColl(name, query) {
      return sbGet(name + '?' + query).then(function (arr) {
        Storage.offline = false;
        cacheSet(CACHE_PREFIX + name, arr || []);
        return arr || [];
      }, function (e) {
        var c = cacheGet(CACHE_PREFIX + name);
        Storage.offline = true;
        if (Storage.onError) Storage.onError(err('OFFLINE', '当前离线，显示的是最近一次缓存数据'));
        return c || [];
      });
    }

    return {
      listWeights: function () {
        return readColl('weights', 'select=*&order=date.asc');
      },
      saveWeight: function (w) {
        var e = requireOwner(); if (e) return Promise.reject(e);
        return sbWrite('insert', 'weights', { date: w.date, kg: w.kg, note: w.note || '' });
      },
      updateWeight: function (id, patch) {
        var e = requireOwner(); if (e) return Promise.reject(e);
        return sbWrite('update', 'weights', { id: id, kg: patch.kg, note: patch.note });
      },
      deleteWeight: function (id) {
        var e = requireOwner(); if (e) return Promise.reject(e);
        return sbWrite('delete', 'weights', { id: id });
      },
      listEvents: function () {
        return readColl('events', 'select=*&order=date.asc');
      },
      addEvent: function (ev) {
        var e = requireOwner(); if (e) return Promise.reject(e);
        return sbWrite('insert', 'events', { date: ev.date, title: ev.title, detail: ev.detail || '', type: ev.type || 'event' });
      },
      updateEvent: function (id, patch) {
        var e = requireOwner(); if (e) return Promise.reject(e);
        return sbWrite('update', 'events', { id: id, title: patch.title, detail: patch.detail });
      },
      deleteEvent: function (id) {
        var e = requireOwner(); if (e) return Promise.reject(e);
        return sbWrite('delete', 'events', { id: id });
      },
      listSuggestions: function () {
        return readColl('suggestions', 'select=*&order=created_at.desc');
      },
      /* 亲友免密提建议：云端不校验密钥，但标注身份 */
      addSuggestion: function (s) {
        var e = requireLoggedIn(); if (e) return Promise.reject(e);
        return sbWrite('insert', 'suggestions', { date: s.date, content: s.content });
      },
      updateSuggestion: function (id, patch) {
        var e = requireOwner(); if (e) return Promise.reject(e);
        return sbWrite('update', 'suggestions', { id: id, status: patch.status });
      },
      deleteSuggestion: function (id) {
        var e = requireOwner(); if (e) return Promise.reject(e);
        return sbWrite('delete', 'suggestions', { id: id });
      },
      getSettings: function () {
        return sbGet('settings?select=key,value').then(function (arr) {
          Storage.offline = false;
          var s = { lmp: CFG.DEFAULT_LMP, height: '', preweight: '' };
          (arr || []).forEach(function (kv) { if (kv && kv.key) s[kv.key] = kv.value; });
          lsSet(K_SETTINGS, s);
          return s;
        }, function (e) {
          var c = lsGet(K_SETTINGS);
          Storage.offline = true;
          if (Storage.onError) Storage.onError(err('OFFLINE', '当前离线，显示的是最近一次缓存数据'));
          return c || { lmp: CFG.DEFAULT_LMP, height: '', preweight: '' };
        });
      },
      saveSettings: function (patch) {
        var e = requireOwner(); if (e) return Promise.reject(e);
        return sbWrite('settings', 'settings', patch);
      }
    };
  })();

  /* ================= 对外统一接口 ================= */
  var impl = Local;
  var api = {
    Auth: Auth,
    mode: 'local',
    offline: false,
    onError: null,

    init: function () {
      if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY) {
        impl = Cloud;
        api.mode = 'cloud';
      } else {
        impl = Local;
        api.mode = 'local';
      }
    },

    listWeights: function () { var e = requireLoggedIn(); if (e) return Promise.reject(e); return impl.listWeights(); },
    saveWeight: function (w) { return impl.saveWeight(w); },
    updateWeight: function (id, patch) { return impl.updateWeight(id, patch); },
    deleteWeight: function (id) { return impl.deleteWeight(id); },
    listEvents: function () { var e = requireLoggedIn(); if (e) return Promise.reject(e); return impl.listEvents(); },
    addEvent: function (ev) { return impl.addEvent(ev); },
    updateEvent: function (id, patch) { return impl.updateEvent(id, patch); },
    deleteEvent: function (id) { return impl.deleteEvent(id); },
    listSuggestions: function () { var e = requireLoggedIn(); if (e) return Promise.reject(e); return impl.listSuggestions(); },
    addSuggestion: function (s) { return impl.addSuggestion(s); },
    updateSuggestion: function (id, patch) { return impl.updateSuggestion(id, patch); },
    deleteSuggestion: function (id) { return impl.deleteSuggestion(id); },
    getSettings: function () { var e = requireLoggedIn(); if (e) return Promise.reject(e); return impl.getSettings(); },
    saveSettings: function (patch) { return impl.saveSettings(patch); },

    /* 导出备份（仅咕嘟） */
    exportAll: function () {
      var e = requireOwner(); if (e) return Promise.reject(e);
      return Promise.all([impl.getSettings(), impl.listWeights(), impl.listEvents(), impl.listSuggestions()])
        .then(function (rs) {
          return {
            app: 'pregnancy-calendar', version: CFG.VERSION,
            exportedAt: new Date().toISOString(), lmp: rs[0].lmp,
            settings: rs[0], weights: rs[1], events: rs[2], suggestions: rs[3]
          };
        });
    },

    /* 导入备份（仅咕嘟）：体重按日期合并（导入为准）、事项/建议按 id 去重 */
    importAll: function (obj) {
      var e = requireOwner(); if (e) return Promise.reject(e);
      if (!obj || obj.app !== 'pregnancy-calendar' || !obj.weights) return Promise.reject(err('BAD_FILE', '备份文件格式不正确'));
      var patch = {};
      if (obj.settings) {
        if (obj.settings.lmp) patch.lmp = obj.settings.lmp;
        if (obj.settings.height) patch.height = obj.settings.height;
        if (obj.settings.preweight) patch.preweight = obj.settings.preweight;
      }
      var chain = Promise.resolve();
      if (Object.keys(patch).length) chain = chain.then(function () { return impl.saveSettings(patch); });
      (obj.weights || []).forEach(function (w) {
        chain = chain.then(function () { return impl.saveWeight(w); });
      });
      var curEvents = {};
      var curSugs = {};
      return chain
        .then(function () { return impl.listEvents(); })
        .then(function (list) {
          list.forEach(function (x) { curEvents[x.id] = true; });
          var c2 = Promise.resolve();
          (obj.events || []).forEach(function (ev) {
            if (curEvents[ev.id]) return;
            c2 = c2.then(function () {
              return impl.addEvent({ date: ev.date, title: ev.title, detail: ev.detail, type: ev.type || 'event' });
            });
          });
          return c2;
        })
        .then(function () { return impl.listSuggestions(); })
        .then(function (list) {
          list.forEach(function (x) { curSugs[x.id] = true; });
          var c3 = Promise.resolve();
          (obj.suggestions || []).forEach(function (s) {
            if (curSugs[s.id]) return;
            c3 = c3.then(function () {
              return impl.addSuggestion({ date: s.date, content: s.content });
            });
          });
          return c3;
        });
    }
  };

  return api;
})();
