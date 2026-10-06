import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// 배분 자동 재확정 배선 — 확정 세 갈래가 **응답 전에** 부르고, 저장은 사람이 누르는 것과 같은 DB 함수로만 한다.
const dir = path.join(process.cwd(), "src", "features", "billing", "session-terms", "server");
const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");
/** `export async function name(`부터 다음 `export ` 전까지. */
function body(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start, `${name}을 찾지 못함`).toBeGreaterThan(-1);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next === -1 ? undefined : next);
}

describe("배분 자동 재확정 — 확정 경로 배선", () => {
  it("한 칸 확정·반 일괄 확정·선택 확정이 확정 쓰기 뒤, 응답 전에 부른다", () => {
    const actions = read("actions.ts");
    for (const [src, fn, trigger] of [
      [actions, "confirmSessionTerm", "confirm"], [actions, "confirmClassTerms", "confirm_class"],
      [read("selected-confirm-actions.ts"), "confirmSelectedTerms", "confirm_selected"],
    ] as const) {
      const b = body(src, fn);
      const call = b.indexOf(`await autoReallocateAfterConfirm(supabase,`);
      expect(call, `${fn}: 자동 재확정 호출이 없다`).toBeGreaterThan(-1);
      expect(b.slice(call, call + 200)).toContain(`"${trigger}"`);
      // 확정 쓰기(update) 뒤 · 마지막 return 전
      expect(b.indexOf(".update(")).toBeLessThan(call);
      expect(call).toBeLessThan(b.lastIndexOf("return {"));
    }
  });

  it("확정 해제는 부르지 않는다(풀린 반은 다시 확정할 때 맞춘다)", () => {
    expect(body(read("actions.ts"), "unconfirmSessionTerm")).not.toContain("autoReallocateAfterConfirm");
    expect(read("class-unconfirm-actions.ts")).not.toContain("autoReallocateAfterConfirm");
  });

  it("저장은 항목별 배분 함수 하나로만 — 자유 배분 함수는 쓰지 않는다", () => {
    const src = read("auto-reallocate.ts");
    expect(src).toContain(`db.rpc("save_session_receipt_allocations",`);
    expect(src).not.toContain("save_session_receipt_allocations_free");
    // 감사로그는 사람이 누른 저장과 다른 키로 남는다(누가 바꿨는지 가린다).
    expect(src).toContain(`action: "session_term_receipt_allocate_auto"`);
  });
});
