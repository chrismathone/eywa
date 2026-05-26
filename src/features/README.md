# features/

도메인(메뉴)별 모듈. 한 폴더 = 사이드바 한 메뉴.

| Feature | 메뉴 | 라우트 |
|---|---|---|
| `dashboard/` | 대시보드 (공지 포함) | `/` |
| `timetable/` | 시간표 | `/timetable` |
| `attendance/` | 출석부 | `/attendance/[date]` |
| `classes/` | 수업목록 | `/classes` |
| `students/` | 학생목록 (숙제/시험/교재 서브탭) | `/students/[id]` |
| `enrollment/` | 신입생 등록상담 (AI 분석 + 인쇄) | `/enrollment/[id]` |
| `consultations/` | 학생상담 | `/consultations` |
| `withdrawals/` | 퇴원관리 | `/withdrawals` |
| `staff/` | 직원관리 (급여 서브탭) | `/staff/[id]` |
| `billing/` | 수납관리 | `/billing` |
| `meetings/` | 회의록 | `/meetings/[id]` |
| `help/` | 도움말 | `/help` |

각 폴더는 다음 하위 구조를 가집니다 (생성 시):

```
features/<name>/
├─ components/    # 클라이언트 컴포넌트
├─ server/        # Server Actions, DB 쿼리
├─ hooks/         # 클라이언트 훅
└─ schemas/       # Zod 스키마 (서버↔클라이언트 경계)
```

**규칙**: 한 파일 200줄 이하. 한 컴포넌트의 props는 10개 이하로 유지. 그 이상이면 분해.
