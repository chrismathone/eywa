# 감사 이력 (Audit Log) — 이중검토 방지 체크리스트

> 전수 감사한 항목을 여기 체크오프해, 나중에 다시 감사할 때 **이미 정리된 곳을 재검토하지 않도록** 한다.
> 새 감사를 돌리면 이 문서의 "✅ 정리됨"은 건너뛰고, "⚠️ 백로그"만 재검토하면 된다. 코드가 크게 바뀐 영역은 날짜 확인 후 재검토.

---

## 1. 비활성 버튼 → 필수항목 빨간 `*` (2026-06-24, 멀티에이전트 sweep)

**범위**: submit/저장 버튼이 **필수필드 미입력으로 disabled**되는 폼 전수. 기준: 필수 입력(파일·텍스트·동의·선택)이
비어서 비활성 = 대상. pending(제출 중)·선택0 일괄액션·도메인 전제조건·키패드 자리수 = 비대상.

| 폼 | 판정 | 처리 |
|---|---|---|
| 수강료 계산기 견적 저장 (`tuition-calculator.tsx`) | ✅ 대상 | **적용** — 학생 이름·수강 과목에 `*` + 비활성 사유 안내 (`296593d`) |
| 학생 엑셀 가져오기 (`students/_components/student-import-dialog.tsx`) | ✅ 대상 | **적용** — "엑셀 파일 `*`" 라벨 + 안내(`!file` 미리보기 게이팅) |
| 시간표 엑셀 가져오기 (`timetable/_components/import-dialog.tsx`) | ✅ 대상 | **적용** — "엑셀 파일 `*`" 라벨 + 안내 |
| 학부모 공개접수 (`(intake)/intake/[token]/public-intake-form.tsx`) | ⏭️ skip | submit은 pending만. 필수필드는 **이미 `<Field required>` 헬퍼가 `*` 자동 렌더** + 동의 제목 수동 `*`. 추가 불필요 |
| 강의실 자동배정 (`classes/_components/classroom-assign-dialog.tsx`) | ⏭️ skip | `count===0`(알고리즘 변경 0건)·pending. 필수 사용자 입력 없음(옵션 체크박스뿐). 버튼이 "변경 없음/N건 적용" 자체 설명 |
| 수납 표 (`billing/_components/billing-table.tsx`) | ⏭️ skip | 일괄 완납=행 선택0, 저장=pending. EditInvoiceDialog는 필수 미입력 게이팅 없음(defaultValue·선택값) |
| 출석 셀 메모 (`attendance/_components/attendance-cell.tsx`) | ⏭️ skip | `!status` 도메인 전제(상태 먼저 선택). 메모는 선택 입력. 이미 title 안내 있음 |
| 출석 입력폼 (`attendance/[date]/[classId]/input-form.tsx`) | ⏭️ skip | pending만. 상태 토글 0개여도 제출 가능. dirty/filled는 표시용 |
| 키오스크 키패드 (`(kiosk)/kiosk/_components/keypad.tsx`) | ⏭️ skip | 자리수 도메인 제약(필수 라벨 폼 아님) |

> **재검토 시**: 위 ⏭️ skip 사유가 유효하면 재검토 불필요. 새 폼을 추가할 때 "필수 미입력으로 버튼 비활성"이면 필수필드에 `*` + 안내 추가가 컨벤션.

---

## 2. 배선 orphan / dead-end 전수 감사 (2026-06-24, 멀티에이전트 발굴 + 수동 적대 검증)

**범위**: write-only-orphan(설정 저장됐는데 소비처 0) · settings-ignored(enum 하드코딩) · DB 컬럼/테이블 orphan ·
dead action/route/component · form→persist→display 단절. 6개 도메인 발굴(26 후보).
⚠️ 워크플로 Verify 단계가 서버 일시 rate-limit으로 실패 → **수동 grep으로 26 후보 전수 적대 검증**(소비처/호출처/import 카운트).

> **결론: 배선이 끊겨 나가리되는 user-facing 기능은 0건.** 학원설정→소비처 배선은 견고(2026-06-19 감사 + 이번 billing.account 배선).
> 발견은 전부 ① 이미 문서화된 의도적 orphan ② 저영향 dead code(미사용 shadcn·죽은 컴포넌트/액션). 아래는 다음 재감사 시 건너뛰도록 기록.

### ✅ refuted (소비처 있음 — orphan 아님)
moveEnrollment · subjectTone(14곳) · SectionTitle · FeatureBlock · english_levels(3) · lesson_reports(7) ·
attendance_notifications(3) · SUBJECT_TABS(등록상담 과목탭, 4) · class merge_group은 schema뿐이나 합반=의도적 미구현.

### dead code (2026-06-24 — 대부분 제거 완료)
| 항목 | 근거 | 처리 |
|---|---|---|
| ~~미사용 shadcn ui: `tabs`·`checkbox`·`badge`·`card`·`table`~~ | importers=0 | ✅ **제거**(5파일 삭제, aywa는 FaceTabs·Pill·커스텀 사용) |
| ~~dead 컴포넌트 `StudentQuickPanel`·`StudentQuickPopover`~~ | import 0 | ✅ **제거**(2파일 삭제). CLAUDE.md stale 메모도 정정 |
| ~~dead 액션 `endEnrollment`(`enrollments/server/actions.ts`)~~ | 호출처 0 | ✅ **제거** — `endSingleEnrollment`의 중복 leftover(수강종료 기능은 정상) |
| `recomputePrimaryTeacher`(`students/server/actions.ts:543`) | 호출처 0 | ⏳ **유지** — 담임 재계산 유틸(유용·미배선). 데모는 `fix-primary-teacher.cjs`로 대체. 향후 /admin 배선 후보(삭제 아님) |
| ~~write-only 컬럼 `textbook_orders.notes`~~ | — | ✅ **해결**: 쿼리 select + 교재 목록 행 "메모:" 표시 + 수정 prefill(round-trip 완성) |

### ⏭️ 의도적 orphan (이미 문서화 — 재검토 불필요)
- 설정 hidden orphan: `operations.terms` · `notifications.kakaoChannelId` · `billing.defaultMethod` · `billing.taxMode` → CLAUDE.md "🚫 입력 숨김"(소비처 없어 v1 비노출, 상태·스키마·저장은 보존).
- `class_schedules.merge_group` → 합반(merged class) 미구현(의도적).
- `textbook_orders.billed_at` · `delivered_at` → 교재 상태를 3체크(등록/주문/납부)로 단순화하며 폐기(컬럼만 잔존, 2026-06-24).

> **재감사 시**: 위 ⏭️ 의도적·🟡 dead code는 사유 유효 시 건너뜀. 🟡 dead code를 정리하기로 하면 별도 cleanup 작업으로.

---

## 3. 서버 액션의 쓰기 = 감사로그 전수 (2026-10-15, 원장 *"감사로그 빈틈 확인하고 추가할것"*)

**범위**: `src` 전체의 `"use server"` 파일에서 내보낸 함수 686개 — 본문에 `.insert`·`.update`·`.upsert`·`.delete`·`.rpc(`가 있는데
기록 함수(`logAction` 등 · 그것을 직접 부르는 최상위 도우미 · `audit_logs` 직접 insert)가 없는 것 = **92개**(첫 스캔 = 기록 45 + 예외 47).
적대적 리뷰 뒤 가드를 넓혀(템플릿 SQL · 여러 단계 도우미 · 같은 파일/import 이름만 · 본문은 다음 최상위 선언까지) 연습본 적용 예약 취소(기록)·
연동 PC 대시보드(예외)를 더 찾았고, 쓰기가 아니던 묵은 예외 2개(보기 설정 — 옆 함수의 쓰기가 섞여 있었다)를 뺐다. 손으로 학생 성적 추가(도우미 안 쓰기)·
연습본 적용 예약(즉시 적용 갈래만 기록되던 것)을 찾았고, 예외였던 보강관리 명령은 RPC가 안 남기는 명령만 기록하게 바꿨다.

> **결론: 49개에 기록을 넣고(새 키 45 · 재사용 4), 45개는 이유와 함께 예외 + RPC가 이미 쓰던 보강관리 키 14개를 등록(화면 영문 노출).** 이제 가드
> [`audit-coverage.test.ts`](../src/features/audit/audit-coverage.test.ts)가 새로 생기는 빈틈을 막는다 — 재감사는 그 테스트의 예외 목록만 보면 된다.

### ⏭️ 예외 분류 (가드의 `EXEMPT` — 이유 없는 줄은 실패)
| 분류 | 뜻 | 예 |
|---|---|---|
| 보기 설정 | 계정 귀속 화면 상태 | 정렬·필터·글씨·접기 15개 |
| 개인 상태 | 남에게 영향 없는 내 것 | 내 알림 · 팝업 안 보기 · 즐겨찾기 · 내 보고서 템플릿 · 결재선 템플릿 · 학생 순서 · 뷰 전환 |
| 칸 자동저장 | 입력할 때마다 저장 — 건마다 남기면 감사로그가 묻힌다 | 원스크린 칸 · ECS 목표·표식·메모 · MCS 목표 · 자리 JJ 칸 · 회의 메모장 |
| AI 결과 캐시 | 버튼이 다시 만드는 요약 저장 | 출결 리캡 · 상담 준비 브리프 |
| 자체 기록 | RPC나 그 행이 누가·언제를 남긴다 | 영수증 묶음(→`audit_logs`) · 수강 삭제(→`audit_logs`) · 학부모 출발 확인 |
| 자동 정리 | 이미 기록된 요청의 마무리 | 연동 PC 해제 확정(요청은 `sync_agent_manage`로 남는다) |
| 읽기 | 쓰기 없는 RPC | 내 발송 달력 |

> 보강관리 명령은 RPC(`makeup_private.audit`, 0345a)가 접수·승인·예약·인정·종결 등을 `audit_logs`에 `makeup_<명령>`으로 직접 남긴다 — 그 키 14개가
> 등록부에 없어 감사 화면에 영문이 떴다(이번에 등록). RPC가 안 남기는 명령(담당 지정·참여 기록·검토 제출·보류·재개·대사 처리)만 앱이
> `makeup_case_command`로 남긴다. ⚠️ 새 보강관리 명령을 만들면 RPC에서 `audit`을 부르거나 `APP_LOGGED_COMMANDS`(makeups/server/actions.ts)에 넣을 것.

### ⚠️ 가드가 못 보는 것 (손으로 확인함)
- **한 함수 안의 갈래별 기록** — 예: 연습본 적용은 즉시 적용 갈래만 `runApplyJob`이 남겨서, 예약 갈래는 손으로 찾아 넣었다.
- **도우미 안에서만 쓰는 액션**(본문에 직접 쓰기가 없는 것) — 한 단계 따라가 37개를 확인: 보기 설정(`patchMyUiPrefs` 등) ·
  두 단계 아래에서 기록하는 것(ECS·JJ 계획 = `logPlanChange` · 마스터 시트·연습본 반영 = 트랜잭션 SQL로 `audit_logs`) ·
  자체 기록(셔틀 정규 탑승 변경 = `shuttle_rider_history` · 지점 보기 끝내기 = 보기 기록 행) · 칸 저장(원스크린 영상 숙제 단건 — 일괄은 기록) ·
  이름이 겹친 읽기. **진짜 빈틈은 `createStudentGrade` 하나**(→ `student_grade_create`).
- DB 트리거 활동 기록(`activity_log`, 32개 표)은 직원 상세 '활동 기록' 탭·수강 이력·직원 포트폴리오(출결 당일·본인 판정)에만 쓰이고 감사로그 화면에는 안 보인다 — 그래서 트리거가 걸린 표에 쓰는 액션도 `logAction`을 따로 남겼다.
- 활동 기록은 계정 보기 설정(`users.ui_prefs`)을 남기지 않는다(0444a, 2026-10-23 — 그 전엔 활동 기록 바이트의 13%). 🔴 `ui_prefs`에 **보기 설정이 아닌 값**(학부모 글·권한·돈을 바꾸는 값)을 새로 담으면 흔적이 어디에도 안 남는다 — 그런 값은 `ui_prefs` 밖에 두거나 그 액션에 `logAction`을 남길 것(실례: 학습 추세 미발송 `onescreen_trend_optout`).
