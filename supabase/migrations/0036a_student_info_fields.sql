-- 0036a: 학생 정보 필드 보강 (ijw-calander 학생 폼 패리티 — 정보성 필드 7개)
-- 전부 nullable 추가(기존 데이터 무영향). 폼/상세가 소비처. 발송토글·현금영수증 등 오펀성 필드는 의도적으로 제외.
-- 손수 alpha (drizzle db:generate 금지 — #P0-6 드리프트). supabase 쿼리는 string-typed라 schema.ts 없이도
-- 동작 — 병렬 세션이 schema.ts를 동시 편집 중이라 students 블록 반영은 드리즐 스냅샷 reconciliation 때 일괄(드리프트 기존 과제).

alter table students add column if not exists graduation_year text; -- 졸업연도
alter table students add column if not exists home_phone text;      -- 원생 집전화
alter table students add column if not exists parent_relation text;  -- 보호자 관계(부/모/조부모/기타)
alter table students add column if not exists other_phone text;      -- 기타 알림 연락처
alter table students add column if not exists zip_code text;         -- 우편번호
alter table students add column if not exists address_detail text;   -- 상세주소
alter table students add column if not exists nickname text;         -- 닉네임
