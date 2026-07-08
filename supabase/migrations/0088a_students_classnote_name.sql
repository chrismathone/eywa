-- 0088a: 학생 ClassNote 보드명 오버라이드(동명이인 구분) — P3 오발송 방지 옵션2.
-- ClassNote 보드/원아 선택이 이름 텍스트 기반(첫 일치)이라 동명이인은 오발송 위험 → 0088 이전엔 감지·차단만.
-- classnote_name을 지정하면 워커 보드명 = (과목){classnote_name || name}, 감지도 이 유효이름 기준 → 구분 시 발송 허용.
-- nullable 추가라 rewrite 없음(0082a 패턴, 짧은 메타데이터 락). 비우면 name 사용(기본 동작 불변).
alter table students add column if not exists classnote_name text;
