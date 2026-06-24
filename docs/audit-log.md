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

## 2. 배선 orphan / dead-end 전수 감사 (2026-06-24, 진행 중)

**범위**: write-only-orphan(설정 저장됐는데 소비처 0) · settings-ignored(enum 하드코딩) · DB 컬럼/테이블 orphan ·
dead action/route/component · form→persist→display 단절. 멀티에이전트 발굴 + 적대 검증(소비처 반증).

> ⏳ 결과 종합 후 이 섹션에 confirmed orphan / refuted(소비처 있었음) 채워넣을 예정. (CLAUDE.md "배선 현황"·2026-06-19 owner 감사와 대조.)
