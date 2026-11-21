-- Run this once in Supabase SQL Editor for an existing Sargam.play project.
-- New track credits are stored per song so singer/composer search works.

alter table public.tracks
  add column if not exists singer text not null default '',
  add column if not exists composer text not null default '';

alter table public.album_request_tracks
  add column if not exists singer text not null default '',
  add column if not exists composer text not null default '';
