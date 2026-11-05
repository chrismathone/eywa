import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 구조 가드 — 이탈 방어 **읽기 권한**이면 캠페인 추가·상태 전환·제거와 '발송 조치 기록'을 그리지 않는다(원장 2026-11-05).
 * 판정은 서버 게이트(server/actions.ts)와 같은 `canWriteTenant(…,"retention")`를 page가 계산해 내린다.
 */
const ROOT = join(__dirname, "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");

describe("이탈 방어 읽기 권한 — 쓰기 단추", () => {
  it("서버 게이트와 같은 판정을 page가 계산해 내린다", () => {
    expect(read("src/features/retention/server/actions.ts")).toContain('canWriteTenant(user.systemRole, "retention")');
    for (const page of ["campaign", "messages"]) {
      const src = read(`src/app/(shell)/retention/${page}/page.tsx`);
      expect(src, page).toContain('canWriteTenant(user.systemRole, "retention")');
      expect(src, page).toContain("canWrite={canWrite}");
    }
  });

  it("캠페인 보드는 추가·카드 단추를 쓰기 판정 안에서만 그린다", () => {
    const src = read("src/features/retention/components/campaign-board.tsx");
    expect(src).toMatch(/\{canWrite \? \(\s*<button[\s\S]*?campaignAdd/);
    expect(src).toMatch(/\{canWrite \? \(\s*<div className="mt-2 flex flex-wrap gap-1">[\s\S]*?campaignRemove/);
  });

  it("메시지 작성기는 복사는 남기고 '발송 조치 기록'만 쓰기 판정으로 그린다", () => {
    const src = read("src/features/retention/components/message-composer.tsx");
    expect(src).toMatch(/\{canWrite \? \(\s*<form action=\{formAction\}/);
    expect(src).toContain("메시지 복사");
  });
});
