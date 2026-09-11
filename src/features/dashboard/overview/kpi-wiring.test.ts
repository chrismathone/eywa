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
  intakeDayHref,
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
    expect(SERVER).toContain("countEnrolledStudents(db, scope)");
    expect(SERVER).toContain("fetchActiveEnrolledEnrollments(db)");
    expect(SERVER).toContain("enrolledSubjectCounts(rows, scope)");
    expect(SERVER).toMatch(/composeEnrolled\(\{/);
    expect(SERVER).toContain("gradeSplit(visible, composition.programs, settings.operations.gradeLevels)");
    expect(SERVER).toContain("concurrent: programs.both");
  });

  it("원생목록 상단 카드·program= 필터도 같은 순수 집계를 지난다", () => {
    expect(QUERIES).toContain("countEnrolledStudents(supabase, teacherScope)");
    expect(QUERIES).toContain("enrolledSubjectCounts(ens, teacherScope)");
    expect(COMPOSITION).toMatch(/composeEnrolled\(\{ students, rows, scope, subjects: settings\.operations\.subjects \}\)/);
    expect(STUDENTS_PAGE).toContain("restrictIdsFor(program, firstDay)");
    expect(STUDENTS_PAGE).toContain("restrictIds");
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

  it("카드와 추이 패널은 **같은 행**(getWithdrawalsInWindow 한 번)을 쓰고, 카드는 같은 창 판정으로 거른다", () => {
    expect(count(SERVER, "getWithdrawalsInWindow(")).toBe(1);
    expect(SERVER).toContain("withdrawalMonthWindow(month, today)");
    expect(SERVER).toMatch(/inWithdrawalWindow\(\{ withdrawnAt: row\.withdrawnAt, systemBulk: false \}, win\.from, win\.to\)/);
    expect(SERVER).toContain("withdrawn.map((r) => r.withdrawnAt)");
    expect(SERVER).not.toContain("datedWithdrawals");
    expect(WINDOW).toMatch(/inWithdrawalWindow\(/);
  });

  it("퇴원관리 range=month·program=은 같은 판정(withdrawalMonthWindow·inWithdrawalWindow·withdrawalProgram)", () => {
    expect(PAGE).toContain("withdrawalMonthWindow(monthKey, kstToday())");
    expect(PAGE).toMatch(/inWithdrawalWindow\(r, monthWindow\.from, monthWindow\.to\)/);
    expect(PAGE).toMatch(/withdrawalProgram\(r, settings\.operations\.subjects\)/);
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
    expect(withdrawalsMonthHref("2026-09")).toBe("/withdrawals?range=month&month=2026-09");
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
  it("서버가 단일 분류기로 종류를 싣고, 카드·팝업은 todayLevelTests 한 번의 결과를 같이 쓴다", () => {
    expect(SERVER).toContain("kind: admissionsEventKind(event)");
    expect(count(STRIP, "todayLevelTests(")).toBe(1);
    expect(STRIP).toContain("<LevelTestPopup events={levelTests} />");
    expect(STRIP).not.toContain("/calendar");
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

describe("⑥ 결석학생 — 카드·출석부·브리핑이 같은 함수", () => {
  const ATTEND = src("src/app/(shell)/attendance/[date]/page.tsx");

  it("카드·출석부는 강사 스코프를 건 같은 함수, 브리핑은 같은 판정(학원 전체)의 결석 무리만", () => {
    expect(SERVER).toContain("getScopedAbsentStudents(today, await teacherIdPromise)");
    expect(ATTEND).toContain("getScopedAbsentStudents(date, teacherId)");
    expect(ATTEND).toContain("effectiveTeacherId()");
    expect(SIGNALS).toContain("getAbsentStudents(today, { supabase, tenantId: db?.tenantId })");
    expect(SIGNALS).toContain("absent.value.absent.map(");
    expect(absentDayHref("2026-09-11")).toBe("/attendance/2026-09-11?status=absent");
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

  it("여섯 칸이 모두 같은 카드 부품을 쓰고, 열 수는 선 카드 수에서 나온다(D2)", () => {
    expect(count(STRIP, "<KpiCard")).toBe(6);
    expect(STRIP).toContain("style={kpiGridVars(shown)}");
  });
});
