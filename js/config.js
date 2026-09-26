/* ============================================================
 * config.js —— 全局配置（唯一需要手动编辑的文件）
 * ------------------------------------------------------------
 * 1. 本地模式：SUPABASE_URL 留空即可，数据存在各自浏览器里。
 * 2. 云同步模式（Supabase 免费版）：
 *    a) 在 supabase.com 注册免费账号并创建项目（无需信用卡）；
 *    b) 在 Supabase 的 SQL Editor 里执行 supabase-setup.sql；
 *    c) 把项目的 Project URL 和 anon public key 填到下面两项。
 *    详细步骤见 README.md。
 * 3. 修改任何代码后，记得把 index.html 里 script 的 ?v= 数字加一
 *    （微信缓存很顽固）。
 * ============================================================ */
var CFG = {
  VERSION: '3',

  /* Supabase 项目地址，如 'https://abcdefgh.supabase.co'（结尾不带 /） */
  SUPABASE_URL: '',
  /* Supabase 项目的 anon public key（不是 service_role key！） */
  SUPABASE_ANON_KEY: '',

  /* 末次月经第一天 */
  DEFAULT_LMP: '2026-08-03',

  /* 两个身份：
     - 亲友：免密登录（hash 留空），打开链接点「亲友」即进
     - 咕嘟：需要密码，hash = 密码的 SHA-256（不存明文密码）
     改咕嘟密码方法：设置页 → 密码哈希生成器 → 同时更新这里的
     hash 和 supabase-setup.sql 里的 v_owner_hash */
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
