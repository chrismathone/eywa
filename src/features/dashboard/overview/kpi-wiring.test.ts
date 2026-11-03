/**
 * **운영실 KPI 여섯 칸 — 카드·팝업·목적지 화면이 같은 함수를 부른다**(원장 2026-09-11, 구조 가드).
 *
 * 카드 숫자와 ↗로 연 화면의 숫자가 다르면 "운영실이 틀렸다"가 된다. 순수 규칙이 맞아도 표면이 그 규칙을 안
 * 지나가면 소용없어서, 표면마다 **공용 함수를 부르는지**를 소스로 잠근다(주석은 강제력이 없다).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attendanceStatsHref,
  billingStatsHref,
  consultProgressStatsHref,
  consultationStatsHref,
  newcomerStatsHref,
  expenseStatsHref,
  firstClassTrendHref,
  intakeTrendHref,
  reportStatsHref,
  absentDayHref,
  recentAbsenceRange,
  intakeDayHref,
  makeupWeekHref,
  studentsEnrolledHref,
  studentsFirstClassHref,
  withdrawalsMonthHref,
} from "./kpi-links";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
const src = (path: string) => strip(read(path));
const count = (text: string, needle: string) => text.split(needle).length - 1;

const SERVER = src("src/features/dashboard/overview/server.ts");
const STRIP = src("src/app/(shell)/dashboard/_overview/kpi-strip.tsx");
const POPUPS = src("src/app/(shell)/dashboard/_overview/kpi-popups.tsx");
const SIGNALS = src("src/features/dashboard/server/action-signals.ts");
const STUDENTS_PAGE = src("src/app/(shell)/students/page.tsx");

describe("① 재원생 — 원생목록과 같은 조회·같은 순수 집계", () => {
  const QUERIES = src("src/features/students/server/queries.ts");
  const COMPOSITION = src("src/features/students/server/enrolled-programs.ts");

  it("운영실은 행을 한 번 받아 원생목록과 같은 순수 집계에 넘긴다(B1 — 서버 액션엔 요청 캐시가 없다)", () => {
    expect(SERVER).toContain("countEnrolledStudents(db, scope, notStarted)");
    expect(SERVER).toContain("fetchActiveEnrolledEnrollments(db)");
    // 학원 전체 값은 받은 행 그대로(`build(studentRows, rows, enrolled)`), 과목 관리자 값은 같은 집계에 과목으로 거른 행을 넘긴다.
    expect(SERVER).toContain("enrolledSubjectCounts(countRows, scope, today)");
    expect(SERVER).toContain("if (!pred) return build(studentRows, rows, enrolled);");
    expect(SERVER).toMatch(/composeEnrolled\(\{/);
    expect(SERVER).toContain("gradeSplit(visible, composition.programs, settings.operations.gradeLevels)");
    expect(SERVER).toContain("concurrent: programs.both");
  });

  it("원생목록 상단 카드·program= 필터도 같은 순수 집계를 지난다", () => {
    expect(QUERIES).toContain("countEnrolledStudents(supabase, teacherScope, notStarted)");
    expect(QUERIES).toContain("enrolledSubjectCounts(ens, teacherScope, kstToday())");
    expect(COMPOSITION).toMatch(/composeEnrolled\(\{[\s\S]*?today: kstToday\(\)/);
    expect(STUDENTS_PAGE).toContain("restrictIdsFor(program, firstDay, { levels, mixes })");
    expect(STUDENTS_PAGE).toContain("restrictIds");
  });

  /**
   * '실시간 재원생'(원장 2026-09-16) — 아직 한 과목도 시작 안 한 학생을 **카드·목록·과목이 함께** 뺀다.
   * 🔴 한 곳만 빼면 "338명"이라 적어 놓고 339줄이 뜬다(원장이 지적한 종류의 불일치).
   */
  it("④ 아직 시작 안 한 수강만 가진 학생은 총원·목록·과목에서 함께 빠진다", () => {
    // 집합을 만드는 곳은 순수 함수 한 벌
    expect(src("src/features/students/enrollment/enrolled-composition.ts")).toContain(
      "export function notYetStartedStudentIds(",
    );
    // 총원(count head)과 목록(students 조회)이 같은 집합을 뺀다
    expect(COMPOSITION).toContain("export const getNotStartedStudentIds");
    expect(QUERIES).toContain("getNotStartedStudentIds()");
    expect(QUERIES).toMatch(/hideNotStarted[\s\S]*?\.not\("id", "in"/);
    // 운영실도 같은 순수 함수로 만든 집합을 넘긴다(서버 액션이라 요청 캐시가 없다)
    expect(SERVER).toContain("notYetStartedStudentIds(rows, today)");
  });

  it("A6 — 옛 '동시 수강'(과목 둘 이상) 값은 남기지 않는다", () => {
    expect(QUERIES).not.toContain("concurrent");
    expect(src("src/features/students/enrollment/subject-enrollment-summary.ts")).not.toMatch(/concurrent\s*[:=]/);
  });

  it("🔴 좁힐 학생 집합을 .in(id)에 싣지 않는다(URL 414) — 같은 필터로 id 전건을 받아 JS로 거른다", () => {
    expect(QUERIES).toMatch(/restrict\.has\(id\)/);
    expect(QUERIES).not.toMatch(/\.in\("id", \[\.\.\.restrict/);
  });

  it("↗는 모든 축을 명시값으로 적는다", () => {
    expect(studentsEnrolledHref()).toBe(
      "/students?status=enrolled&subject=all&grade=all&teacher=all&noenr=0&from=dashboard",
    );
    expect(studentsEnrolledHref("eie")).toMatch(/&program=eie$/);
  });

  /**
   * '재원생 구성' 막대 → 원생목록(원장 2026-09-28 "막대 숫자 = 열린 목록 건수"). 숫자 자체는 composition-filter-parity.test.ts가
   * 같은 재료로 잠그고, 여기선 **표면이 그 함수를 부르는지**를 잠근다(주석은 강제력이 없다).
   */
  it("재원생 구성 막대·원생목록 level=·mix=·'미수강'이 같은 판정 함수를 지난다", () => {
    const PURE = src("src/features/students/enrollment/enrolled-composition.ts");
    // 운영실 active(미수강 막대의 여집합)와 목록 '미수강'이 같은 줄 판정(activeRows)
    expect(PURE).toMatch(/for \(const \[row, klass\] of activeRows\(input\.rows, input\.scope, input\.today\)\)/);
    expect(PURE).toMatch(/export function activeStudentIds[\s\S]*?activeRows\(rows, scope, today\)/);
    // 목록 '미수강'은 재원이면 운영실 구성과 같은 요청 캐시 행을 쓴다
    expect(COMPOSITION).toMatch(/enrolledOnly \? loadActiveEnrolledEnrollments\(\)/);
    expect(COMPOSITION).toContain("activeStudentIds(rows, scope, kstToday())");
    expect(QUERIES).toContain('getSubjectFilterKeep(subjectFilter.all, options?.status === "enrolled")');
    // 학교급 × 구성 = 막대와 같은 재료(getEnrolledComposition) · 같은 학교급 분류(studentLevelOf)
    expect(COMPOSITION).toContain("compositionStudentIds(await getEnrolledComposition(), filter)");
    expect(src("src/features/dashboard/overview/student-composition.ts")).toContain(
      "levelLabel(studentLevelOf(student.grade))",
    );
    expect(src("src/features/students/server/restrict-ids.ts")).toContain("getCompositionStudentIds(composition)");
    // 엑셀도 같은 집합(파일 행 = 목록 행)
    expect(src("src/app/api/exports/students/route.ts")).toContain("parseLevels(url.searchParams.get(\"level\"))");
    // 막대 링크는 kpi-links 한 곳에서 만든다(목적지 축을 명시값으로)
    const CHART = src("src/app/(shell)/dashboard/_overview/level-split.tsx");
    expect(CHART).toContain("studentsCompositionHref(");
    expect(CHART).toContain("studentsUnenrolledHref()");
  });
});

describe("B1 — 한 번 푼 스코프·설정을 넘긴다", () => {
  it("loadOverview는 강사 스코프·학원설정을 한 번만 푼다(영역마다 getCurrentUser가 users를 다시 읽지 않게)", () => {
    expect(count(SERVER, "effectiveTeacherId()")).toBe(1);
    expect(SERVER).not.toContain("effectiveTeacherScope(");
    expect(count(SERVER, "getTenantSettings()")).toBe(1);
    expect(SERVER).toContain("teacherIdPromise.then((id) => (id ? getTeacherScope(id) : null))");
  });
});

describe("② 퇴원&수업종료 — 1일~오늘, 퇴원관리의 과목 전체 종료 기준", () => {
  const PAGE = src("src/app/(shell)/withdrawals/page.tsx");
  const QUERIES = src("src/features/withdrawals/server/queries.ts");
  const WINDOW = src("src/features/withdrawals/server/window.ts");
  const EXIT_ROWS = src("src/features/withdrawals/exit-rows.ts");

  it("카드와 추이는 실제 퇴원 조회를 공유하고, 카드는 과목 종료를 추가한다", () => {
    expect(count(SERVER, "getWithdrawalsInWindow(")).toBe(1);
    expect(SERVER).toContain("withdrawalMonthWindow(month, today)");
    expect(SERVER).toMatch(/inWithdrawalWindow\(\{ withdrawnAt: row\.exitDate, systemBulk: false \}, win\.from, win\.to\)/);
    // 추이의 퇴원 칸은 사유 없는 단체 장부 정리를 뺀 목록(원장 2026-10-20) — 카드(이번 달 퇴원 수)는 그대로 센다.
    expect(SERVER).toContain("const exits = withdrawn.filter((r) => !r.cleanup);");
    // 수업을 시작한 등록만(원장 2026-10-20) — 판정 창 안 등록은 수업을 시작한 근거가 있어야 등록 칸에(퇴원 칸은 그대로) · 운영실·원생 통계 둘 다 재료를 넘긴다.
    expect(SERVER).toContain("const joined = counted.filter((r) => !bookkeeping.has(r.id) && isStarted(r.id, r.enrolled_at));");
    expect(SERVER).toContain("loadRecordCoverage(user.tenantId, today).catch(");
    expect(src("src/features/students/stats/server/load.ts")).toContain("DETAIL_MONTHS, !scoped, coverage)");
    // 퇴원 막대의 달 = 퇴원월(수강료를 낸 마지막 달 — `exitDate`, 원장 2026-10-29).
    expect(SERVER).toContain("exits.filter((r) => !pred || inSlice(pred, exitSubjects(r))).map((r) => r.exitDate)");
    // 운영실 과목 관리자 카드는 종전대로 '모름은 모두에게'(기본값) — 원생 통계만 모르는 기록을 뺀다(2026-10-20).
    expect(SERVER).toContain("unknownToAll = true,");
    expect(SERVER).toContain("unknownToAll ? inSliceAny(pred, subjects)");
    expect(SERVER).toContain("getSubjectEndedStudents({ countFrom: win.from })");
    // 줄 조립은 순수 함수(`monthWithdrawalRows` — monthly-exits.test가 잠근다) · 이번 달 퇴원은 6개월 창보다 앞 달로 셌어도 싣는다(원장 2026-11-03 '앞 달로 센').
    expect(SERVER).toContain("...monthWithdrawalRows(rows, ended, win,");
    expect(SERVER).toContain("getWithdrawalsInWindow(`${monthKeys(today)[0]}-01`, today, { keepProcessedFrom: `${exitReportMonth(today)}-01` })");
    expect(src("src/features/dashboard/overview/monthly-exits.ts")).toContain("rows: includeSubjectEnds(");
    expect(SERVER).not.toContain("datedWithdrawals");
    expect(WINDOW).toMatch(/inWithdrawalWindow\(/);
  });

  it("퇴원관리 range=month·program=은 같은 판정(withdrawalMonthWindow·inWithdrawalWindow·withdrawalProgram)", () => {
    // 2026-09-28 퇴원·수강종료 한 목록 — 기간 판정은 exit-rows.ts `inRange`가 같은 `inWithdrawalWindow`를 부른다.
    expect(PAGE).toContain("withdrawalMonthWindow(monthKey, today)");
    expect(PAGE).toContain("resolveRange(range, { today, month: monthWindow");
    expect(EXIT_ROWS).toMatch(/inWithdrawalWindow\(\{ withdrawnAt: row\.countDate, systemBulk: row\.systemBulk \}, w\.from, w\.to\)/);
    expect(PAGE).toMatch(/withdrawalProgram\(\s*\{ lastClassSubject: r\.programSubject, lastClassEnglishTrack: r\.englishTrack \},\s*settings\.operations\.subjects,?\s*\)/);
    expect(PAGE).toContain("isValidYm(sp.month)");
  });

  it("두 조회가 같은 종료 수강 조회·같은 마지막 반 선택을 쓴다(청크 × 페이징)", () => {
    for (const s of [QUERIES, WINDOW]) {
      expect(s).toContain("loadEndedEnrollments(supabase");
      expect(s).toContain("lastEndedByStudent(");
    }
    expect(WINDOW).toContain("fetchAllPagedInChunks");
  });

  it("카드와 팝업은 같은 집계(countWithdrawalPrograms) · '올해'는 '최근 1년'", () => {
    expect(STRIP).toContain("countWithdrawalPrograms(withdrawals.rows)");
    expect(POPUPS).toContain("countWithdrawalPrograms(data.rows)");
    expect(PAGE).not.toContain('"올해"');
    expect(withdrawalsMonthHref("2026-09")).toBe("/withdrawals?type=all&range=month&month=2026-09");
  });

  /**
   * 원장 2026-09-13: 중복 병합된 학생(김지유B·권민서B)이 퇴원으로 잡혀 있었다. 병합은 *"원래 한 사람이었다"*를
   * 정리한 것이지 퇴원이 아니다 — 카드·퇴원관리가 **같은 모집단**에서 빼야 두 숫자가 같이 맞는다.
   * 🔴 판정은 이름 접미사가 아니라 `students/merged.ts` 한 벌이다(접미사로 거르면 진짜 동명이인 퇴원이 사라진다).
   */
  it("🔴 중복 병합된 학생은 퇴원 모집단에서 빠진다 — 두 조회가 같은 판정을 쓴다", () => {
    for (const s of [QUERIES, WINDOW]) {
      // 🔴 `toContain("isMergedStudent")`로 끝내지 말 것 — **import 줄만으로 통과**한다(필터를 지워도
      //    unused import는 이 리포에서 error가 아니라 warning이라 게이트가 안 잡는다). 호출 꼴을 본다.
      expect(s).toMatch(/filter\(\([\w]+\) => !isMergedStudent\(/);
      // 판정 재료(`notes`)를 실제로 받아야 판정이 돈다 — select에서 빠지면 조용히 전원 통과한다.
      expect(s).toMatch(/select\([\s\S]{0,200}?notes/);
    }
  });

  /**
   * 🔴 증감을 세는 표면이 여섯이고 **하나만 빠져도 두 화면이 다른 학원이 된다** — 그게 이 수정의 이유다.
   *    그래서 필터가 붙은 자리를 전부 잠근다(가드가 없던 세 곳에서 조용히 되돌아갈 수 있었다).
   */
  it("등록·증감을 세는 다른 표면도 같은 축으로 뺀다", () => {
    const DASH = src("src/features/dashboard/server/queries.ts");
    const WEEKLY = src("src/features/dashboard/onescreen/server/queries.ts");
    // 이 조회는 status를 안 본다(복구된 학생의 그 달 등록을 살리려고) → 병합 학생이 그대로 세졌다.
    expect(SERVER).toMatch(/filter\(\([\w]+\) => \(!ids \|\| ids\.has\([\w.]+\)\) && !isMergedStudent\(/);
    // 수업 기록 없는 장부 정리도 등록에서 뺀다(퇴원 메타데이터를 함께 읽는다 — `bookkeepingOnlyIds`, 원장 2026-10-15).
    expect(SERVER).toContain('select("id,enrolled_at,notes,withdrawal_metadata")');
    // 이번 달 증감(등록·퇴원 양쪽) · 최근 7일 증감(등록·퇴원 양쪽) = 최소 4곳.
    // ⚠️ **하한**으로 잠근다 — 딱 맞는 수로 박으면 나중에 같은 파일에서 **다섯 번째 누수를 고치는 사람이**
    //    빨간 가드를 만나고, 그걸 푸는 가장 쉬운 길이 '숫자 올리기'라 가드를 편집하는 습관이 든다.
    expect((DASH.match(/!isMergedStudent\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // 4주 증감 — 등록·퇴원 한 판정 함수(`notMerged`)를 양쪽 배열에 건다.
    expect(WEEKLY).toMatch(/!isMergedStudent\(/);
    expect((WEEKLY.match(/\.filter\(notMerged\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("③ 신규문의 — 같은 KST 하루 경계", () => {
  const INTAKE = src("src/features/enrollment/server/intake-day.ts");
  const QUERIES = src("src/features/enrollment/server/queries.ts");
  const PAGE = src("src/app/(shell)/enrollment/page.tsx");

  it("카드·브리핑 신호 = getIntakeOnDay · 목록 received=와 같은 경계 함수", () => {
    expect(SERVER).toContain("getIntakeOnDay(today)");
    expect(SIGNALS).toContain("getIntakeOnDay(today, { supabase, tenantId: db?.tenantId })");
    expect(INTAKE).toContain("kstDayBounds(date)");
    expect(QUERIES).toContain("kstDayBounds(filter.received)");
    expect(QUERIES).toContain("kstMonthBounds(filter.month)");
    expect(QUERIES).not.toMatch(/new Date\(y, m, 1\)/);
    expect(intakeDayHref("2026-09-11")).toBe("/enrollment?view=table&received=2026-09-11");
  });

  it("C2 — 달·접수일은 달력에 있는 값만(없는 날짜는 필터 없음)", () => {
    expect(PAGE).toContain("isValidYmd(received)");
    expect(PAGE).toContain("isValidYm(month)");
  });

  // 옛 콜&상담 대시보드(`getMonthlyOutcomeDistribution`)가 지던 규칙 — 2026-10-23 그 화면을 지워 월별 결과 수는
  // '통계' 보기의 `getEnrollmentStats`(group-by RPC)가 낸다. 같은 규칙을 그쪽에 건다.
  it("C3 — 월별 결과 수는 실패를 0건으로 위장하지 않는다(RPC 오류 = throw)", () => {
    const STATS = src("src/features/enrollment/server/stats-queries.ts");
    const at = STATS.indexOf("export async function getEnrollmentStats");
    expect(at, "getEnrollmentStats를 못 찾았다").toBeGreaterThanOrEqual(0);
    const fn = STATS.slice(at, STATS.indexOf("export async function", at + 1));
    expect(fn).toContain('supabase.rpc("consultation_monthly_stats"');
    expect(fn).toContain("if (cur.error) throw cur.error;");
  });
});

describe("④ 전일 입테 — 분류기 한 벌, ↗ 없음", () => {
  it("서버가 단일 분류기로 종류를 싣고, 카드·팝업은 levelTestListOn(어제) 한 번의 결과를 같이 쓴다", () => {
    expect(SERVER).toContain("kind: admissionsEventKind(event)");
    expect(count(STRIP, "levelTestListIn(")).toBe(1);
    expect(STRIP).toContain("levelTestListIn(v.calendar.data, prev)");
    expect(STRIP).toContain("const prev = previousDayRange(today);");
    expect(STRIP).not.toContain("levelTestsIn(");
    expect(STRIP).toContain("<LevelTestPopup list={levelTests} range={prev} />");
    expect(STRIP).not.toContain("/calendar");
  });

  // 원장 2026-09-30 — 취소된 입테는 목록엔 취소선, 숫자엔 없다.
  it("카드 숫자 = 살아 있는 입테(active), 취소는 보조 줄 '취소 N'으로만", () => {
    expect(STRIP).toContain("value={count(levelTests?.active.length)}");
    expect(STRIP).toContain("`취소 ${number(levelTests.cancelled)}`");
    const POPUPS_DAY = src("src/app/(shell)/dashboard/_overview/kpi-popups-day.tsx");
    expect(POPUPS_DAY).toContain('<PopupTotal label="전일 레벨테스트" value={list.active.length} unit="건" />');
  });

  // 원장 2026-10-22 *"금일 입테 -> 전일 입테로 … 측정하는것도 전일 입테로"* — 일정은 어제부터 읽고, 어제 줄은 입테만 · 패널은 오늘부터.
  it("서버는 어제부터 읽어 어제 줄은 레벨테스트만 싣고, 일정 패널·요약은 오늘부터만 센다", () => {
    // 전일 첫날(월요일엔 토요일 — 원장 2026-10-22 *"월요일의 전일은 주말 모두 포함"*)부터 — 기간은 previousDayRange 한 곳.
    expect(SERVER).toContain("const prevFrom = previousDayRange(today).from;");
    expect(SERVER).toContain("getDateRangeEvents(prevFrom, end)");
    expect(src("src/features/dashboard/layout/summary.ts")).toContain("levelTestListIn(v.calendar.data, previousDayRange(snap.today))");
    expect(src("src/features/dashboard/overview/enrolled-recent.ts")).toContain("const prev = previousDayRange(today);");
    expect(SERVER).toContain('(event) => event.endDate >= today || admissionsEventBaseKind(event) === "levelTest"');
    const OVERVIEW_SRC = src("src/app/(shell)/dashboard/_overview/overview.tsx");
    expect(OVERVIEW_SRC).toContain("upcomingAdmissionsRows(v.calendar.data, snapshot.today)");
    expect(OVERVIEW_SRC).not.toContain("<AdmissionsSchedule events={v.calendar");
    const SUMMARY = src("src/features/dashboard/layout/summary.ts");
    expect(count(SUMMARY, "upcomingAdmissionsRows(v.calendar.data, snap.today)")).toBe(2);
  });

  it("취소된 일정은 서버가 kind=null + cancelledKind로 싣고 반·콜&상담 연결을 붙이지 않는다", () => {
    const cancelledBranch = SERVER.slice(SERVER.indexOf("if (isCancelledEventTitle(event.title)) {"));
    expect(cancelledBranch.slice(0, 600)).toContain("kind: null,");
    expect(cancelledBranch.slice(0, 600)).toContain("cancelledKind: admissionsEventBaseKind(event),");
    expect(cancelledBranch.slice(0, 600)).toContain("matchedConsultation: null,");
    // 반·상담 연결 조회는 살아 있는 일정만.
    expect(SERVER).toContain("consultationBasesInTitles(live, consultations, notNames)");
  });

  it("'일정 보기 (N개)'도 같은 축 — 살아 있는 일정만 세고 취소는 ' · 취소 N'으로 따로", () => {
    const OVERVIEW_SRC = src("src/app/(shell)/dashboard/_overview/overview.tsx");
    expect(OVERVIEW_SRC).toContain("admissionsRows!.filter((event) => !isCancelledAdmissionsRow(event)).length}개)${cancelledSuffix(");
    expect(OVERVIEW_SRC).not.toContain("전체 ${v.calendar!.data!.length}개 일정 보기");
  });
});

/**
 * 원장 2026-09-23: *"금일 등록 카드를 최상단에 추가 … 금일 입테 우측에"* → *"콜&상담에서 등록 완료로 이동한 학생을 오늘날짜 기준으로"*.
 * 옮긴 시각은 상태 변경 감사로그뿐이라, **등록 완료로 옮기는 두 경로가 모두 그 로그를 남겨야** 카드가 안 빈다.
 */
describe("④-2 전일 / 이달 신규 — 등록 완료로 옮긴 로그 한 벌, 반 배정은 칸반과 같은 함수", () => {
  const QUERY = src("src/features/dashboard/server/enrolled-today.ts");
  const ACTIONS = src("src/features/enrollment/server/actions.ts");
  it("카드·팝업이 같은 서버 배열, 자리는 전일 입테 오른쪽", () => {
    expect(SERVER).toContain('addSliced("enrolledToday", ["enrollment"], async () => {');
    expect(SERVER).toContain("const rows = await getEnrolledRecent(today);");
    expect(STRIP).toContain("<EnrolledTodayPopup rows={registered}");
    // 전일 / 이달 가르기는 카드·팝업·요약형이 같은 함수(원장 2026-10-21).
    expect(STRIP).toContain("splitEnrolledRecent(registered, today)");
    expect(src("src/app/(shell)/dashboard/_overview/kpi-popups-day.tsx")).toContain("splitEnrolledRecent(rows, today)");
    expect(src("src/features/dashboard/layout/summary.ts")).toContain("splitEnrolledRecent(v.enrolledToday.data, snap.today)");
    expect(STRIP.indexOf('label="전일 / 이달 신규"')).toBeGreaterThan(STRIP.indexOf('label="전일 입테"'));
    expect(STRIP.indexOf('label="전일 / 이달 신규"')).toBeLessThan(STRIP.indexOf('label="오늘첫수업"'));
  });
  it("등록 완료로 옮기는 두 경로(상태 변경·수업 배정)가 같은 로그를 남긴다", () => {
    expect(count(ACTIONS, 'action: "enrollment_consultation_outcome"')).toBe(2);
    expect(ACTIONS).toContain('to: "enrolled", via: "convert"');
    expect(QUERY).toContain('systemAuditScope(["enrollment_consultation_outcome"])');
    expect(QUERY).toContain('.eq("metadata->>to", "enrolled")');
  });
  it("반 배정 판정·배정 반은 칸반 카드 표식과 같은 필터(assignedQuery) · 지금도 등록 완료인 상담만", () => {
    expect(QUERY).toContain("listAssignedClassNames(db, row.student_id");
    expect(QUERY).toContain('row.outcome === "enrolled"');
    // 배정 반 목록도 개수와 같은 필터를 지난다(원장 2026-10-22 *"반배정된 반이름과 과목 보이게"*).
    const ASSIGNED = src("src/features/enrollment/server/assigned-classes.ts");
    const names = ASSIGNED.slice(ASSIGNED.indexOf("export async function listAssignedClassNames("));
    expect(names.slice(0, 800)).toContain("assignedQuery(supabase, studentId, classKeys,");
    // 상담 과목 글자 → 반 과목 키는 칸반 배지·상세와 같은 판정(2026-10-23 — 옛 이관 '수학'·'EIE'도 그 반을 찾는다).
    expect(names.slice(0, 800)).toContain("await classKeysFor(subject)");
    expect(QUERY).toContain("classKeys: classKeysOf(c.subject)");
  });
});

describe("⑤ 오늘첫수업 — 같은 조회·같은 판정·같은 과목 묶음", () => {
  const ARRIVALS = src("src/features/dashboard/day-arrivals.ts");
  const ARRIVALS_QUERY = src("src/features/dashboard/server/day-arrivals-query.ts");
  const RESTRICT = src("src/features/students/server/restrict-ids.ts");

  it("카드·원생목록 first=·엑셀·브리핑이 같은 함수(getDayArrivals → getFirstClassStudents)를 쓴다", () => {
    expect(SERVER).toContain("getFirstClassStudents(today, settings.operations.subjects)");
    expect(RESTRICT).toContain("getFirstClassStudents(first, settings.operations.subjects)");
    expect(ARRIVALS_QUERY).toContain("(await getDayArrivals(date, subjects, deps)).starting");
    // 브리핑 '오늘 첫 수업'도 같은 함수 — 따로 조회·판정하지 않는다(같은 이름의 숫자는 같다).
    expect(SIGNALS).toMatch(/getDayArrivals\(\s*date,/);
    expect(SIGNALS).not.toContain("resolveDayArrivals(");
    expect(SIGNALS).not.toContain("loadDayEnrollmentRows(");
    expect(STUDENTS_PAGE).toContain("isValidYmd(sp.first)");
  });

  it("A4 — 새 과목은 programOf와 같은 묶음(subjectGroupOf) · 브리핑은 그 결과 전체(첫 등원 + 새 과목)", () => {
    expect(ARRIVALS).toContain("subjectGroupOf(subject, subjects)");
    expect(ARRIVALS).toContain("const starting = resolveFirstClasses(rows, today, subjects);");
    expect(ARRIVALS).not.toMatch(/kind === "first"/);
    expect(studentsFirstClassHref("2026-09-11")).toBe(
      "/students?first=2026-09-11&status=all&subject=all&grade=all&teacher=all&noenr=0&from=dashboard",
    );
  });

  it("D4 — 엑셀도 같은 집합으로 좁힌다(파일 행 = 목록 행)", () => {
    const ROUTE = src("src/app/api/exports/students/route.ts");
    expect(ROUTE).toContain("restrictIdsFor(");
    expect(ROUTE).toContain("restrict.has(row.id)");
    expect(STUDENTS_PAGE).toContain("...(program ? { program } : {})");
    expect(STUDENTS_PAGE).toContain("...(firstDay ? { first: firstDay } : {})");
  });
});

/**
 * 원장 2026-10-20: *"전일결석 -> 최근 결석 (최근 7일 반영)"* · *"학생별로 누적 결석 정렬"* · *"담당 누군지도 적어주고
 * (결석이 입력되었을때 수업하는 선생님)"*. 옛 '전일 결석'(어제 하루, 2026-09-12)을 어제까지 7일로 넓혔다.
 * 창이 표면마다 갈리면 카드 숫자와 팝업이 다른 기간을 말한다 — 그래서 "한 창"을 소스로 잠근다.
 */
describe("⑥ 최근 결석 — 어제까지 7일 · 카드·팝업이 같은 창 · 담당 = 출결 강사 귀속", () => {
  const ATTEND = src("src/app/(shell)/attendance/[date]/page.tsx");
  const POPUP = src("src/app/(shell)/dashboard/_overview/recent-absent-popup.tsx");
  const RECENT = src("src/features/dashboard/server/recent-absences.ts");
  const BRIEFING = src("src/features/dashboard/server/briefing.ts");

  it("창 = 어제까지 7일(KST · 오늘 제외) — 월·연 경계에서도", () => {
    expect(recentAbsenceRange("2026-09-12")).toEqual({ from: "2026-09-05", to: "2026-09-11" });
    expect(recentAbsenceRange("2026-10-01")).toEqual({ from: "2026-09-24", to: "2026-09-30" }); // 월 경계
    expect(recentAbsenceRange("2026-01-01")).toEqual({ from: "2025-12-25", to: "2025-12-31" }); // 연 경계
  });

  it("서버는 그 창으로 조회하고, 센 창을 데이터에 실어 보낸다", () => {
    expect(SERVER).toContain("const absentRange = recentAbsenceRange(today);");
    expect(SERVER).toContain("getScopedRecentAbsences(absentRange, await teacherIdPromise)");
    expect(SERVER).not.toContain("getScopedAbsentStudents(");
    expect(RECENT).toContain("return { from: range.from, to: range.to, students: [] };");
  });

  it("카드 보조 줄·팝업 머리·팝업 본문이 모두 서버가 센 창에서 나온다(↗는 없다)", () => {
    expect(STRIP).toContain("recentAbsent ? { from: recentAbsent.from, to: recentAbsent.to } : recentAbsenceRange(today)");
    expect(STRIP).toContain("popupTitle={`최근 7일 결석 (${absentWhen})`}");
    // 7일을 한 번에 보이는 출결 화면이 아직 없다 — 하루 결석 보기로 보내면 카드 숫자와 갈린다.
    const card = STRIP.slice(STRIP.indexOf('label="최근 결석"'), STRIP.indexOf('label="보강예정"'));
    expect(card).toContain("jump={null}");
    expect(card).not.toContain("absentDayHref(");
    // 팝업 본문도 창에서 만든다 — '어제'·'7일'을 결석 문구에 글자로 박으면 카드와 갈릴 수 있다.
    expect(POPUP).toContain("formatShortKoreanDate(data.from)");
    expect(POPUP).not.toMatch(/(오늘|어제)\s*(결석|한 교시도)/);
  });

  it("로드 스켈레톤은 실제 보조 줄과 같은 모양이다(기간 + 결석 횟수 + 연락 필요)", () => {
    const LOADING = src("src/app/(shell)/dashboard/loading.tsx");
    expect(LOADING).toMatch(/\["최근 결석",[^\]]*"[^"]*· 결석 0회 · 연락 필요 0명"/);
  });

  it("카드 라벨 = '최근 결석' — 색을 칠하는 CSS 선택자도 같은 글자다", () => {
    // 🔴 `data-kpi`는 라벨 문자열 **그대로**라 라벨만 고치면 카드 틴트가 조용히 빠진다(에러 없음) — 두 자리를 함께 잠근다.
    const CSS = read("src/app/(shell)/dashboard/_overview/appearance.module.css");
    expect(STRIP).toContain('label="최근 결석"');
    expect(CSS).toContain('[data-kpi="최근 결석"]');
    expect(CSS).not.toContain('[data-kpi="전일 결석"]');
    expect(STRIP).toContain('labelNote={noteOf("absent", "7일")}');
  });

  it("🔴 실패 문구가 기간을 지우지 않는다 — 기간은 detail이 아니라 접두로 넘긴다", () => {
    const CARD = src("src/app/(shell)/dashboard/_overview/kpi-card.tsx");
    expect(CARD).toContain("const text = detailPrefix ? `${detailPrefix} · ${body}` : body;");
    expect(STRIP).toContain("detailPrefix={absentWhen}");
    expect(STRIP).not.toContain("`${absentWhen} · 결석");
  });

  it("🔴 담당 = 그 칸을 가르친 사람(teacher-axis) — 입력한 사람(recorded_by)이 아니다 · 그날 담임은 이력으로 복원", () => {
    expect(RECENT).toContain("resolveRecordTaughtBy(");
    expect(RECENT).toContain("homeroomTeacherOnDate(");
    expect(RECENT).toContain("loadScopeFacts(");
    expect(RECENT).not.toContain("recorded_by");
    // 상태로 좁히지 않는다(정정 판정) — 결석 행은 학생 후보를 고르는 데만 쓰고, 판정은 그 학생들의 창 안 전 칸으로.
    expect(RECENT).toContain('.eq("status", "absent")');
    expect(RECENT).toContain("fetchAllPagedInChunks<RawRow>(studentIds");
  });

  it("출석부 결석 보기·브리핑 '어제 결석'은 그대로 하루 단위 판정(같은 함수)", () => {
    expect(ATTEND).toContain("getScopedAbsentStudents(date, teacherId)");
    expect(ATTEND).toContain("effectiveTeacherId()");
    expect(SIGNALS).toContain("getAbsentStudents(today, { supabase, tenantId: db?.tenantId })");
    expect(SIGNALS).toContain("absent.value.absent.map(");
    expect(absentDayHref("2026-09-11")).toBe("/attendance/2026-09-11?status=absent");
    // 🔑 남의 파일 문장을 글자 그대로 잠그지 않는다 — "브리핑이 **어제를 기준일로** 넘긴다"는 사실만 본다.
    expect(BRIEFING).toMatch(/yesterday\s*=\s*daysBefore\(\s*\w+\s*,\s*1\s*\)/);
    expect(BRIEFING).toMatch(/asOf:\s*\{[\s\S]{0,160}?date:\s*yesterday\b/);
    expect(SIGNALS).toMatch(/today\s*=\s*opts\?\.asOf\?\.date\s*\?\?\s*kstToday\(\)/);
  });
});

describe("A3 — 브리핑 항목 링크는 그 신호의 기준일로", () => {
  const ACTIONS = src("src/features/dashboard/today-actions.ts");

  it("결석·첫 수업·접수가 운영실 KPI와 같은 목적지를 기준일로 연다", () => {
    expect(ACTIONS).toContain("href: absentDayHref(raw.date)");
    expect(ACTIONS).toContain("href: studentsFirstClassHref(raw.date)");
    expect(ACTIONS).toContain("href: intakeDayHref(raw.date)");
    expect(SIGNALS).toContain("date: today,");
  });
});

describe("카드 구조 — ↗는 버튼 안에 들어가지 않는다", () => {
  const CARD = src("src/app/(shell)/dashboard/_overview/kpi-card.tsx");

  it("몸통은 DetailPopup 트리거(버튼), ↗는 그 밖의 형제 WindowLink", () => {
    expect(CARD).toContain('trigger={<button type="button" className={s.kpiBody} />}');
    expect(CARD.indexOf("</DetailPopup>")).toBeGreaterThan(0);
    expect(CARD.indexOf("<WindowLink")).toBeGreaterThan(CARD.indexOf("</DetailPopup>"));
  });

  it("아홉 칸(강좌수 2026-10-20)이 모두 같은 카드 부품을 쓰고, 열 수는 선 카드 수에서 나온다(D2)", () => {
    expect(count(STRIP, "<KpiCard")).toBe(9);
    expect(STRIP).toContain("style={kpiGridVars(shown)}");
  });
});

const LOADING = src("src/app/(shell)/dashboard/loading.tsx");
const OVERVIEW = src("src/app/(shell)/dashboard/_overview/overview.tsx");

/**
 * 원장 2026-09-14: *"대시보드에도 '보강예정' 카드 추가"* → 2026-09-16 *"오늘 기준으로 1달 이내로 바꿔줘"* ·
 * *"배선 오류 없이 아주 모든 곳에서 일치하도록"*. 창 = `monthAheadWindow` 한 함수(⑧ 일정 패널과 같은 끝 날짜) ·
 * 카드 = 팝업(같은 `rows`, 같은 `range`) · 반 집합(`listMakeupScopeClasses`)과 기간 조회(`getReservationsInRange`)는
 * 시간표 '보강' 탭과 **같은 두 함수**. 탭은 주 × 과목 격자라 ↗ 문구는 "주별로 보기"다.
 */
describe("⑦ 보강예정 — 오늘부터 한 달, 카드·팝업·시간표 보강 탭이 같은 반 집합·같은 조회", () => {
  const UPCOMING = src("src/features/dashboard/server/makeup-upcoming.ts");
  const QUERIES = src("src/features/attendance/server/makeup-reservation-queries.ts");
  const TIMETABLE = src("src/app/(shell)/timetable/page.tsx");
  const POPUPS_DAY = src("src/app/(shell)/dashboard/_overview/kpi-popups-day.tsx");

  it("서버는 강사 스코프를 넘겨 한 달 창(같은 함수)으로 센다 — 지난 미이행 ~ 창 끝을 한 조회로", () => {
    // 반별 창 뒤 예약 수(행 조회)는 과목 값이 필요할 때만 — 원장 화면은 건수 조회(head) 그대로.
    expect(SERVER).toContain("loadUpcomingMakeup(today, await teacherIdPromise, sliceSets.length > 0)");
    expect(UPCOMING).toContain("const range = monthAheadWindow(today);");
    // 반 집합(누구의 반인가)은 이번 주 — 시간표 탭이 이번 주에 고르는 반과 같다(한 달로 넓히면 남의 반이 섞인다).
    expect(UPCOMING).toContain("listMakeupScopeClasses(teacherId, weekBoundsOf(today))");
    expect(UPCOMING).toContain("getReservationsInRange(shiftDays(today, -OVERDUE_LOOKBACK_DAYS), range.end, classIds)");
    expect(UPCOMING).toContain("countLaterByClass(supabase, range.end, classIds)");
    expect(UPCOMING).toContain(": countLater(supabase, range.end, classIds).catch(() => 0)");
    expect(UPCOMING).toContain('.select("id", { count: "exact", head: true })');
    expect(UPCOMING).toContain("overdue: r.makeupDate < today,");
    expect(UPCOMING).toContain("return { overview: { range, rows, later: total }, subjectOf: new Map(classes.map((c) => [c.id, c.subject])), laterByClass: typeof later === \"number\" ? new Map() : later };");
    // 옛 주 조회가 남아 있으면 카드와 팝업이 다른 기간을 말한다.
    expect(UPCOMING).not.toContain("getReservationsInWeek");
    // 이름 조회 실패를 빈 배열로 삼키면 카드가 "0건"이라는 거짓을 말한다 — 던져서 칸이 '조회 실패'로 서야 한다.
    expect(UPCOMING).not.toMatch(/from\("students"\)[\s\S]{0,120}\.catch\(/);
  });

  it("시간표 보강 탭도 같은 반 집합 함수 + 같은 기간 조회(주 범위로 좁히고 과목 축만 더한다)", () => {
    expect(TIMETABLE).toContain("listMakeupScopeClasses(teacherId ?? null, weekBoundsOf(referenceDate))");
    expect(TIMETABLE).toContain("getReservationsInWeek(referenceDate, [...classMeta.keys()])");
    expect(TIMETABLE).toContain("const makeupTab = isMakeupKind(kind);");
    // 주 조회는 기간 조회 한 벌을 부를 뿐이다 — 세는 법(상태·정렬·페이지)이 둘로 갈리지 않게.
    const week = QUERIES.slice(QUERIES.indexOf("export async function getReservationsInWeek"));
    expect(week.slice(0, week.indexOf("\n}"))).toContain("return getReservationsInRange(start, end, classIds);");
  });

  it("카드는 맨 뒤(원장 '가장 끝으로'), 보조 줄·팝업이 서버가 센 창을 읽고, ↗는 보강 탭(주별)", () => {
    expect(STRIP.indexOf('label="보강예정"')).toBeGreaterThan(STRIP.indexOf('label="최근 결석"'));
    expect(STRIP).toContain('data-kpi-n={shown}');
    expect(STRIP).toContain("value={count(makeup?.rows.length)}");
    expect(STRIP).toContain("windowUntilLabel(makeup?.range ?? monthAheadWindow(today))");
    expect(STRIP).toContain("detailPrefix={makeupUntil}");
    expect(STRIP).toContain('label: "시간표 보강 탭에서 주별로 보기"');
    expect(POPUPS_DAY).toContain("const until = windowUntilLabel(data.range);");
    expect(POPUPS_DAY).toContain('<PopupTotal label={`${until} 보강 예약`} value={rows.length} unit="건" />');
    expect(makeupWeekHref()).toBe("/timetable?kind=makeup");
    // 옛 '이번 주' 문구가 한 곳이라도 남으면 카드와 팝업이 다른 창을 말한다.
    for (const [name, text] of [["kpi-strip", STRIP], ["kpi-popups-day", POPUPS_DAY], ["loading", LOADING]] as const) {
      expect(text, name).not.toMatch(/이번 주 보강|이번 주\(월~일\) 예약|다음 주 이후|"이번 주 · /);
    }
  });
});

/**
 * 원장 2026-09-16: '레벨테스트 및 첫수업 일정'도 *"오늘 기준으로 1달 이내"*(그전엔 7일). 서버 조회 창·첫 수업 연결 후보 창·
 * 패널 머리·빈 문구가 **같은 함수**(`monthAheadWindow`)를 지나야 한다 — 하나라도 7일이면 "일정 없음"이 거짓말이 된다.
 */
describe("⑧ 레벨테스트 및 첫수업 일정 — 오늘부터 한 달, 서버·패널·빈 문구가 같은 창", () => {
  it("서버: 일정 조회 구간·필터·첫 수업 후보가 모두 한 달 창의 끝을 쓴다", () => {
    expect(SERVER).toContain("const { end } = monthAheadWindow(today);");
    // 구간 한 번 — 달 단위(getMonthEvents)로 받으면 창이 두 달에 걸치는 날마다 조회가 두 벌이다.
    // 시작은 어제(KPI '전일 입테' — 원장 2026-10-22) · 어제 줄은 입테만, 패널은 `upcomingAdmissionsRows`로 오늘부터.
    expect(SERVER).toContain("const result = await getDateRangeEvents(prevFrom, end);");
    expect(SERVER).not.toContain("getMonthEvents");
    expect(SERVER).toContain("upcomingAdmissionsEvents(result.events, prevFrom, end)");
    expect(SERVER).toContain("firstClassCandidates(today, end)");
    expect(SERVER).toContain("firstClassScheduleCandidates(today, end)");
    expect(SERVER).not.toContain("shiftDate(today, 6)");
  });

  it("화면: 머리·빈 문구가 같은 오늘로 같은 함수를 부르고, 7일 문구가 어디에도 없다", () => {
    expect(OVERVIEW).toContain("const admissionsRange = monthAheadWindow(snapshot.today);");
    expect(OVERVIEW).toContain("note={monthAheadNote(admissionsRange)}");
    expect(OVERVIEW).toContain("오늘부터 {windowUntilLabel(admissionsRange)} 레벨테스트·첫 수업 일정이 없습니다.");
    for (const [name, text] of [["overview", OVERVIEW], ["loading", LOADING]] as const) {
      expect(text, name).not.toMatch(/오늘부터 7일|다가오는 7일/);
    }
    expect(LOADING).toContain('note: "오늘부터 한 달 · 10/15 (목)까지"');
  });
});

// 원장 2026-10-20 "상세 눌렀을때 추이를 볼 수 없는곳 모두 추가해보자"
describe("운영실 '상세' → 통계 화면", () => {
  it("추이를 보는 화면으로 가고, 과목 관리자가 고른 과목을 싣는다", () => {
    expect(intakeTrendHref()).toBe("/enrollment?view=stats&trend=day&from=dashboard#intake");
    expect(billingStatsHref("math")).toBe("/billing/stats?subject=math#billing");
    expect(firstClassTrendHref("english")).toBe("/students/stats?fc=day&subject=english#first");
    expect(attendanceStatsHref(null)).toBe("/attendance/stats#rate");
    expect(expenseStatsHref()).toBe("/billing/stats#expenses");
    // 상담 통계는 과목 묶음으로 거를 수 없어 과목을 싣지 않는다(대표 키 하나로 거르면 같은 묶음의 다른 과목 상담이 빠진다).
    expect(consultationStatsHref()).toBe("/consultations/stats");
    expect(reportStatsHref("math")).toBe("/lesson-reports/stats?subject=math#reports");
    expect(consultProgressStatsHref()).toBe("/enrollment?view=stats&from=dashboard#progress");
    expect(newcomerStatsHref()).toBe("/newcomers/stats#history");
  });
});

describe("원생 통계 상세 — 고른 과목을 싣고 강사 화면은 원생목록으로(리뷰 2026-10-21)", () => {
  it("과목 관리자가 고른 과목 · 보기 · 강사 화면", async () => {
    const { studentsStatsHref, studentsEnrolledHref, admissionsStatsHref } = await import("./kpi-links");
    expect(studentsStatsHref("trend")).toBe("/students/stats#trend");
    expect(studentsStatsHref("trend", { view: "mix" })).toBe("/students/stats?view=mix#trend");
    expect(studentsStatsHref("courses", { subject: "english" })).toBe("/students/stats?subject=english#courses");
    expect(studentsStatsHref("trend", { view: "subject", subject: "math" })).toBe("/students/stats?view=subject&subject=math#trend");
    expect(studentsStatsHref("flow", { teacherView: true })).toBe(studentsEnrolledHref());
    expect(admissionsStatsHref()).toBe("/enrollment?view=stats&from=dashboard#conversion");
  });
});
