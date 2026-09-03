# 다음 배치 계획 — 감사 잔여분 (2026-09-03 작성)

원장 지시로 이번 세션은 2차 배치까지 반영하고 멈춘다. 이 문서는 **다음에 이어받을 사람(또는 세션)이
바로 착수할 수 있게** 순서·근거·위험을 적어 둔 것이다. 발견 전문은
[`perf-tab-audit-2026-09-03.md`](perf-tab-audit-2026-09-03.md).

---

## 0. 먼저 할 일 — 감사 검증 마저 돌리기

검증이 두 번 세션 한도에 걸려 **아직 반증을 안 거친 영역**이 남았다:
`수업목록(classes)` · `MCS` · 횡단 7개(셸·창 / B2·B3 스윕 / 번들 / 워터폴 / 캐시·loading / realtime·타이머 / 리렌더).

```
Workflow({ scriptPath: "<세션 workflows/scripts>/eywa-perf-and-tab-audit-wf_f7763601-cf6.js",
           resumeFromRunId: "wf_f7763601-cf6" })
```
캐시가 남아 있어 **실패분만** 새로 돈다(끝난 것은 즉시 replay). 끝나면 `perf-tab-audit-2026-09-03.md`를
다시 생성한다(생성기는 임시본이라 다시 짜야 한다 — 발견 JSON은 워크플로 결과에 있다).

🔴 **미검증 발견을 그대로 고치지 말 것.** 이번 감사에서 174건 중 **57건이 3렌즈 반증으로 폐기**됐다
(거짓 양성 33%). 검증 없이 손대면 그 비율만큼 헛수고 + 회귀 위험이다.

---

## 1. 배치 3 — 돈·데이터 정확성 (가장 먼저)

숫자가 틀리는 건이라 체감보다 위험이 크다. **돈 계열은 골든마스터가 머지 게이트**다
(`src/features/billing/golden/` — 깨지면 "왜 달라졌는지" 설명이 먼저다).

| # | 건 | 파일 | 왜 위험한가 |
|---|---|---|---|
| 3-1 | **회차 계획 N이 반이동 종료일을 하루 더 세어 옛 반에 1회 과청구** | `features/billing/session-terms/server/actions.ts:52` | 학부모에게 나가는 **청구액**이 틀린다. 종료 규약은 반열림([[#125]]) — `isEnrollmentEndedOn`이 정본 |
| 3-2 | **교재요청 발송에서 제외된 학생의 요청서까지 '발송함'으로 찍혀 영구 차단** | `features/billing/server/textbook-notice-actions.ts:238` | 한 배열에 결과 모양이 섞인 [[#117]] 계열. 되돌릴 UI가 없어 그 요청서가 **영영 안 나간다** |
| 3-3 | **등록상담 월·기간 경계가 KST가 아니라 서버 로컬(UTC)** | `features/enrollment/server/queries.ts:156` (`monthBounds`) | `new Date(y, m, 1).toISOString()` — Vercel은 UTC라 **1일 00:00~09:00 KST 상담이 전달 목록**에 뜬다. 칸반·목록·통계 건수가 서로 갈린다. 정본은 앱 전역 `kstMonth`/`monthRange` |
| 3-4 | **이월(carryover) 한도 검증이 시수 RPC를 무페이징 호출** | `features/billing/session-terms/server/actions.ts:311` | 1000행 넘으면 실측이 **0으로 위장**돼 한도 검사가 무력화(B2) |
| 3-5 | 전환율 추세가 36개월 전건 무페이징 select | `features/enrollment/server/queries.ts:893` | 조용한 절단(B2) — 추세선이 말없이 틀려진다 |
| 3-6 | 통계 분포 페이징에 `ORDER BY`가 없음 | `features/enrollment/server/stats-queries.ts:203` | OFFSET 페이징은 정렬이 없으면 **행 중복·누락**(2·3개년 조회에서) |
| 3-7 | 목록뷰 헤더 count 실패를 0으로 삼켜 '상담이 없습니다' | `features/enrollment/server/queries.ts:387` | 이번에 고친 다른 삼킴들과 같은 부류 — `(shell)/error.tsx`가 생겼으니 이제 throw로 바꿀 수 있다 |
| 3-8 | **예약 담임·반이름·그룹배치 cron이 스냅샷 50개만 읽는다** | `app/api/cron/apply-due-class-updates/route.ts:55` | 쌓이면 예약이 **조용히 영영 안 돈다**(에러도 안 난다). [[#120]]과 같은 결 |

---

## 2. 배치 4 — 창 열기 체감(클라 실행이 지배항)

`docs/perf-open-window-backlog.md` 2026-07-29 실측: **병목은 서버가 아니라 뷰어 PC의 클라 JS 실행**이다
(CPU 4배 스로틀 → 창 열기 405→746ms인데 서버 TTFB는 9~10ms 불변).

| # | 건 | 파일 | 메모 |
|---|---|---|---|
| 4-1 | **수납: 면 하나를 열어도 7개 면 전체 클라 코드(114KB 한 청크)** | `app/(shell)/billing/page.tsx:3` | 계산기·공휴일표만 34KB. 원스크린에 이번에 적용한 `next/dynamic` 분리와 같은 처방 |
| 4-2 | 시간표: 교실뷰·배치 편집·가져오기 다이얼로그가 정적 import | `app/(shell)/timetable/page.tsx:68` | 같은 처방. ⚠️ dnd-kit을 dynamic화하면 편집 진입만 늦어 역효과(백로그 '비권장') |
| 4-3 | **원스크린 메모이제이션 0 + 완전 제어 입력** — 칸 하나 타이핑마다 트리 전체 리렌더 | `features/onescreen/components/grid-row.tsx` | 가장 뜨거운 화면. ⚠️ 범위가 커서 **별건**으로: 먼저 `config/fields/rowActions` 인라인 객체를 `useMemo`로 고정하고 행을 `memo`로 감싸는 최소 변경부터 |
| 4-4 | 수납: 회차 확정 표가 학생 행마다 단가 datalist 복제(`<option>` 약 3,900개) | `app/(shell)/billing/_components/session-term-table.tsx:185` | datalist 하나를 공유하면 끝 |
| 4-5 | 수납: 닫힌 다이얼로그를 채우려 학생 409명을 창마다 RSC로 | `app/(shell)/billing/_components/billing-content.tsx:83` | 열 때 가져오게 |
| 4-6 | 상담 상세가 닫힌 배정 다이얼로그용 4필드 때문에 반 전체(왕복 5·행 1,870) 조회 | `app/(shell)/enrollment/[id]/page.tsx:80` | 같은 부류 |
| 4-7 | 오늘 출결 좌석표가 파생값을 안 기억해 검색 한 글자마다 500여 칸 재렌더 | `features/attendance/live/components/seating-chart.tsx:70` | `useMemo` |

---

## 3. 배치 5 — 서버 왕복·캐시

- 운영실이 **오늘 출결을 한 렌더에 4번**, 수강·시간표를 **3벌씩** 중복 조회
  (`features/dashboard/server/{queries,action-signals}.ts`) — 요청 캐시로 접기.
  ⚠️ 이번에 7일 추세만 60초 캐시했다. 나머지는 **요청 단위 dedupe**가 맞다(신선도 손해 0).
- 운영실 출결 스냅샷 폴백이 8~9회 직렬(B4).
- ECS: **오늘 면이 `getEcsToday` 집계를 버리고 반마다 주 전체 시트를 다시 읽는다**
  (`app/(shell)/ecs/page.tsx:88`) · **반 전환 드롭다운 하나 때문에 랜딩 전체 집계를 매번 재실행**
  (`app/(shell)/ecs/[classId]/page.tsx:29`). 🔑 MCS엔 이미 경량 조회(`getMathClassOptions`)가 있다 —
  ⚠️ 다만 ECS 랜딩은 **그 주에 수업이 있는 반만** + **그 주 시점 반 이름**이라, 경량판을 새로 짜면 두 벌이 된다.
  **`getSheetLanding`에 `optionsOnly` 갈래를 내는 쪽**이 맞다(판정 한 곳 유지).
- 학생 상세 '수업' 탭이 학원 전체 반 목록(≈2,000행)을 무조건 조회(`_tabs/classes-tab.tsx:73`).
- 공개 QR 접수 폼이 조회수 +1 UPDATE를 await한 뒤 설정을 읽음(학부모 모바일 직렬 3왕복).

---

## 4. 원장 결정이 필요한 것 (내가 임의로 고치지 않았다)

1. **`getTeacherScope`가 담임 반만 본다** — 교시 담당(부담임)만 하는 강사는 **학생목록이 0명**이고
   **시간표가 통째로 빈다**. 고치면 좋지만 이 함수는 교재요청 **쓰기**·수업보고서 **인쇄 PII**까지
   8곳이 공유하고, 코드 두 곳에 *"누가 보이는지는 안 건드린다"*가 명시돼 있다 → **확대는 결정**이다.
   · 출결은 2026-08-18에 이미 축을 넓혔다(`teacher-axis.ts`, 가시성은 합집합).
   · 물어볼 것: "교시만 맡는 강사에게 학생목록·시간표를 열어 줄까요?"
2. **자리(JJ·LAB) 시트의 출결 쓰기 축**이 ECS 게이트(담임∪부담임)와 다르다 — 같은 성격.
3. **`/onescreen`에 `loading.tsx`가 없다** — 넣으면 첫 페인트가 빨라지지만 **날짜 이동마다 스켈레톤이
   번쩍인다**(백로그가 attendance·enrollment를 같은 이유로 보류했다). 강사에게 어느 쪽이 나은지 확인 필요.
4. **원스크린 일괄 저장·발송을 배치 액션으로 묶을지** — 행마다 서버 액션 1회라 40행이면 왕복 40회다.
   검증자 셋이 "게이트를 복제하지 말고 **얇은 래퍼 액션**부터"로 의견을 모았다(1단계 저위험). 다만
   `latestRow`가 지키던 "루프 중 편집 반영"이 스냅샷으로 바뀌므로 동작이 미세하게 달라진다.

---

## 5. 작업 규칙 (이번에 실제로 물린 것들)

- **널리 쓰이는 컴포넌트에 `useRouter` 의존을 새로 만들지 말 것** — `WindowLink`에 붙였다가
  라우터 없이 렌더하는 **컴포넌트 테스트 13건**이 깨졌다.
- **같은 판정을 두 벌 만들지 말 것** — `parseExamPairs`를 새로 짤 뻔했는데 `parseExamMaxes`가 이미 있었다.
- **CSS를 만진 커밋은 푸시 전 `pnpm build`** — typecheck·lint·vitest는 CSS 문법을 안 본다(2026-09-02 배포 2건 실패).
- **새 컬럼을 읽는 코드는 SQL 적용 확인 뒤에**([[#95]]) — 이번 수정에 새 컬럼은 **0개**다(마이그레이션 불필요).
