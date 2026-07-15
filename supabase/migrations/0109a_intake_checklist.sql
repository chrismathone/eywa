-- 0109a — 신규 상담 사전 체크리스트(공개 QR 접수 2단계)
-- 학부모가 QR 접수 폼 2단계에서 답하는 10개 섹션(상담 목표·걱정·수준 판단 근거·과목별 상태·학습 행동
-- 5점·선행학습·6개월 목표·학원에 바라는 것 등)을 jsonb 한 컬럼에 담는다. 컬럼 20여 개로 펼치지 않는 이유:
-- ① 문항은 개편이 잦다(스키마 마이그레이션 없이 카탈로그만 바꾸면 됨) ② 집계·필터 대상이 아니라 상담 시
-- 사람이 읽는 참고 자료다 ③ 값은 코드(slug)로 저장 — 라벨은 코드가 소유(src/features/enrollment/intake-checklist.ts).
-- 형태: { version:1, goals:[], worries:[], math:{states,course}, habits:{key:1~5}, ... } — null = 미작성(스텝2 건너뜀).
-- 쓰기: submitPublicIntake(공개 폼, admin client)가 parseIntakeChecklist로 화이트리스트 재검증 후 저장.
-- RLS 무변경: enrollment_consultations의 기존 테넌트 정책을 그대로 탄다(컬럼 추가일 뿐 새 접근 경로 없음).

alter table public.enrollment_consultations
  add column if not exists intake_checklist jsonb;

comment on column public.enrollment_consultations.intake_checklist is
  '신규 상담 사전 체크리스트(공개 QR 접수 2단계) 응답. slug 저장·라벨은 intake-checklist.ts. null=미작성.';
