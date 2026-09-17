/**
 * 출결의 **강사 귀속 축이 화면마다 갈라지는 것**을 막는 회귀 테스트 (2026-08-18).
 *
 * 배경: 축이 셋(담임 `classes.teacher_id` / 교시 담당 `class_schedules.teacher_id` / 입력자
 * `attendance_records.recorded_by`)인데 화면마다 다른 축을 골라 썼다.
 *  · 월간 출석부  = 담임뿐  → 교시 담당 강사의 출석부가 통째로 비었다(Florence Park: 담임 0반·교시 5반).
 *  · 당일 출결 보드 = 교시 담당 → 없으면 담임(맞는 규칙인데 **인라인**이라 다른 화면이 못 따라 썼다).
 * → 규칙은 `teacher-axis.ts` 한 곳에만 두고, 표시·스코프 소비처는 전부 그 모듈을 거친다.
 *
 * ⚠️ **일부러 대상에서 뺀 곳 = 돈**(`server/teacher-money.ts` · `payroll/server/payslip-queries.ts`).
 *    금액·정산액은 여전히 **담임 축**이다 — 시트 대조로 맞춰 둔 프리랜서 4인 금액과 골든마스터가
 *    그 집합에 걸려 있어서다(`teaching-scope-single-source.test.ts`의 같은 예외와 짝). 교시 축 배분은
 *    별건이고, 그 사실은 출석부 합계 줄(moneyNote)이 화면에 밝힌다.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const AXIS_MODULE = "@/features/attendance/teacher-axis";

/** 주석은 규칙을 **설명**하는 자리라 검사에서 뺀다(경고 주석 자체가 위반으로 걸리면 안 된다). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const CONSUMERS = [
  join("src", "features", "attendance", "server", "queries.ts"),
  join("src", "features", "attendance", "live", "server", "load.ts"),
  join("src", "app", "(shell)", "attendance", "page.tsx"),
  // 결석 통보 접수 미리보기(2026-08-19) — 칸마다 "누가 가르치나"를 적는 화면이라 같은 축을 거쳐야 한다.
  // (담임을 직접 적었다가 교시마다 담당이 다른 영어 반에서 둘 다 담임 이름으로 표시된 회귀가 있었다.)
  join("src", "features", "attendance", "intake", "server", "queries.ts"),
  // 출결 알림 벨 수신자(원장 결정 2026-09-14) — "그날 그 교시 담당 + 담임"을 같은 모듈에서 판정한다.
  join("src", "features", "attendance", "live", "server", "actions.ts"),
  join("src", "features", "attendance", "live", "server", "cross-notify.ts"),
];

/**
 * 알림 수신자 두 경로 — 반의 슬롯 담당을 **요일·교시·유효기간 없이** 긁어 모으던 모양으로 되돌아가지 않게.
 * 실측(2026-09-14): 그 모양이 활성 반 120개 중 31개 반에서 무관한 강사 연인원 75명에게 벨을 보냈다.
 */
const NOTICE_RECIPIENT_FILES = [
  join("src", "features", "attendance", "live", "server", "actions.ts"),
  join("src", "features", "attendance", "live", "server", "cross-notify.ts"),
];

describe("출결 강사 귀속 축 단일 소스", () => {
  it.each(CONSUMERS)("%s — 축 모듈을 import한다", (rel) => {
    const src = readFileSync(join(process.cwd(), rel), "utf8");
    expect(
      src.includes(AXIS_MODULE) || src.includes("./teacher-axis-queries"),
      `${rel}: 강사 축은 ${AXIS_MODULE} 한 곳에서만 정한다 — 화면마다 따로 고르면 같은 출결이 화면마다 다른 사람의 것이 된다`,
    ).toBe(true);
  });

  it("당일 출결 보드에 인라인 담임 폴백이 남아 있지 않다", () => {
    const code = stripComments(
      readFileSync(join(process.cwd(), "src", "features", "attendance", "live", "server", "load.ts"), "utf8"),
    ).replace(/\s+/g, " ");
    expect(
      /teacher_id\s*\?\?\s*klass\.teacher_id/.test(code),
      "슬롯 담당 → 담임 폴백 규칙은 taughtByForSlot(teacher-axis)만 안다. 여기에 다시 적으면 자리(LAB·JJ) 예외가 갈라진다",
    ).toBe(false);
  });

  it("월간 출석부가 강사 스코프를 SQL 담임 필터로 되돌리지 않았다", () => {
    const code = stripComments(
      readFileSync(join(process.cwd(), "src", "features", "attendance", "server", "queries.ts"), "utf8"),
    ).replace(/\s+/g, " ");
    expect(
      /classesQuery\s*=\s*classesQuery\.eq\(\s*["']teacher_id["']/.test(code),
      "반 목록을 담임으로 좁히면 교시 담당 강사의 출석부가 다시 빈다 — 좁히는 일은 classTeacherIdsInRange가 한다",
    ).toBe(false);
  });

  /**
   * 담임 시작일 필터(2026-08-19)가 **표시 축 밖으로 새지 않는지**.
   * 새는 방향이 셋이라 셋 다 잠근다: ① 교시 담당 반 ② 반별 보기 ③ 급여 별지(돈).
   */
  describe("담임 시작일 필터 — 적용 범위", () => {
    const page = readFileSync(join(process.cwd(), "src", "app", "(shell)", "attendance", "page.tsx"), "utf8");

    it("🔴 담임 폴백으로 잡힌 반에만 건다 — 교시 담당 반은 그 사람이 실제로 가르쳤다", () => {
      expect(
        /teacherRoles\.get\(c\.id\)\s*===\s*"homeroom"/.test(page),
        "담임 시작일 필터가 역할을 안 보고 걸리고 있습니다 — 교시 담당(slot)·겸임(both) 반까지 가리면 " +
          "2026-08-18에 넓힌 '교시 담당 강사도 자기 출석부를 본다'가 도로 깨집니다.",
      ).toBe(true);
    });

    /**
     * ⚠️ 2026-09-17 원장 *"내 출석부에서 고치는건데 남의 출석부를 건드리는건 아니지"* — **강사 계정**의 반별 보기는 그 강사
     *    렌즈다(`classScopeTeacher`, 스코프·담임 시작일을 강사 전체 보기와 같은 규칙으로). 관리자의 반별 보기는 여전히 반 전체다:
     *    그 렌즈는 로그인한 강사 본인(`myTeacherId`)에게서만 나온다 — 관리자가 강사 드롭다운으로 고른 `effectiveTeacher`가 아니다.
     */
    it("🔴 관리자의 반별 보기·급여 별지에는 안 넘긴다 — 반 관점에선 그 기록이 맞고 돈 축은 담임 그대로다", () => {
      const flat = page.replace(/\s+/g, " ");
      expect(
        /getMonthlyAttendanceMatrix\( month, effectiveClassId, viewPrefs\.periodMode, (?:\/\/[^\n]*? )?classScopeTeacher, classScopeTeacher && homeroomSinceIdx && teacherRoles\.get\(effectiveClassId\) === "homeroom"/.test(
          flat,
        ),
        "반별 보기 호출의 스코프·담임 시작일이 강사 계정 렌즈(classScopeTeacher)에서만 나와야 합니다 — 관리자의 반별 보기는 반 전체입니다.",
      ).toBe(true);
      expect(
        /const classScopeTeacher = mode === "class" && myTeacherId && selectedClass && classTaughtBy\(selectedClass, myTeacherId\) \? myTeacherId : null;/.test(
          flat,
        ),
        "반별 보기 렌즈가 로그인한 강사 본인이 아닌 값(effectiveTeacher 등)에서 나오면 관리자 반별 보기가 좁아집니다.",
      ).toBe(true);
      const payslip = readFileSync(
        join(process.cwd(), "src", "app", "(print)", "payroll", "[teacherId]", "payslip", "page.tsx"),
        "utf8",
      );
      expect(
        /getMonthlyAttendanceMatrix\(period,\s*c\.id,\s*"month"\)/.test(payslip),
        "급여 별지 호출에 강사 스코프·담임 시작일이 붙었습니다 — 돈 축은 담임 그대로가 확정입니다(골든마스터).",
      ).toBe(true);
    });

    it("파생(수업보고서)도 같은 경계를 본다 — 수기만 빼면 파생이 그 칸을 되살린다", () => {
      const queries = stripComments(
        readFileSync(join(process.cwd(), "src", "features", "attendance", "server", "queries.ts"), "utf8"),
      ).replace(/\s+/g, " ");
      expect(
        /!scopeSince \|\| d\.date >= scopeSince/.test(queries),
        "파생 등원일이 담임 시작일을 안 봅니다 — JJ2A는 8/3~8/10에 전임이 쓴 보고서가 14건 있어 " +
          "수기 기록을 빗금으로 빼도 그 칸이 '출석'으로 되살아납니다.",
      ).toBe(true);
    });
  });

  it("돈(정산·명세서)은 담임 축을 그대로 쓴다 — 의도적 예외라 축 모듈을 안 거친다", () => {
    for (const rel of [
      join("src", "features", "attendance", "server", "teacher-money.ts"),
      join("src", "features", "payroll", "server", "payslip-queries.ts"),
    ]) {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      expect(src.includes(AXIS_MODULE), `${rel}: 돈 축을 옮기려면 골든마스터부터 설명할 것`).toBe(false);
    }
  });

  describe("출결 알림 벨 수신자 — 그날 그 교시 담당 + 담임(원장 결정 2026-09-14)", () => {
    /**
     * `class_schedules`에서 **담당(teacher_id)을 읽는** 조회 중 요일·유효기간을 안 싣는 것.
     * (담당을 안 읽는 조회 — 예: 요청자가 그 반 교시 담당인지 보는 게이트 — 는 대상이 아니다.)
     */
    function unscopedSlotTeacherQueries(src: string): string[] {
      const code = stripComments(src).replace(/\s+/g, " ");
      return code
        .split(/from\(\s*["']class_schedules["']\s*\)/)
        .slice(1)
        .map((rest) => rest.slice(0, 700).split(";")[0]!)
        .filter((chain) => {
          const select = /\.select\(\s*["'`]([^"'`]*)["'`]/.exec(chain)?.[1] ?? "";
          if (!/\bteacher_id\b/.test(select)) return false;
          const scoped =
            /\bday_of_week\b/.test(select) &&
            /\bvalid_from\b/.test(select) &&
            /\bvalid_to\b/.test(select) &&
            /\.lte\(\s*["']valid_from["']/.test(chain) &&
            /valid_to\.is\.null/.test(chain);
          return !scoped;
        });
    }

    it("검사기가 옛 모양(반의 슬롯 담당 전부)을 실제로 잡는다 — 헛도는 가드 방지", () => {
      const old = `admin.from("class_schedules").select("teacher_id").eq("tenant_id", t).eq("class_id", id).not("teacher_id", "is", null);`;
      expect(unscopedSlotTeacherQueries(old)).toHaveLength(1);
    });

    it.each(NOTICE_RECIPIENT_FILES)("%s — 수신자는 attendanceNoticeRecipients가 정한다", (rel) => {
      const src = readFileSync(join(process.cwd(), rel), "utf8");
      const code = stripComments(src);
      expect(
        /attendanceNoticeRecipients\(/.test(code),
        `${rel}: 벨 수신자는 teacher-axis의 attendanceNoticeRecipients 한 벌로 판정한다`,
      ).toBe(true);
      expect(
        unscopedSlotTeacherQueries(src),
        `${rel}: 슬롯 담당을 요일·유효기간 없이 모으면 끝난 배치 이력·다른 요일·다른 교시 강사에게까지 벨이 간다`,
      ).toEqual([]);
      expect(
        /\.map\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\.teacher_id\b/.test(code.replace(/\s+/g, " ")),
        `${rel}: 슬롯 행의 teacher_id를 그대로 수신자로 펼치지 말 것 — 교시·날짜 판정을 건너뛴다`,
      ).toBe(false);
    });

    /**
     * 임시 위임 대체 강사(원장 결정 2026-09-14) — 로더가 위임을 안 넘기면 순수 함수가 맞아도 대체 강사가
     * **조용히** 빠진다(에러가 안 난다). 위임 표를 호출부에서 직접 읽으면 해제·기간 규약이 두 벌이 된다.
     */
    it.each(NOTICE_RECIPIENT_FILES)("%s — 그날 위임 대체 강사를 같은 헬퍼로 읽어 함께 넘긴다", (rel) => {
      const code = stripComments(readFileSync(join(process.cwd(), rel), "utf8")).replace(/\s+/g, " ");
      expect(
        /getActiveDelegationsForClasses\(/.test(code),
        `${rel}: 위임은 classes/server/delegation의 getActiveDelegationsForClasses 한 벌로 읽는다`,
      ).toBe(true);
      expect(
        /from\(\s*["']class_delegations["']\s*\)/.test(code),
        `${rel}: 위임 표를 직접 조회하지 말 것 — 해제(revoked_at)·양끝 포함 규약이 두 벌이 된다`,
      ).toBe(false);
      const calls = code
        .split("attendanceNoticeRecipients({")
        .slice(1)
        .map((rest) => rest.split(";")[0]!);
      expect(calls.length, `${rel}: attendanceNoticeRecipients 호출을 찾지 못했습니다`).toBeGreaterThan(0);
      for (const call of calls) {
        expect(/\bdelegations:/.test(call), `${rel}: 수신자 판정에 delegations가 빠졌습니다: ${call}`).toBe(true);
      }
    });

    it("좌석표의 '지금 교시'(periodStart)가 교차 알림 수신자까지 흘러간다 — 저장 교시만 보면 늦게 온 학생 벨이 첫 교시 담당에게만 간다", () => {
      const notify = stripComments(
        readFileSync(join(process.cwd(), "src", "features", "attendance", "live", "server", "cross-notify.ts"), "utf8"),
      ).replace(/\s+/g, " ");
      expect(/periodStart:\s*cell\.periodStart/.test(notify), "cross-notify가 칸의 periodStart를 순수 함수에 안 넘깁니다").toBe(
        true,
      );
      const save = stripComments(
        readFileSync(join(process.cwd(), "src", "features", "attendance", "server", "actions.ts"), "utf8"),
      ).replace(/\s+/g, " ");
      const calls = save
        .split("notifyUnmarkedToPresent(")
        .slice(1)
        .map((rest) => rest.slice(0, 300));
      expect(calls.length, "셀 저장·일괄 저장 두 호출부가 있어야 한다").toBeGreaterThanOrEqual(2);
      for (const call of calls) {
        expect(/cells:[^}]*periodStart/.test(call), `교차 알림 칸에 periodStart가 빠졌습니다: ${call}`).toBe(true);
      }
    });
  });
});
