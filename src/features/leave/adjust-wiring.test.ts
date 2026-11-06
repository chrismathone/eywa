import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_ACCESS } from "@/lib/permissions";
import { canAdjustLeave } from "@/features/leave/access";

import { readMigration } from "@/lib/db/migrations-corpus.mjs";
/**
 * 구조 가드 — 연차 조정(원장 2026-09-08 *"관리자랑 김예원이 직원들의 연차갯수를 조정해야하는데"*)이
 * ① 화면에서만 잠기거나([[#77]]) ② 잔여 산식이 표면마다 갈리지 않게 못 박는다.
 *
 * 지키는 것 넷:
 *  · 조정 자격은 원장 역할 · 학원 설정에서 지정한 사람 + super_admin **한 함수**(canAdjustLeave)로만 난다 — 화면·서버 액션 공용.
 *  · 자리는 **직원관리**다(원장 2026-09-09) — 전자결재 메뉴를 열어 주지 않는다.
 *  · 잔여 = 부여 + 조정 − 사용 − 결재중을 **세 표면**(내 현황·기안 거절·관리자 표)이 같은
 *    순수 함수(balance.ts)로 계산한다.
 *  · 서버 액션이 클라가 보낸 구간·현재값을 믿지 않는다(오래된 화면이 남의 조정을 덮지 않게).
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const ADJUSTER = "11111111-1111-4111-8111-111111111111";
const OUTSIDER = "00000000-0000-4000-8000-000000000000";
const policy = { adjusterIds: [ADJUSTER] };
const admin = (id: string) => ({ id, systemRole: "admin" as const });

describe("연차 조정 자격", () => {
  it("🔴 코드에 계정 명단을 두지 않는다 — 지정은 역할·권한 화면에서만(원장 2026-10-06)", () => {
    const access = read("src/features/leave/access.ts");
    expect(access).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(access).not.toMatch(/_IDS\b/);
  });

  it("지정되지 않은 사람은 막고, super_admin은 지정 없이 통과(원장 2026-08-13)", () => {
    expect(canAdjustLeave(admin(ADJUSTER), false, policy)).toBe(true);
    expect(canAdjustLeave(admin(OUTSIDER), false, policy)).toBe(false);
    expect(canAdjustLeave(admin(OUTSIDER), true, policy)).toBe(true);
    expect(canAdjustLeave(admin(ADJUSTER), false, { adjusterIds: [] })).toBe(false);
    // 저장값이 목록이 아니면(손으로 넣은 값) 지정된 사람이 없는 것으로 본다.
    expect(canAdjustLeave(admin(ADJUSTER), false, { adjusterIds: `x${ADJUSTER}` as unknown as string[] })).toBe(false);
  });

  it("🔴 원장 역할은 지정 없이 조정한다 — 원장은 그 지점의 전부를 한다(원장 2026-10-06)", () => {
    expect(canAdjustLeave({ id: OUTSIDER, systemRole: "master" }, false, { adjusterIds: [] })).toBe(true);
    // 그 밖의 역할은 지정이 있어야 한다(관리자여도).
    for (const role of ["admin", "manager", "teacher", "counselor", "accountant", "viewer"] as const) {
      expect(canAdjustLeave({ id: OUTSIDER, systemRole: role }, false, policy)).toBe(false);
    }
  });

  it("🔴 메뉴 권한과 섞이지 않는다 — 자격 판정이 권한 표를 읽지 않는다", () => {
    // 조정 자격은 메뉴 권한(전자결재 · 직원관리)이 아니라 지정이 정한다 — 메뉴를 열어 줘도 자격이 따라오지 않는다.
    const access = read("src/features/leave/access.ts");
    expect(access).not.toContain("perm-matrix");
    expect(access).not.toContain("MENU_ACCESS");
  });

  it("🔴 연차 조정 지정이 전자결재 메뉴를 열지 않는다 — 자리는 직원관리다(원장 2026-09-09)", () => {
    // 조정 화면이 /staff로 옮겨졌으니 전자결재를 열어 줄 이유가 없다
    // (열어 두면 "연차 고치라고 준 권한"이 남의 결재 문서 열람까지 넓어진다). 전자결재 접근 파일은 계정을 하나도 들지 않는다.
    expect(MENU_ACCESS.approvals.master).toBe("none");
    const access = read("src/features/approvals/access.ts");
    expect(access).not.toContain("canAdjustLeave");
    // 전자결재 접근 판정이 연차 쪽 모듈을 끌어오지도 않는다(조정 담당을 가져다 메뉴를 여는 우회).
    expect(access).not.toContain("features/leave");
    // 대신 직원관리 목록이 같은 함수로 버튼을 낸다.
    const staffPage = read("src/app/(shell)/staff/page.tsx");
    expect(staffPage).toContain('from "@/features/leave/access"');
    // '다른 강사 뷰'면 버튼도 그 직원으로(연차 관리 화면 · 저장 액션과 같은 사람 — 2026-11-05 적대 재리뷰).
    expect(staffPage).toContain("const viewer = (await getCurrentUser({ teacherView: true })) ?? user;");
    expect(staffPage).toContain("canAdjustLeave(viewer, isSuperAdmin,");
    expect(staffPage).toContain('href="/staff/annual-leave"');
  });
});

describe("게이트 배선", () => {
  it("화면과 서버 액션이 같은 함수를 지난다", () => {
    const page = read("src/app/(shell)/staff/annual-leave/page.tsx");
    expect(page).toContain("canAdjustLeave");
    expect(page).toContain('requireAccess("staff")');
    expect(page).toContain('redirect("/staff")');

    const actions = read("src/features/leave/server/actions.ts");
    expect(actions).toContain("canAdjustLeave");
    // 둘 다 학원 설정의 같은 칸을 읽는다(한쪽만 다른 값을 보면 버튼은 뜨는데 저장이 거절된다).
    for (const src of [page, actions, read("src/app/(shell)/staff/page.tsx")]) {
      expect(src).toContain("{ adjusterIds: settings.permissions.specialAccess.leaveAdjusterIds }");
    }
    // 🔴 서버 액션도 화면과 같은 두 문이다 — 직원관리 메뉴 + 지정. 지정만 보면 메뉴가 닫힌 사람이 요청을 만들어 고친다.
    const flat = actions.replace(/\s+/g, " ");
    expect(flat).toContain('canAccessTenant(user.systemRole, "staff")');
    expect(flat).toContain("if (!canOpenStaff || !canAdjustLeave(user, isSuperAdmin,");
    // 🔴 직원관리 과목 범위 — 표(조회)와 추가·삭제(쓰기) 세 곳이 같은 판정을 지난다.
    expect(page).toContain("getViewerStaffScope(user)");
    // 화면의 user = 강사뷰 대상(저장 액션 requireAdjuster와 같은 사람) · 읽기 강사뷰는 조정 단추를 그리지 않는다.
    expect(page).toContain("const user = (await getCurrentUser({ teacherView: true })) ?? signedIn;");
    expect(page).toContain("readOnly={readOnly}");
    expect(flat).toContain("if (!(await canSeeStaffMember(user, userId))) return { error: STAFF_SCOPE_DENIED_MSG };");
    expect(flat).toContain("if (!(await canSeeStaffMember(user, targetId))) return { error: STAFF_SCOPE_DENIED_MSG };");
    // 쓰기 두 갈래(추가·삭제)가 각각 게이트를 지난다 — 한쪽만 막으면 POST로 우회된다.
    expect(actions.match(/requireAdjuster\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("🔴 서버가 구간·현재값을 다시 계산한다 — 클라가 보낸 값을 쓰지 않는다", () => {
    const actions = read("src/features/leave/server/actions.ts");
    expect(actions).toContain("resolveLeavePeriod");
    expect(actions).toContain("adjustmentDaysFor");
    // 폼에서 읽는 값은 대상·방식·일수·사유·사용 기간뿐이다(구간·현재 총 부여를 받으면 오래된 화면이 이긴다).
    // ⚠️ `usedStart`·`usedEnd`는 **휴가를 쓴 날**이지 연차 구간이 아니다 — 구간은 서버가 다시 계산해
    //    그 안인지 가둔다(아래).
    const read_keys = [...actions.matchAll(/formData\.get\("([a-zA-Z]+)"\)/g)].map((m) => m[1]);
    expect(new Set(read_keys)).toEqual(
      new Set(["userId", "reason", "mode", "days", "adjustmentId", "usedStart", "usedEnd"]),
    );
  });

  it("🔴 빈 일수 칸이 '총 0일로'로 읽히지 않는다(화면·서버 두 겹)", () => {
    const actions = read("src/features/leave/server/actions.ts");
    // Number("")는 0이다 — 문자열이 빈지 **먼저** 본다.
    expect(actions).toContain('if (!daysRaw) return { error: "일수를 입력하세요" };');
    // 결과 총액 상한도 함께(한 줄 상한만으론 여러 번 쌓아 넘길 수 있다).
    expect(actions).toContain("newTotal > MAX_LEAVE_TOTAL");
    const ui = read("src/app/(shell)/staff/annual-leave/_adjust-table.tsx");
    // 음수 총 부여도 화면이 먼저 막는다(grantedTotal이 0으로 잘려 하한 검사에 안 걸린다).
    // 차단 조건은 **한 이름**으로 모아 둔다 — 버튼 속성에 늘어놓으면 조건이 늘 때 한쪽만 고치게 된다.
    expect(ui.replace(/\s+/g, " ")).toContain(
      "const blocked = !valid || !quarterOk || negativeTotal || delta === 0 || belowUsed || overCap || usedRangeBad;",
    );
    // 🔴 일수-기간 불일치는 **경고만**이라 차단 조건에 들어가면 안 된다(반차·반반차면 원래 안 맞는다).
    expect(ui.replace(/\s+/g, " ")).not.toContain("rangeMismatch ||");
    expect(ui.replace(/\s+/g, " ")).toContain("<SubmitButton label=\"조정 기록\" blocked={blocked} />");
    // 상한 상수는 화면·서버가 **같은 것**을 읽는다(값이 갈리면 버튼은 열리는데 서버만 거절한다).
    expect(ui).toContain("MAX_LEAVE_TOTAL");
    expect(actions).toContain("MAX_LEAVE_TOTAL");
  });

  it("구간 귀속은 중앙 날짜 한 규칙으로 — 입사일 정정에 조정·사용이 증발하거나 다음 해로 새지 않는다", () => {
    for (const f of [
      "src/features/leave/server/admin.ts",
      "src/features/leave/server/actions.ts",
      "src/features/approvals/server/queries.ts",
    ]) {
      const src = read(f);
      expect(src).toContain("leaveRowMatchesPeriod");
      // SQL은 겹침으로 넓게 받고 판정은 순수 함수가 한다 — 시작일 '일치'로 좁히면 정정 뒤 증발한다.
      expect(src).not.toContain('.eq("period_start"');
    }
  });

  it("admin 클라이언트를 쓰는 조회·쓰기에 tenant_id 필터가 붙는다([[#104]])", () => {
    for (const f of [
      "src/features/leave/server/actions.ts",
      "src/features/leave/server/admin.ts",
    ]) {
      const src = read(f);
      expect(src).toContain("createAdminClient");
      expect(src).toContain('"tenant_id"');
    }
  });
});

describe("조정의 휴가 사용 기간(0270b, 원장 2026-09-18)", () => {
  it("🔴 기간은 서버가 **그 구간 안인지** 가둔다 — 화면 min·max는 게이트가 아니다([[#77]])", () => {
    const actions = read("src/features/leave/server/actions.ts");
    expect(actions).toContain('formData.get("usedStart")');
    expect(actions).toContain('formData.get("usedEnd")');
    // 양 끝을 **둘 다** 본다 — 시작만 보면 구간 끝을 넘겨 끝나는 기간이 그대로 들어온다.
    expect(actions.replace(/\s+/g, " ")).toContain(
      "const outsidePeriod = [usedStart, usedEnd] .filter(Boolean) .some((d) => d < target.period.start || d > target.period.end);",
    );
    // 형식도 서버가 본다(달력 밖에서 임의 문자열을 넣어도 통과하지 않게).
    expect(actions).toContain("YMD_RE.test(usedStart)");
    expect(actions).toContain("YMD_RE.test(usedEnd)");
  });

  it("🔴 거꾸로 된 기간·시작 없는 종료를 서버가 거절한다(DB 제약과 같은 판정)", () => {
    const actions = read("src/features/leave/server/actions.ts");
    expect(actions).toContain("if (usedEnd && !usedStart)");
    expect(actions).toContain("usedStart && usedEnd && usedEnd < usedStart");
    const sql = readMigration("0270b_leave_adjustment_used_range.sql");
    expect(sql).toContain("check (used_end is null or (used_start is not null and used_end >= used_start))");
  });

  it("🔴 기간을 '사용'으로 두 번 세지 않는다 — 차감은 days가 이미 한다", () => {
    // 잔여 산식(balance.ts)에 사용 기간이 들어가면 같은 연차가 두 번 깎인다. 산식 파일은 날짜를 모른다.
    const balance = read("src/features/leave/balance.ts");
    expect(balance).not.toContain("usedStart <");
    expect(balance).not.toContain("used_start");
    expect(balance).not.toContain("used_end");
    // 내역 조회도 숫자를 세지 않는다(세는 곳은 getMyLeaveBalance 한 곳).
    const history = read("src/features/leave/server/my-history.ts");
    expect(history).not.toContain("remainingDays");
    expect(history).not.toContain("sumAdjustments");
  });

  it("0270b 미적용에도 살아 있다([[#95]]) — 조회는 칸을 빼고 다시 읽고, 쓰기는 빈 값이면 키를 안 보낸다", () => {
    const admin = read("src/features/leave/server/admin.ts");
    expect(admin).toContain("isMissingUsedRangeColumn");
    expect(admin).toContain("selectAdjustments(tenantId, userIds, false)");
    const history = read("src/features/leave/server/my-history.ts");
    expect(history).toContain("isMissingUsedRangeColumn");
    const actions = read("src/features/leave/server/actions.ts");
    // 빈 기간에 `used_start: null`을 실으면 칸 없는 창에서 **조정 전체**가 거절된다.
    expect(actions.replace(/\s+/g, " ")).toContain("...(usedStart ? { used_start: usedStart } : {})");
    expect(actions.replace(/\s+/g, " ")).toContain("...(usedEnd ? { used_end: usedEnd } : {})");
    // 표 없음과 칸 없음은 **다른 안내**다(한 문구로 뭉치면 무엇을 적용해야 하는지 알 수 없다).
    expect(actions).toContain("TABLE_MISSING_MSG");
    expect(actions).toContain("USED_RANGE_MISSING_MSG");
  });

  it("칸이 없으면 **기간 입력만** 잠긴다 — 조정 기능 전체를 잠그지 않는다", () => {
    const admin = read("src/features/leave/server/admin.ts");
    expect(admin).toContain("usedRangeReady");
    const page = read("src/app/(shell)/staff/annual-leave/page.tsx");
    expect(page).toContain("usedRangeReady={overview.usedRangeReady}");
    const ui = read("src/app/(shell)/staff/annual-leave/_adjust-table.tsx");
    expect(ui).toContain("disabled={!usedRangeReady}");
    // 표가 없을 때 잠그는 것(tableReady)과 축이 다르다 — 둘을 한 값으로 합치지 말 것.
    expect(ui).toContain("disabled={!r.period || !tableReady}");
  });

  it("기간 표기는 두 화면이 **같은 순수 함수**를 쓴다(글자가 갈리면 같은 줄이 달라 보인다)", () => {
    for (const f of [
      "src/app/(shell)/staff/annual-leave/_adjust-table.tsx",
      "src/app/(shell)/me/_components/leave-card.tsx",
    ]) {
      expect(read(f)).toContain("usedRangeLabel");
    }
    // 일수 계산도 휴가 신청과 같은 함수(일요일 제외)라 두 화면이 같은 숫자를 말한다.
    expect(read("src/app/(shell)/staff/annual-leave/_adjust-table.tsx")).toContain("countLeaveDays(");
  });
});

describe("사유는 선택(원장 2026-09-21)", () => {
  it("🔴 서버가 사유를 요구하지 않는다 — 길이만 본다", () => {
    const actions = read("src/features/leave/server/actions.ts");
    expect(actions).not.toContain("if (!reason) return");
    expect(actions).toContain("reason.length > MAX_REASON");
  });

  it("DB 제약도 함께 푼다 — 화면만 열면 저장에서 막힌다([[#77]]의 뒤집힌 꼴)", () => {
    const sql = readMigration("0277a_leave_adjustment_reason_optional.sql");
    expect(sql).toContain("drop constraint if exists leave_adjustments_reason_present");
    // 적용 전 창에서는 그 거절을 한글로 옮긴다(영문 제약 이름을 화면에 내보내지 않는다).
    const actions = read("src/features/leave/server/actions.ts");
    expect(actions).toContain("leave_adjustments_reason_present");
    expect(actions).toContain("REASON_REQUIRED_MSG");
  });
});

describe("종료일 상한·자동 채움(원장 2026-09-21)", () => {
  it("상한은 순수 함수 하나에서 온다 — 화면이 날짜를 직접 더하지 않는다", () => {
    const ui = read("src/app/(shell)/staff/annual-leave/_adjust-table.tsx");
    expect(ui).toContain("maxUsedEnd(");
    expect(ui).toContain("max={endMax}");
    // 날짜 산술을 화면에서 새로 만들면 말일·윤년이 자리마다 갈린다(addDays·maxUsedEnd가 정본).
    expect(ui).not.toContain("new Date(Date.UTC");
  });

  it("하루짜리면 종료일을 시작일로 자동 — 시작·일수 어느 쪽을 고쳐도 같게", () => {
    const ui = read("src/app/(shell)/staff/annual-leave/_adjust-table.tsx").replace(/\s+/g, " ");
    expect(ui).toContain("function pickStart(v: string)");
    expect(ui).toContain("function pickDays(v: string)");
    expect(ui).toContain("if (neededDays <= 1) { setUsedEnd(v); return; }");
    expect(ui).toContain("if (need <= 1) { setUsedEnd(usedStart); return; }");
    // 두 칸 **모두** 손잡이를 지난다 — 하나만 배선하면 반대 순서로 입력할 때 안 맞는다.
    expect(ui).toContain("onChange={(e) => pickStart(e.target.value)}");
    expect(ui).toContain("onChange={(e) => pickDays(e.target.value)}");
  });
});

describe("내 정보 연차 카드(원장 2026-09-18)", () => {
  it("숫자는 잔여 산식 단일 소스에서 온다 — 화면이 다시 세지 않는다", () => {
    const page = read("src/app/(shell)/me/page.tsx");
    expect(page).toContain("getMyLeaveBalance");
    expect(page).toContain("getMyLeaveHistory");
    const card = read("src/app/(shell)/me/_components/leave-card.tsx");
    // 카드는 그리기만 한다(합계를 다시 만들면 카드 안에서 숫자와 목록이 어긋난다).
    expect(card).not.toContain("remainingDays");
    expect(card).not.toContain("grantedTotal");
    // 라벨은 단일 소스 — 여기서 새 맵을 만들지 않는다.
    expect(card).toContain("LEAVE_KIND_LABEL");
    expect(card).toContain("docStatusLabel");
  });

  it("🔴 연차 조각이 실패해도 내 정보가 죽지 않는다(이력서를 채우는 화면이다)", () => {
    const page = read("src/app/(shell)/me/page.tsx");
    expect(page.replace(/\s+/g, " ")).toContain("getMyLeaveBalance(user.id).catch(() => null)");
    expect(page.replace(/\s+/g, " ")).toContain(".catch(() => null)");
    // 학생·아르바이트엔 연차 개념이 없다 — 아예 부르지 않는다(판정은 eligibility.ts 한 곳 · 원장 2026-11-05).
    expect(page).toContain("!isLeaveEligibleRole(user.systemRole) ? Promise.resolve(null)");
  });

  it("아르바이트는 연차 대상이 아니다 — 내 정보 카드·관리 표·조정이 같은 판정(원장 2026-11-05)", async () => {
    const { isLeaveEligibleRole, NON_LEAVE_ROLES } = await import("./eligibility");
    expect(isLeaveEligibleRole("parttime")).toBe(false);
    expect(isLeaveEligibleRole("student")).toBe(false);
    for (const r of ["master", "admin", "manager", "teacher", "counselor", "accountant", "viewer"]) expect(isLeaveEligibleRole(r)).toBe(true);
    expect([...NON_LEAVE_ROLES]).toEqual(["student", "parttime"]);
    const admin = read("src/features/leave/server/admin.ts");
    // 아르바이트는 SQL이 아니라 JS로 거른다(열거형 값이 없는 DB에서도 표가 산다).
    expect(admin).toContain('.neq("system_role", "student")');
    expect(admin).toContain(".filter((u) => isLeaveEligibleRole(u.system_role))");
    expect(admin).not.toContain("NON_LEAVE_ROLES");
    const actions = read("src/features/leave/server/actions.ts");
    expect(actions).toContain('if (!isLeaveEligibleRole(data.system_role as string | null)) return { error: "아르바이트는 연차 대상이 아닙니다" };');
  });

  it("조정을 바꾸면 본인 화면도 함께 새로 그린다", () => {
    const actions = read("src/features/leave/server/actions.ts");
    expect(actions.match(/revalidatePath\("\/me"\)/g)?.length ?? 0).toBe(2); // 추가·삭제 두 갈래
  });
});

describe("잔여 산식 단일 소스", () => {
  it("세 표면이 balance.ts를 읽는다", () => {
    for (const f of [
      "src/features/approvals/server/queries.ts", // 내 연차 현황
      "src/features/approvals/server/actions.ts", // 기안 잔여 거절
      "src/features/leave/server/admin.ts", // 직원관리 연차 표
    ]) {
      // 경로는 alias(@/features/leave/balance)와 상대(../balance) 둘 다 정본이다 — 어느 쪽이든
      // **같은 순수 모듈**을 읽는지만 본다.
      expect(read(f)).toMatch(/from "(\.\.\/balance|@\/features\/leave\/balance)"/);
    }
  });

  it("🔴 기안 거절이 조정을 포함한 부여로 판정한다", () => {
    const actions = read("src/features/approvals/server/actions.ts");
    expect(actions).toContain("adjustmentDaysFor");
    expect(actions).toContain("grantedTotal(period.granted, adjustment)");
    // 동결값(granted_days)도 조정 포함 — 법정분만 적으면 문서가 "부여 15일인데 18일째 사용"이 된다.
    expect(actions).toContain("granted_days: granted");
  });

  it("잔여 판정이 leave_forms를 두 번 구현하지 않는다(reservedLeaveDays 공용)", () => {
    const actions = read("src/features/approvals/server/actions.ts");
    expect(actions).toContain("reservedLeaveDays");
    // 사본을 다시 만들면 한쪽만 결재중을 빼먹는다 — 정의는 leave/server/admin.ts 한 곳뿐이다.
    expect(actions).not.toContain("async function reservedLeaveDays");
  });
});

describe("표가 없어도 죽지 않는다([[#95]])", () => {
  it("내 연차 현황은 조정 조회 실패를 0으로 삼키고, 기안 액션은 소리 내어 거절한다", () => {
    const queries = read("src/features/approvals/server/queries.ts");
    // 조정 조회가 실패하면 0으로 떨어진다(잔여가 **덜** 잡히는 안전한 방향) — 줄바꿈에 흔들리지 않게
    // 공백을 지운 형태로 본다.
    expect(queries.replace(/\s+/g, " ")).toContain("const adjustment = adjRes.error ? 0");
    const admin = read("src/features/leave/server/admin.ts");
    // 표 없음(0252a 전)만 0으로 — 그 밖의 실패는 throw해서 기안이 이유를 말할 수 있게 한다.
    expect(admin).toContain("if (isMissingRelation(error)) return 0;");
  });

  it("관리자 표는 조정 조회 실패와 '조정 없음'을 구분한다", () => {
    const admin = read("src/features/leave/server/admin.ts");
    expect(admin).toContain("tableReady: adjRows !== null");
  });
});

describe("감사로그", () => {
  it("추가·삭제 두 키가 등록돼 있다(영문 키가 화면에 새지 않게)", () => {
    const log = read("src/features/audit/server/log.ts");
    expect(log).toContain("leave_adjust:");
    expect(log).toContain("leave_adjust_delete:");
    const describe_ = read("src/features/audit/describe.ts");
    expect(describe_).toContain('case "leave_adjust"');
    expect(describe_).toContain('case "leave_adjust_delete"');
  });

  it("두 액션 모두 기록을 남긴다 — 남의 연차를 바꾸는 일은 흔적이 필수다", () => {
    const actions = read("src/features/leave/server/actions.ts");
    expect(actions.match(/logAction\(/g)?.length ?? 0).toBe(2);
  });
});
