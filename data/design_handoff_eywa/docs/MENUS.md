# 12개 메뉴 · 5개 카테고리

> `design-files/eywa-shared.jsx`의 `EYWA_MENUS` / `EYWA_GROUPS` 정의가 정답.
> 모든 화면의 사이드바·라우팅·breadcrumb이 이 매핑을 그대로 따릅니다.

---

## 메뉴 정의

```ts
export const EYWA_GROUPS = {
  home: '홈',
  class: '수업',
  student: '학생',
  ops: '운영',
  help: '지원',
} as const;

export const EYWA_MENUS = [
  { id: 'dashboard',    label: '대시보드',  group: 'home',    icon: 'tree' },
  { id: 'timetable',    label: '시간표',    group: 'class',   icon: 'leaf' },
  { id: 'attendance',   label: '출석부',    group: 'class',   icon: 'pulse' },
  { id: 'classes',      label: '수업목록',  group: 'class',   icon: 'branch' },
  { id: 'students',     label: '학생목록',  group: 'student', icon: 'seed' },
  { id: 'enrollment',   label: '등록상담',  group: 'student', icon: 'sprout' },
  { id: 'consultation', label: '학생상담',  group: 'student', icon: 'wave' },
  { id: 'withdrawal',   label: '퇴원관리',  group: 'student', icon: 'falling' },
  { id: 'staff',        label: '직원관리',  group: 'ops',     icon: 'roots' },
  { id: 'billing',      label: '수납관리',  group: 'ops',     icon: 'pollen' },
  { id: 'meetings',     label: '회의록',    group: 'ops',     icon: 'rings' },
  { id: 'help',         label: '도움말',    group: 'help',    icon: 'spore' },
] as const;
```

---

## 라우트 매핑 (Next.js App Router)

| 메뉴 | 메인 경로 | 동적 경로 | 비고 |
|---|---|---|---|
| 대시보드 | `/` | — | 홈 |
| 시간표 | `/timetable` | — | |
| 출석부 | `/attendance` | `/attendance/[date]` | 날짜별 |
| 수업목록 | `/classes` | `/classes/[id]` | 반 상세 |
| 학생목록 | `/students` | `/students/[id]`, `/students/new`, `/students/[id]/edit` | |
| 등록상담 | `/enrollment` | `/enrollment/[id]`, `/enrollment/new`, `/enrollment/[id]/print` | 인쇄 라우트 |
| 학생상담 | `/consultations` | `/consultations/[id]` | |
| 퇴원관리 | `/withdrawal` | `/withdrawal/[id]` | |
| 직원관리 | `/staff` | `/staff/[id]` | |
| 수납관리 | `/billing` | `/billing/[invoiceId]` | |
| 회의록 | `/meetings` | `/meetings/[id]`, `/meetings/new` | |
| 도움말 | `/help` | — | |

### 인증 라우트 그룹
- `(auth)/login` — 로그인 페이지
- `(shell)/...` — 위 12개 메뉴 (사이드바 + topbar 레이아웃)
- `(print)/...` — 인쇄 전용 라우트 그룹 (등록상담서 등)

---

## 사이드바 그룹 순서

```
01 · 홈        → 대시보드
02 · 수업       → 시간표 · 출석부 · 수업목록
03 · 학생       → 학생목록 · 등록상담 · 학생상담 · 퇴원관리
04 · 운영       → 직원관리 · 수납관리 · 회의록
05 · 지원       → 도움말
```

---

## breadcrumb 패턴

화면별 breadcrumb (topbar 작은 라벨):

| 화면 | breadcrumb |
|---|---|
| 대시보드 | `EYWA · 홈` |
| 시간표 | `EYWA · 수업 · 시간표` |
| 출석부 | `EYWA · 수업 · 출석부` |
| 수업목록 | `EYWA · 수업 · 수업목록` |
| 학생목록 | `EYWA · 학생 · 학생목록` |
| 등록상담 | `EYWA · 학생 · 등록상담` |
| 학생상담 | `EYWA · 학생 · 학생상담` |
| 퇴원관리 | `EYWA · 학생 · 퇴원관리` |
| 직원관리 | `EYWA · 운영 · 직원관리` |
| 수납관리 | `EYWA · 운영 · 수납관리` |
| 회의록 | `EYWA · 운영 · 회의록` |
| 도움말 | `EYWA · 지원 · 도움말` |

---

## AI 활용 영역 (3곳)

| 화면 | AI 사용 | API |
|---|---|---|
| **등록상담** | 신규 학부모 상담 녹음을 분석해 학습스타일/관심사/우려/반추천 요약 | Claude API |
| **학생상담** | 재원생 케어 진단 (선택적 AI 분석) | Claude API |
| **회의록** | 회의 녹음을 요약, 핵심 결정사항 + 액션 아이템 추출 | Claude API |

### AI 결과 동결 (Snapshotting)
한 번 생성된 분석은 **결과 스냅샷으로 저장**해서, 모델이 바뀌어도 인쇄물·과거 기록은 변하지 않게 합니다. DB 스키마에 `ai_analysis_snapshot` JSON 컬럼 권장.
