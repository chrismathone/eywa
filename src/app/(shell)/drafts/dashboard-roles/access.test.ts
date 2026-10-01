import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 역할별 운영실 시안(숨은 시안) 노출 가드 — 원장 + 슈퍼관리자만 · 메뉴 미노출.
 * 이 시안은 **실제 운영실 데이터**(금액·직원·퇴원 명단까지)를 읽으므로, 게이트가 새면 지난 시안(가짜 데이터)과 달리
 * 원장 전용 정보가 곧바로 노출된다. 원장 지시(2026-10-01)의 목적이 노출 통제라 시안 자체가 새면 본말전도다.
 */
const ROOT = process.cwd();
const DIR = "src/app/(shell)/drafts/dashboard-roles";
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    if (statSync(join(ROOT, p)).isDirectory()) return sources(p);
    return /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("역할별 운영실 시안 — 노출 가드", () => {
  it("게이트 함수는 원장(master) + 슈퍼관리자만 통과시킨다(서버 전용·요청 캐시)", () => {
    const gate = read(`${DIR}/_server/access.ts`);
    expect(gate).toContain('import "server-only"');
    expect(gate).toContain('if (user.systemRole === "master") return true;');
    expect(gate).toContain("return isCurrentUserSuperAdmin();");
    expect(gate).toContain("if (!user) return false;");
  });

  it("레이아웃(loading 앞)과 페이지(데이터를 읽기 전) 둘 다 게이트를 먼저 지나고, 범위 밖은 없는 주소(notFound)", () => {
    const layout = read(`${DIR}/layout.tsx`);
    expect(layout).toContain("if (!(await canOpenDraft())) notFound();");
    const page = read(`${DIR}/page.tsx`);
    const gateAt = page.indexOf("if (!(await canOpenDraft())) notFound();");
    expect(gateAt).toBeGreaterThan(-1);
    // 실제 운영실 조회(loadOverview)보다 앞에서 막는다 — 호출 위치만 보면 import 줄이 아니라 호출식이다.
    expect(gateAt).toBeLessThan(page.indexOf("loadOverview()"));
  });

  it("메뉴·사이드바·권한 키에 올리지 않는다", () => {
    expect(read("src/lib/navigation.ts")).not.toContain("/drafts");
    expect(read("src/lib/permissions.ts")).not.toContain("drafts");
  });

  it("시안은 서버 액션·쓰기·새 조회를 만들지 않는다 — 읽기는 운영실 한 곳(loadOverview·refreshOverview)뿐", () => {
    const files = sources(DIR).filter((f) => !f.endsWith("_server/access.ts"));
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/@\/lib\/supabase|@\/lib\/db|createClient|createAdminClient|"use server"|\bfetch\(/);
      expect(src, f).not.toMatch(/(?<!searchParams)\.(insert|update|upsert|delete)\(/);
    }
    const board = read(`${DIR}/_components/role-board.tsx`);
    expect(board).toContain('import { refreshOverview } from "@/features/dashboard/overview/actions";');
  });

  it("고른 역할·체크는 저장하지 않는다 — 주소(replaceState)에만", () => {
    const board = read(`${DIR}/_components/role-board.tsx`);
    expect(board).not.toMatch(/localStorage|sessionStorage|indexedDB|ui_prefs/);
    expect(board).toContain("window.history.replaceState");
  });

  it("기본값은 전부 가림 — 6가지가 모두 꺼진 채 시작한다", () => {
    const roles = read(`${DIR}/_lib/roles.ts`);
    expect(roles).toMatch(/export const NO_TOGGLES: Toggles = \{\s*deskBilling: false,\s*subjectBilling: false,\s*subjectSheets: false,\s*subjectWithdrawals: false,\s*showPhones: false,\s*staffCard: false,\s*\};/);
  });
});
