# 적대적 코드 리뷰 8b

- **C1: 닫힘** — 문맥 밖에서는 trigger=manual로 확정하고 예약 source를 null로 만든다. 입력의 다른 속성을 감사 metadata에 펼치지 않는다(`src/features/report-admin/server/classnote-sync-actions.ts:116`, `:194`). 합류 두 경로도 같은 trigger를 전달·기록한다(`:149`, `:182`, `:205`). 표시도 trigger 우선·옛 행만 source로 읽으며 꼬리는 두 조건을 모두 확인한다(`src/features/audit/describe.ts:1157`).
- **C2: 닫힘** — 권한자는 운영자 조회 없이 통과, 권한 없는 강사는 자동 문맥 또는 운영자일 때 통과, 둘 다 아니면 숨김 거절한다. 권한 없는 다른 역할은 종전처럼 거절하며 기존 읽기 전용 가드는 유지한다(`src/features/report-admin/server/classnote-sync-actions.ts:48`, `:53`).
- **C3: 닫힘** — 유효 UUID·full=false 범위·상태 재조회와 운영자 예외·조회 생략·새 요청/합류의 source 위조를 실제 액션으로 검사한다(`src/features/report-admin/server/classnote-sync-actions.test.ts:224`, `:235`, `:253`, `:257`). trigger 우선 검사(`src/features/audit/describe.test.ts:1322`)와 요청 순간의 실제 문맥 검사(`src/features/onescreen/board-missing.test.ts:83`, `:237`)도 수리를 되돌리면 단언이 깨지는 구조다.

새 발견 사항: 없음. 남은 수리 0건.
코드 대조만 수행했으며 테스트·변이를 재실행하지 않았다.

판정: 커밋 가능
