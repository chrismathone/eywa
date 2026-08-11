/**
 * 직원 **계정 액션**(비번 재설정·이메일 변경·삭제·역할 변경·근무표)이 게이트 **두 짝**을 다 거치는지 잠근다.
 *
 * 이 계열은 전부 `createAdminClient()`(service_role = RLS 우회)로 `users`/`auth.users`를 쓴다 —
 * **DB에 두 번째 방어선이 없다**. 그래서 게이트를 하나라도 빠뜨리면 그 순간 그대로 뚫리고, 화면은
 * 멀쩡해 보인다(#77). 두 짝은 서로 다른 것을 판정한다:
 *   ① **담당인가** = 직원관리 메뉴 쓰기(`canWriteTenant("staff")`, 개인 예외 `userOverrides` 반영)
 *      — account-actions는 `loadTarget()` 안에서 건다.
 *   ② **대상이 손댈 수 있는 사람인가** = `canManageStaffMember`(자신 권한 이하, 2026-08-11).
 * ①만 있으면 매니저가 원장 비번을 열고, ②만 있으면 메뉴가 잠긴 사람이 직접 POST로 통과한다.
 *
 * ⚠️ 이 파일에 새 계정 액션을 **추가하지 않으면 테스트가 실패**한다(목록이 곧 체크리스트).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8");

const ACCOUNT_ACTIONS = join("src", "features", "staff", "server", "account-actions.ts");
const STAFF_ACTIONS = join("src", "features", "staff", "server", "actions.ts");
const STAFF_DETAIL_PAGE = join("src", "app", "(shell)", "staff", "[id]", "page.tsx");

/** `export async function NAME(` 부터 다음 top-level export 직전까지 = 그 액션의 본문. */
function bodyOf(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name}을(를) 찾지 못했다 — 이름이 바뀌었으면 이 테스트 목록도 고칠 것`).toBeGreaterThan(-1);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport (async function|function|type|const) /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("직원 계정 액션 게이트 배선", () => {
  const src = read(ACCOUNT_ACTIONS);

  // 목록이 소스와 어긋나면(새 액션 추가) 실패 — "빠뜨림"을 잡는 게 이 테스트의 존재 이유.
  const EXPECTED = ["resetStaffPassword", "changeStaffEmail", "deleteStaff", "updateWorkSchedule"];

  it("account-actions.ts의 내보낸 액션 목록이 이 테스트와 일치한다", () => {
    const found = [...src.matchAll(/^export async function (\w+)\(/gm)].map((m) => m[1]);
    expect(
      found.sort(),
      "새 계정 액션이 생겼다 — 아래 게이트 검사에 추가하고 액션에도 두 게이트를 걸 것",
    ).toEqual([...EXPECTED].sort());
  });

  for (const name of EXPECTED) {
    it(`${name}은 담당 게이트(loadTarget→canWriteTenant)와 대상 게이트(canManageStaffMember)를 둘 다 통과시킨다`, () => {
      const body = bodyOf(src, name);
      expect(body, `${name}에 담당 게이트가 없다(loadTarget 경유 필수)`).toContain("loadTarget(");
      expect(body, `${name}에 대상 게이트가 없다`).toContain("canManageStaffMember(");
    });
  }

  it("loadTarget이 직원관리 메뉴 쓰기 권한을 건다(개인 예외 반영 경로)", () => {
    // 위 액션들이 전부 loadTarget에 담당 판정을 위임하므로, 그 안에 실제로 게이트가 있어야 의미가 있다.
    const start = src.indexOf("async function loadTarget(");
    expect(start, "loadTarget을 찾지 못했다").toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\nexport async function", start));
    expect(body, "loadTarget이 canWriteTenant 게이트를 걸지 않는다").toContain(
      'canWriteTenant(actor.systemRole, "staff")',
    );
  });

  it("역할 변경(changeStaffRole)은 메뉴 쓰기 + 부여 위계(canAssignRole)를 둘 다 건다", () => {
    const body = bodyOf(read(STAFF_ACTIONS), "changeStaffRole");
    expect(body, "역할 변경에 직원관리 쓰기 게이트가 없다").toContain('canWriteTenant(actor.systemRole, "staff")');
    // 🔴 부여는 '엄격히 아래'만 — canManageStaffMember(동급 허용)로 대체하면 자기와 같은 등급을 찍어낼 수 있다.
    expect(body, "역할 부여 위계 게이트(canAssignRole)가 없다").toContain("canAssignRole(");
  });

  it("🔴 계정 관리 카드 노출도 두 게이트를 함께 건다 — 화면만 canManageStaffMember로 열면 readonly가 샌다", () => {
    const page = read(STAFF_DETAIL_PAGE);
    const line = page.split(/\r?\n/).find((l) => l.includes("canManageStaffMember("));
    expect(line, "staff/[id]/page.tsx에서 canManageStaffMember 호출을 찾지 못했다").toBeTruthy();
    expect(line, "카드 노출에 canManage(직원관리 쓰기)가 함께 걸려 있지 않다").toContain("canManage &&");
  });
});
