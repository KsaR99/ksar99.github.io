-- kl0ck1s multiplayer signaling — tuning pass
-- Uzupełnienie do 0001_mp_rooms.sql: brakujący indeks pod cleanup
-- oraz szerszy alfabet kodów pokoju (bez znaków mylących się wizualnie).

-- 1) Indeks pod `delete ... where expires_at < now()` wołane w mp_create_room.
--    Bez tego to pełny sekwencyjny skan tabeli przy KAŻDYM tworzeniu pokoju.
create index if not exists idx_mp_rooms_expires_at
    on public.mp_rooms (expires_at);

-- 2) Szerszy, czytelniejszy alfabet kodów: 32 znaki (bez 0/O, 1/I/L, które
--    łatwo pomylić przy przepisywaniu na głos/telefonie) zamiast tylko
--    hexowego 0-9A-F. Daje 32^6 ≈ 1.07 mld kombinacji zamiast 16^6 ≈ 16.7 mln.
create
or replace function public.mp_generate_room_code()
returns text
language sql
volatile
as $$
select string_agg(
           substr('23456789ABCDEFGHJKMNPQRSTUVWXYZ', (floor(random() * 32) + 1):: int, 1),
           ''
       )
from generate_series(1, 6);
$$;

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
v_code := public.mp_generate_room_code();
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

grant execute on function public.mp_generate_room_code
() to anon, authenticated;

-- 3) Opcjonalnie, dopiero jeśli ruch będzie realnie duży: autovacuum
--    agresywniej dla tej tabeli, bo insert+delete cykl trwa sekundy.
-- alter table public.mp_rooms set (autovacuum_vacuum_scale_factor = 0.02);
