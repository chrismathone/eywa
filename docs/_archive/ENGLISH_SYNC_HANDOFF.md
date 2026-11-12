# 영어 시간표 → aywa 동기화 · 핸드오프 (2026-07-03, 최신 갱신 2026-07-06)

> **목적**: 구글 스프레드시트(인재원 7월 영어시간표)를 진실원본으로 삼아 aywa의 **영어** 데이터(학생 배정·반·배치)를 완전히 재구축.
> **철칙**: 모든 DB 작업은 **`subject='english'` 로만** 스코프. **수학(math)은 절대 건드리지 않는다.**

---

## 📌 진행 상황 스냅샷 (이어가기용 — 최신 위)

**✅ main 반영 완료(2026-07-06, `d8207d7` — 사용자 승인 후 병합 push)**: origin/main(합반 통합 명단·기본뷰
격자 리워크·shrinkToFit·counselor 스코핑 등 11커밋)을 브랜치에 병합(텍스트 충돌 1=import 합집합, 클로버 0 대조 확인) →
4게이트(tsc0/lint0/**test703**/build✓) + 패리티 diff0 + 병합 적대리뷰(8에이전트, CONFIRMED 4건 전부 수정: 강사뷰 톤
ink/25 재동기·수학 export 교시 설정 파생+onSkippedSlots·과목 운영 사이드바 하부탭·savedNonce 거짓 미저장 확인) +
라이브(병합 dev: 영어 11교시×합반 명단 공존·강사뷰·수학 무회귀·콘솔 0) 후 `git push origin HEAD:main`. 브랜치 tip=main.

### 🟢 2026-07-06 — 시트↔강사뷰 전격비교 → 패리티 3픽스 + 10분 격자 재작업 (새 PC `C:\tmp\eywa-english`, dev 3002)

전격비교(시트 xlsx ↔ 운영 DB 정규형 diff): 실강사 9명 완전 일치, 차이 3건 발견·전부 수정 →
**`verify-sheet-parity.cjs` 기준 강사 12명 전 세션 시트=aywa 일치(diff 0)**. 이 스크립트가 상시 회귀 검증기.

| 커밋 | 내용 | 검증 |
|---|---|---|
| `aa44830` | **P0** verify-timetable-live 하드코딩 자격증명 → env(EYWA_VERIFY_EMAIL/PASSWORD). ⚠️ **비번 회전 권고**(계정이 main CLAUDE.md 데모 표에도 있어 회전 시 문서 동반 갱신) | node --check |
| `3b21f93` | 반명 `고등E_고1 특별S`→`특별 S`(시트 표기, DB 1행) | 멱등·undo |
| `f7c4044` | **SKY 라벨 방 15슬롯 → 실방**(Jane→301·Elsa/Dom/Florence→303·JJ→305, label+classroom_id 동시). 마감된 옛 슬롯 5건은 타임머신 이력 보존 위해 불변. + apply 스크립트 재발방지(SKY_ROOM_BY_TEACHER 매핑·별표 필터 제거·ART_DIR env화) | 멱등·undo |
| `c7578ea` | **LAB(JJ·이주희) 병렬 수업 54슬롯 이식** — xlsx 병합 기반(import-lab-parallel-slots.cjs). 시트 101세션=기존 47+신규 54, DB-only 0. 별표(*) 7건 포함(=통합 `*LAB` 파생 실스케줄 — 정규시간 밖 추가 LAB; *MEC1-3 수 1건만 통합 미표시, 기록). + parse-grid.ts 시각을 **행 인덱스 규칙**으로(A열 라벨 미신뢰) — 스팟체크 end 17:00→17:20 정정 | 멱등·undo·test 15 |
| `e74b6b8` | **강사뷰 = 10분 격자(46행) + 시트식 병합(rowSpan)** — ten-minute-grid.ts(순수) + teacher-grid 재작업. 블록=실길이 비례(40분=4행). **고정높이 래퍼**(td height=최소값 함정)·**#71 STICKY_EDGES 로컬 복제**(이 브랜치는 main 픽스 이전 — weekday-group-tables 수정 금지)·sticky thead·칩 방=slot_room_label만(반 기본 강의실 아님). 옛 교시축(rowOf 'mon' 주말 핵) 자연 소멸 | tsc0/lint0/실브라우저 |
| `f193efe`~`6d785b3` | **강사뷰 v2 반복 7커밋**(사용자 피드백): 칩 토글·블록 색면 채움·packGroups 합반 그룹 셀·교시별 셀 분할·칩 세로 배치·격자 톤 수학 동일+강사 경계 2px + **통합뷰 명단 고정 행수/이단 스크롤 해소**(afc4c0a). 상세 아래 불릿 | tsc0/lint0/test656/실브라우저 각 단계 |

- **🔑 근본 원인 발견**: 원 임포트의 `본원SKY`는 **파서가 반명 속 "SKY"를 방으로 오인**한 것(ROOM_RE를 raw 전체에 매칭 — 시트는 처음부터 301/303). parse-grid.ts·verify 스크립트 모두 "반명 뺀 잔여에서만 방 탐색"으로 정정 + 테스트 고정.
- **핸드오프 정정**: ① 옛 "16:00 anomaly DB 정규화(옵션)" 항목 **폐기** — 그 2슬롯(15:40~16:00/16:00~16:20)은 시트와 정확히 일치(10분 축에서 자연 렌더, 건드리면 오히려 시트와 어긋남). ② 아티팩트 경로 = `scripts/_english_sync/_artifacts/`(env `ENGLISH_SYNC_ART_DIR`, 구 `D:\영어시간표\_english-sync-artifacts` 대체 — 구 PC의 undo/백업 JSON은 이 PC에 없음, 7/6 이후 것만 있음). ③ 시트는 **링크 공유 상태**라 `export?format=xlsx` 무인증 다운로드 가능(서비스계정 키 불필요 — §3-4 정식화 때 참고).
- **부수효과(의도)**: LAB 세션이 기본뷰·통합뷰(반 미니그리드 "이주희" 셀)에도 표시 — 시트 충실. ⚠️ 담임 미등록 반(JP1 등)의 통합뷰 담임 폴백(최빈 슬롯강사)이 "이주희"로 보일 수 있음 — §후속 "강사 5명 직원 등록"으로 해소.
- **✅ 강사뷰 v2 완료(같은 날 사용자 피드백 반복 7커밋 — 최종 상태)**:
  · **칩 클릭 = 반명↔학생 명단 토글**([teacher-chip.tsx](<src/app/(shell)/timetable/_components/teacher-chip.tsx>) 클라 칩 신설 — 접힘=색면이 병합 블록 **전체**를 채움(시트 병합 셀 미러, 반명 줄바꿈 허용+강의실 아랫줄 세로 배치·중앙), 펼침=색 헤더 1줄+잔여 높이 재원 명단(내부 스크롤), 학생 행 클릭=학생 창, hover 수업카드. ClassCell 미사용 — 헤더가 반 창 링크라 토글과 충돌, dense prop 원복).
  · **병렬 반(합반·LAB) = packGroups** ([ten-minute-grid.ts](src/features/timetable/lib/ten-minute-grid.ts)): 같은 (start,end) 병렬 반 = 한 그룹 → **한 셀(rowSpan×colSpan) 안에 나란히**(그룹 단위 연속 빈 레인 그리디 패킹, 병렬 레인당 64px). 다른 길이 겹침만 별도 레인. 일반 강사=1레인 무변. 초기 assignLanes(레인별 낱개 분산)·합반 amber 테두리는 **폐기**(사용자: 테두리 제거).
  · **연결 교시 수업 = 교시별 셀 분할**(buildSlotIntervals — 슬롯=블록 1:1, 접기 없음): 시트가 2교시 수업을 교시별 셀 2개로 그리는 것(검은 교시선)을 그대로. 예: Jane 심화 16:20~18:10 = 셀 2개, 토 고2심화 = 셀 3개.
  · **격자 톤 = 수학 기본뷰와 동일**: 가로줄 균일 border-line(옅음/정시 구분 제거), sticky 가상요소(#71)도 bg-line, **강사 밴드 경계만 같은 색 2px 세로줄**. top-sticky 헤더 세로선은 x축으론 표와 함께 움직여 일반 border-r 안전(하단만 가상요소).
- **✅ 통합뷰 명단 고정 행수(afc4c0a)**: 재원 12행·대기 3행·퇴원 5행 **고정 프레임**(그룹 max 동기화 폐기 — DP5 퇴원 10명이 전 카드를 늘리던 것), 넘침은 섹션 내부 스크롤. + RichGridView 자체 overflow-y-auto 제거 → **우측 이단 스크롤 해소**(세로 스크롤은 셸 하나만). ⚠️ 이 컴포넌트는 수학 통합뷰도 공유 — 회귀 확인 완료.

### 🟢 2026-07-06 (2차) — 과목 운영 설정 배선: 강사뷰 가로줄·격자단위 + 과목별 평일 교시 + "과목 운영" 탭 신설

강사뷰 하드코딩 3종(내부 가로줄 6시각·10분 격자·영어 교시표)을 **학원설정 과목별 커스터마이징**으로 배선
(사용자 지시 4항목 전부, 마이그레이션 0 = 전부 `tenant_settings.data` jsonb). 계획 [`gentle-sleeping-starlight.md`].

- **스키마**: `subjectSchema` + 3필드 — `weekdayPeriods?`(과목 전용 평일 교시, 미설정=폴백)·`teacherViewLines?`(HH:MM[])·
  `teacherViewStep?`(**60의 약수 literal union** 5|10|15|20|30|60 — 정시선·rowSpan 예측성). 기본값: english에
  `ENGLISH_WEEKDAY_PERIOD_LIST`(11교시)+가로줄 6시각+step 10 프리필. `normalizeSubjects`(resolve.ts) = 저장 행에
  누락 필드를 key 기반 기본값으로 주입(normalizeHolidays식 읽기 승격, **기본값 있는 필드만** — undefined 키 노이즈 금지).
- **lib**: `PeriodsConfig.weekdayBySubject?`(plain Record — 직렬화) + **`weekdayTableFor(subject, config)` = 과목 전용 ??
  (english ? ENGLISH_PERIODS : 전역)** 폴백 체인으로 4소비처(slotPeriodRow·subjectPeriodRows·periodToTimes·
  subjectWeekdayPeriods) 통일. subject 인자 전부 `string`화(subject_1 등 커스텀 키도 커버). ten-minute-grid
  **stepMin 파라미터화**(축 경계 자정 기준 step 배수 스냅 — 14:20이 30분 격자면 14:00으로, 분수 인덱스 방지.
  slotRowSpan은 rows에서 step 추론=시그니처 불변). `DEFAULT_TEACHER_VIEW_LINES` 상수로 이동.
- **소비처**: teacher-grid가 `sectionLineMins`/`stepMin` props + **`rowH = round(stepMin×1.4)`**(분당 px 고정 — step 30에서도
  60분 수업 84px 유지) + 가로줄 시각을 `floor(m/step)*step` 스냅(silent drop 방지). page.tsx **비영어 teacher뷰 URL 가드**
  (`?view=teacher&subject=math` 직입력 → basic 강제, 노출 조건 = english 또는 가로줄/step 설정 과목). weekday-group-tables
  `subSlotOf`·students 쿼리 `groupSchedule`(학생 상세 N교시 라벨)도 config 경유로 정합.
- **UI**: **"과목 운영" FaceTab 신설**(owner, 설정 그룹 — 운영 체계 옆). SubjectListEditor 이동 + 과목별 카드(평일 교시
  전용표 만들기/되돌리기 + 강사뷰 격자단위 select + 가로줄 time 목록). **같은 `operations` 섹션에 저장**(face→section
  매핑은 UI 레벨, 동시편집 가드 scope 동일). 운영 체계 면 평일 교시는 "(기본값)"으로 개칭.
- **검증**: tsc0/lint0/**test666**(periods 4·ten-minute-grid 5·resolve 1 신규) + **라이브 라운드트립**(3002, master):
  영어 카드 프리필(11교시·6줄·10분) → 가로줄 16:10 삭제+step 20 저장 → 강사뷰 23행 20분 격자·16:10 선 소멸·19:10→19:00
  스냅 → 원복 저장 → 46행 복원 / math+`view=teacher` → 기본뷰 강제(토글 미노출) / 운영 체계 저장이 과목 필드 클로버 0 /
  기본뷰 영어 1교시 14:20~15:00 무회귀 / 학생 상세 수업 탭 "9-11교시" 라벨 정합 / **verify-sheet-parity diff 0** / 콘솔 에러 0.
- CLAUDE.md **KNOWN_EXCEPTION(영어 교시 하드코딩) 해소 기록** 3곳 갱신.

### 🟢 2026-07-06 (3차) — 과목 삭제 = "다른 과목에 흡수" + 두 탭 빈공간 정리

사용자 요청 2건: ① 운영체계 탭 빈공간 정리 ② 운영 과목 삭제 시 그 과목의 데이터를 다른 과목에 전부 흡수.

- **빈공간 정리**: 운영 체계 = 키 높이별 카드 짝([평일|주말]·[학년|직급]·공휴일 span2) + '과목 운영 탭' 링크.
  과목 운영 = 좌(운영 과목 표) ┃ 우(과목별 설정 **접이식 details + 요약 배지**) 2열 — 빈 풀폭 카드 5장 해소.
  SubjectListEditor 입력 폭 축소(반폭 카드 행 랩 방지).
- **과목 흡수 삭제**: X 클릭 → 다이얼로그가 사용량 표시(반·담당 강사·등록/학생상담·성적·시험·레벨테스트·
  성적목표·학습코멘트·교재단가·상담 과목별점수·원스크린 세션) → 대상 과목 선택 → **모두 흡수하고 삭제(즉시 적용)**.
  사용 0건이면 **미사용 삭제**(실행 시점 사용량 재검증 = TOCTOU 차단, 서버 즉시 확정).
  · **저장 표면 전수**(적대리뷰 열거 검증 통과): 스칼라 9테이블 + `users.subjects[]` + jsonb 2곳
    (`subject_details`·`subject_progress`) + `tenant_settings` 행 제거([subject-actions.ts](src/features/owner/server/subject-actions.ts) 상단 주석이 단일 소스).
  · **0077a RPC `absorb_subject_key`**: users 배열 치환·순서보존 dedupe + jsonb 키 개명(양쪽 객체면 to-우선
    얕은 병합)을 **DB 원자 단일 문**으로 — 클라 루프의 동시저장(원스크린 800ms 자동저장) 유실 레이스·행당 왕복
    타임아웃 제거. 의미 정의 = [subject-absorb.ts](src/features/owner/subject-absorb.ts) 순수 헬퍼(Vitest 8).
    **프로덕션 DB 적용됨**(함수 생성만 — 브랜치 코드만 호출, main 무영향).
  · 설정 쓰기는 saveOwnerSection 경유(단일 쓰기 경로) + **저장 직전 fresh 재읽기**(진행 중 다른 창 저장분 보존).
    classes 유니크 충돌 사전점검(fetchAllPaged) + 23505 친절 매핑. 감사로그 `owner_subject_absorb`/`owner_subject_delete`.
- **적대 리뷰(워크플로 13에이전트, find 3렌즈→verify)**: 열거 완전성 통과(빠진 표면 0) + CONFIRMED 9건
  전부 수정 — RPC 원자화(레이스·타임아웃) / 설정 fresh 재읽기 / classes 사전점검 B2 / **SearchableSelect
  검색창 Enter 가드**(폼 암묵 제출 — 전 사용처 공통 픽스) / 다이얼로그 native `<dialog>`+showModal(배경
  inert·Esc·포커스 격리) / run·usage try-catch(busy 고착 방지) / **SectionForm payload 변경 시 input dispatch**
  (버튼→state→hidden 경로가 unsaved guard에 안 잡히던 것 — owner 전 섹션 공통 픽스) / zero-usage 서버 확정.
  REFUTED 1(fromRow 부재 revalidate — 무효화할 캐시 없음).
- **검증**: tsc0/lint0/**test674**(subject-absorb 8 신규) + RPC BEGIN…ROLLBACK 의미검증(배열 dedupe·jsonb
  to-우선 병합 = 순수 헬퍼와 1:1) + **라이브 E2E**(3002, 스로어웨이 과목 2개 + 4표면 합성 데이터): 다이얼로그
  4건 카운트 → 흡수 → 4표면 전부 이동(병합 정확)·설정 행 제거·감사 metadata {moved:4, detail} → 정리 →
  zero-usage 삭제(저장 버튼 없이 서버 확정·감사) → **원상 복구 확인**(설정 5과목·english 11교시/6가로줄/10분·residual 0).
  실과목 스팟체크: 수학(심화) 다이얼로그 = 반 15·담당 강사 4(=highmath 마이그레이션 때 수치와 일치) → 취소.

### (이전) 2026-07-04까지

| 커밋 | 내용 | 검증 | 상태 |
|---|---|---|---|
| `eb2c92e` | 시트 A열(교시) 정찰 스크립트 보존 | node --check | ✅ push |
| `7740aa4` | 교시 갱신 핸드오프 반영(문서) | — | ✅ push |
| **`491aea6`** | **영어 교시 = 통합영어시간표 시트 col A 11교시로 교체**(periods.ts) | **tsc0/lint0/test631 + 헤드리스 렌더체크** | ✅ push |
| `ddb8348` | 영어 강사뷰(`?view=teacher`, 강사-major, teacher-grid.tsx) | tsc0/lint0/build✓ | ✅ push |
| (이전) | enrollment 247 / class_schedules temporal 254 / 종강18·폐지1 / fetchSlots weekSundayOf 픽스 | 라이브 E2E·롤백 | ✅ 운영 DB 반영 |

**🟢 이번 턴 요약(2026-07-04)**: 사용자 정정 — **교시 진실원본 = 통합영어시간표(7월) 시트**(강사별은 10분 단위로 쪼갠 것, 시작시각 일치 시 통합에 수식 출력이라 교시 기준 아님). `ENGLISH_PERIODS`를 옛 10교시(시각 일부 오류) → **통합 col A distinct start 11개**로 교체([periods.ts](src/features/timetable/lib/periods.ts)). 추출도구 [extract-integrated-period-times.cjs](scripts/_english_sync/extract-integrated-period-times.cjs). 4게이트 통과 + 실 production 영어 slot 12 start → subjectPeriodRows 11행·slotPeriodRow e-1~e-11 매핑(16:00 anomaly 2슬롯만 기타). **수학 별도 상수(MATH_PERIODS) 무변.** 상세 = 아래 §후속 권장(교시 항목) + §4 코드 상태.

**🔜 잔여(우선순위)**: ① 정식 코드화 — "시트 반영" 버튼(§3-4, structure/ 파서·매칭 커밋됨, readSheetGridWithMerges+diff+액션+UI 필요) ② 강사 5명(Elsa·Anna·Dom·JJ·이주희) 직원 등록+english_name+담임 재지정(§후속) ③ (옵션) 16:00 anomaly 2슬롯 DB 정규화(→15:40 start)=기타 0, **프로덕션 mutation이라 승인 후** ④ **main 반영은 사용자 승인 후에만**. ~~⑤ 강사뷰 가로줄·격자·과목별 교시 설정 배선~~ → ✅ 완료(2026-07-06 2차, 위 섹션).

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
스프레드시트 통합 시트의 반별 학생 명단(247건) → aywa 영어 수강에 반영. **99.6% 이름매칭**(246/247).

| 작업 | 수 |
|---|---|
| 신규 생성 반 | **14** — `LT2 LS2a LS2b KW6 PJ5 JP1 MEC1-3 LS5 PL2 RTT2 LT4 LS4 KW1 고등E_고2 심화` (컬럼: tenant_id·class_name·subject='english'만, 시간/방/담임 **비어있음**) |
| 신규 수강 INSERT | 104 |
| 이미 맞아서 유지 | 142 |
| 소프트삭제(`end_date`=2026-07-03) | 149 (시트에 없던 기존 영어수강) |
| 미해결(동명이인) | 1 (`이재윤` 일중, aywa에 2명 — 학년으로 구분 필요) |
| **결과: 영어 열린수강** | **247건 = 시트 상태** |

- 검증: DP5(7명)·LT2(6명)·중등E_중2 심화(10명) aywa 명단 = 시트와 정확히 일치.
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
[scripts/_english_sync/close-old-english-classes.cjs](scripts/_english_sync/close-old-english-classes.cjs). 원안 "is_active=false+closed_at"는 aywa 의미론상 **폐지=타임머신에서도 숨김**이라, 실수강 이력(3~10건)이 있는 18개는 **종강(closed_at='2026-07-02', is_active 유지)** — 과거 주에 이력 표시 보존(검증: ref 06-28에 18개 표시). 이력 0의 `고등특강(테스트)`만 폐지. 언두: `CLASSES_UNDO_2026-07-03.json`.

### 3-3. 이재윤 동명이인 ✅ — 쓰기 0으로 해결
시트 배정(중등E_중1 TOP·일중·중1)은 aywa `0524df0a`(일중·중1)의 **기존 열린 수강(2026-04-07~)이 이미 충족** — TOP 명단 시트=DB 10명 완전 일치. 다른 이재윤(`821441f9`·대구일중·중1·수강0)은 **중복 학생 행 의심** → 병합/정리는 owner 데이터정리(중복 학생) 도구 소관(별건).

### 3-4. 정식 코드화 (재사용 가능한 "시트 반영" 버튼) — 유일한 잔여
지금 반영은 일회성 스크립트(스크립트들은 `scripts/_english_sync/`에 커밋됨). 반복 동기화하려면 `src/features/timetable/import/structure/` 에 정식 편입 필요:
- 이미 있음(커밋됨·테스트 14개 통과): `types.ts`, `parse-grid.ts`(그리드→슬롯 순수파서), `match.ts`(슬롯↔기존레코드 이름매칭).
- 필요: `google-sheets.ts`에 `readSheetGridWithMerges`(`includeGridData`로 병합까지) 추가 → `values.get`은 병합 잃음. + diff + 적용 서버액션(스냅샷 백업) + UI 트리거(수학의 "시트 반영"과 동일 패턴).

### 3-5. 영어 '강사뷰' = 시트 "강사별영어시간표" 그대로(강사-major) ✅ (2026-07-04)
`/timetable?subject=english&view=teacher` — 뷰 토글 3번째 칩(영어에서만). ⚠️ **1차 시도(요일-major)는
사용자가 "완전 틀렸다"고 반려** — 시트는 **강사-major**(강사=세로 블록, 그 안에 월~토 가로, 왼쪽 단일 시각열,
셀=반명+방·학생 없음)라 축을 뒤집어 전용 컴포넌트로 재작성.
- **관계 확정(사용자)**: 시트 `강사별영어시간표` = 마스터(강사들이 직접 짜는 배치) → `통합영어시간표`(반-major+학생명단)를
  931개 수식으로 자동 파생 = **aywa 통합뷰**에 대응. 그러니 강사뷰 = **강사별 마스터 그리드를 그대로 옮긴 것**.
- 전용 컴포넌트 [teacher-grid.tsx](<src/app/(shell)/timetable/_components/teacher-grid.tsx>) `TeacherGridView`:
  컬럼 = 강사(시트 좌→우 순서) → 그 강사 요일(월→토 자연순, 실제 가르치는 요일만). 행 = 영어 10교시(+비정렬 기타).
  **토요일도 오후라 영어 평일 교시 축에 정렬**(rowOf에 'mon' 강제 → 주말 09:00 교시 미사용). 셀 = ClassCell `roster="none"`(반명+방만, 학생 X — 시트 강사별 탭과 동일). 연속 교시 반은 세로 병합(rowSpan), 요일 병합 없음(각 요일 독립 컬럼).
- **강사 순서·색 = 시트 실측**([english-teacher-sheet.ts](src/features/timetable/lib/english-teacher-sheet.ts) — [read-teacher-grid.cjs](scripts/_english_sync/read-teacher-grid.cjs)로 시트 강사 헤더 병합·배경색 추출):
  Jane #dd7e6b · Hannah #f9b3d1 · Elsa #674ea7 · Charlie #f6b26b · 부원장 #d9ead3 · Dom #76a5af · Anna #4285f4 ·
  Florence #cc0000 · Kristine #a4c2f4 · Sam #ffc000 · JJ #bdbdbd · 이주희 #fff2cc. DB(getTeacherColorMap) 우선, 미등록 강사(대부분)는 이 시트 미러색 폴백 → 강사 등록되면 자동으로 DB색이 우선.
- 읽기전용(편집·DndArea는 기본뷰), 타과목 전환 시 기본뷰 폴백.
- 검증: typecheck0/lint0 + 라이브(dev 3012, 마스터): 강사 밴드 순서 12명 시트 일치·색 헤더 12·요일 서브컬럼(월6/29~토7/4)·토 정렬(Jane 토 1교시 고등E_고2 심화/301)·셀=반명+방(DP5/본원602 등). ⚠️ 1차 요일-major 컴포넌트 변경(weekday-group-tables `groupBySlotTeacher`)은 되돌림.
- ⏭️ 후속: 강사별 시트엔 강사 근무메모(r2 "월~금 2:00-10:00")도 있음 — aywa엔 미보존(강사 등록 시 users 메모로). 셀 반명 긴 것은 클립(hover 전체) — 시트도 동일.

### 후속 권장 (데이터 아님·운영 결정)
- **강사 5명 직원 등록**: Elsa(전양원)·Anna(육소희)·Dom(김동후)·JJ·이주희는 users에 없어 담임 미배정/기본뷰 강사 컬럼이 옛 담임 기준. 직원관리에서 등록 + `english_name` 세팅 후 해당 반 담임 지정하면 완결(통합뷰 슬롯 라벨은 이미 정확).
- **✅ ENGLISH_PERIODS = 통합 시트 11교시로 갱신 (2026-07-04, 커밋 491aea6)**: 사용자 정정 "통합을 기준으로 교시를 봐라 — 강사별은 10분 단위로 쪼갠 것(시작시각 일치 시 통합에 수식 출력)". 통합영어시간표(7월) col A distinct start 11개(14:20·15:00·15:40·16:20·17:00·17:20·17:40·18:20·19:20·20:20·21:10, 끝=start별 최빈)로 교체. 이제 옛 '기타' 폴백 시작(17:20·19:20·20:20·21:10)이 정식 교시행(e-6·e-9·e-10·e-11)으로 표시. 오후 16:20~17:40 40분·60분 두 체계 공존 → 4~7교시 시간대 일부 겹침(시트 실제). 검증=tsc0/lint0/test631 + 헤드리스 렌더체크(실 slot 12 start → 11행 매핑, 16:00 anomaly 2슬롯[15:40~16:20 split 잔재]만 기타). 추출도구=`scripts/_english_sync/extract-integrated-period-times.cjs`. 수학은 별도 상수 무변.
  - ⚠️ 잔여(옵션): 16:00 anomaly 2슬롯을 15:40 start로 DB 정규화 → 기타 0. 프로덕션 mutation이라 승인 후.

## 4. 코드 상태 (브랜치 `Injaewon/english-timetable-import`)

- `src/features/timetable/import/structure/`
  - `types.ts` — SheetGrid/슬롯/매칭/diff/드라이런 타입.
  - `parse-grid.ts` — 강사별 그리드(셀+병합) → 정규화 슬롯. 순수함수. (커밋 `f15610e`)
  - `match.ts` — 슬롯 ↔ 기존 강사/수업/방 이름매칭(구버전 방어). (커밋 `dfee9b8`)
  - `*.test.ts` — 실 시트 픽스처로 검증, **14/14 통과**. (`npx vitest run src/features/timetable/import/structure/`)
  - `fixtures/teacher-grid.sample.json` — 실 강사별 시트를 Sheets includeGridData 형태로 스냅샷.
- `next.config.ts` — `serverExternalPackages: ["exceljs"]` 추가(커밋).
- `src/features/timetable/lib/periods.ts` — **`ENGLISH_PERIODS` = 통합 시트 col A 11교시**(커밋 `491aea6`). ⚠️ 교시 진실원본은 **통합영어시간표**(강사별 아님). 수학 상수(`MATH_PERIODS`)는 별도·무변. 관련 테스트 `periods.test.ts`(26)·`class-grid.test.ts`(7) 갱신.
- `scripts/_english_sync/extract-integrated-period-times.cjs` — 통합 시트 col A(A1:A194)에서 오후→24h 변환 후 distinct start→end 집계(11교시 재검증용, 재현 가능·커밋 `eb2c92e`).
- **(2026-07-06 신규)**
  - [`src/features/timetable/lib/ten-minute-grid.ts`](src/features/timetable/lib/ten-minute-grid.ts)(+test 24) — 10분 행 축·피복·slotRowSpan·buildSlotIntervals(슬롯=블록 1:1)·packGroups(합반 그룹 레인 패킹). 순수([[#61]]).
  - [`teacher-chip.tsx`](<src/app/(shell)/timetable/_components/teacher-chip.tsx>) — 강사뷰 전용 클라 칩(반명↔명단 토글).
  - `scripts/_english_sync/fix-classname-teukbyeol-s.cjs` · `fix-sky-room-labels.cjs` · `import-lab-parallel-slots.cjs` · **`verify-sheet-parity.cjs`**(상시 회귀 검증기 — xlsx↔DB 정규형 diff, exit code 게이트) — 전부 dry-run 기본·멱등·undo(`_artifacts/`).
  - xlsx 획득: `curl -sL ".../export?format=xlsx"`(시트 링크 공유라 무인증, gid 없이 전체 워크북).

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
