create extension if not exists pgcrypto;

create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  admin_id text unique not null,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists albums (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  album_id uuid references albums(id) on delete set null,
  title text not null,
  caption text not null default '',
  storage_path text not null unique,
  public_url text not null,
  uploaded_at timestamptz not null default now(),
  featured boolean not null default false
);

create table if not exists visitor_identities (
  id uuid primary key default gen_random_uuid(),
  visitor_token text unique not null,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists likes (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  visitor_id uuid not null references visitor_identities(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(photo_id, visitor_id)
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid not null references photos(id) on delete cascade,
  visitor_id uuid not null references visitor_identities(id) on delete cascade,
  display_name text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists website_themes (
  id uuid primary key default gen_random_uuid(),
  active boolean not null default true,
  theme_name text not null default 'love',
  background text not null default '',
  colors jsonb not null default '{}'::jsonb,
  font_family text not null default 'Nunito, sans-serif',
  background_image text,
  updated_at timestamptz not null default now(),
  updated_by uuid references admin_users(id)
);

create unique index if not exists one_active_theme_idx on website_themes(active) where active = true;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('memory-photos', 'memory-photos', true, 15728640, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Memory photographs are publicly readable"
on storage.objects for select using (bucket_id = 'memory-photos');

create policy "Service role may manage memory photographs"
on storage.objects for all
using (bucket_id = 'memory-photos' and auth.role() = 'service_role')
with check (bucket_id = 'memory-photos' and auth.role() = 'service_role');

create index if not exists photos_album_uploaded_idx on photos(album_id, uploaded_at desc);
create index if not exists likes_photo_idx on likes(photo_id);
create index if not exists comments_photo_created_idx on comments(photo_id, created_at asc);

alter table admin_users enable row level security;
alter table albums enable row level security;
alter table photos enable row level security;
alter table visitor_identities enable row level security;
alter table likes enable row level security;
alter table comments enable row level security;
alter table website_themes enable row level security;

create policy "Public albums are readable" on albums for select using (true);
create policy "Public photos are readable" on photos for select using (true);
create policy "Public themes are readable" on website_themes for select using (true);
create policy "Public like counts are readable" on likes for select using (true);
create policy "Public comments are readable" on comments for select using (true);

insert into website_themes (active, theme_name) values (true, 'love')
on conflict (active) do nothing;

alter publication supabase_realtime add table photos;
alter publication supabase_realtime add table albums;
alter publication supabase_realtime add table likes;
alter publication supabase_realtime add table comments;
alter publication supabase_realtime add table website_themes;
