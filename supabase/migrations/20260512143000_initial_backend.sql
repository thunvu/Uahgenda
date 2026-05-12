create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Thời khóa biểu UAH',
  source_hash text,
  academic_year text,
  semester text,
  event_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  summary text not null,
  course_code text,
  class_name text,
  credits integer,
  weekday text not null check (weekday in ('MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU')),
  starts_on date not null,
  ends_on date not null,
  start_time time not null,
  end_time time not null,
  room text,
  campus text,
  address text,
  recurrence_rule text not null,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index schedule_events_schedule_id_idx on public.schedule_events(schedule_id);
create index schedule_events_user_id_idx on public.schedule_events(user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger schedules_set_updated_at
before update on public.schedules
for each row execute function public.set_updated_at();

create trigger google_connections_set_updated_at
before update on public.google_connections
for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    avatar_url = excluded.avatar_url;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_events enable row level security;
alter table public.google_connections enable row level security;

create policy "Users can read own profile"
on public.profiles for select
using (auth.uid() = id);

create policy "Users can update own profile"
on public.profiles for update
using (auth.uid() = id)
with check (auth.uid() = id);

create policy "Users can manage own schedules"
on public.schedules for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "Users can manage own schedule events"
on public.schedule_events for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Intentionally no client-facing policies for google_connections.
-- Only Edge Functions using the service role key should read/write Google tokens.
