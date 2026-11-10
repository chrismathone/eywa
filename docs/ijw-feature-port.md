# ijw → aywa 기능 이식 진행/핸드오프

> **목적:** ijw-calander(학원 SaaS 원본)의 기능을 aywa로 **"자연스럽게 이전한 느낌"** 이 되도록 완전 이식.
> 디자인 복제가 아니라 **ijw가 하던 동작이 aywa에서 그대로 되게** 하는 게 목표.
> 다른 컴퓨터/세션에서 이어갈 수 있도록 repo에 기록(이 문서가 진실 — `.claude/plans`·memory는 기기 로컬).
> 최종 갱신: 2026-06-18.

## 원본 위치
- ijw 코드: `D:\ijw-calander\` (Firebase/Vite SPA). 시간표 = `components/Timetable/`(수학 `Math/`, 영어 `English/`).
- ijw 실데이터(정적): `D:\tmp\ijw-export-*.json` (라이브 Firebase 불필요).

---

## ✅ 완료 — 시간표(Timetable) 기본뷰 충실 이식 (main, push됨)

커밋: `423627d`(신입/전입색·사이드바) · `015514d`(교시/병합 1차) · `6de7294`(그룹밴드·평일주말·2D병합·엑셀격자).

**구조(ijw `Math/components/TimetableGrid.tsx` 대조):**
- **과목 단일 선택** — "전체" 없음, 기본 수학. 데이터에 있는 과목만 칩(수학·영어·고등수학). `page.tsx`.
- **교시 축 = 과목 인지** (휴리스틱 제거): `src/features/timetable/lib/periods.ts`
  - `slotPeriodRow(subject, startTime, day)` — start_time→교시/그룹 역매핑. 수학계열=8교시를 2개씩 **4그룹**(1교시 14:30~16:20…), 영어=10교시, 주말=8교시(시간단위). 매칭 실패는 `기타` 폴백(throw 금지).
  - `subjectPeriodRows(subject, weekend)` — **표준 교시 전체**(수업 없어도 행 생성 → 빈 교시 균일 높이).
- **요일그룹 밴드 + 평일/주말 분리** — `_components/weekday-group-tables.tsx`
  - 평일 한 판: 월/목·화/금·수 그룹 컬럼 밴드, 3단 헤더(그룹→강사→요일).
  - 주말 한 판: 1교시 시작시각이 평일(14:30)과 달라(09:00) **우측에 자체 교시열로 나란히**. 행높이=평일÷2 → **2주말교시=1평일그룹** 격자 정렬.
- **2D 병합** — `src/features/timetable/lib/grid.ts`
  - `computeBlocks(rows, cols, keyAt, allowColMerge)` — 같은 반(classId)이 연속교시(rowSpan)·인접요일(colSpan)에 걸치면 직사각형 한 칸. 주말은 가로병합 off.
  - `mergeSlotsByClass` — 한 칸 안 같은 반 슬롯 합쳐 시간범위(min~max) 한 카드.
- **엑셀 격자** — `table-layout:fixed` + `colgroup` 균일 폭(요일 150px), 교시열 92px, 모든 행 고정 높이, 넘치면 셀 내부 스크롤.
- **셀(ClassCell, `_components/class-cell.tsx`)** — 학생 **세로 명단**(이름·학교·학년), 신입(30일)=빨강·전입=초록 행. 헤더 클릭→상세 드로어. 편집모드 학생 드래그(`student:enrollmentId`→`class:classId` 계약).
- **통합뷰**(`_components/rich-grid-view.tsx` + `rich-card-group.tsx`) — ✅ **ijw EnglishClassTab "반=열 리치 그리드" 충실 이식(2026-06-22 최종)**.
  시작 교시별 섹션(평일 기준, 주말 전용=별도 섹션, 섹션마다 visiblePeriods) → 좌측 sticky 라벨열(수업명/담임/강의실/교시/재원/대기/퇴원) +
  반=열 카드: ijw 헤더색(`bg_color`) 수업명 + 담임 + **요일별 강의실**(`월수 본원304 / 목 LAB실`) + **요일×교시 미니그리드**(셀마다
  강사약칭·**강사 저장색**(ijw `users.bg_color`; 영문닉네임은 `users.english_name`으로 해결, 미해결만 `teacherColor` 해시 폴백) / LAB=파란배지) +
  **재원/대기/퇴원**(신입 빨강·전입 초록, 영문이름 `이름 (English)`). 읽기전용. 순수함수 `lib/class-grid.ts`
  의 `buildRichCardGroups`/`teacherColor`(+test 6). ⚠️ **데이터 백필 필수**: aywa 데모가 평면(슬롯별 강사/강의실/영문이름 0)이라
  `scripts/_poc_migration/backfill-english-slots.cjs`(멱등)로 ijw 익스포트의 slotTeachers·slotRooms·bgColor·englishName을 적재
  (slot강사 183·강의실 84·LAB 65셀·반색 52·영문 29). 스키마 0041a(`class_schedules.slot_teacher_label/slot_room_label`).
  **(2026-06-26) 강사 퍼스널 색 이식**: ijw `staff`(42명 전원 bgColor/textColor)를 `backfill-teacher-colors.cjs`(멱등)로 `users.bg_color`/
  `text_color`/`english_name`에 적재(0054a·0055a, staff.name↔users.display_name 42/42) → 통합뷰 셀·담임이 저장색(인라인 hex), 익스포터도 ijw색 일치.
  설계 변천(폐기): 전과목색오버뷰 → 단순카드그리드(영어 데이터 못 살림) → **리치 그리드(현재)**. 합반(classGroupId)·영어 레벨배너 미이식(후속).
- **순수함수 Vitest**: periods(slotPeriodRow 등), grid(computeBlocks/mergeRuns). `pnpm test` 그린(338).
- 사이드바: 와이드 터치 회색지대 보정(`layout.tsx` `lg:pointer-fine:` — 크롬 전환을 `useIsDesktop`과 일치).

**시간표 잔여(데이터 의존 — 데모엔 데이터 없어 보류):**
- **분리등원**(월-only/목-only 학생 분할 표시) — `enrollments.attendance_days`가 **데모 전건 비어있음**. 데이터 생기면 셀에 요일배지/분할 추가(`StudentLine.attendanceDays` 이미 쿼리에 노출됨).
- **합반(merge_group)** 학생별 라벨 — 데이터 희소로 보류.

---

## ⬜ 남은 작업 (우선순위 B → C → D)

### Phase B — 빠른 승리 (학생목록·수업목록) — ✅ 전부 완료 (2026-06-19 확인)
수업목록(요일칩 **시작시각 표시**·정렬(수업명/학생수/강사명)·강사명 검색·**capacity=8 하드코딩 제거**·일요일 필터)과
학생목록(정렬(이름/학년/등록일)·학년/담임 필터)은 이미 `class-filter-bar.tsx`/`student-filter-bar.tsx` + 각 `queries.ts`에
완전 배선됨. highmath 라벨 버그도 **학원설정 단일소스**(`buildSubjectMaps`/`useSubjectMaps`)로 해결 — 하드코딩
`SUBJECT_META`/`SUBJECT_LABEL` 전수 제거(규칙=CLAUDE.md "운영체계 enum 하드코딩 절대 금지").

### Phase C — 죽은 기능 배선 — ✅ 핵심 6건 완료 (2026-06-19)
백엔드만 있던 고아 액션을 UI에 연결 + 보안 게이트 보강(end-enrollment-button confirm 패턴 복제):
- ✅ **직원 퇴사/재직복구** — `account-actions.tsx`의 `DeactivateButton`(`deactivateStaff`, confirm 인라인, 상세도 revalidate).
- ✅ **수강 종료** — `end-enrollment-button.tsx`(`endSingleEnrollment`). (이전 완료)
- ✅ **성적 삭제** — `grades-tab.tsx` 행 삭제 컬럼(`delete-grade-button.tsx` → `deleteStudentGrade`) + write 게이트.
- ✅ **상담 후속 완료 토글** — `consultations-tab.tsx` 후속 블록(`follow-up-toggle.tsx` → `toggleConsultationFollowUp`) + write 게이트.
- ✅ **반 폐지/재운영** — 수업 상세(`archive-class-button.tsx` → `archiveClass`) + write 게이트.
- ✅ **급여/휴가 보안 게이트(6건)** — `src/features/payroll/server/actions.ts`(markPayrollPaid·upsertPayroll·autoComputePayroll·
  requestLeave·approveLeave·deleteLeave)에 `canManageStaff` 추가(비-master POST 우회 차단). ⚠️ markPayrollPaid 실제 위치는
  **payroll/server/actions.ts**(이전 문서의 staff/server/actions.ts는 오기재).
- 신규 write 게이트 패턴 = `accessLevelTenant(role, menu) === "full" | "scoped"`(exams `canWrite` 미러, CLAUDE.md #58 tenant-aware).
- (잔여: 청구서 삭제·지급취소·휴가거절 등 역방향 CRUD는 신규 액션 필요, M — 후속.)

### Phase D — 후속 (효과 크나 비용 L)
- **시간표 엑셀 import 1클릭 복원 UI** — 스냅샷/로그는 이미 DB 적재(`timetable_snapshots`/`timetable_import_logs`), 뷰어+복원 버튼만.
- **요일별 강의실 일괄배정 화면** — ijw `ClassroomAssignment` 패턴.

---

## 핵심 사실 & 함정 (이어가기 전 필독)
- **데모 데이터가 ijw 교시 시각 보존**: 수학 8교시 55분(14:30~22:00), 영어 10교시 40분(14:20~), 주말 8교시 시간단위(09:00~17:00). `class_schedules`는 **교시당 1행(55/40분)** — 2교시짜리 수업=2행 → `mergeSlotsByClass`로 합침.
- `enrollments.attendance_days` **전건 비어있음**(분리등원 0). `students` 과목: english 371·math 227·highmath 30(국어/과학/예술 0).
- **멀티세션 동시 작업**: 다른 Claude 세션이 `git add -A`로 미커밋 작업을 쓸어담아 커밋/push한 전례 多 → **커밋은 항상 명시경로** `git commit -F - -- <paths>`. push 전 `git fetch` + `git merge origin/main`(rebase 아님 — CLAUDE.md 작업 격리 정책).
- **dev/build**: `PORT=3100 pnpm dev`(또는 3200). `pnpm build`는 dev와 `.next` 충돌(#36)하니 **dev 정지 후** 빌드.
- Next.js 16(AGENTS.md): API가 학습데이터와 다름 — `node_modules/next/dist/docs/` 참고.

## 검증 게이트
```
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
화면: `pnpm dev` → `http://localhost:3100/timetable`(기본 수학). 데모 로그인은 CLAUDE.md "데모 로그인 계정".
