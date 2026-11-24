-- ─────────────────────────────────────────────
-- 하자보수 민원 시스템 — Supabase(PostgreSQL) 스키마
-- Supabase 대시보드 > SQL Editor 에 붙여넣어 실행하세요.
-- ─────────────────────────────────────────────

create extension if not exists "pgcrypto";

create table if not exists contractors (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  defect_types  text[] not null default '{}',   -- LEAK_PIPE, ELECTRIC, DOOR_WINDOW, HVAC, WALL_FLOOR, COMMON, ETC
  regions       text[] not null default '{}',   -- 서울 자치구명, 예: '강남구'
  phone         text not null,
  email         text not null default '',
  is_contracted boolean not null default true,
  is_available  boolean not null default true,
  created_at    timestamptz not null default now()
);

create sequence if not exists complaint_receipt_seq;

create table if not exists complaints (
  id               uuid primary key default gen_random_uuid(),
  receipt_no       text unique not null default (
                     'MW-' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMMDD') || '-' ||
                     lpad(nextval('complaint_receipt_seq')::text, 4, '0')),
  received_at      timestamptz not null default now(),
  complainant_name text not null,
  phone            text not null,
  apartment_name   text not null,
  region           text not null default '',   -- 서울 자치구명 (구별 처리율 집계 기준)
  building         text not null,
  unit             text not null,
  defect_type      text not null check (defect_type in ('LEAK_PIPE','ELECTRIC','DOOR_WINDOW','HVAC','WALL_FLOOR','COMMON','ETC')),
  description      text not null,
  urgency          text not null default 'NORMAL' check (urgency in ('EMERGENCY','HIGH','NORMAL','LOW')),
  photos           text[] not null default '{}',
  contractor_id    uuid references contractors(id) on delete set null,
  status           text not null default 'RECEIVED'
                     check (status in ('RECEIVED','PENDING_REVIEW','ASSIGNED','SCHEDULED','IN_PROGRESS','COMPLETED')),
  channel          text not null default 'MANUAL' check (channel in ('PHONE_AI','MANUAL')),
  call_transcript  text,
  ai_summary       text,
  preferred_dates  date[] not null default '{}',   -- 거주자가 문자 링크에서 고른 방문 희망일 (최대 3개)
  history          jsonb not null default '[]'::jsonb,
  updated_at       timestamptz not null default now()
);

-- 이전 스키마로 만든 DB에 희망일 컬럼 추가
alter table complaints add column if not exists preferred_dates date[] not null default '{}';

create index if not exists complaints_status_idx      on complaints (status);
create index if not exists complaints_received_at_idx on complaints (received_at desc);
create index if not exists complaints_contractor_idx  on complaints (contractor_id);
create index if not exists complaints_region_idx      on complaints (region);

-- 서버(API Route)에서 service_role 키로만 접근하므로 RLS를 켜고 공개 정책은 두지 않습니다.
alter table contractors enable row level security;
alter table complaints  enable row level security;

-- 예시 업체 데이터 (선택)
insert into contractors (name, defect_types, regions, phone, email) values
  ('바른배관설비', '{LEAK_PIPE}', '{강남구,서초구,송파구}', '02-555-1001', 'pipe@barun.test'),
  ('밝은전기공사', '{ELECTRIC}', '{강남구,서초구,송파구,동작구}', '02-333-3003', 'elec@bright.test'),
  ('든든창호', '{DOOR_WINDOW}', '{노원구,도봉구,강북구,성북구}', '02-222-4004', 'door@dd.test')
on conflict do nothing;
