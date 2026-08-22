-- kl0ck1s multiplayer signaling — Supabase migration
-- Run this in the Supabase SQL editor (or via `supabase db push`).

-- 1) Room registry -----------------------------------------------------
-- We do NOT store SDP offers/answers here. The table only exists so a
-- guest can validate a code before trying to connect, and so we can
-- clean up stale rooms. The actual offer/answer exchange happens over
-- a Realtime Broadcast channel named "room:<code>" (see JS module).

create table if not exists public.mp_rooms
(
    code
    text
    primary
    key,
    status
    text
    not
    null
    default
    'waiting'
    check (
    status
    in
(
    'waiting',
    'matched',
    'closed'
)),
    created_at timestamptz not null default now
(
),
    expires_at timestamptz not null default
(
    now
(
) + interval '10 minutes')
    );

alter table public.mp_rooms enable row level security;

-- No direct table access for anon/authenticated — everything goes
-- through the SECURITY DEFINER functions below, so nobody can list
-- every open room by querying the table directly.
revoke all on public.mp_rooms from anon, authenticated;

-- 2) RPCs ----------------------------------------------------------------

create
or replace function public.mp_create_room()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
v_code     text;
    v_attempts
int := 0;
begin
delete
from public.mp_rooms
where expires_at < now();

loop
v_code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
begin
insert into public.mp_rooms (code)
values (v_code);
return v_code;
exception when unique_violation then
            v_attempts := v_attempts + 1;
            if
v_attempts > 10 then
                raise exception 'could not allocate a unique room code';
end if;
end;
end loop;
end;
$$;

create
or replace function public.mp_join_room(p_code text)
returns boolean
language sql
security definer
set search_path = public
as $$
    with upd as (
        update public.mp_rooms
           set status = 'matched'
         where code = upper(p_code)
           and status = 'waiting'
           and expires_at > now()
        returning 1
    )
select exists(select 1 from upd);
$$;

create
or replace function public.mp_close_room(p_code text)
returns void
language sql
security definer
set search_path = public
as $$
delete
from public.mp_rooms
where code = upper(p_code);
$$;

grant
execute
on
function
public
.
mp_create_room
()      to anon, authenticated;
grant execute on function public.mp_join_room
(text)     to anon, authenticated;
grant execute on function public.mp_close_room
(text)    to anon, authenticated;

-- Optional: periodic cleanup of abandoned rooms via pg_cron
-- (Database > Extensions > enable pg_cron first)
-- select cron.schedule('mp_rooms_cleanup', '*/5 * * * *',
--   $$delete from public.mp_rooms where expires_at < now()$$);

-- 3) Realtime Broadcast authorization ------------------------------------
-- Realtime Authorization is on by default for new projects: to send/
-- receive Broadcast messages on a private channel, you need explicit
-- RLS policies on realtime.messages. We scope access to topics that
-- start with "room:" so this doesn't open up unrelated Realtime usage.

drop
policy if exists "mp rooms broadcast read" on "realtime"."messages";
create
policy "mp rooms broadcast read"
on "realtime"."messages"
for
select
    to anon, authenticated
    using (
    realtime.topic() like 'room:%'
    and extension = 'broadcast'
    );

drop
policy if exists "mp rooms broadcast write" on "realtime"."messages";
create
policy "mp rooms broadcast write"
on "realtime"."messages"
for insert
to anon, authenticated
with check (
    realtime.topic() like 'room:%'
    and extension = 'broadcast'
);
