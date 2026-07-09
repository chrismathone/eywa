-- 0093a: 원스크린 특이사항(강사 메모) — edutrix reports.notes(특이사항 자유입력) 이식 (AI 멘트 4c).
-- 강사가 "조퇴함, 개념 어려워함" 같은 메모를 입력하면 AI가 학부모 문장으로 풀어 씀(공지 모드 A/B의 핵심 입력).
-- 작업중 상태(onescreen_daily_sessions)에 학생별 저장 — 새로고침에도 유지. 학부모에겐 생성된 문구만 노출.
alter table onescreen_daily_sessions add column if not exists special_note text;
