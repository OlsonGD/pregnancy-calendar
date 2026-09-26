-- ============================================================
-- supabase-setup.sql —— 孕期日历云端数据库一键初始化
-- 使用方法：Supabase 控制台 → 左侧 SQL Editor → New query
--           → 粘贴本文件全部内容 → 点 Run（执行一次即可）
-- ============================================================

-- ---------- 1. 建表 ----------
create table if not exists weights (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,                       -- 一天一条
  kg          numeric(5,2) not null check (kg > 20 and kg < 200),
  note        text default '',
  entered_by  text default 'owner',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  date       date not null,
  title      text not null,
  detail     text default '',
  type       text default 'event' check (type in ('event','food','checkup')),
  created_by text default 'owner',
  created_at timestamptz default now()
);

create table if not exists suggestions (
  id         uuid primary key default gen_random_uuid(),
  date       date,
  content    text not null,
  created_by text default 'family',
  status     text default 'new' check (status in ('new','done')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists settings (
  key        text primary key,
  value      text,
  updated_at timestamptz default now()
);

create index if not exists idx_weights_date on weights(date);
create index if not exists idx_events_date on events(date);
create index if not exists idx_suggestions_created on suggestions(created_at desc);

-- ---------- 2. 开启行级安全（RLS） ----------
-- 策略：所有表「所有人可读」，但任何人都不能直接写；
--       所有写操作必须经过下面的 app_write 函数（函数内部校验咕嘟密钥）。
alter table weights     enable row level security;
alter table events      enable row level security;
alter table suggestions enable row level security;
alter table settings    enable row level security;

drop policy if exists w_read on weights;
drop policy if exists e_read on events;
drop policy if exists s_read on suggestions;
drop policy if exists st_read on settings;

create policy w_read  on weights     for select using (true);
create policy e_read  on events      for select using (true);
create policy s_read  on suggestions for select using (true);
create policy st_read on settings    for select using (true);
-- 注意：故意不建 insert/update/delete 策略 → 匿名客户端无法直接写入

-- ---------- 3. 唯一的写入入口：app_write 函数 ----------
-- SECURITY DEFINER 让函数以管理员身份执行，从而绕过 RLS 完成写入。
-- 权限规则：
--   · 提建议（suggestions insert）→ 任何人可做（亲友免密），身份自动标注
--   · 其余所有写操作           → 必须提供咕嘟密码哈希
create or replace function app_write(p_key text, p_op text, p_table text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 咕嘟密码 leyuan 的 SHA-256（改密码时改这里）
  v_owner_hash text := 'fe866bf72d97fb946453b3cd3db69eaa44da57a67b6bbc2ea5eaba01b00b1659';
  v_owner boolean := (coalesce(p_key,'') <> '' and p_key = v_owner_hash);
  v_by    text := case when coalesce(p_key,'') = v_owner_hash then 'owner' else 'family' end;
  v_out   jsonb;
begin
  -- ① 亲友免密：提交建议
  if p_table = 'suggestions' and p_op = 'insert' then
    if coalesce(p_data->>'content','') = '' then
      raise exception 'content required' using errcode = '22023';
    end if;
    insert into suggestions(date, content, created_by, status, created_at, updated_at)
    values (
      case when coalesce(p_data->>'date','') ~ '^\d{4}-\d{2}-\d{2}$'
           then (p_data->>'date')::date else current_date end,
      p_data->>'content', v_by, 'new', now(), now()
    )
    returning to_jsonb(suggestions.*) into v_out;
    return v_out;
  end if;

  -- ② 其余写操作仅咕嘟
  if not v_owner then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_table = 'weights' then
    if p_op = 'insert' then
      insert into weights(date, kg, note, entered_by, created_at, updated_at)
      values ((p_data->>'date')::date, (p_data->>'kg')::numeric,
              coalesce(p_data->>'note',''), 'owner', now(), now())
      on conflict (date) do update
        set kg = excluded.kg, note = excluded.note, entered_by = 'owner', updated_at = now()
      returning to_jsonb(weights.*) into v_out;
      return v_out;
    elsif p_op = 'update' then
      update weights set
        kg   = coalesce((p_data->>'kg')::numeric, kg),
        note = coalesce(p_data->>'note', note),
        updated_at = now()
      where id = (p_data->>'id')::uuid
      returning to_jsonb(weights.*) into v_out;
      return coalesce(v_out, '{}'::jsonb);
    elsif p_op = 'delete' then
      delete from weights where id = (p_data->>'id')::uuid
      returning to_jsonb(weights.*) into v_out;
      return coalesce(v_out, '{}'::jsonb);
    end if;

  elsif p_table = 'events' then
    if p_op = 'insert' then
      insert into events(date, title, detail, type, created_by, created_at)
      values ((p_data->>'date')::date, p_data->>'title',
              coalesce(p_data->>'detail',''),
              coalesce(nullif(p_data->>'type',''), 'event'), 'owner', now())
      returning to_jsonb(events.*) into v_out;
      return v_out;
    elsif p_op = 'update' then
      update events set
        title  = coalesce(p_data->>'title', title),
        detail = coalesce(p_data->>'detail', detail)
      where id = (p_data->>'id')::uuid
      returning to_jsonb(events.*) into v_out;
      return coalesce(v_out, '{}'::jsonb);
    elsif p_op = 'delete' then
      delete from events where id = (p_data->>'id')::uuid
      returning to_jsonb(events.*) into v_out;
      return coalesce(v_out, '{}'::jsonb);
    end if;

  elsif p_table = 'suggestions' then
    if p_op = 'update' then
      update suggestions set
        status = coalesce(p_data->>'status', status),
        updated_at = now()
      where id = (p_data->>'id')::uuid
      returning to_jsonb(suggestions.*) into v_out;
      return coalesce(v_out, '{}'::jsonb);
    elsif p_op = 'delete' then
      delete from suggestions where id = (p_data->>'id')::uuid
      returning to_jsonb(suggestions.*) into v_out;
      return coalesce(v_out, '{}'::jsonb);
    end if;

  elsif p_table = 'settings' then
    insert into settings(key, value, updated_at)
    select kv.key, kv.value, now()
    from jsonb_each_text(p_data) as kv(key, value)
    where kv.key in ('lmp','height','preweight')
    on conflict (key) do update set value = excluded.value, updated_at = now();
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_out from settings;
    return v_out;
  end if;

  raise exception 'unsupported operation: % %', p_table, p_op using errcode = '22023';
end $$;

-- 允许匿名客户端调用这个函数（函数内部自己做权限校验）
grant execute on function app_write(text, text, text, jsonb) to anon, authenticated;

-- ---------- 4. 初始设置 ----------
insert into settings(key, value) values
  ('lmp', '2026-08-03'),
  ('height', ''),
  ('preweight', '')
on conflict (key) do nothing;
