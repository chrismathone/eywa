import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 역할별 운영실 시안(숨은 시안) 노출 가드 — 원장 + 슈퍼관리자만 · 메뉴 미노출 · DB를 읽지 않는다.
 * 원장 지시(2026-10-01)의 목적이 **노출 통제**라, 시안 페이지 자체가 새면 본말전도다.
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
  it("페이지는 원장·슈퍼관리자 게이트를 먼저 지나고, 범위 밖은 없는 주소처럼(notFound)", () => {
    const page = read(`${DIR}/page.tsx`);
    expect(page).toMatch(/const viewer = await getDraftViewer\(\);\s*if \(!viewer\) notFound\(\);/);
    const gate = read(`${DIR}/_server/access.ts`);
    expect(gate).toContain('import "server-only"');
    expect(gate).toContain('if (user.systemRole !== "master" && !superAdmin) return null;');
    expect(gate).toContain("isCurrentUserSuperAdmin()");
  });

  it("메뉴·사이드바·권한 키에 올리지 않는다", () => {
    expect(read("src/lib/navigation.ts")).not.toContain("/drafts");
    expect(read("src/lib/permissions.ts")).not.toContain("drafts");
  });

  it("침산 실측(조사 요약)은 server-only — 클라이언트 번들에 실리지 않는다", () => {
    expect(read(`${DIR}/_data/research.ts`)).toContain('import "server-only"');
    const clientFiles = sources(DIR).filter((f) => /^\s*["']use client["']/.test(read(f)));
    expect(clientFiles.length).toBeGreaterThan(3);
    for (const f of clientFiles) {
      expect(read(f), f).not.toMatch(/from\s+["'][^"']*(_data\/research|bundle-summary)["']/);
      expect(read(f), f).not.toMatch(/개발팀|경영지원팀|분원장/);
    }
    // 클라이언트 보드가 읽는 묶음 설명에도 실측 문구가 없다.
    expect(read(`${DIR}/_data/bundles.ts`)).not.toMatch(/개발팀|경영지원팀|분원장|교수부장|\d+명 —/);
  });

  it("DB·서버 액션·외부 호출을 하지 않는다 — 숫자·이름은 전부 가짜", () => {
    const files = sources(DIR).filter((f) => !f.endsWith("_server/access.ts"));
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/@\/lib\/supabase|@\/lib\/db|createClient|createAdminClient|"use server"|\bfetch\(/);
      expect(src, f).not.toMatch(/server\/(queries|actions)/);
    }
  });
});
