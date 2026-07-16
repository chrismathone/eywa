# features/

도메인(메뉴)별 모듈. 한 폴더 = 사이드바 한 메뉴.

| Feature | 메뉴 | 라우트 |
|---|---|---|
| `dashboard/` | 운영실 (AI 실행 큐·운영 브리핑) | `/dashboard` |
| `timetable/` | 시간표 | `/timetable` |
| `attendance/` | 출결 처리 | `/attendance/[date]` |
| `classes/` | 반·수업 | `/classes` |
| `students/` | 학생 (숙제/시험/교재 서브탭) | `/students/[id]` |
| `enrollment/` | 등록 상담 (AI 분석 + 인쇄) | `/enrollment/[id]` |
| `consultations/` | 학생 상담 | `/consultations` |
| `withdrawals/` | 퇴원 | `/withdrawals` |
| `staff/` | 팀 (급여 서브탭) | `/staff/[id]` |
| `billing/` | 수납·청구 (책갈피 3면: 수납·교재신청·지출, `?tab=`) | `/billing` |
| `meetings/` | 회의 | `/meetings/[id]` |
| `help/` | 도움말 | `/help` |
| `retention/` | 이탈 신호 (재등록 위험 보드) | `/retention` |

> `billing/server/`에 `textbook-queries.ts`·`expense-queries.ts`(교재신청·지출 면). 테이블 `textbook_orders`·`expenses`(마이그레이션 `0025`).

각 폴더는 다음 하위 구조를 가집니다 (생성 시):

```
features/<name>/
├─ components/    # 클라이언트 컴포넌트
├─ server/        # Server Actions, DB 쿼리
├─ hooks/         # 클라이언트 훅
└─ schemas/       # Zod 스키마 (서버↔클라이언트 경계)
```

**규칙**: 한 파일 200줄 이하. 한 컴포넌트의 props는 10개 이하로 유지. 그 이상이면 분해.
