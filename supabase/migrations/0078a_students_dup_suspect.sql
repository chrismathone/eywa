-- students.dup_suspect — makeedu 동기화가 **이름 충돌로 자동 접미사**(테스트→테스트A)를 붙여 만든 신규 학생 표시.
-- "확실한 동명이인"이 아니라 "자동 판정이라 사람이 한 번 확인해야 하는 건"(같은 사람이 정보 부족으로 새로
-- 갈렸을 수도 있음 = 반대 방향 오류). sync_added_at의 ↻배지와 달리 동기화로 안 지워지고, 사람이 '정상 확인'
-- 하거나 병합할 때까지 유지된다. (import-students-list.cjs가 접미사 신규에만 true.)
-- ⚠️ 손수 alpha(drizzle 무관). 적용: node --env-file=.env.local raw. db:generate 금지.
alter table students add column if not exists dup_suspect boolean not null default false;
