# 영어 시간표 → eywa 동기화 · 핸드오프 (2026-07-03)

> **목적**: 구글 스프레드시트(인재원 7월 영어시간표)를 진실원본으로 삼아 eywa의 **영어** 데이터(학생 배정·반·배치)를 완전히 재구축.
> **철칙**: 모든 DB 작업은 **`subject='english'` 로만** 스코프. **수학(math)은 절대 건드리지 않는다.**

---

## 0. 다음 세션 시작하는 법 — ⚠️ 메인 브랜치 전환 금지

**메인(`D:\eywa_refactoring`)의 브랜치를 이 브랜치로 전환하지 말 것.**
→ 사장님의 미커밋 ijw 작업(5파일)이 걸리고, 그 폴더를 쓰는 **다른 세션(27개)이 전부 영향**받음.

대신 **이미 이 브랜치가 체크아웃된 워크트리 폴더를 직접 열면 됨** (전환 불필요):

1. Claude Code/IDE를 **`D:\eywa_refactoring\.claude\worktrees\english-timetable-import`** 에서 열기.
   - 브랜치 `Injaewon/english-timetable-import`가 이미 체크아웃된 **독립 작업공간**.
   - `CLAUDE.md`·`AGENTS.md`(프로젝트 규칙), `.env.local`(DB 접속), `node_modules`(메인 정션·rimraf 수정됨) 모두 갖춰짐.
   - **메인·다른 27개 세션 무영향.**
2. 이 문서 + 아래 "재현 아티팩트" 읽고 이어서.

> 참고: git은 한 브랜치를 두 곳에 동시 체크아웃 못 하므로, 이 브랜치는 워크트리에만 있으면 됨. 메인은 계속 `main`으로 두기.

---

## 1. 원본 데이터

- 스프레드시트: `https://docs.google.com/spreadsheets/d/1-rxcGRayUOJl8nU5GU93I6V19ID-FFvAQn8laI3BR0M`
  - 탭 `강사별영어시간표(7월)` = 배치 원본(강사×요일×교시 그리드, 병합셀=한 수업, 셀 "수업명/방번호").
  - 탭 `통합영어시간표(7월)` = 강사별에서 **931개 구글전용 수식으로 자동 파생** + 반별 **학생 명단(수기 입력)** 이 하단에 있음.
- 테넌트: **인재원** `becaa316-e636-42e9-9d09-08b133e0b094` (단일 테넌트 DB).

## 2. 이미 완료된 것 (운영 DB에 반영·커밋됨)

### 2-1. 학생 배정(enrollment) 동기화 ✅ (2026-07-03 커밋)
스프레드시트 통합 시트의 반별 학생 명단(247건) → eywa 영어 수강에 반영. **99.6% 이름매칭**(246/247).

| 작업 | 수 |
|---|---|
| 신규 생성 반 | **14** — `LT2 LS2a LS2b KW6 PJ5 JP1 MEC1-3 LS5 PL2 RTT2 LT4 LS4 KW1 고등E_고2 심화` (컬럼: tenant_id·class_name·subject='english'만, 시간/방/담임 **비어있음**) |
| 신규 수강 INSERT | 104 |
| 이미 맞아서 유지 | 142 |
| 소프트삭제(`end_date`=2026-07-03) | 149 (시트에 없던 기존 영어수강) |
| 미해결(동명이인) | 1 (`이재윤` 일중, eywa에 2명 — 학년으로 구분 필요) |
| **결과: 영어 열린수강** | **247건 = 시트 상태** |

- 검증: DP5(7명)·LT2(6명)·중등E_중2 심화(10명) eywa 명단 = 시트와 정확히 일치.
- **되돌리기 가능**: 소프트삭제라 가역. `UNDO_english_2026-07-03.json`에 생성된 반/수강 id + end_date 처리된 149건 id 기록됨. 원복 = 생성분 삭제 + 해당 149건 end_date=null.

### 2-2. rimraf 빌드버그 수정 ✅
- 증상: `/timetable` 등 `import ExcelJS` 라우트가 `Module not found / Cannot find module 'rimraf'`로 500.
- 원인: `node_modules/.pnpm/rimraf@2.7.1/node_modules/rimraf` 디렉터리가 **빈 스텁**(파일 미추출). pnpm 설치 불량.
- 수정: 해당 디렉터리 삭제 후 `pnpm install --force` → rimraf 복구. `node -e "require('exceljs')"` OK 확인.
- **추가로 필요**: `next.config.ts` 에 `serverExternalPackages: ["exceljs"]` (컴파일타임 번들 회피). → 메인에는 이미(미커밋), 이 브랜치엔 커밋함.
- ⚠️ `pnpm install --force`가 `pnpm-lock.yaml`을 수정해서 **되돌렸음**(메인 클린 유지). node_modules 복구는 남아있음.

## 3. 남은 작업 (미완)

### 3-1. class_schedules(배치: 시간·강의실·담임) 재구축 — **최우선**
지금 14개 신규 반은 스케줄이 없어 **시간표 격자에 안 보임**. 강사별 그리드 → class_schedules 필요.
- 슬롯 추출 완료: **254개 유효**(노이즈 21개 제외: 날짜·"쉬는 시간"·"수업준비"·"교수부미팅"·"연차사용"·별표변형 `*MEC1-3` 등).
- 해석 드라이런 결과:
  - **반 254/254 매칭** (전부 존재).
  - **강사 131/254 매칭**(englishName). 라벨처리 필요(FK 없음): **Anna, Dom, Elsa, JJ, 부원장, 이주희** → `class_schedules.slot_teacher_label`(자유텍스트) 사용.
  - **강의실**: eywa는 `본원301`·`바른602`처럼 **건물 접두어**. 시트의 `301~304, 601, 602, 604`는 `본원3xx/6xx`로 매칭되나 **`305, 605, 606, SKY`는 eywa에 없음**. → **결정 필요**: (a) `본원305/605/606` 신규 생성 (b) `slot_room_label`(자유텍스트)로 처리. **eywa 강의실 컨벤션(CLAUDE.md 검색) 확인 후 진행**.
  - 시각: A열 교시라벨 범위("4:20~5:00")→24h. `ENGLISH_PERIODS`(10교시)와 정렬 검증됨.
- ⚠️ `enrollments_no_overlap`(GiST EXCLUDE) 제약 주의. class_schedules에는 slot 오버라이드(teacher_id/classroom_id 또는 label), `merge_group`(합반) 지원.

### 3-2. 옛 영어 반 폐강 — 19개
시트에 없는 eywa active 영어반(이미 수강 0): `LE4 PJ4 고등E_고2 SKY LT1 PL5 고등E_고1 특별 고등E_고1 정규 A RTT3 DP2 LS2 고등E_고1 정규 B LT4b JP6 KW3 고등E_고2 TOP 고등특강(테스트) PJ2 LT4a LS1` → `is_active=false` + `closed_at`.

### 3-3. 이재윤 동명이인 1건 — 학년/학교로 구분 후 배정.

### 3-4. 정식 코드화 (재사용 가능한 "시트 반영" 버튼)
지금 반영은 일회성 스크립트로 했음. 반복 동기화하려면 `src/features/timetable/import/structure/` 에 정식 편입 필요:
- 이미 있음(커밋됨·테스트 14개 통과): `types.ts`, `parse-grid.ts`(그리드→슬롯 순수파서), `match.ts`(슬롯↔기존레코드 이름매칭).
- 필요: `google-sheets.ts`에 `readSheetGridWithMerges`(`includeGridData`로 병합까지) 추가 → `values.get`은 병합 잃음. + diff + 적용 서버액션(스냅샷 백업) + UI 트리거(수학의 "시트 반영"과 동일 패턴).

## 4. 코드 상태 (브랜치 `Injaewon/english-timetable-import`)

- `src/features/timetable/import/structure/`
  - `types.ts` — SheetGrid/슬롯/매칭/diff/드라이런 타입.
  - `parse-grid.ts` — 강사별 그리드(셀+병합) → 정규화 슬롯. 순수함수. (커밋 `f15610e`)
  - `match.ts` — 슬롯 ↔ 기존 강사/수업/방 이름매칭(구버전 방어). (커밋 `dfee9b8`)
  - `*.test.ts` — 실 시트 픽스처로 검증, **14/14 통과**. (`npx vitest run src/features/timetable/import/structure/`)
  - `fixtures/teacher-grid.sample.json` — 실 강사별 시트를 Sheets includeGridData 형태로 스냅샷.
- `next.config.ts` — `serverExternalPackages: ["exceljs"]` 추가(커밋).

## 5. 재현 아티팩트 위치

`D:\영어시간표\_english-sync-artifacts\` (운영 백업·재현용, git 밖):
- `BACKUP_english_2026-07-03.json` — enrollment 반영 **직전** 영어 반·수강 전체 스냅샷.
- `UNDO_english_2026-07-03.json` — 되돌리기용 id 목록(생성반/생성수강/end_date처리 149건).
- `sheet_students.json` — 시트에서 추출한 학생배정 247건(반·이름·학교·학년).
- `english_slots.json` — 강사별 배치 슬롯 254(+노이즈) 건(강사·요일·시각·반·방).
- `normalized_model.json` — 강사별 정규화 모델(수업·강사·요일·방 요약).

## 6. DB 접속 메모 (읽기/쓰기 재현)

- `.env.local`의 `DATABASE_URL` (직접 Postgres, 사용자 `postgres`=superuser라 RLS 우회).
- Node: `import postgres from "postgres"; postgres(url, {ssl:"require"})`. (`exceljs`/`postgres` 모두 node_modules에 있음)
- **모든 쿼리 `tenant_id='becaa316-...'` + `subject='english'` 스코프. 쓰기는 트랜잭션 + 백업 필수.**

## 7. 핵심 수치 스냅샷 (2026-07-03 반영 후)

- 인재원: 학생 568(재원 526), 영어반 46(active), 영어 열린수강 **247**, class_schedules(전체) 628.
- 시트: 배정 247건 / 유효 배치슬롯 254 / 강사 12명 / 방 11종(301-305,601-606,SKY).
