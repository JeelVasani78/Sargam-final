-- Apply these additive updates to an existing Sargam.play Supabase project.
-- Safe to run again: columns, bucket, and policies are created idempotently.

-- Per-track credits, and the play counter used by Top Hits.
alter table public.tracks
  add column if not exists singer text not null default '',
  add column if not exists composer text not null default '',
  add column if not exists play_count bigint not null default 0;

alter table public.album_request_tracks
  add column if not exists singer text not null default '',
  add column if not exists composer text not null default '';

-- Top Hits records a play through this database function.
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

-- Profile photos are publicly viewable; uploads and changes are limited to
-- the signed-in user's own folder (the first path segment is their auth ID).
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
