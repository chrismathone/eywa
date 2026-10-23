import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { endChoices, shortKoreanDate } from "./end-choices";

describe("endChoices — '오늘까지 / 어제까지' 두 갈래", () => {
  it("🔴 오늘까지 = end_date 오늘 · 내일부터 제외(원장 2026-09-01)", () => {
    const [today] = endChoices("2026-09-01");
    expect(today.date).toBe("2026-09-01");
    expect(today.label).toContain("오늘까지 수업");
    expect(today.label).toContain("9월 1일(화)");
    expect(today.effect).toContain("9월 2일(수)");
  });

  it("🔴 어제까지 = end_date 어제 · 오늘부터 제외", () => {
    const [, yesterday] = endChoices("2026-09-01");
    expect(yesterday.date).toBe("2026-08-31");
    expect(yesterday.label).toContain("어제까지 수업");
    expect(yesterday.label).toContain("8월 31일(월)");
    expect(yesterday.effect).toContain("9월 1일(화)");
  });

  it("달·해 경계에서도 하루만 뒤로 간다", () => {
    expect(endChoices("2026-03-01")[1].date).toBe("2026-02-28");
    expect(endChoices("2027-01-01")[1].date).toBe("2026-12-31");
  });

  it("요일은 UTC 파싱이라 결정적", () => {
    expect(shortKoreanDate("2026-09-01")).toBe("9월 1일(화)");
    expect(shortKoreanDate("2026-09-06")).toBe("9월 6일(일)");
  });

  it("🔴 수강 시작일보다 앞서면 그 갈래를 막는다 — 클램프로 설명이 거짓말이 된다", () => {
    // 오늘 시작한 수강에 "어제까지"를 누르면 실제로는 오늘까지로 저장된다.
    const [today, yesterday] = endChoices("2026-09-01", "2026-09-01");
    expect(today.disabledReason).toBeUndefined();
    expect(yesterday.disabledReason).toContain("9월 1일(화)");
    // 예전 시작이면 둘 다 고를 수 있다.
    for (const c of endChoices("2026-09-01", "2026-03-02")) {
      expect(c.disabledReason).toBeUndefined();
    }
    // 시작일을 모르면 막지 않는다(모르는 것으로 길을 막지 않는다).
    for (const c of endChoices("2026-09-01")) expect(c.disabledReason).toBeUndefined();
  });

  it("🔴 두 갈래는 '오늘/어제'만 쓰지 않고 **실제 날짜**를 함께 적는다([[#121]])", () => {
    for (const c of endChoices("2026-09-01")) {
      expect(c.label).toMatch(/\d+월 \d+일\(.\)/);
      expect(c.effect).toMatch(/\d+월 \d+일\(.\)/);
    }
  });
});

describe("배선 — 수강 종료 표면 둘이 같은 한 벌을 쓴다", () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");
  /**
   * 반 상세의 학생별 버튼은 2026-10-15(원생 상태 변경 개인별 권한 분리, 39cee2bd3)에 페이지에서
   * `ClassStudentActions` 컴포넌트로 나갔다 — 가드가 읽는 파일을 그쪽으로 옮겼다(2026-10-22).
   * 페이지는 그 컴포넌트를 부르고 권한 셋(basic·status·schedule)을 넘기는지만 본다.
   */
  const CLASS_PAGE = "app/(shell)/classes/[id]/page.tsx";
  const CLASS_ACTIONS = "app/(shell)/classes/[id]/_components/class-student-actions.tsx";

  it("🔴 반 상세·학생 상세 모두 EndEnrollmentAction (표면마다 다시 짜면 한쪽만 고쳐진다)", () => {
    for (const rel of [CLASS_ACTIONS, "app/(shell)/students/[id]/_tabs/classes-tab.tsx"]) {
      expect(read(rel)).toContain("EndEnrollmentAction");
    }
    expect(read(CLASS_PAGE)).toContain("<ClassStudentActions");
  });

  it("🔴 반 상세 버튼은 서버 게이트와 같은 모양(#77) — 종료 = 원생 상태 권한 · 배정 취소 = 학생 쓰기(full)", () => {
    /**
     * 2026-10-15부터 두 버튼의 게이트가 갈렸다(개인별 '원생 상태 변경' 권한):
     *  · 수강 종료 → `canManageStudentStatusNow()` = 서버 `endSingleEnrollment`의 게이트
     *  · 배정 취소·예약 이동 → `canManageTenant(…, "students")` = 서버 `deleteEnrollment`의 게이트
     */
    const page = read(CLASS_PAGE);
    expect(page).toContain('const canManageStudents = await canManageTenant(user.systemRole, "students")');
    expect(page).toContain("const canManageStatus = await canManageStudentStatusNow()");
    expect(page).toMatch(/permissions=\{\{\s*basic: canManageStudents,\s*status: canManageStatus\b/);
    const src = read(CLASS_ACTIONS);
    expect(src).toContain("if (!permissions.basic) return null;");
    expect(src).toContain("permissions.status ? <EndEnrollmentAction");
    // 화면 게이트와 서버 게이트가 같은 함수인지 — 서버 쪽을 바꾸면 여기서 함께 드러난다.
    const server = read("features/students/server/actions.ts");
    const endFn = server.slice(server.indexOf("export async function endSingleEnrollment"));
    expect(endFn.slice(0, endFn.indexOf("formData.get("))).toContain("canManageStudentStatusNow()");
    const enr = read("features/enrollments/server/actions.ts");
    const delFn = enr.slice(enr.indexOf("export async function deleteEnrollment"));
    expect(delFn.slice(0, delFn.indexOf("formData.get("))).toContain('canManageTenant(user.systemRole, "students")');
  });

  it("🔴 다니는 학생=수강 종료 / 예정 학생=배정 취소로 갈라진다(원장 2026-09-01)", () => {
    const src = read(CLASS_ACTIONS);
    const upcomingAt = src.indexOf('if (s.phase === "upcoming") {');
    const cancelAt = src.indexOf("<CancelAssignmentButton");
    const endAt = src.indexOf("<EndEnrollmentAction");
    expect(upcomingAt).toBeGreaterThan(-1);
    // 배정 취소는 예정 갈래 안, 수강 종료는 그 갈래를 나온 뒤(= 다니는 학생)에만.
    expect(cancelAt).toBeGreaterThan(upcomingAt);
    expect(endAt).toBeGreaterThan(cancelAt);
  });

  it("🔴 배정 취소는 서버 단일 진입점(deleteEnrollment)만 부른다", () => {
    const src = read("features/enrollments/components/cancel-assignment-button.tsx");
    expect(src).toContain("deleteEnrollment");
    expect(src).not.toContain('from("enrollments")');
  });

  it("🔴 서버가 '아직 시작 안 한 배정인가'를 다시 확인한다(화면 조건은 게이트가 아니다)", () => {
    const src = read("features/enrollments/server/actions.ts");
    expect(src).toContain("if (!ownerLevel && !(String(enr.start_date) > kstToday()))");
    // 원장 전용 자물쇠를 통째로 푸는 것이 아니다 — 시작한 수강은 여전히 원장만.
    expect(src).toContain("const ownerLevel =");
  });

  it("🔴 종료는 서버 단일 진입점(endSingleEnrollment)만 부른다", () => {
    const src = read("features/enrollments/components/end-enrollment-action.tsx");
    expect(src).toContain("endSingleEnrollment");
    // 종료 규약(클램프·withdrawal_reason)을 클라에서 다시 짜지 않는다.
    expect(src).not.toContain("withdrawal_reason");
    expect(src).not.toContain('from("enrollments")');
  });

  it("🔴 반에서 종료하면 그 반 화면도 갱신한다(다른 창은 router.refresh가 못 미친다)", () => {
    const src = read("features/students/server/actions.ts");
    expect(src).toContain("revalidatePath(`/classes/${res.classId}`)");
  });
});
