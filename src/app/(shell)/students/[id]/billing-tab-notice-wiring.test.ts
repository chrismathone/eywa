import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 원생 상세 — 권한 없이 수납 탭 주소로 왔을 때의 안내 한 줄(운영점검 2026-10-03 A23).
 *
 * 페이지 전체를 그리는 테스트는 조회·권한 모킹이 열 개가 넘어 여기서는 **배선만** 고정한다(화면 동작은 브라우저 확인 몫):
 *  · 안내는 수납 탭이 권한으로 막혔을 때만 선다. 같은 폴백 줄의 SRS 성적·오늘 수학은 기능이 꺼진 지점에서
 *    "있었는지조차 모르게"가 결정이라 조용히 개요로 떨어져야 한다 — 조건을 `tab !== requestedTab`처럼 넓히면 그 탭의 존재가 드러난다.
 *  · 개요 탭은 같은 권한 값으로 수납 조회·카드를 생략한다(조회·카드 쪽은 overview-billing-access.test.tsx가 그린다).
 *  · 문구에 내부 역할 이름·권한 키가 없다.
 */
const page = readFileSync(join(process.cwd(), "src/app/(shell)/students/[id]/page.tsx"), "utf8");
const code = page
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

describe("수납 탭 권한 안내", () => {
  it("권한 판정은 수납 메뉴 권한 하나다", () => {
    expect(code).toContain('const canSeeBilling = await canAccessTenant(user.systemRole, "billing");');
  });

  it("권한이 없으면 강제 주소도 개요로 떨어진다(기존 게이트 그대로)", () => {
    // 2026-10-22 원생 기여도 탭 조건과 한 줄로 묶이며 괄호가 붙었다 — `(…) || (requestedTab === "billing" && !canSeeBilling) ? "overview"`.
    expect(code).toMatch(/requestedTab === "billing" && !canSeeBilling\)?\s*\?\s*"overview"/);
  });

  it("🔴 안내는 '수납 탭 + 권한 없음'일 때만 선다 — 조건이 그 한 줄뿐이다", () => {
    const notices = [...code.matchAll(/\{([^{}]+?)\?\s*\(\s*<p[^>]*role="status"[^>]*><SheetText value=\{"([^"]+)"\} \/><\/p>/g)];
    expect(notices).toHaveLength(1);
    const [, condition, message] = notices[0]!;
    expect(condition.trim()).toBe('requestedTab === "billing" && !canSeeBilling');
    expect(message).toBe("수납 내역을 볼 권한이 없어 학생 개요를 표시합니다.");
  });

  it("SRS 성적·오늘 수학 폴백에는 안내가 없다(꺼진 기능은 흔적 없이)", () => {
    // 두 폴백은 조용히 개요로 떨어지는 삼항에만 있고, 화면 문구와 묶인 곳이 없다.
    expect(code).toMatch(/requestedTab === "srs" && !showSrs\s*\?\s*"overview"/);
    expect(code).toMatch(/requestedTab === "todays-math" && !showTodaysMath\s*\?\s*"overview"/);
    expect(code.match(/requestedTab === "srs"/g)).toHaveLength(1);
    expect(code.match(/requestedTab === "todays-math"/g)).toHaveLength(1);
    // 요청한 탭과 보이는 탭이 다르다는 사실만으로 안내를 띄우지 않는다.
    expect(code).not.toMatch(/tab !== requestedTab|requestedTab !== tab/);
  });

  it("안내 문구에 내부 역할 이름·권한 키가 없다", () => {
    const message = code.match(/role="status"[^>]*><SheetText value=\{"([^"]+)"\}/)?.[1] ?? "";
    expect(message).not.toBe("");
    expect(message).not.toMatch(/슈퍼|총괄|super_admin|master|teacher|admin|billing|원장|강사/);
  });

  it("개요 탭은 같은 권한 값을 받는다 — 조회와 카드가 그 값으로 생략된다", () => {
    expect(code).toContain("<OverviewTab student={student} canSeeBilling={canSeeBilling} />");
    const overview = readFileSync(join(process.cwd(), "src/app/(shell)/students/[id]/_tabs/overview-tab.tsx"), "utf8");
    expect(overview).toContain("canSeeBilling ? getStudentInvoices(sid) : Promise.resolve([])");
    // 수납 조회는 그 한 곳뿐이다(권한 없이 도는 두 번째 조회가 없다).
    expect(overview.match(/getStudentInvoices\(/g)).toHaveLength(1);
  });
});
