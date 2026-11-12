import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 프리랜서 명세서의 수업료 = 그 강사 출석부(강사 전체 보기)의 실급여 합계(원장 2026-10-06 *"전부 통일 출석부 그대로"* · *"프리랜서만."*).
 *
 * 화면(`attendance/page.tsx`)과 명세서 조립(`server/teacher-sheet.ts`)은 따로 도는 코드다 — 같은 조회를 같은 인자로 부르지 않으면
 * 화면 합계와 명세서 금액이 갈린다. 여기서 두 곳의 **호출 모양**을 잠근다(한쪽만 고치면 이 시험이 먼저 깨진다).
 */
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const page = read("src/app/(shell)/attendance/page.tsx");
const sheet = read("src/features/attendance/server/teacher-sheet.ts");
const flat = (s: string) => s.replace(/\s+/g, " ");

describe("강사 전체 보기 조립 — 화면과 명세서가 같은 호출을 한다", () => {
  it("반 목록은 두 곳 모두 `teacherSheetClasses` 한 벌(담임 ∪ 교시 담당 ∪ 그 달의 이전 담임 − 그 달 뒤에 담임이 된 반)", () => {
    expect(page).toContain("teacherSheetClasses({");
    expect(sheet).toContain("teacherSheetClasses({");
    // 화면이 판정을 손으로 다시 적지 않는다.
    expect(page).not.toContain("homeroomStartsAfter(");
    expect(page).not.toMatch(/function classTaughtBy\(/);
  });

  it("칸은 그 강사 교시만 — 달력월 · 강사 렌즈 · 담임 시작일", () => {
    expect(flat(page)).toContain('getMonthlyAttendanceMatrix(month, c.id, "month", effectiveTeacher, sinceByClass.get(c.id) ?? null)');
    expect(flat(sheet)).toContain('getMonthlyAttendanceMatrix(month, c.id, "month", teacherId, scope.sinceByClass.get(c.id) ?? null)');
  });

  it("청구액·등록 차수·단가는 같은 조회에 같은 강사 몫 판정(영어 반 = 교시 담당별 배분)", () => {
    for (const src of [page, sheet]) {
      const s = flat(src);
      expect(s).toContain('attendanceUnitSuffix(c.subject, operations.subjects) === "U").map((c) => c.id)');
      expect(s).toContain("holidays: Object.keys(buildHolidayMap(operations.holidays))");
      expect(s).toContain("getAttendanceClassBilledAmounts(month,");
    }
    expect(flat(sheet)).toContain("homeroomSinceByClass: Object.fromEntries(scope.sinceByClass)");
    expect(flat(page)).toContain("Object.fromEntries(sinceByClass)");
  });

  it("보이지 않는 '보강' 반 묶음도 같은 사슬 — 찾기 → 명단(반 전체) → 그 명단의 청구 판정(허용 반)", () => {
    for (const src of [page, sheet]) {
      const s = flat(src);
      expect(s).toMatch(/findMakeupPoolClass\(/);
      expect(s).toMatch(/getMonthlyAttendanceMatrix\(month, (makeupPoolClassId|poolId), "month", null, null, (makeupPoolClassId|poolId)\)/);
      expect(s).toMatch(/allowClassIds: \[(makeupPoolClassId|poolId)\]/);
      expect(s).toContain("mergeAttendanceClassBilling(");
    }
  });

  it("🔴 명세서 조립은 금액이다 — 보는 사람의 강사 렌즈·접힌 재료를 그대로 쓰지 않고 멈춘다", () => {
    const s = flat(sheet);
    // 아래 조회들은 보는 사람의 강사 렌즈로 반을 좁힌다 — 대상 강사와 다르면 부분 금액이 오류 없이 나온다.
    // 로그인 없는 조립 문맥(강사평가 밤 집계)은 렌즈가 없고 다른 지점은 조립하지 않는다(read-context.ts).
    expect(s).toContain("const lens = readCtx ? null : await effectiveTeacherId(); if (lens && lens !== teacherId) { throw new TeacherSheetError(");
    expect(s).toContain("if (readCtx && readCtx.tenantId !== tenantId) throw new TeacherSheetError(");
    // 화면은 접지만 돈은 접힌 재료로 계산하지 않는다: 담임 이력 · 대신 보강 귀속 · 보강 반 · 청구 조회(이월·보강 반 청구).
    expect(s).toContain("if (sinceIdx.incomplete) throw new TeacherSheetError(");
    expect(s).toContain('if (taughtBy === "unknown") throw new TeacherSheetError(');
    expect(s).toContain("findMakeupPoolClass(tenantId, teacherId, { strict: true })");
    // 접힌 재료 — 학원 설정·반 목록·반별 매트릭스·보강 반 매트릭스·청구 조회를 전부 확인한다(행동은 server/teacher-sheet.test.ts).
    expect(s).toContain("stopIfFolded([foldedReason(settings), ...(base.degraded ?? [])]);");
    expect(s).toContain("stopIfFolded(matrices.flatMap((m) => m.degraded ?? []));");
    expect(s).toContain("stopIfFolded(matrix?.degraded ?? []);");
    expect(s).toContain("stopIfFolded(billing.degraded ?? []);");
    // 화면은 종전대로 접는다(표를 살린다) — strict는 돈 경로만.
    expect(flat(page)).toContain("findMakeupPoolClass(user.tenantId, effectiveTeacher)");
  });

  it("정산액 안내는 정산액을 그리는 표에만 — 프리랜서 표(실급여)는 명세서와 반대 사실을 말하지 않는다", () => {
    const totals = flat(read("src/app/(shell)/attendance/_components/totals-row.tsx"));
    expect(totals).toContain("{showLegacySettlement && settlementNote ?");
    const p = flat(page);
    expect(p).toMatch(/const settlementNote = \[ money && outsideUnits > 0 \? sheetTf\(lang, "att\.moneyNote\.substitute"/);
    expect(p).toContain("settlementNote={settlementNote}");
    // 회차 정산이 꺼진 학원엔 이월 표식도 없다.
    expect(p).toContain("carryMarksByRow={sessionBillingOn ? classBilledAmounts.carryMarks : {}}");
    // 담당 반 학생이 0명이어도 보강 묶음이 있으면 표를 세운다(그 줄의 실급여가 명세서에 들어간다).
    expect(p).toContain("const sheetEmpty = totalStudents === 0 && !makeupGroup;");
    // 빈 화면 판정은 세 곳이 같은 값을 본다 — 한 곳이라도 `totalStudents === 0`으로 되돌아가면 보강 묶음만 있는 표가 가려진다.
    expect(p).toContain("const gridShown = allGroups.length > 0 && !sheetEmpty;");
    expect(p).toContain("allGroups.length === 0 || sheetEmpty ? []");
    expect(p).toMatch(/\) : sheetEmpty \? \(/);
    expect(p.split("totalStudents === 0").length - 1).toBe(1); // 정의 한 곳뿐 — 판정을 다시 적은 자리가 없다
    // 🔴 강사 보기는 표에 설 반이 0개여도 요약 허브로 떨어지지 않는다 — 빈 상태 + 대신 보강 목록.
    expect(p).toContain('const hubShown = allGroups.length === 0 && mode !== "teacher";');
    expect(p).toContain("{hubShown ? (");
    expect(p.split("<SubstituteCellsNote cells={substituteCells} lang={lang} />").length - 1).toBe(2);
  });

  it("실급여 식은 한 곳(`salary-rates.ts`) — 화면 합계 칸과 명세서 조립이 같은 함수를 부른다", () => {
    const totals = read("src/app/(shell)/attendance/_components/live-totals.tsx");
    const pure = read("src/features/attendance/sheet-salary.ts");
    for (const src of [totals, pure]) {
      expect(src).toContain("actualLessonSalary(");
      expect(src).toContain("salaryBilledCap(");
      expect(src).toContain("sumSalaryAmounts(");
    }
    // 회차 정산이 꺼진 학원은 화면 prop을 undefined로 보내 단가 열 자체를 세우지 않고, 명세서 계산도 빈 재료를 쓴다.
    expect(flat(page)).toContain("confirmedPricesByRow={sessionBillingOn ? classBilledAmounts.confirmedPrices : undefined}");
    expect(flat(page)).toContain("termSessionsByRow={sessionBillingOn ? classBilledAmounts.confirmedSessions : undefined}");
    expect(flat(page)).toContain("priceConfirmedRows={sessionBillingOn ? classBilledAmounts.priceConfirmed : undefined}");
    expect(flat(sheet)).toContain("prices: sheet.sessionBillingOn ? sheet.billing.confirmedPrices : {}");
  });
});
