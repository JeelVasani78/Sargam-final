-- Run this file in the Supabase SQL Editor.
-- The browser uses only the project URL and anon key. Never put a service-role key in the app.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  email text not null default '',
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.albums (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  artist text not null default 'Sargam.play',
  cover_path text,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  album_id uuid not null references public.albums (id) on delete cascade,
  title text not null,
  artist text not null default 'Sargam.play',
  singer text not null default '',
  composer text not null default '',
  storage_path text not null unique,
  duration numeric not null default 0,
  play_count bigint not null default 0,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  track_id uuid not null references public.tracks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

create table if not exists public.album_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text not null default '',
  artist text not null default 'Sargam.play',
  cover_path text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '',
  reviewed_by uuid references public.profiles (id) on delete set null,
  approved_album_id uuid references public.albums (id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create table if not exists public.album_request_tracks (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.album_requests (id) on delete cascade,
  title text not null,
  artist text not null default 'Sargam.play',
  singer text not null default '',
  composer text not null default '',
  file_name text not null,
  storage_path text not null unique,
  position integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text not null default '';
alter table public.tracks add column if not exists play_count bigint not null default 0;
alter table public.tracks add column if not exists singer text not null default '';
alter table public.tracks add column if not exists composer text not null default '';
alter table public.album_request_tracks add column if not exists singer text not null default '';
alter table public.album_request_tracks add column if not exists composer text not null default '';

create index if not exists tracks_album_position_idx
  on public.tracks (album_id, position);
create index if not exists favorites_user_idx
  on public.favorites (user_id);
create index if not exists album_requests_status_created_idx
  on public.album_requests (status, created_at desc);
create index if not exists album_requests_owner_idx
  on public.album_requests (requested_by, created_at desc);
create index if not exists album_request_tracks_request_idx
  on public.album_request_tracks (request_id, position);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', ''),
    coalesce(new.email, '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

alter table public.profiles enable row level security;
alter table public.albums enable row level security;
alter table public.tracks enable row level security;
alter table public.favorites enable row level security;
alter table public.album_requests enable row level security;
alter table public.album_request_tracks enable row level security;

grant select on public.albums, public.tracks to anon, authenticated;
grant select on public.profiles to authenticated;
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.favorites to authenticated;
grant insert, update, delete on public.albums, public.tracks to authenticated;
grant select, insert, update, delete on public.album_requests to authenticated;
grant select, insert, delete on public.album_request_tracks to authenticated;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Albums are visible to everyone" on public.albums;
create policy "Albums are visible to everyone"
  on public.albums for select to anon, authenticated
  using (true);

drop policy if exists "Admins can add albums" on public.albums;
create policy "Admins can add albums"
  on public.albums for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Admins can update albums" on public.albums;
create policy "Admins can update albums"
  on public.albums for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can remove albums" on public.albums;
create policy "Admins can remove albums"
  on public.albums for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "Tracks are visible to everyone" on public.tracks;
create policy "Tracks are visible to everyone"
  on public.tracks for select to anon, authenticated
  using (true);

drop policy if exists "Admins can add tracks" on public.tracks;
create policy "Admins can add tracks"
  on public.tracks for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists "Admins can update tracks" on public.tracks;
create policy "Admins can update tracks"
  on public.tracks for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can remove tracks" on public.tracks;
create policy "Admins can remove tracks"
  on public.tracks for delete to authenticated
  using ((select public.is_admin()));

drop policy if exists "Users can read their own favorites" on public.favorites;
create policy "Users can read their own favorites"
  on public.favorites for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Users can add their own favorites" on public.favorites;
create policy "Users can add their own favorites"
  on public.favorites for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can update their own favorites" on public.favorites;
create policy "Users can update their own favorites"
  on public.favorites for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "Users can remove their own favorites" on public.favorites;
create policy "Users can remove their own favorites"
  on public.favorites for delete to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Users can read their own album requests" on public.album_requests;
create policy "Users can read their own album requests"
  on public.album_requests for select to authenticated
  using (requested_by = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Users can submit their own album requests" on public.album_requests;
create policy "Users can submit their own album requests"
  on public.album_requests for insert to authenticated
  with check (requested_by = (select auth.uid()) and status = 'pending');

drop policy if exists "Admins can review album requests" on public.album_requests;
create policy "Admins can review album requests"
  on public.album_requests for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Owners can finish their pending request upload" on public.album_requests;
create policy "Owners can finish their pending request upload"
  on public.album_requests for update to authenticated
  using (requested_by = (select auth.uid()) and status = 'pending')
  with check (requested_by = (select auth.uid()) and status = 'pending');

drop policy if exists "Owners can cancel pending requests" on public.album_requests;
create policy "Owners can cancel pending requests"
  on public.album_requests for delete to authenticated
  using (requested_by = (select auth.uid()) and status = 'pending');

drop policy if exists "Owners and admins can read requested tracks" on public.album_request_tracks;
create policy "Owners and admins can read requested tracks"
  on public.album_request_tracks for select to authenticated
  using (
    (select public.is_admin())
    or exists (
      select 1 from public.album_requests r
      where r.id = request_id and r.requested_by = (select auth.uid())
    )
  );

drop policy if exists "Owners can add tracks to pending requests" on public.album_request_tracks;
create policy "Owners can add tracks to pending requests"
  on public.album_request_tracks for insert to authenticated
  with check (
    exists (
      select 1 from public.album_requests r
      where r.id = request_id
        and r.requested_by = (select auth.uid())
        and r.status = 'pending'
        and storage_path like 'requests/' || (select auth.uid())::text || '/' || request_id::text || '/%'
    )
  );

insert into storage.buckets (id, name, public)
values ('music', 'music', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('music-requests', 'music-requests', false)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "Avatars are publicly readable" on storage.objects;
create policy "Avatars are publicly readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload their own avatar" on storage.objects;
create policy "Users can upload their own avatar"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can update their own avatar" on storage.objects;
create policy "Users can update their own avatar"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users can delete their own avatar" on storage.objects;
create policy "Users can delete their own avatar"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Music files are publicly readable" on storage.objects;
create policy "Music files are publicly readable"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'music');

drop policy if exists "Admins can upload music files" on storage.objects;
create policy "Admins can upload music files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'music' and (select public.is_admin()));

drop policy if exists "Admins can update music files" on storage.objects;
create policy "Admins can update music files"
  on storage.objects for update to authenticated
  using (bucket_id = 'music' and (select public.is_admin()))
  with check (bucket_id = 'music' and (select public.is_admin()));

drop policy if exists "Admins can remove music files" on storage.objects;
create policy "Admins can remove music files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'music' and (select public.is_admin()));

drop policy if exists "Users can upload files to their own requests" on storage.objects;
create policy "Users can upload files to their own requests"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'music-requests'
    and (storage.foldername(name))[1] = 'requests'
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

drop policy if exists "Owners and admins can read request uploads" on storage.objects;
create policy "Owners and admins can read request uploads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'music-requests'
    and (
      (select public.is_admin())
      or (
        (storage.foldername(name))[1] = 'requests'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
    )
  );

drop policy if exists "Owners and admins can remove request uploads" on storage.objects;
create policy "Owners and admins can remove request uploads"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'music-requests'
    and (
      (select public.is_admin())
      or (
        (storage.foldername(name))[1] = 'requests'
        and (storage.foldername(name))[2] = (select auth.uid())::text
      )
    )
  );

create or replace function public.record_track_play(track_uuid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tracks
  set play_count = play_count + 1
  where id = track_uuid;
$$;

revoke all on function public.record_track_play(uuid) from public;
grant execute on function public.record_track_play(uuid) to anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'albums'
  ) then
    alter publication supabase_realtime add table public.albums;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'tracks'
  ) then
    alter publication supabase_realtime add table public.tracks;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'album_requests'
  ) then
    alter publication supabase_realtime add table public.album_requests;
  end if;
end;
$$;

-- After a user signs up, promote exactly that account from the SQL Editor:
-- update public.profiles set role = 'admin'
-- where id = (select id from auth.users where email = 'your-admin-email@example.com');
