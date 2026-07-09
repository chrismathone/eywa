-- 0091a: lesson_reports 학습 추세(종합분석) 컬럼 (edutrix→eywa AI 멘트 패리티 4a)
-- edutrix가 reports.graph_eval에 담던 "최근 시험·과제 흐름 종합분석" 문구를 eywa 보고서에도 담는다.
-- 학부모 멘트(notes)와 별개 출력 — 자동작성 시 함께 생성, 학부모 보고서에 '학습 추세' 섹션으로 표시(설정 토글 showTrendNote).
alter table lesson_reports add column if not exists trend_note text;
