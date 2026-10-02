alter table public.schedules add column if not exists photo_url text;
alter table public.schedules add column if not exists photo_path text;
alter table public.schedules add column if not exists photo_position_x numeric(5,2) not null default 50;
alter table public.schedules add column if not exists photo_position_y numeric(5,2) not null default 50;
alter table public.schedules add column if not exists photo_zoom numeric(4,2) not null default 1;
alter table public.schedules add column if not exists photo_uploaded_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'schedule-photos',
  'schedule-photos',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "owner read schedule photos" on storage.objects;
drop policy if exists "owner insert schedule photos" on storage.objects;
drop policy if exists "owner update schedule photos" on storage.objects;
drop policy if exists "owner delete schedule photos" on storage.objects;

create policy "owner read schedule photos"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'schedule-photos'
    and lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
  );

create policy "owner insert schedule photos"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'schedule-photos'
    and lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
  );

create policy "owner update schedule photos"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'schedule-photos'
    and lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
  )
  with check (
    bucket_id = 'schedule-photos'
    and lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
  );

create policy "owner delete schedule photos"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'schedule-photos'
    and lower((select auth.jwt() ->> 'email')) = 'harminis@gmail.com'
  );
