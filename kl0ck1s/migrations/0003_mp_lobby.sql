-- kl0ck1s multiplayer signaling — open lobby (bez ręcznego przepisywania kodu)
--
-- Zastępuje model "host podaje 6-znakowy kod znajomemu" modelem publicznego
-- lobby: host tworzy pokój -> pojawia się na liście u wszystkich, którzy mają
-- otwarty ekran "Dołącz" -> gość klika "Dołącz do gracza X" -> host widzi
-- przychodzącą prośbę i klika "Akceptuj" (albo "Odrzuć") -> dopiero wtedy
-- leci automatyczna wymiana WebRTC offer/answer, dokładnie tak jak wcześniej.
--
-- `code` (6-znakowy identyfikator) nigdy nie trafia do UI/gracza. Zostaje
-- wewnątrz JS jako:
--   1) nazwa prywatnego kanału Broadcast do wymiany SDP ("room:<code>"),
--   2) "sekret" hosta — apka nie ma prawdziwego auth, więc `code` pełni
--      rolę dowodu, że to on jest właścicielem danego pokoju
--      (patrz `mp_match_room` / `mp_close_room`).
--
-- Ten plik jest samowystarczalny i idempotentny (bezpieczny do wielokrotnego
-- uruchomienia) — jeśli masz już wdrożone poprzednie 0001_mp_rooms.sql /
-- 0002_mp_rooms_tuning.sql, ten skrypt je nadpisuje. Jeśli baza jest jeszcze
-- pusta, po prostu wklej ten jeden plik zamiast tamtych dwóch.

-- ─── Sprzątanie starych obiektów ───
drop function if exists public.mp_join_room(text);
drop function if exists public.mp_close_room(text);
drop function if exists public.mp_create_room();
drop function if exists public.mp_create_room(text);
drop function if exists public.mp_list_open_rooms();
drop function if exists public.mp_match_room(text, uuid);
drop function if exists public.mp_generate_room_code();
drop table if exists public.mp_rooms;

-- ─── Tabela pokoi ───
create table public.mp_rooms
(
    id         uuid primary key     default gen_random_uuid(),
    code       text        not null unique,
    host_name  text        not null default '',
    status     text        not null default 'open' check (status in ('open', 'matched')),
    created_at timestamptz not null default now(),
    expires_at timestamptz not null default now() + interval '10 minutes'
);

create index idx_mp_rooms_expires_at on public.mp_rooms (expires_at);
create index idx_mp_rooms_open_created_at on public.mp_rooms (created_at desc) where status = 'open';

-- RLS włączone, ale bez żadnych policy dla anon/authenticated na samej
-- tabeli — czyli brak bezpośredniego SELECT/INSERT/UPDATE z klienta.
-- Wszystko idzie przez poniższe funkcje `security definer`.
alter table public.mp_rooms enable row level security;

-- ─── Generator kodu pokoju: 32-znakowy alfabet bez znaków mylących się
--     wizualnie (bez 0/O, 1/I/L) ───
create function public.mp_generate_room_code()
    returns text
    language sql volatile
as $$
select string_agg(
           substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (floor(random() * 32) + 1):: int, 1),
           ''
       )
from generate_series(1, 6);
$$;

-- ─── Host: utworzenie pokoju, od razu widocznego w lobby ───
create function public.mp_create_room(p_host_name text default '')
    returns table
            (
                room_id uuid,
                code    text
            )
    language plpgsql
security definer
set search_path = public
as $$
declare
v_code     text;
    v_id
uuid;
    v_attempts
int := 0;
begin
delete
from public.mp_rooms
where expires_at < now();

loop
v_code := public.mp_generate_room_code();
begin
insert into public.mp_rooms (code, host_name)
values (v_code, left(trim (coalesce (p_host_name, '')), 24)) returning id
into v_id;

return query select v_id, v_code;
return;
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

-- ─── Każdy: lista aktualnie otwartych pokoi (bez kolumny `code`!) ───
-- Używana tylko do "seedowania" listy przy wejściu na ekran "Dołącz" —
-- kolejne otwarcia/zamknięcia dochodzą już na żywo przez Broadcast (kanał
-- "lobby"), bez ponownego odpytywania bazy.
create function public.mp_list_open_rooms()
    returns table
            (
                room_id    uuid,
                host_name  text,
                created_at timestamptz
            )
    language sql stable
security definer
set search_path = public
as $$
select id, host_name, created_at
from public.mp_rooms
where status = 'open'
  and expires_at > now()
order by created_at desc limit 50;
$$;

-- ─── Host: potwierdzenie w bazie, że dany pokój dostał matcha ───
-- `p_code` musi się zgadzać z kodem tego pokoju — tylko host go zna,
-- więc to on jedyny może to wywołać skutecznie dla swojego pokoju.
create function public.mp_match_room(p_code text, p_room_id uuid)
    returns boolean
    language plpgsql
security definer
set search_path = public
as $$
declare
v_updated int;
begin
update public.mp_rooms
set status = 'matched'
where id = p_room_id
  and code = p_code
  and status = 'open'
  and expires_at > now();

get diagnostics v_updated = row_count;
return v_updated > 0;
end;
$$;

-- ─── Host: sprzątnięcie pokoju (po matchu, po anulowaniu, po błędzie) ───
create function public.mp_close_room(p_code text)
    returns void
    language sql
    security definer
set search_path = public
as $$
delete
from public.mp_rooms
where code = p_code;
$$;

grant
execute
on
function
public
.
mp_generate_room_code
()   to anon, authenticated;
grant execute on function public.mp_create_room
(text)      to anon, authenticated;
grant execute on function public.mp_list_open_rooms
()      to anon, authenticated;
grant execute on function public.mp_match_room
(text, uuid) to anon, authenticated;
grant execute on function public.mp_close_room
(text)       to anon, authenticated;

-- ─── Realtime Broadcast: autoryzacja kanałów (`private: true` w JS) ───
-- Jeśli Twoje poprzednie 0001_mp_rooms.sql definiowało już policy dla
-- tematu "room:%" na realtime.messages — ta nowa policy jest dodatkowa
-- (permisywne policy łączą się przez OR), więc nic się nie popsuje, co
-- najwyżej będzie redundancja. Warto wtedy usunąć starą.
drop
policy if exists "mp broadcast access" on realtime.messages;
create
policy "mp broadcast access"
on realtime.messages
for all
to anon, authenticated
using (
    realtime.topic() like 'room:%'
    or realtime.topic() = 'lobby'
    or realtime.topic() like 'lobby-room:%'
)
with check (
    realtime.topic() like 'room:%'
    or realtime.topic() = 'lobby'
    or realtime.topic() like 'lobby-room:%'
);
