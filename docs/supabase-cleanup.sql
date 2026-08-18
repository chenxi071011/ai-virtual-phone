-- ═══════════════════════════════════════════════════════════════════
-- Supabase 空间体检 + 清理（Database Size 快满时用）
--
-- 用法：
--   第 1 步：先单独跑「体检」那一段，看看到底是哪张表在吃空间；
--   第 2 步：按需执行下面的清理语句（都只删日志/过期/已下架数据，
--            不动用户账号、作品正文、钱包流水）；
--   第 3 步：跑最后的 VACUUM——不跑这一步，仪表盘上的
--            Database Size 不会变小（Postgres 删行只是打标记）。
-- ═══════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════
-- ★ 头号嫌疑犯：cron.job_run_details（pg_cron 执行日志）
--
-- 2026-08 实测：数据库 444 MB 里有 369 MB（83%）是这张表——推送扫描
-- 任务 10 秒一跑，每天写 8640 行执行记录，一个月堆了 23 万行。
-- 它是纯日志，清空不影响任何业务，且 truncate 即时回收空间、无需 VACUUM。
--
-- 先看它有多大：
--   select pg_size_pretty(pg_total_relation_size('cron.job_run_details'::regclass)),
--          count(*) from cron.job_run_details;
--
-- 清空（几百 MB 一秒回收）：
--   truncate table cron.job_run_details;
--
-- 装上自动清理，防止再堆（每天 03:20 UTC 删两天前的记录，只需执行一次）：
--   select cron.schedule(
--     'prune-cron-history', '20 3 * * *',
--     'delete from cron.job_run_details where start_time < now() - interval ''2 days'''
--   );
-- 查看已有定时任务：select jobid, schedule, jobname from cron.job;
-- ═══════════════════════════════════════════════════════════════════

-- ── 第 1 步 · 体检：各表实际占用（含索引），从大到小 ──
-- 提示：如果所有表加起来远小于 pg_database_size，说明大头在 public 之外，
-- 用下面这句按 schema 汇总定位（cron / auth / storage / realtime）：
--   select n.nspname, pg_size_pretty(sum(pg_total_relation_size(c.oid)))
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where c.relkind = 'r' group by 1 order by 2 desc;

select
  relname as table_name,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
  pg_size_pretty(pg_relation_size(c.oid)) as data_size,
  to_char(coalesce(s.n_live_tup, 0), 'FM999,999,999') as live_rows,
  to_char(coalesce(s.n_dead_tup, 0), 'FM999,999,999') as dead_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_stat_user_tables s on s.relid = c.oid
where n.nspname = 'public' and c.relkind = 'r'
order by pg_total_relation_size(c.oid) desc
limit 30;

-- ═══════════════════════════════════════════════════════════════════
-- 第 2 步 · 清理（每条都可以单独执行；先跑体检确认主犯再动手）
-- ═══════════════════════════════════════════════════════════════════

-- ① 过期登录会话（登录态早已失效的记录，删了用户无感）
delete from public.app_sessions where expires_at < now();

-- ② 取用留痕（水印反查用的日志）：只保留最近 60 天
--    注意：删掉的时间段内泄出的副本将无法反查取用账号，按需缩放天数
delete from public.content_access_logs where created_at < now() - interval '60 days';

-- ③ 自定义 APP 下载留痕：只保留最近 60 天
delete from public.custom_app_package_downloads where created_at < now() - interval '60 days';

-- ④ 联机房间：已关闭的直接删；开着但两天没动静的视为僵尸房
delete from public.online_rooms where status = 'closed';
delete from public.online_rooms where status = 'open' and updated_at < now() - interval '2 days';

-- ⑤ 推送队列尾巴：已终态的任务/已消费的收件箱，保留 7 天
delete from public.push_jobs
  where status in ('done', 'cancelled', 'failed') and created_at < now() - interval '7 days';
delete from public.push_outbox
  where consumed_at is not null and created_at < now() - interval '7 days';
delete from public.push_shortcut_commands
  where status in ('succeeded', 'failed', 'expired', 'cancelled') and created_at < now() - interval '7 days';

-- ⑥ 身份验证申请：已处理完的，保留 30 天
delete from public.verification_requests
  where status in ('approved', 'rejected') and created_at < now() - interval '30 days';

-- ⑦ 软删除的作品：下架超过 30 天的彻底清掉（点赞/收藏/评论随外键级联）
delete from public.game_hall_games
  where deleted_at is not null and deleted_at < now() - interval '30 days';
delete from public.custom_app_market_apps
  where deleted_at is not null and deleted_at < now() - interval '30 days';

-- ⑧ 独家特调：下架超过 30 天的材料/配方 + 它们的点赞/入柜/评论
--    （社交表没挂外键，先删社交行再删主体）
delete from public.mixology_likes l
  using public.mixology_items i
  where l.target_type = 'material' and l.target_id = i.id
    and i.deleted_at is not null and i.deleted_at < now() - interval '30 days';
delete from public.mixology_saves sv
  using public.mixology_items i
  where sv.target_type = 'material' and sv.target_id = i.id
    and i.deleted_at is not null and i.deleted_at < now() - interval '30 days';
delete from public.mixology_comments cm
  using public.mixology_items i
  where cm.target_type = 'material' and cm.target_id = i.id
    and i.deleted_at is not null and i.deleted_at < now() - interval '30 days';
delete from public.mixology_items
  where deleted_at is not null and deleted_at < now() - interval '30 days';
delete from public.mixology_likes l
  using public.mixology_recipes r
  where l.target_type = 'recipe' and l.target_id = r.id
    and r.deleted_at is not null and r.deleted_at < now() - interval '30 days';
delete from public.mixology_saves sv
  using public.mixology_recipes r
  where sv.target_type = 'recipe' and sv.target_id = r.id
    and r.deleted_at is not null and r.deleted_at < now() - interval '30 days';
delete from public.mixology_comments cm
  using public.mixology_recipes r
  where cm.target_type = 'recipe' and cm.target_id = r.id
    and r.deleted_at is not null and r.deleted_at < now() - interval '30 days';
delete from public.mixology_recipes
  where deleted_at is not null and deleted_at < now() - interval '30 days';

-- ⑨（可选，默认注释）软删除的评论正文置空：评论树结构要留着，但正文可以清
-- update public.game_hall_comments set content = '' where deleted_at is not null;
-- update public.mixology_comments set content = '' where deleted_at is not null;

-- ═══════════════════════════════════════════════════════════════════
-- 第 3 步 · 回收空间（必须跑，否则仪表盘数字不变）
--
-- VACUUM FULL 会重写整张表、期间锁表（这个量级也就几秒~几十秒），
-- 只对体检里排前几名、且刚刚删过大量行的表跑即可，别全库无脑跑。
-- 跑完过几分钟仪表盘的 Database Size 才会刷新。
-- ═══════════════════════════════════════════════════════════════════

-- 按体检结果挑着跑，例如：
-- vacuum full public.content_access_logs;
-- vacuum full public.app_sessions;
-- vacuum full public.online_rooms;
-- vacuum full public.push_outbox;
-- vacuum full public.game_hall_games;

-- 收尾：全库轻量 vacuum + 刷新统计（不锁表，随便跑）
vacuum analyze;
