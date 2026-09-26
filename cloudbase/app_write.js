/**
 * app_write —— 孕期日历写操作云函数
 * 部署：腾讯云开发 CloudBase 控制台 → 云函数 → 新建云函数
 *       名称：app_write
 *       运行环境：Nodejs 16.13（或更新）
 *       把本文件内容全部粘贴进去，保存并部署
 *
 * 作用：所有「写」操作都经过这里，云端校验咕嘟的密码哈希，
 *       亲友免密只能提建议。云函数以管理员身份写库，绕过安全规则，
 *       所以数据库集合的安全规则可以统一设为「所有用户可读、不可写」。
 *
 * 改咕嘟密码时：同步更新本文件的 OWNER_HASH 和 js/config.js 里的 hash。
 */
const cloud = require('@cloudbase/node-sdk');
const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

/* 咕嘟密码 leyuan 的 SHA-256 */
const OWNER_HASH = 'fe866bf72d97fb946453b3cd3db69eaa44da57a67b6bbc2ea5eaba01b00b1659';

exports.main = async (event) => {
  const { key = '', op = '', table = '', data = {} } = event || {};

  const ok = (payload) => Object.assign({ ok: true }, payload);
  const fail = (code, msg) => ({ ok: false, code, msg });

  /* ---- 亲友免密：提建议（key 为空也放行），身份自动标注 ---- */
  if (table === 'suggestions' && op === 'insert') {
    const r = await db.collection('suggestions').add({
      date: data.date || '',
      content: data.content || '',
      created_by: key === OWNER_HASH ? 'owner' : 'family',
      status: 'new',
      created_at: Date.now(),
      updated_at: Date.now()
    });
    return ok({ id: r.id });
  }

  /* ---- 其余写操作：仅咕嘟 ---- */
  if (key !== OWNER_HASH) return fail('FORBIDDEN', '仅咕嘟可以执行此操作');

  const now = Date.now();

  if (table === 'weights') {
    if (op === 'insert') {
      /* 按日期 upsert（一天一条） */
      const q = await db.collection('weights').where({ date: data.date }).get();
      const rec = { date: data.date, kg: data.kg, note: data.note || '', entered_by: 'owner', updated_at: now };
      if (q.data && q.data.length) {
        await db.collection('weights').doc(q.data[0]._id).update(rec);
        return ok({ id: q.data[0]._id, date: data.date, kg: data.kg, note: data.note || '' });
      }
      const r = await db.collection('weights').add(Object.assign({ created_at: now }, rec));
      return ok({ id: r.id, date: data.date, kg: data.kg, note: data.note || '' });
    }
    if (op === 'update') {
      const patch = { updated_at: now };
      if (data.kg !== undefined) patch.kg = data.kg;
      if (data.note !== undefined) patch.note = data.note;
      await db.collection('weights').doc(data.id).update(patch);
      return ok({ id: data.id });
    }
    if (op === 'delete') {
      await db.collection('weights').doc(data.id).remove();
      return ok({ id: data.id });
    }
  }

  if (table === 'events') {
    if (op === 'insert') {
      const r = await db.collection('events').add({
        date: data.date, title: data.title, detail: data.detail || '',
        type: data.type || 'event', created_by: 'owner', created_at: now
      });
      return ok({ id: r.id });
    }
    if (op === 'update') {
      const patch = {};
      if (data.title !== undefined) patch.title = data.title;
      if (data.detail !== undefined) patch.detail = data.detail;
      await db.collection('events').doc(data.id).update(patch);
      return ok({ id: data.id });
    }
    if (op === 'delete') {
      await db.collection('events').doc(data.id).remove();
      return ok({ id: data.id });
    }
  }

  if (table === 'suggestions') {
    if (op === 'update') {
      await db.collection('suggestions').doc(data.id).update({ status: data.status, updated_at: now });
      return ok({ id: data.id });
    }
    if (op === 'delete') {
      await db.collection('suggestions').doc(data.id).remove();
      return ok({ id: data.id });
    }
  }

  if (table === 'settings') {
    const keys = ['lmp', 'height', 'preweight'];
    for (const k of keys) {
      if (data[k] === undefined) continue;
      const q = await db.collection('settings').where({ key: k }).get();
      if (q.data && q.data.length) {
        await db.collection('settings').doc(q.data[0]._id).update({ value: String(data[k]), updated_at: now });
      } else {
        await db.collection('settings').add({ key: k, value: String(data[k]), updated_at: now });
      }
    }
    return ok({});
  }

  return fail('BAD_OP', '不支持的操作');
};
