import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MENU_ACCESS } from "@/lib/permissions";
import { APPROVAL_PILOT_USER_IDS } from "@/features/approvals/access";
import { LEAVE_ADJUSTER_USER_IDS, canAdjustLeave } from "@/features/leave/access";

/**
 * 구조 가드 — 연차 조정(원장 2026-09-08 *"관리자랑 김예원이 직원들의 연차갯수를 조정해야하는데"*)이
 * ① 화면에서만 잠기거나([[#77]]) ② 잔여 산식이 표면마다 갈리지 않게 못 박는다.
 *
 * 지키는 것 넷:
 *  · 조정 자격은 명단 + super_admin **한 함수**(canAdjustLeave)로만 난다 — 화면·서버 액션 공용.
 *  · 자리는 **직원관리**다(원장 2026-09-09) — 전자결재 메뉴를 열어 주지 않는다.
 *  · 잔여 = 부여 + 조정 − 사용 − 결재중을 **세 표면**(내 현황·기안 거절·관리자 표)이 같은
 *    순수 함수(balance.ts)로 계산한다.
 *  · 서버 액션이 클라가 보낸 구간·현재값을 믿지 않는다(오래된 화면이 남의 조정을 덮지 않게).
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

const SOSUN = "fcf735fa-edf7-4095-8fa6-724285a018ed"; // 박소선 (master)
const YEWON = "8bb70f71-a8c3-450c-9236-561e9b43ca4f"; // 김예원 (admin)
const OUTSIDER = "00000000-0000-4000-8000-000000000000";

describe("연차 조정 자격", () => {
  it("명단 = 박소선·이승엽·김예원 세 사람", () => {
    expect(LEAVE_ADJUSTER_USER_IDS).toHaveLength(3);
    expect(LEAVE_ADJUSTER_USER_IDS).toContain(SOSUN);
    expect(LEAVE_ADJUSTER_USER_IDS).toContain(YEWON);
  });

  it("명단 밖은 막고, super_admin은 명단 없이 통과(원장 2026-08-13)", () => {
    expect(canAdjustLeave(YEWON, false)).toBe(true);
    expect(canAdjustLeave(OUTSIDER, false)).toBe(false);
    expect(canAdjustLeave(OUTSIDER, true)).toBe(true);
  });

  it("🔴 파일럿 명단과 섞이지 않는다 — 테스터는 결재를 써 보지만 남의 연차는 못 고친다", () => {
    const tester = APPROVAL_PILOT_USER_IDS.find((id) => !LEAVE_ADJUSTER_USER_IDS.includes(id));
    expect(tester).toBeTruthy();
    expect(canAdjustLeave(tester!, false)).toBe(false);
  });

  it("🔴 연차 조정 명단이 전자결재 메뉴를 열지 않는다 — 자리는 직원관리다(원장 2026-09-09)", () => {
    // 박소선은 결재 파일럿이 아니다. 조정 화면이 /staff로 옮겨졌으니 전자결재를 열어 줄 이유가 없다
    // (열어 두면 "연차 고치라고 준 권한"이 남의 결재 문서 열람까지 넓어진다).
    expect(APPROVAL_PILOT_USER_IDS).not.toContain(SOSUN);
    expect(MENU_ACCESS.approvals.master).toBe("none");
    const access = read("src/features/approvals/access.ts");
    expect(access).not.toContain("canAdjustLeave");
    // 대신 직원관리 목록이 같은 함수로 버튼을 낸다.
    const staffPage = read("src/app/(shell)/staff/page.tsx");
    expect(staffPage).toContain('from "@/features/leave/access"');
    expect(staffPage).toContain("canAdjustLeave(user.id, isSuperAdmin)");
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
    // 쓰기 두 갈래(추가·삭제)가 각각 게이트를 지난다 — 한쪽만 막으면 POST로 우회된다.
    expect(actions.match(/requireAdjuster\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("🔴 서버가 구간·현재값을 다시 계산한다 — 클라가 보낸 값을 쓰지 않는다", () => {
    const actions = read("src/features/leave/server/actions.ts");
    expect(actions).toContain("resolveLeavePeriod");
    expect(actions).toContain("adjustmentDaysFor");
    // 폼에서 읽는 값은 대상·방식·일수·사유뿐이다(구간·현재 총 부여를 받으면 오래된 화면이 이긴다).
    const read_keys = [...actions.matchAll(/formData\.get\("([a-zA-Z]+)"\)/g)].map((m) => m[1]);
    expect(new Set(read_keys)).toEqual(new Set(["userId", "reason", "mode", "days", "adjustmentId"]));
  });

  it("🔴 빈 일수 칸이 '총 0일로'로 읽히지 않는다(화면·서버 두 겹)", () => {
    const actions = read("src/features/leave/server/actions.ts");
    // Number("")는 0이다 — 문자열이 빈지 **먼저** 본다.
    expect(actions).toContain('if (!daysRaw) return { error: "일수를 입력하세요" };');
    // 결과 총액 상한도 함께(한 줄 상한만으론 여러 번 쌓아 넘길 수 있다).
    expect(actions).toContain("newTotal > MAX_LEAVE_TOTAL");
    const ui = read("src/app/(shell)/staff/annual-leave/_adjust-table.tsx");
    // 음수 총 부여도 화면이 먼저 막는다(grantedTotal이 0으로 잘려 하한 검사에 안 걸린다).
    expect(ui.replace(/\s+/g, " ")).toContain(
      "blocked={ !valid || !quarterOk || negativeTotal || delta === 0 || belowUsed || overCap || !reason.trim() }",
    );
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
