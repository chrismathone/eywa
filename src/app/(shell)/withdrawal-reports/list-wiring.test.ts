import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 퇴원보고서 목록 배선 — 서버 화면(page.tsx)은 렌더 시험이 무거워 원문으로 잠근다(리뷰 2026-11-06).
 * 목록의 '내 재요청 필요'는 상세 화면 취소 단추·서버 취소 권한과 **같은 원장급 판정**이어야 하고,
 * 승인 완료 줄은 목록 조회가 실어 온 묶음 형제 상태로 단계를 가른다.
 */
const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const DIRECTOR = "cancelsAsDirector(viewer.user.systemRole, !!viewer.teacherId)";

describe("퇴원보고서 목록 배선", () => {
  const page = read("src/app/(shell)/withdrawal-reports/page.tsx");
  const start = page.indexOf("buildListItems({");
  const call = page.slice(start, page.indexOf("});", start));

  it("목록은 상세·서버 취소와 같은 원장급 판정(directorLevel)과 쓰기 권한을 buildListItems에 넘긴다", () => {
    expect(start).toBeGreaterThan(-1);
    expect(call).toContain(`directorLevel: ${DIRECTOR}`);
    expect(call).toContain("writable: viewer.writable");
    expect(call).toContain("userId: viewer.user.id");
    // 상세 화면 취소 단추 · 서버 취소 권한이 같은 식을 쓴다(한쪽만 바뀌면 이 시험이 빨개진다)
    expect(read("src/app/(shell)/withdrawal-reports/[id]/page.tsx")).toContain(`directorLevel={${DIRECTOR}}`);
    expect(read("src/features/withdrawal-reports/server/actions.ts")).toContain(`!${DIRECTOR}`);
  });

  it("승인 완료 줄의 단계 판정에 목록 조회의 묶음 형제 상태를 넘긴다", () => {
    expect(call).toContain("groupStatuses: list.groupStatuses");
    expect(read("src/features/withdrawal-reports/server/queries.ts")).toMatch(/groupStatuses: await groupStatusesOf\(viewer\.user\.tenantId, rows\)/);
  });
});
