-- Hold — private heavy-file vault (Dropbox-style)
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- After this script:
-- 1) Dashboard → Storage → Settings → Global file size limit → 25 GiB
--    (or 26843545600 bytes). Free plan is capped at 50 MB; Pro is required
--    for 25 GB files.
-- 2) Confirm the `hold` bucket appears under Storage → Buckets.

-- ---------------------------------------------------------------------------
-- 1) Metadata
-- ---------------------------------------------------------------------------
create table if not exists public.hold_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  mime text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes >= 0),
  storage_path text not null,
  created_at timestamptz not null default now(),
  unique (storage_path)
);

create index if not exists hold_files_user_created_idx
  on public.hold_files (user_id, created_at desc);

alter table public.hold_files enable row level security;

drop policy if exists "hold_files: owner read" on public.hold_files;
drop policy if exists "hold_files: owner write" on public.hold_files;
drop policy if exists "hold_files: owner delete" on public.hold_files;

create policy "hold_files: owner read" on public.hold_files
  for select using (auth.uid() = user_id);
create policy "hold_files: owner write" on public.hold_files
  for insert with check (auth.uid() = user_id);
create policy "hold_files: owner delete" on public.hold_files
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2) Private bucket — 25 GiB, all MIME types (PDF, images, zip, everything)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hold', 'hold', false, 26843545600, null)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = null,
      public = false;

drop policy if exists "hold: owner read" on storage.objects;
drop policy if exists "hold: owner insert" on storage.objects;
drop policy if exists "hold: owner update" on storage.objects;
drop policy if exists "hold: owner delete" on storage.objects;

create policy "hold: owner read"
  on storage.objects for select
  using (
    bucket_id = 'hold'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "hold: owner insert"
  on storage.objects for insert
  with check (
    bucket_id = 'hold'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE is required for TUS resumable uploads (chunk patches).
create policy "hold: owner update"
  on storage.objects for update
  using (
    bucket_id = 'hold'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'hold'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "hold: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'hold'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
