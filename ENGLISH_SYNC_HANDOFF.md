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

## 3. 남은 작업 → ✅ 3-1/3-2/3-3 완료 (2026-07-03 저녁, 운영 DB 반영)

### 3-1. class_schedules 재구축 ✅ (적대리뷰 6에이전트급 검증 + 라이브 E2E)
[scripts/_english_sync/apply-english-schedules.cjs](scripts/_english_sync/apply-english-schedules.cjs) (dry-run 기본·`--apply`)로 적용:
- **진실원본 = `normalized_model.json`의 periods**(병합 행 범위 기반 정확한 시작·끝 시각 — ⚠️ `english_slots.json`의 시각은 A열 라벨 첫 행만 읽어 끝시각이 틀림, 쓰지 말 것). 유효 254 = 275 − 노이즈 18 − 별표 3.
- **temporal 전환**: 기존 영어 스케줄 371행 `valid_to='2026-07-02'` 마감 + 신규 254행 `valid_from='2026-07-03'` 삽입(삭제 0 = 타임머신 과거 주 보존). 단일 트랜잭션, 마감 UPDATE에 `valid_from < CUTOVER` 술어(동시 편집 레이스 봉쇄).
- **강사**: english_name 매칭(teacher/viewer 중복행은 `system_role='teacher'` 우선으로 해소 — #70 잔재 안전) 131/254 → `teacher_id`+라벨. 미해석 6명(Elsa·Anna·Dom·JJ·부원장·이주희 — **users에 계정 자체가 없음**) → `slot_teacher_label`만.
- **강의실**: (a)+(b) 혼합 — `본원305/605/606` **신규 생성**(실재 방, 강사 상주), `SKY`는 **`본원SKY` 라벨-only**(기존 슬롯 라벨에 "본원SKY" 전례·LAB실 패턴). 전 슬롯 `slot_room_label='본원'+토큰` + 해석되는 것만 `classroom_id`.
- **classes 담임/기본강의실 39건 갱신**: ⚠️ 최빈값은 **강사 이름 기준(전 슬롯)** — 해석된 슬롯만 세면 미해석 강사가 다수인 반의 담임이 소수 슬롯 강사에게 오배정(적대리뷰 MED-1, 13개 반 실측). 최빈 이름이 계정으로 해석될 때만 갱신, 미해석/동률=기존 유지.
- **⚠️ 동반 버그픽스(제품 코드)**: `fetchSlots`의 valid_from 상한이 `weekEndOf`(ref+6 롤링 창)라 과거 주(6/22~28) 조회에 새 스케줄이 새어 **구·신 시간표 합성 표시**(적대리뷰 MED-2와 독립 발견 일치) → 신규 [`weekSundayOf`](src/features/timetable/lib/week.ts)(그 주 실제 일요일)로 교체 + 테스트. enrollment look-ahead(예정 학생)는 의도적 롤링 창이라 불변.
- **검증**: 현재 주 254/과거 주 371 정확(중복 0 — 픽스 전이면 625 합성), 신규 14개 반 전부 스케줄 확보, 스팟체크(중등E_중2 심화=Jane 월수목 16:20-17:20/17:20-18:10+JJ 수 305) 시트 일치, 비영어 257 무변(수학 불가침), **라이브 E2E**(dev 3012, 마스터 로그인): 현재 주=신규 반만·과거 주=옛 반만·통합뷰 슬롯 강사/방 라벨·담임 폴백(LS2a→Anna)·수학 200. typecheck0/lint(에러0)/test631.
- 백업/언두: `SCHED_BACKUP_2026-07-03.json`(371행 전체) / `SCHED_UNDO_2026-07-03.json`(복원 순서 명시).

### 3-2. 옛 영어 반 19개 ✅ — 종강 18 + 폐지 1 (핸드오프 원안에서 의도적 수정)
[scripts/_english_sync/close-old-english-classes.cjs](scripts/_english_sync/close-old-english-classes.cjs). 원안 "is_active=false+closed_at"는 eywa 의미론상 **폐지=타임머신에서도 숨김**이라, 실수강 이력(3~10건)이 있는 18개는 **종강(closed_at='2026-07-02', is_active 유지)** — 과거 주에 이력 표시 보존(검증: ref 06-28에 18개 표시). 이력 0의 `고등특강(테스트)`만 폐지. 언두: `CLASSES_UNDO_2026-07-03.json`.

### 3-3. 이재윤 동명이인 ✅ — 쓰기 0으로 해결
시트 배정(중등E_중1 TOP·일중·중1)은 eywa `0524df0a`(일중·중1)의 **기존 열린 수강(2026-04-07~)이 이미 충족** — TOP 명단 시트=DB 10명 완전 일치. 다른 이재윤(`821441f9`·대구일중·중1·수강0)은 **중복 학생 행 의심** → 병합/정리는 owner 데이터정리(중복 학생) 도구 소관(별건).

### 3-4. 정식 코드화 (재사용 가능한 "시트 반영" 버튼) — 유일한 잔여
지금 반영은 일회성 스크립트(스크립트들은 `scripts/_english_sync/`에 커밋됨). 반복 동기화하려면 `src/features/timetable/import/structure/` 에 정식 편입 필요:
- 이미 있음(커밋됨·테스트 14개 통과): `types.ts`, `parse-grid.ts`(그리드→슬롯 순수파서), `match.ts`(슬롯↔기존레코드 이름매칭).
- 필요: `google-sheets.ts`에 `readSheetGridWithMerges`(`includeGridData`로 병합까지) 추가 → `values.get`은 병합 잃음. + diff + 적용 서버액션(스냅샷 백업) + UI 트리거(수학의 "시트 반영"과 동일 패턴).

### 3-5. 영어 '강사뷰' = 시트 "강사별영어시간표" 그대로(강사-major) ✅ (2026-07-04)
`/timetable?subject=english&view=teacher` — 뷰 토글 3번째 칩(영어에서만). ⚠️ **1차 시도(요일-major)는
사용자가 "완전 틀렸다"고 반려** — 시트는 **강사-major**(강사=세로 블록, 그 안에 월~토 가로, 왼쪽 단일 시각열,
셀=반명+방·학생 없음)라 축을 뒤집어 전용 컴포넌트로 재작성.
- **관계 확정(사용자)**: 시트 `강사별영어시간표` = 마스터(강사들이 직접 짜는 배치) → `통합영어시간표`(반-major+학생명단)를
  931개 수식으로 자동 파생 = **eywa 통합뷰**에 대응. 그러니 강사뷰 = **강사별 마스터 그리드를 그대로 옮긴 것**.
- 전용 컴포넌트 [teacher-grid.tsx](<src/app/(shell)/timetable/_components/teacher-grid.tsx>) `TeacherGridView`:
  컬럼 = 강사(시트 좌→우 순서) → 그 강사 요일(월→토 자연순, 실제 가르치는 요일만). 행 = 영어 10교시(+비정렬 기타).
  **토요일도 오후라 영어 평일 교시 축에 정렬**(rowOf에 'mon' 강제 → 주말 09:00 교시 미사용). 셀 = ClassCell `roster="none"`(반명+방만, 학생 X — 시트 강사별 탭과 동일). 연속 교시 반은 세로 병합(rowSpan), 요일 병합 없음(각 요일 독립 컬럼).
- **강사 순서·색 = 시트 실측**([english-teacher-sheet.ts](src/features/timetable/lib/english-teacher-sheet.ts) — [read-teacher-grid.cjs](scripts/_english_sync/read-teacher-grid.cjs)로 시트 강사 헤더 병합·배경색 추출):
  Jane #dd7e6b · Hannah #f9b3d1 · Elsa #674ea7 · Charlie #f6b26b · 부원장 #d9ead3 · Dom #76a5af · Anna #4285f4 ·
  Florence #cc0000 · Kristine #a4c2f4 · Sam #ffc000 · JJ #bdbdbd · 이주희 #fff2cc. DB(getTeacherColorMap) 우선, 미등록 강사(대부분)는 이 시트 미러색 폴백 → 강사 등록되면 자동으로 DB색이 우선.
- 읽기전용(편집·DndArea는 기본뷰), 타과목 전환 시 기본뷰 폴백.
- 검증: typecheck0/lint0 + 라이브(dev 3012, 마스터): 강사 밴드 순서 12명 시트 일치·색 헤더 12·요일 서브컬럼(월6/29~토7/4)·토 정렬(Jane 토 1교시 고등E_고2 심화/301)·셀=반명+방(DP5/본원602 등). ⚠️ 1차 요일-major 컴포넌트 변경(weekday-group-tables `groupBySlotTeacher`)은 되돌림.
- ⏭️ 후속: 강사별 시트엔 강사 근무메모(r2 "월~금 2:00-10:00")도 있음 — eywa엔 미보존(강사 등록 시 users 메모로). 셀 반명 긴 것은 클립(hover 전체) — 시트도 동일.

### 후속 권장 (데이터 아님·운영 결정)
- **강사 5명 직원 등록**: Elsa(전양원)·Anna(육소희)·Dom(김동후)·JJ·이주희는 users에 없어 담임 미배정/기본뷰 강사 컬럼이 옛 담임 기준. 직원관리에서 등록 + `english_name` 세팅 후 해당 반 담임 지정하면 완결(통합뷰 슬롯 라벨은 이미 정확).
- **ENGLISH_PERIODS(10교시 상수) vs 7월 시트 시간구조**: 시트는 40분 그리드(1~3교시)와 50~60분 블록(16:20~17:20·17:20~18:10·18:20~19:20·19:20~20:10·20:20~21:10·21:10~22:00)이 혼재 — 기본뷰에서 비정렬 시작(17:20·19:20·20:20·21:10 등 ~75슬롯)은 '기타' 행 폴백으로 표시(안전·정상 렌더). 교시표 갱신은 과거 주 표시와 트레이드오프라 사용자 결정 사안.

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

## 7. 핵심 수치 스냅샷 (2026-07-03 스케줄 반영 후)

- 인재원: 학생 568(재원 526), 영어반 **운영중 41 / 종강 18 / 폐지 1**, 영어 열린수강 **247**.
- class_schedules: 영어 열린(신규) **254**(valid_from 07-03) + 마감(옛) 371(valid_to 07-02, 타임머신용 보존) + 비영어 257(무변).
- 강의실 +3(본원305·605·606, 계 21). classes 갱신 39(담임 10·기본강의실).
- 시트: 배정 247건 / 유효 배치슬롯 254 / 강사 12명 / 방 11종(301-305,601-606,SKY).
