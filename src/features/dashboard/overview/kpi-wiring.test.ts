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
  absentDayHref,
  absentKpiDate,
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
    expect(SERVER).toContain("enrolledSubjectCounts(rows, scope, today)");
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
    expect(src("src/features/students/enrolled-composition.ts")).toContain(
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
    expect(src("src/features/students/subject-enrollment-summary.ts")).not.toMatch(/concurrent\s*[:=]/);
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
    const PURE = src("src/features/students/enrolled-composition.ts");
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

describe("② 퇴원생 — 1일~오늘, 카드 = 추이 패널 = 퇴원관리", () => {
  const PAGE = src("src/app/(shell)/withdrawals/page.tsx");
  const QUERIES = src("src/features/withdrawals/server/queries.ts");
  const WINDOW = src("src/features/withdrawals/server/window.ts");
  const EXIT_ROWS = src("src/features/withdrawals/exit-rows.ts");

  it("카드와 추이 패널은 **같은 행**(getWithdrawalsInWindow 한 번)을 쓰고, 카드는 같은 창 판정으로 거른다", () => {
    expect(count(SERVER, "getWithdrawalsInWindow(")).toBe(1);
    expect(SERVER).toContain("withdrawalMonthWindow(month, today)");
    expect(SERVER).toMatch(/inWithdrawalWindow\(\{ withdrawnAt: row\.withdrawnAt, systemBulk: false \}, win\.from, win\.to\)/);
    expect(SERVER).toContain("withdrawn.map((r) => r.withdrawnAt)");
    expect(SERVER).not.toContain("datedWithdrawals");
    expect(WINDOW).toMatch(/inWithdrawalWindow\(/);
  });

  it("퇴원관리 range=month·program=은 같은 판정(withdrawalMonthWindow·inWithdrawalWindow·withdrawalProgram)", () => {
    // 2026-09-28 퇴원·수강종료 한 목록 — 기간 판정은 exit-rows.ts `inRange`가 같은 `inWithdrawalWindow`를 부른다.
    expect(PAGE).toContain("withdrawalMonthWindow(monthKey, today)");
    expect(PAGE).toContain("resolveRange(range, { today, month: monthWindow");
    expect(EXIT_ROWS).toMatch(/inWithdrawalWindow\(\{ withdrawnAt: row\.date, systemBulk: row\.systemBulk \}, w\.from, w\.to\)/);
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
    expect(withdrawalsMonthHref("2026-09")).toBe("/withdrawals?type=withdrawn&range=month&month=2026-09");
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
    expect(SERVER).toContain('select("id,enrolled_at,notes")');
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

  it("C3 — 월별 결과 분포는 실패를 0건으로 위장하지 않는다(fetchAllPaged = throw)", () => {
    const fn = QUERIES.slice(QUERIES.indexOf("export async function getMonthlyOutcomeDistribution"));
    expect(fn.slice(0, 900)).toContain("fetchAllPaged");
    expect(fn.slice(0, 900)).not.toContain("data ?? []");
  });
});

describe("④ 금일입테 — 분류기 한 벌, ↗ 없음", () => {
  it("서버가 단일 분류기로 종류를 싣고, 카드·팝업은 todayLevelTestList 한 번의 결과를 같이 쓴다", () => {
    expect(SERVER).toContain("kind: admissionsEventKind(event)");
    expect(count(STRIP, "todayLevelTestList(")).toBe(1);
    expect(STRIP).not.toContain("todayLevelTests(");
    expect(STRIP).toContain("<LevelTestPopup list={levelTests} />");
    expect(STRIP).not.toContain("/calendar");
  });

  // 원장 2026-09-30 — 취소된 입테는 목록엔 취소선, 숫자엔 없다.
  it("카드 숫자 = 살아 있는 입테(active), 취소는 보조 줄 '취소 N'으로만", () => {
    expect(STRIP).toContain("value={count(levelTests?.active.length)}");
    expect(STRIP).toContain("`취소 ${number(levelTests.cancelled)}`");
    const POPUPS_DAY = src("src/app/(shell)/dashboard/_overview/kpi-popups-day.tsx");
    expect(POPUPS_DAY).toContain('<PopupTotal label="오늘 레벨테스트" value={list.active.length} unit="건" />');
  });

  it("취소된 일정은 서버가 kind=null + cancelledKind로 싣고 반·콜&상담 연결을 붙이지 않는다", () => {
    const cancelledBranch = SERVER.slice(SERVER.indexOf("if (isCancelledEventTitle(event.title)) {"));
    expect(cancelledBranch.slice(0, 600)).toContain("kind: null,");
    expect(cancelledBranch.slice(0, 600)).toContain("cancelledKind: admissionsEventBaseKind(event),");
    expect(cancelledBranch.slice(0, 600)).toContain("matchedConsultation: null,");
    // 반·상담 연결 조회는 살아 있는 일정만.
    expect(SERVER).toContain("consultationBasesInTitles(live, consultations, notNames)");
  });

  it("'전체 N개 일정 보기'도 같은 축 — 살아 있는 일정만 세고 취소는 ' · 취소 N'으로 따로", () => {
    const OVERVIEW_SRC = src("src/app/(shell)/dashboard/_overview/overview.tsx");
    expect(OVERVIEW_SRC).toContain("filter((event) => !isCancelledAdmissionsRow(event)).length}개 일정 보기${cancelledSuffix(");
    expect(OVERVIEW_SRC).not.toContain("전체 ${v.calendar!.data!.length}개 일정 보기");
  });
});

/**
 * 원장 2026-09-23: *"금일 등록 카드를 최상단에 추가 … 금일 입테 우측에"* → *"콜&상담에서 등록 완료로 이동한 학생을 오늘날짜 기준으로"*.
 * 옮긴 시각은 상태 변경 감사로그뿐이라, **등록 완료로 옮기는 두 경로가 모두 그 로그를 남겨야** 카드가 안 빈다.
 */
describe("④-2 금일 등록 — 등록 완료로 옮긴 로그 한 벌, 반 배정은 칸반과 같은 함수", () => {
  const QUERY = src("src/features/dashboard/server/enrolled-today.ts");
  const ACTIONS = src("src/features/enrollment/server/actions.ts");
  it("카드·팝업이 같은 서버 배열, 자리는 금일입테 오른쪽", () => {
    expect(SERVER).toContain('add("enrolledToday", ["enrollment"], () => getEnrolledToday(today));');
    expect(STRIP).toContain("<EnrolledTodayPopup rows={registered}");
    expect(STRIP.indexOf('label="금일 등록"')).toBeGreaterThan(STRIP.indexOf('label="금일 입테"'));
    expect(STRIP.indexOf('label="금일 등록"')).toBeLessThan(STRIP.indexOf('label="오늘첫수업"'));
  });
  it("등록 완료로 옮기는 두 경로(상태 변경·수업 배정)가 같은 로그를 남긴다", () => {
    expect(count(ACTIONS, 'action: "enrollment_consultation_outcome"')).toBe(2);
    expect(ACTIONS).toContain('to: "enrolled", via: "convert"');
    expect(QUERY).toContain('systemAuditScope(["enrollment_consultation_outcome"])');
    expect(QUERY).toContain('.eq("metadata->>to", "enrolled")');
  });
  it("반 배정 판정은 칸반 카드 표식과 같은 countAssignedClasses · 지금도 등록 완료인 상담만", () => {
    expect(QUERY).toContain("countAssignedClasses(db, row.student_id");
    expect(QUERY).toContain('row.outcome === "enrolled"');
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
 * 원장 2026-09-12: *"대시보드 결석학생은 어제 결석으로 해야지. 오늘은 수업을 안하면 볼 수가 없잖아"*.
 * 기준일이 표면마다 갈리면 **카드 숫자와 ↗로 연 화면이 다른 날**을 보여준다 — 그래서 "어제 한 값"을 소스로 잠근다.
 */
describe("⑥ 전일 결석 — 어제 기준으로 카드·팝업·↗·브리핑이 같은 날", () => {
  const ATTEND = src("src/app/(shell)/attendance/[date]/page.tsx");
  const POPUPS_DAY = src("src/app/(shell)/dashboard/_overview/kpi-popups-day.tsx");
  const BRIEFING = src("src/features/dashboard/server/briefing.ts");

  it("기준일 = 어제(KST) — 월·연 경계에서도", () => {
    expect(absentKpiDate("2026-09-12")).toBe("2026-09-11");
    expect(absentKpiDate("2026-10-01")).toBe("2026-09-30"); // 월 경계
    expect(absentKpiDate("2026-01-01")).toBe("2025-12-31"); // 연 경계
  });

  it("서버는 그 날짜로 조회하고, 조회한 날을 데이터에 실어 보낸다(오늘로 조회하지 않는다)", () => {
    expect(SERVER).toContain("const absentDate = absentKpiDate(today);");
    expect(SERVER).toContain("getScopedAbsentStudents(absentDate, await teacherIdPromise)");
    expect(SERVER).toContain("date: absentDate,");
    expect(SERVER).not.toContain("getScopedAbsentStudents(today");
  });

  it("카드 보조 줄·팝업 머리·↗ aria·팝업 본문이 모두 그 한 값에서 나온다", () => {
    expect(STRIP).toContain("const absentDate = absentDay?.date ?? absentKpiDate(today);");
    expect(STRIP).toContain("const absentWhen = `어제 ${formatShortKoreanDate(absentDate)}`;");
    expect(STRIP).toContain("popupTitle={`${absentWhen} 결석 학생`}");
    expect(STRIP).toContain("label: `출석부에서 ${absentWhen} 결석 학생 보기`");
    expect(STRIP).toContain("absentDayHref(absentDate)");
    expect(STRIP).not.toContain("absentDayHref(today)");
    // 팝업 본문도 기준일에서 만든다 — 날짜 말("오늘"·"어제")을 글자로 박으면 카드와 갈릴 수 있다.
    // (신규문의·금일입테 팝업의 '오늘'은 그대로 맞다 — 결석 문구만 본다.)
    expect(POPUPS_DAY).toContain("formatShortKoreanDate(day.date)");
    expect(POPUPS_DAY).not.toMatch(/(오늘|어제)\s*(결석|한 교시도)/);
  });

  it("로드 스켈레톤은 **흔한 경우**와 같은 모양이다(기준일 + 항목 셋)", () => {
    // '일부 교시'는 실측상 거의 매일 있다(09-09 11명 · 09-10 5명 · 09-11 1명) — 그 꼬리를 빼면
    // 흔한 날마다 보조 줄이 한 줄 늘어 로드 끝에 여섯 칸이 함께 내려앉는다.
    const LOADING = src("src/app/(shell)/dashboard/loading.tsx");
    expect(LOADING).toMatch(/\["전일 결석",[^\]]*"어제 [^"]*· 연락 필요 0 · 사전 통보 0 · 일부 교시 0"/);
  });

  it("카드 라벨 = '전일 결석' — 색을 칠하는 CSS 선택자도 같은 글자다", () => {
    // 원장 2026-09-12: *"결석학생 어제 라고 되어있는 상단 메뉴를 전일 결석으로 교체"*.
    // 🔴 `data-kpi`는 라벨 문자열 **그대로**라 라벨만 고치면 카드 틴트가 조용히 빠진다(에러 없음) — 두 자리를 함께 잠근다.
    const CSS = read("src/app/(shell)/dashboard/_overview/appearance.module.css");
    expect(STRIP).toContain('label="전일 결석"');
    expect(CSS).toContain('[data-kpi="전일 결석"]');
    expect(CSS).not.toContain('[data-kpi="결석학생"]');
    // 라벨이 이미 '전일'을 말하니 같은 말을 꼬리표로 덧붙이지 않는다(다른 칸의 꼬리표는 막지 않는다).
    expect(STRIP).not.toContain('labelNote="어제"');
  });

  it("🔴 실패 문구가 기준일을 지우지 않는다 — 기준일은 detail이 아니라 접두로 넘긴다", () => {
    const CARD = src("src/app/(shell)/dashboard/_overview/kpi-card.tsx");
    // 갱신 한 번 실패하면 detail이 통째로 대체된다 — 그때 '어제'가 사라지면 형제 다섯 칸(오늘) 사이에서
    // 어제 숫자가 오늘 결석으로 읽힌다.
    expect(CARD).toContain("const text = detailPrefix ? `${detailPrefix} · ${body}` : body;");
    expect(STRIP).toContain("detailPrefix={absentWhen}");
    expect(STRIP).not.toContain("`${absentWhen} · 연락 필요");
  });

  it("카드·출석부는 강사 스코프를 건 같은 함수, 브리핑은 같은 판정(학원 전체)의 결석 무리만", () => {
    expect(ATTEND).toContain("getScopedAbsentStudents(date, teacherId)");
    expect(ATTEND).toContain("effectiveTeacherId()");
    expect(SIGNALS).toContain("getAbsentStudents(today, { supabase, tenantId: db?.tenantId })");
    expect(SIGNALS).toContain("absent.value.absent.map(");
    expect(absentDayHref("2026-09-11")).toBe("/attendance/2026-09-11?status=absent");
  });

  it("브리핑 '어제 결석'도 같은 날 — asOf=어제 수집분이 같은 판정 함수로 흐른다", () => {
    // 🔑 남의 파일 문장을 글자 그대로 잠그지 않는다(필드가 하나 늘거나 줄바꿈만 바뀌어도 이 가드가 깨진다) —
    //    "브리핑이 **어제를 기준일로** 넘긴다"는 사실만 본다.
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

  it("여덟 칸이 모두 같은 카드 부품을 쓰고, 열 수는 선 카드 수에서 나온다(D2)", () => {
    expect(count(STRIP, "<KpiCard")).toBe(8);
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
    expect(SERVER).toContain("getUpcomingMakeupOverview(today, await teacherIdPromise)");
    expect(UPCOMING).toContain("const range = monthAheadWindow(today);");
    // 반 집합(누구의 반인가)은 이번 주 — 시간표 탭이 이번 주에 고르는 반과 같다(한 달로 넓히면 남의 반이 섞인다).
    expect(UPCOMING).toContain("listMakeupScopeClasses(teacherId, weekBoundsOf(today))");
    expect(UPCOMING).toContain("getReservationsInRange(shiftDays(today, -OVERDUE_LOOKBACK_DAYS), range.end, classIds)");
    expect(UPCOMING).toContain("countLater(supabase, range.end, classIds)");
    expect(UPCOMING).toContain("overdue: r.makeupDate < today,");
    expect(UPCOMING).toContain("return { range, rows, later };");
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
    expect(STRIP.indexOf('label="보강예정"')).toBeGreaterThan(STRIP.indexOf('label="전일 결석"'));
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
    expect(SERVER).toContain("const result = await getDateRangeEvents(today, end);");
    expect(SERVER).not.toContain("getMonthEvents");
    expect(SERVER).toContain("upcomingAdmissionsEvents(result.events, today, end)");
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
