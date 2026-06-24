-- 0050a_meeting_speaker_staff.sql (손수 alpha)
-- 회의 전사 화자(A/B/C…) → 직원(users.id) 연결 맵. 화자 수동 편집에서 직원 드롭다운으로 선택 시 저장.
-- 표시 라벨은 기존 ai_speaker_roles(jsonb {A:"원장"})가 담당하고, 이 컬럼은 연계 기반(staffId) 전용:
--   speaker_staff jsonb = { "A": "<users.id>", "B": "<users.id>" }
-- 미래 업무연계(회의 액션아이템 → 담당자 자동배정/알림)가 이 맵으로 staff를 조인한다. (docs/meeting-to-workflow.md)
-- RLS는 meeting_minutes 테이블 단위 정책이 이미 커버 — 컬럼 추가만.
alter table meeting_minutes add column if not exists speaker_staff jsonb;
