/* ============================================================
 * config.js —— 全局配置（唯一需要手动编辑的文件）
 * ------------------------------------------------------------
 * 1. 本地模式：CLOUDBASE_ENV 留空即可，数据存在各自浏览器里。
 * 2. 云同步模式（腾讯云开发 CloudBase）：
 *    a) 注册腾讯云账号（cloud.tencent.com）并完成实名认证；
 *    b) 云开发 CloudBase 控制台创建一个环境，复制环境 ID；
 *    c) 数据库建 4 个集合（weights/events/suggestions/settings），
 *       安全规则都设为「所有用户可读」；
 *    d) 云函数新建 app_write，粘贴 cloudbase/app_write.js 的代码；
 *    e) 把环境 ID 填到下面的 CLOUDBASE_ENV。
 *    详细图文步骤见 README.md。
 * 3. 修改任何代码后，记得把 index.html 里 script 的 ?v=1 改成
 *    ?v=2（微信缓存很顽固）。
 * ============================================================ */
var CFG = {
  VERSION: '2',

  /* 腾讯云开发环境 ID，如 'yunqi-1a2b3c'（结尾不带空格）。留空 = 本地模式 */
  CLOUDBASE_ENV: '',

  /* 末次月经第一天 */
  DEFAULT_LMP: '2026-08-03',

  /* 两个身份：
     - 亲友：免密登录（hash 留空），打开链接点「亲友」即进
     - 咕嘟：需要密码，hash = 密码的 SHA-256（不存明文密码）
     改咕嘟密码方法：设置页 → 密码哈希生成器 → 同时更新这里的
     hash 和云函数 app_write 里的 OWNER_HASH */
  USERS: {
    family: { name: '亲友', hash: '' },
    owner:  { name: '咕嘟', hash: 'fe866bf72d97fb946453b3cd3db69eaa44da57a67b6bbc2ea5eaba01b00b1659' }
  },

  /* 日历可浏览范围（相对 LMP 的天数）：孕前 30 天 ~ 孕 42 周 */
  BROWSE_MIN_DAYS: -30,
  BROWSE_MAX_DAYS: 294,

  /* 登录状态保持天数 */
  SESSION_DAYS: 30
};
