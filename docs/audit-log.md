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

### 🟡 dead code (저영향 — 제거는 선택, 동작엔 무해)
| 항목 | 근거 | 비고 |
|---|---|---|
| 미사용 shadcn ui: `tabs.tsx`·`checkbox.tsx`·`badge.tsx`·`card.tsx`·`table.tsx` | importers=0 | eywa는 FaceTabs·Pill·커스텀 사용. shadcn 보일러플레이트(무해) |
| dead 컴포넌트: `StudentQuickPanel`·`StudentQuickPopover` (`students/_components/student-quick-panel.tsx`, `components/student-quick-popover.tsx`) | import 0 | ⚠️ CLAUDE.md "모바일 peek 폴백 잔존" 메모는 **stale**(실제 미연결). 제거 또는 재연결 결정 필요 |
| dead 액션: `endEnrollment`(`enrollments/server/actions.ts:95`)·`recomputePrimaryTeacher`(`students/server/actions.ts:549`) | 호출처 0 | 정의만 있고 트리거 없음. 제거 또는 배선 필요(수강종료 UI는 다른 경로 사용) |
| write-only 컬럼: `textbook_orders.notes` | createTextbookOrder가 INSERT하나 어떤 쿼리도 SELECT 안 함 | 표시 추가 또는 무시 |

### ⏭️ 의도적 orphan (이미 문서화 — 재검토 불필요)
- 설정 hidden orphan: `operations.terms` · `notifications.kakaoChannelId` · `billing.defaultMethod` · `billing.taxMode` → CLAUDE.md "🚫 입력 숨김"(소비처 없어 v1 비노출, 상태·스키마·저장은 보존).
- `class_schedules.merge_group` → 합반(merged class) 미구현(의도적).
- `textbook_orders.billed_at` · `delivered_at` → 교재 상태를 3체크(등록/주문/납부)로 단순화하며 폐기(컬럼만 잔존, 2026-06-24).

> **재감사 시**: 위 ⏭️ 의도적·🟡 dead code는 사유 유효 시 건너뜀. 🟡 dead code를 정리하기로 하면 별도 cleanup 작업으로.
