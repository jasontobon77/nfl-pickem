-- =========================================================
-- NFL Pick'Em — Supabase schema
-- Run this in the Supabase SQL editor (Database > SQL Editor)
-- =========================================================

-- ---------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------
create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------
-- Table: profiles
-- One row per app user, keyed to auth.users
-- ---------------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

-- ---------------------------------------------------------
-- Table: games
-- Synced from ESPN's public scoreboard feed by the cron route
-- ---------------------------------------------------------
create table if not exists public.games (
  id            text primary key,          -- ESPN event id
  week          integer not null,
  home_team     text not null,             -- team abbreviation, e.g. "KC"
  away_team     text not null,
  home_score    integer not null default 0,
  away_score    integer not null default 0,
  winner        text,                      -- team abbreviation once final, else null
  status        text not null default 'STATUS_SCHEDULED',
  kickoff_time  timestamptz not null
);

create index if not exists games_week_idx on public.games (week);

-- ---------------------------------------------------------
-- Table: picks
-- One row per (user, game). Upserted whenever a user picks a team.
-- ---------------------------------------------------------
create table if not exists public.picks (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  game_id      text not null references public.games (id) on delete cascade,
  picked_team  text not null,
  is_correct   boolean,                    -- null until the game is final
  updated_at   timestamptz not null default now(),
  unique (user_id, game_id)
);

create index if not exists picks_user_idx on public.picks (user_id);
create index if not exists picks_game_idx on public.picks (game_id);

-- ---------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.games    enable row level security;
alter table public.picks    enable row level security;

-- profiles: anyone (incl. anon) can read display names for the leaderboard;
-- a user can only create/update their own row.
drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- games: publicly readable. Writes only happen via the cron route, which
-- uses the service-role key and therefore bypasses RLS entirely — no
-- insert/update policy is granted to normal users.
drop policy if exists "games are publicly readable" on public.games;
create policy "games are publicly readable"
  on public.games for select
  using (true);

-- picks: publicly readable (needed for the shared leaderboard); a user can
-- only insert/update their own picks, and only before kickoff.
drop policy if exists "picks are publicly readable" on public.picks;
create policy "picks are publicly readable"
  on public.picks for select
  using (true);

drop policy if exists "users can insert their own picks before kickoff" on public.picks;
create policy "users can insert their own picks before kickoff"
  on public.picks for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.kickoff_time > now()
    )
  );

drop policy if exists "users can update their own picks before kickoff" on public.picks;
create policy "users can update their own picks before kickoff"
  on public.picks for update
  using (
    auth.uid() = user_id
    and exists (
      select 1 from public.games g
      where g.id = game_id
        and g.kickoff_time > now()
    )
  );

-- Note: the cron route uses the SUPABASE_SERVICE_ROLE_KEY, which bypasses
-- RLS, so it can still grade picks (set is_correct) after kickoff even
-- though the policies above block the *user* from editing a locked pick.
