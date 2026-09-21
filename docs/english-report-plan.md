# 영어 수업보고서 정규화 — 설계(확정) · 1단계 착수(2026-09-10)

> ## 2026-09-10 갱신 — 1단계 착수 (사용자 지시)
> - **작성 = 원스크린 영어 행의 템플릿 모드**(기본 'ECS 자동' + 사용자 템플릿). 아래 확정 결정 2(필드 고정 + 문체 자유)의
>   구체적인 모양이 템플릿이고, 결정 3(ECS 파생)은 원스크린 칸이 ECS에서 미리 채워지는 기존 배선(sheet-report-draft)을 그대로 쓴다.
> - **게시 형태 = 수학과 같이 `/r` 링크 + 카드 캡처**(사용자 *"링크 + 이미지"*). 카드는 영어면 템플릿 글만 싣는다.
> - **아직 안 한 것**: 설계 B(반 보드 발송 레일 — `classnote_deliveries` 등)는 그대로 미착수다. 영어는 발송 과목 설정이 꺼져 있고
>   강사는 '글 복사'로 붙여 넣는다. A5(관리자 직접작성 영어 차단)도 미착수.
> - 단어시험·학습 결과는 인재원 학습 프로그램(MemoType)에서 **pull**(성적관리 JJ실·JJ실(시험)). 보고서 카드에 결과지 그림을
>   싣는 것은 다음 단계 — 보낼 때 받은 JSON을 보고서와 함께 저장한다(설명서 ⑤).
> - 상세·롤백 = changelog 2026-09-10 (15).

> 2026-07-29 작성. **설계는 확정, 구현은 트리거 충족 전까지 착수하지 않는다.**
> 영어 보고서를 만지기 전에 이 문서를 먼저 읽을 것. 배달 레일은 [classnote-integration.md](classnote-integration.md),
> 데이터 원천은 ECS([0157a](../supabase/migrations/0157a_class_sheets.sql), [features/class-sheets](../src/features/class-sheets)).

## 확정 결정 (재제안 금지)

1. **배달 = 그룹 반 보드에 학생별 게시.** `(영어)학생명` 1인 보드는 폐기.
2. **정규화 = 필드 고정 + 문체 자유.**
3. **보고서 내용 = ECS 파생.** 별도 진도 트랙/과제 필드를 `lesson_reports`에 새로 만들지 않는다
   (`reportTracks` 신설안은 `subjects[].skillAreas`와 중복이라 폐기).
4. **착수는 ECS 정착 후.**

---

## 1. 왜 — 실측 (2026-07-29, 원장 계정 ClassNote GET 조회)

| | 수학 | 영어 |
|---|---|---|
| ClassNote 알림장 (7/21~7/29) | 663건 / 원아 197명 | **847건 / 원아 233명** |
| 발신 | aywa 자동 발송 | **강사가 ClassNote에 직접 타이핑** |
| aywa `lesson_reports` | 최근 30일 681건 | **전 기간 0건** |
| 활성 수강 | 202명 | 249명 |

- 강사 9명 서식이 제각각. 고유 본문 400여 개를 패턴 검사한 필드 포함률:
  진도 24~88% · 과제 58~100% · 단어시험 17~82% · **점수 0~100%** · **기한 9~90%**.
  같은 학원인데 어떤 반은 매일 점수가 나가고 어떤 반은 한 번도 안 나간다.
- 본문은 **반 공통 + 학생 개별 2층** — 194 수업세션 중 81%가 반 전체 동일 본문, 59세션은 공통+개별 혼합.
- `(영어)학생명` 1인 보드 229개는 **게시 0건 · 연결 교사 0명**(학부모 연결은 128). 배달은 전부 그룹 반 보드.
- 반 구성 대조(수업보고서 > 반 구성 탭, 라이브): 반 42 · **발송 가능 217** · 보드에 없음 28 · 오발송 위험 0.

## 2. 착수 트리거 (AND — 셋 다 참일 때)

1. **ECS 실사용** — 영어반 2개 이상 × 수업주 2주 이상에 **의미 있는 plan line**
   (`isMeaningfulPlanLine` = textbook/**pageRange**/progress/homework 중 1개 이상 —
   [plan-codec.ts](../src/features/class-sheets/lib/plan-codec.ts) 단일 소스와 동일 판정) +
   `updated_by`가 **실제 강사 계정**.
2. **영어 강사 로그인 6명 해결** — `@imported.local` 더미 이메일 계정(전양원·이다교·김태건·육소희·이현이·크리스틴)의
   실계정 전환. 실계정 보유는 정은지·추민아·정유진 3명뿐이다. **폼을 아무리 잘 만들어도 6명은 들어올 수 없다.**
   (같은 이름의 `sheet-NN@imported.local` 중복 계정이 직급·급여를 들고 있는 기존 병합 과제와 얽힘.)
3. **빈 보드 2개 해결 또는 명시적 제외** — 고등E_고2 심화(7명)·고등E_고3 정규(4명)은 보드에 연결된 원아가 0명이라
   발송해도 아무도 못 받는다.

작성 시점 기준 ECS 4개 테이블 전부 **0행**. 빈 소스 위에 추측으로 파생 규칙을 짓지 않는다.

---

## 3. 설계 A — 내용: ECS 파생

| 보고서 필드 | ECS 원천 |
|---|---|
| 진도·교재·페이지·과제 | `class_sheet_plan_lines` (구분 `skill_area` × 줄) |
| 학생 개인 진도·상태 | `class_sheet_student_marks` (`status`·`progress_note`, 교시 단위) |
| 출결 | `attendance_records` (ECS가 `ecs_mark_present_if_absent`로 배선) |
| 구분 라벨 | `subjects[].skillAreas` — 기본 6영역([skill-areas.ts](../src/features/owner/skill-areas.ts)) |

**강사 추가 타이핑 0**이 이 방향의 가치다. 원스크린 영어 행은 파생 초안을 **확인·보정 + 멘트만**.

### A1. 단위 변환 — ECS 슬롯 → 보고서 1건
ECS 키는 `(class, date, slot_start)`([0157a#L30](../supabase/migrations/0157a_class_sheets.sql#L30))인데
보고서는 `(student, date, class_id)` 1건이다([0134a#L102](../supabase/migrations/0134a_lesson_reports_class_id.sql#L102)).

- **대상 슬롯** = 그 학생이 그날 그 반에서 마크된 `slot_start`만, 시각 오름차순.
- `term_mode`(regular/exam)는 **둘 다 보존**하고 라벨로 구분 — 내신 줄을 조용히 버리지 않는다.
- **`lineNo`를 DTO에 싣는다** — ECS 위치키가 `(…, term_mode, line_no)`라
  ([0157a#L54](../supabase/migrations/0157a_class_sheets.sql#L54)) 원래 줄 순서가 의미를 갖는다.

```
EcsDerivedDraft {
  classId, reportDate,
  rows:  { slotStart, termMode, lineNo, skillAreaKey, textbook, pageRange, progress, homework }[]
  marks: { slotStart, status, progressNote }[]
  sourceFingerprint
}
```

### A2. 필드별 projector — "표시 텍스트 하나"가 아니다
보고서 스키마는 `textbook`·`progress`·`homework_today`·테스트·태도를 **각각** 갖는다
([schema.ts#L675](../src/lib/db/schema.ts#L675)). 확정할 것은 serializer 하나가 아니라 **projector 4종 + 개행 규칙**:

- `rows → textbook` (중복 교재 병합, 빈 값 제거)
- `rows → progress` (영역·교시·exam 라벨 규칙, 줄 순서 = slotStart → termMode → lineNo)
- `rows → homeworkToday`
- `안전 변환된 mark → 어느 학생별 필드인지` (개인 진도의 자리 확정)

**무손실 계약**: textbook·pageRange·progress·homework 중 어느 것도 사라지지 않는다.
대표 실데이터(다중 교시 · exam 혼합 · 빈 줄 · 중복 교재)로 **골든 fixture** 동결.

### A3. 학부모 출력 안전 — unknown은 raw 출력 금지
`status`·`progress_note` **둘 다 자유 입력**이다([0157a#L100](../supabase/migrations/0157a_class_sheets.sql#L100) — '완'/'결석'/'안침',
"PL 7, 20개 / PV 4" 같은 내부 약어). 삭제된 skill key는 현재 폴백이 **slug를 그대로 노출**한다
([skill-areas.ts#L34](../src/features/owner/skill-areas.ts#L34)).

→ whitelist/변환을 통과한 값만 학부모에게. **unknown status·미등록 skill key는 raw 출력이 아니라 차단 또는 "경고 후 생략"**
(UI raw 코드 노출 금지 규약과 같은 계열).

ECS에 **없는 것**: 과제 기한, 다음 평가 공지 — 실데이터를 본 뒤 ECS에 추가할지 `lesson_reports`에 둘지 결정.

### A4. 확인·보정 생명주기
지금 자동저장은 **평평한 최종 문자열만** 남겨 "ECS 기본값"과 "교사 보정"을 구분하지 못한다.
그대로 두면 확인 후 ECS가 바뀔 때 옛 값이 되살아나거나 확인한 값이 조용히 바뀐다.

- **확인 단위 = (teacher, student, class, reportDate).** 현재 세션 확인값은 학생 단위 boolean 하나이고
  세션 PK가 `(tenant, updated_by, student, session_date)`라 **반 축이 없다**
  ([actions.ts](../src/features/onescreen/server/actions.ts) `SaveOnescreenSessionInput.progressConfirmed`) → class 축 추가가 선행.
- 반별로 `sourceFingerprint`(파생 입력 해시) · `overrides`(교사 보정분만) · `reviewedFingerprint`(확인 시점 해시).
- **서버 큐잉에서 `reviewedFingerprint === currentSourceFingerprint` 강제** — 불일치는 "재확인 필요"로 거부.
- 확인된 보고서는 **스냅샷 고정**. 이후 ECS 변경은 화면 표시만(조용한 변경 금지).
- **서버는 최종 문자열을 받지 않는다** — `identity + overrides`만 받아 **ECS를 재조회해** 스냅샷을 만든다(클라 위조 차단).

### A5. 관리자 우회 봉쇄
관리자 작성은 `classId`가 nullable이고 임의 문자열을 그대로 저장할 수 있다
([compose-actions.ts#L23](../src/features/report-admin/server/compose-actions.ts#L23)).
→ **`subject === "english"`이면 `classId` + ECS provenance 없이는 저장·공유·발송을 차단**한다.
예외는 **owner 전용 audited manual exception**으로만(감사로그 필수).

### A6. 성능·설정 배선
- 파생은 **`targetDate + classIds` 배치 로더 1회** — class 권한을 한 번에 검증한 뒤 병렬 조회
  (현재 주간 조회 [queries.ts#L75](../src/features/class-sheets/server/queries.ts#L75) 참조). 학생·반별 호출 금지(서버 워터폴).
- 학생별 DTO는 전역 Operations context가 아니라 **원스크린 route payload로 최소 직렬화** —
  클라가 `resolveSkillAreas`를 직접 부르면 원장 커스텀 영역이 안 온다.
- 배선 누락 방지(하나라도 빠지면 정규화가 우회된다):
  진도 편집기 3곳 공용화([grid-row.tsx#L95](../src/features/onescreen/components/grid-row.tsx#L95) ·
  [progress-card.tsx#L58](../src/features/onescreen/components/progress-card.tsx#L58) ·
  [bulk-apply.tsx#L207](../src/features/onescreen/components/bulk-apply.tsx#L207)) ·
  관리자 단건·대량 작성 · 공유/인쇄의 **고정 SELECT + 수동 prop 매핑** 2곳
  ([(share)/r/[token]](<../src/app/(share)/r/[token]/page.tsx>) · [(print)/lesson_reports/[id]/print](<../src/app/(print)/lesson_reports/[id]/print/page.tsx>)) ·
  세션 자동저장 3곳(`OnescreenSessionRow.subject_progress` 타입 · 클라 payload · `saveOnescreenSession`).

---

## 4. 설계 B — 배달: 그룹 보드 발송 레일

### B1. 진실 원천 = 전용 테이블, 레거시 상태는 읽기 전용 projection
- 그룹 발송 상태는 service-role 전용 **`classnote_deliveries` + `classnote_delivery_recipients`**(child별)에만 산다.
- **레거시 컬럼에 활성 상태를 쓰지 않는다.** `queued`면 구워커가 claim하고
  ([classnote-core.mjs#L408](../scripts/_classnote/classnote-core.mjs#L408)), `null`이면 관리자 미발송 경로가 다시 집고,
  `processing`이면 멈춤복구가 `queued`로 되돌린다([actions.ts#L213](../src/features/report-admin/server/actions.ts#L213)).
  → **`group_queued` / `group_processing` / `group_blocked` 별도 상태**를 도입하고 배지·통계·달력·미발송·재시도 판정을
  **전부** 갱신하거나, 해당 화면이 delivery 테이블을 직접 읽게 한다. **둘 중 하나를 고르되 절반만 하지 않는다.**
- ⚠️ 인증 사용자가 영어 행의 `classnote_status='queued'`를 **직접 REST로 쓰면 레일 전체가 우회**된다
  ([0049a#L21](../supabase/migrations/0049a_lesson_reports.sql#L21) `FOR ALL`) →
  **DB에서 group-routed 행의 legacy 상태 INSERT/UPDATE와 active/sent 행 DELETE를 거부**한다.

**상태전이표**
- delivery: `pending → queued → claimed → sent | failed | blocked | canceled`
- recipient: `pending → posting → sent | skipped | failed | uncertain`
- 집계: `sent|skipped` = 성공 · 일부 성공 + 일부 실패 = **부분 성공 → failed 고정**(자동 재시도 금지 — 중복 게시 방지) ·
  lease 만료는 **재큐** · 재시도 가능 실패와 결정적 실패를 구분 기록
- 유니크: `(tenant_id, report_id, content_revision)` · `(delivery_id, child_id)`

### B2. 권한 경계
- delivery/recipient/**pin** 쓰기는 **검증 RPC(service-role) 경로만**. 지금 pin은 인증 사용자가 직접 INSERT/DELETE 가능해
  ([0145a#L38](../supabase/migrations/0145a_classnote_student_links.sql#L38)) **잘못된 child를 "안전한 타깃"으로 승격**시킬 수 있다.
- `content_revision`은 앱 코드가 아니라 **DB trigger**가 본문 필드·첨부·토큰 변경 시 증가.
- `processing`/`success` 중 직접 REST 변경 **DB에서 거부**.

### B3. 대상 결정 — **명시적 multi-pin**
- pin은 지금 학생·보드당 1개이고([0145a#L19](../supabase/migrations/0145a_classnote_student_links.sql#L19)) pin이 있으면 판정이
  원아 하나만 돌려준다([board-roster-diff.ts#L216](../src/features/report-admin/board-roster-diff.ts#L216)) →
  단순 배열 추가로는 **pinned 다계정 학생의 전 계정을 못 담는다**. → **multi-pin**(학생·보드당 여러 child 허용)으로 확정.
- **큐 API는 report ID만 받는다.** 서버가 파생: `report.class_id → 그 반 → 유일 board → 모든 child`.
- board와 member는 **동일 snapshot generation** + **허용 age 이내**여야 한다.
- **aywa 활성 수강 + ClassNote live enrollment 둘 다** 검증. `fetchBoardChildren`은 멤버만 주므로
  ([classnote-admin-core.mjs#L262](../scripts/_classnote/classnote-admin-core.mjs#L262)) child마다 `fetchChildDetail`로
  `belong_to_class === boardId && !removed_child` 확인([#L445](../scripts/_classnote/classnote-admin-core.mjs#L445)).
- ⚠️ 현재 pin 검증은 **보고서의 정확한 class_id가 아니라 학생의 다른 활성 반으로도 통과**한다
  ([board-roster-actions.ts#L76](../src/features/report-admin/server/board-roster-actions.ts#L76)) → 보고서 class_id 기준으로 조인다.

### B4. 워커 계약 — 중복 게시 방지
- `claim_id` · `claimed_by` · `lease_until` + **lease heartbeat**. 모든 상태 변경은 **claim_id 포함 CAS**.
- **POST 직전 fence** — claim_id CAS만으로는 lease를 잃은 워커의 외부 POST를 못 막는다.
  **매 child + 409 재시도 직전마다** claim·lease·revision·revoke·kill switch를 재검사.
- **child별 checkpoint**. 🔴 테스트해야 할 창은 "checkpoint 후 종료"가 아니라
  **ClassNote POST 성공 직후 · DB checkpoint 직전 종료**다. `posting`/`uncertain`은 즉시 재게시하지 말고 **실물 확인 후** 처리.
- **본문 고유성은 `/r/{share_token}`이 보장**한다 — 학생명+사실만으로는 **같은 학생의 다계정을 구분하지 못하고**,
  중복 확인은 최근 20건만 조회한다([classnote-admin-core.mjs#L533](../scripts/_classnote/classnote-admin-core.mjs#L533)).
  share 링크 포함이 dedup 정확도와 409 회피를 **동시에** 해결한다(학생명·개별 사실은 가독성 목적).
- 409(`Already exists` — 보드가 달라도 발생, [classnote-notice-core.mjs#L290](../scripts/_classnote/classnote-notice-core.mjs#L290))는
  backoff + **실물 재확인**.
- **content 단일화** — dedup 선확인·POST·사후확인 **세 곳 동일 값**
  (현재 `shareUrl` 직접 사용: [classnote-core.mjs#L306](../scripts/_classnote/classnote-core.mjs#L306)·`#L315`·`#L324`).
- 그룹 과목인데 타깃 없음 → **무조건 차단**(fail-closed).
  ⚠️ `evaluateBoardSafety`를 그룹 경로에서 건너뛰는 이유는 "2가족+ 차단" 때문이 **아니다** — 계정 수 게이트는
  2026-07-15에 폐기됐고 지금은 생년 매핑 검증이다([board-safety.mjs](../scripts/_classnote/board-safety.mjs)).
  이유는 그 함수가 **1인 보드명 `(과목)학생명`으로 보드를 찾는 경로**이고 명시적 그룹 타깃이 그 해석을 대체하기 때문.
  ⚠️ [classnote-admin-core.mjs#L464](../scripts/_classnote/classnote-admin-core.mjs#L464)의 **"보드가 곧 매핑" 폴백은
  그룹 경로에서 절대 금지**(1인 보드 전제 — 그룹 보드에선 보드 전원 오발송).
- 본문 **4,000자 fail-closed** + 4,000/4,001 경계 테스트
  ([notice-actions.ts#L89](../src/features/report-admin/server/notice-actions.ts#L89) 선례).
- 워커 claim `RETURNING`에 타깃·body·revision·class_id 명시([classnote-core.mjs#L408](../scripts/_classnote/classnote-core.mjs#L408)).
- **revoke/reissue**는 신규 delivery를 **원자적으로 취소하거나 새 revision으로 생성**. 기존 delivery 감사기록을 덮어쓰지 않는다.

### B5. 준비·큐잉 원자성
- 공용 API가 **준비 + 타깃/본문/상태 갱신까지 소유**한다(리졸버가 Map만 반환하면 큐 갱신이 흩어진다).
- `content_revision` 기반 **CAS RPC** — 읽은 내용과 큐잉 내용이 같을 때만 전환.
- `processing` 중 저장·첨부변경·재발급 **금지**. `queued` 편집은 **조건부 dequeue + 스냅샷 삭제**를 한 번에.
- 진입점 **전부** 통과: 원스크린 `saveAndQueueClassnote` ·
  관리자 단건·대량([compose-actions.ts#L51](../src/features/report-admin/server/compose-actions.ts#L51)) ·
  재발송·미발송([report-admin/actions.ts](../src/features/report-admin/server/actions.ts)) ·
  **첨부**([attachment-actions.ts#L40](../src/features/onescreen/server/attachment-actions.ts#L40)).
- 내용 무변경 retry·stale 복구는 **기존 body 보존**, 실제 편집·토큰 재발급 때만 재생성.

### B6. 배포·카나리·롤백
워커 capability 규약([watch-classnote-queue.mjs#L75](../scripts/_classnote/watch-classnote-queue.mjs#L75))대로 `groupBoardTargetV1` 추가.

> DB → 워커 배포 → **활성 워커 capability 전수 확인** → 앱 → 전용 테스트 그룹 보드 카나리 → 영어 opt-in

⚠️ 현재 '학원이' 테스트 경로는 `classId: null`이라 그룹 리졸버를 통과하지 못한다
([compose-actions.ts#L299](../src/features/report-admin/server/compose-actions.ts#L299)) → **전용 테스트 그룹 보드**가 필요.
카나리는 opt-in 전에도 **같은 resolver/RPC를 통과하는 service-role 전용 경로**로 돈다.
**롤백**: 신규 큐 차단 → `queued`/`processing` 재고 회수 → 워커 pause → known-good zip 복귀.

### B7. 부수 갱신
`src/lib/db/schema.ts` · `supabase/migrations/README.md` ·
**활동로그 noise/redact**([0120a#L28](../supabase/migrations/0120a_activity_redact_salary_policy.sql#L28)) —
안 하면 본문 전체와 child id가 활동로그에 복제된다. 마이그레이션 번호는 착수 직전 `git fetch` 후 확정.
교사 일괄발송은 학생별 직렬 Server Action이라([onescreen-client.tsx#L1474](../src/features/onescreen/components/onescreen-client.tsx#L1474))
**배치 Server Action 1개**로 바꾼다(스냅샷은 호출당 1회).

---

## 5. 착수 시 검증

`typecheck` · `lint` · `test` · `build` + 동시성/부분성공 retry 테스트.

⚠️ **`test:rls`는 지금 상태로 신뢰할 수 없다** — `.env.local`의 `DATABASE_URL`을 쓰고 URL이 없으면
**전부 skip한 채 성공**한다([ecs-security.test.ts#L18](../tests/integration/ecs-security.test.ts#L18)) →
**전용 disposable DB + production-host 거부 가드**가 선행되어야 의미가 있다.
ClassNote 실 E2E는 기본 `test:e2e`와 분리해 **명시적 opt-in · serial · 단일 워커 · 통제 계정**으로 실행.

**단위 최소 목록**
- 슬롯 집계 골든 fixture · projector 4종 무손실 · unknown status/미등록 skill key 차단
- fingerprint 불일치 시 큐잉 거부 · 관리자 `classId:null` 영어 차단
- multi-pin 전원 발송 · pin이 **보고서 class_id**로 검증됨
- 타깃 누락 시 워커 차단 · 4개 진입점이 같은 리졸버 통과
- 재발급 후 본문 재생성 · 같은 필드라도 share token이 다르면 본문이 다름
- live child + **활성 enrollment** 확인 · dedup/POST/사후확인 동일 content · 본문 4,000자 경계
- 인증 사용자의 타깃·pin·legacy 상태 변조 거부
- **ClassNote POST 성공 직후 · checkpoint 직전 종료 → 재기동 무중복**
- 수학 레일 골든마스터 무회귀
