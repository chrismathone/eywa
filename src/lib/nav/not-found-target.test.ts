import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { isPrintPath, notFoundTarget, PRINT_ROUTES } from "./not-found-target";

describe("없는 주소 → /home(그 사람의 홈, 원장 2026-09-30)", () => {
  it("일반 주소는 /home, 창 안이면 embed=1 유지(#133)", () => {
    expect(notFoundTarget("/asdf", false)).toBe("/home");
    expect(notFoundTarget("/students/zzz/qq", true)).toBe("/home?embed=1");
    expect(notFoundTarget("/super-admin/zzz", false)).toBe("/home");
  });
  it("🔴 보내지 않는 곳 — 공개 화면·인쇄·/home 자신(루프)", () => {
    for (const p of ["/r/abc", "/kiosk", "/intake/t", "/staff-intake/x", "/seat/lab", "/academy", "/inventory/asset/A1", "/login", "/"]) {
      expect(notFoundTarget(p, false)).toBeNull();
    }
    for (const p of ["/lesson_reports/x/print", "/enrollment/x/prep", "/payroll/t1/payslip", "/shuttle/route", "/print/help/manuals"]) {
      expect(notFoundTarget(p, false)).toBeNull();
    }
    expect(notFoundTarget("/home", true)).toBeNull();
  });
  it("공개·인쇄 판정은 정확 매칭 — 비슷한 로그인 화면은 보낸다", () => {
    for (const p of ["/kiosk-settings/zzz", "/staff/zzz", "/inventory/zzz", "/shuttle/routes", "/payroll/zzz", "/homework"]) {
      expect(notFoundTarget(p, false)).toBe("/home");
    }
    expect(isPrintPath("/shuttle/route/x")).toBe(true);
  });
  it("가드 — (print) 라우트 폴더 전부가 PRINT_ROUTES에 있다", () => {
    const root = path.join(process.cwd(), "src/app/(print)");
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name === "page.tsx") found.push("/" + path.relative(root, dir).split(path.sep).join("/"));
      }
    };
    walk(root);
    expect([...found].sort()).toEqual([...PRINT_ROUTES].sort());
  });
  it("배선 — 루트 not-found는 클라 판정만(서버 조회·headers·redirect 금지), /home은 embed를 싣는다", () => {
    const nf = fs.readFileSync(path.join(process.cwd(), "src/app/not-found.tsx"), "utf8");
    expect(nf.startsWith('"use client"')).toBe(true);
    expect(nf).toContain("notFoundTarget(pathname, embed)");
    expect(nf).toContain("window.self !== window.top");
    expect(nf).toContain("target && !bouncedRecently()"); // 홈 자체가 없을 때 루프 차단
    expect(nf).not.toMatch(/from "next\/headers"|from "@\/lib\/auth|import \{[^}]*\bredirect\b/);
    const home = fs.readFileSync(path.join(process.cwd(), "src/app/home/route.ts"), "utf8");
    expect(home).toContain("redirect(withEmbed(home))");
  });
});
