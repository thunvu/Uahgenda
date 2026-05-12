drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.google_imports;
drop table if exists public.schedule_events;
drop table if exists public.schedules;
drop table if exists public.profiles;

create table if not exists public.google_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  google_email text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scopes text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists google_connections_set_updated_at on public.google_connections;

create trigger google_connections_set_updated_at
before update on public.google_connections
for each row execute function public.set_updated_at();

alter table public.google_connections enable row level security;

-- Intentionally no client-facing policies for google_connections.
-- Only Edge Functions using the service role key should read/write Google tokens.
