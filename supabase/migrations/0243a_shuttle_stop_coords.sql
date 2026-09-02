-- 0243a — 셔틀 정류장 좌표(위경도 · 도착 반경 · 주소)
--
-- 원장(2026-09-02) 최종 목표에 *"추후 학부모까지 위치같은것도 볼수있는"* 이 들어 있다. 위치의
-- 전제가 **정류장이 지도 위 어디냐**다 — 지금 `shuttle_stops`는 이름과 메모뿐이라 GPS가 생겨도
-- "지금 어느 정류장 근처인지"를 판정할 수가 없다.
--
-- 🔑 좌표는 지금 당장도 값이 있다 — 0225a가 정류장 마스터를 만들 때 남긴 문제 그대로다:
--    같은 아파트 앞 **반대편 정류장**을 `memo`("CU 건너편", "칠성고 맞은편")라는 사람 말로만 갈라
--    두고 있다. 이관 스크립트(`import-shuttle.cjs`)가 `힐스테이트 대구역 앞`↔`…오페라 동상 앞`,
--    `서희스타힐스(cu건너)`↔`(칠성고맞은편)`, `북구청`↔`북구청역 에듀포레`를 **물리적으로 다를 수
--    있어 일부러 합치지 않고 남겨 둔** 쌍이 그것이다. 좌표가 찍히면 그 판단이 말이 아니라 사실이 된다.
--
-- 🔴 **NOT NULL로 만들지 않는다.** 실측 정류장이 23곳인데 한 번에 다 찍을 수 없다 — 못 찍은 곳이
--    있다고 편성·등하원이 멈추면 안 된다. 좌표는 **있으면 쓰고 없으면 종전대로**다.
-- 🔴 다만 **한쪽만 있는 건 막는다**(아래 check) — 위도만 있는 정류장은 지도에 못 찍는데 "좌표 있음"으로
--    세어져 조용히 빈 마커가 된다. 둘 다 있거나 둘 다 없거나 둘 중 하나다.
--
-- ⚠️ **앱은 이 컬럼이 없어도 살아야 한다**([[#95]] — eywa는 SQL을 원장이 손으로 실행하므로 배포와
--    적용 사이에 항상 간격이 있다). 그래서 조회는 기존 select에 컬럼을 **끼워 넣지 않고**
--    별도 질의로 떼어 두었다(`loadStopCoords`) — 컬럼이 없으면 좌표만 조용히 비고 편성 화면은 그대로 산다.
--    기존 select에 넣었으면 컬럼 부재 → PostgREST 400 → **셔틀 편성 화면이 통째로 빈 보드**가 된다.
--
-- ⚠️ 인덱스를 만들지 않는다 — 실측 23행이고 화면은 항상 전건(상한 500)을 받는다. "좌표 있는 것만"
--    거르는 일도 그 23행 안에서 끝난다. 행이 수천으로 늘면 그때 판단한다.
--
-- 롤백:
--   alter table public.shuttle_stops
--     drop column if exists lat,
--     drop column if exists lng,
--     drop column if exists radius_m,
--     drop column if exists address;
set local statement_timeout = '60s';

alter table public.shuttle_stops
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  -- 도착 판정 반경(미터). GPS가 붙었을 때 "이 정류장에 도착했다"를 정하는 값이고, 지금은 지도에
  -- 원으로만 보인다. 기본 50m = 셔틀이(D:\bus) 실사용값. 아파트 단지처럼 넓은 곳은 늘린다.
  add column if not exists radius_m integer not null default 50,
  -- 카카오 역지오코딩 결과 또는 사람이 적은 주소. 좌표는 사람이 못 읽으므로 **화면에 보여줄 것은
  -- 이 값**이다(인쇄 노선표·신규 기사 안내가 쓴다).
  add column if not exists address text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shuttle_stops_latlng_range'
  ) then
    alter table public.shuttle_stops
      add constraint shuttle_stops_latlng_range check (
        (lat is null or (lat >= -90 and lat <= 90)) and
        (lng is null or (lng >= -180 and lng <= 180))
      );
  end if;

  -- 🔴 둘 다 있거나 둘 다 없거나 — 한쪽만 있으면 지도에 못 찍으면서 '좌표 있음'으로 세어진다.
  if not exists (
    select 1 from pg_constraint where conname = 'shuttle_stops_latlng_paired'
  ) then
    alter table public.shuttle_stops
      add constraint shuttle_stops_latlng_paired check ((lat is null) = (lng is null));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'shuttle_stops_radius_range'
  ) then
    alter table public.shuttle_stops
      add constraint shuttle_stops_radius_range check (radius_m between 10 and 500);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'shuttle_stops_address_len'
  ) then
    alter table public.shuttle_stops
      add constraint shuttle_stops_address_len check (address is null or char_length(address) <= 200);
  end if;
end $$;

comment on column public.shuttle_stops.lat is
  '위도(0243a). null 허용 — 아직 안 찍은 정류장이 있어도 편성·등하원은 그대로 돈다.';
comment on column public.shuttle_stops.radius_m is
  '도착 판정 반경(m, 0243a). GPS가 붙었을 때 "이 정류장에 도착했다"의 기준. 기본 50.';

notify pgrst, 'reload schema';
