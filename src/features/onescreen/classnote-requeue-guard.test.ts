import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 🔴 ClassNote 재클릭 중복 게시 방어 — 원장 2026-09-29 *"방어 가드 넣자"*.
 * 9/29 박세욱: 발송 → 첨부 추가 → 0.3초 뒤 다시 발송. 맨 위의 processing·success 확인을 지난 뒤 워커가 첫 글을 올렸고,
 * 뒤이은 무조건 update가 success를 queued로 되돌려 같은 글이 한 번 더 나갔다(ClassNote 글은 지울 수 없다).
 * → 발송 상태를 쓰는 update는 **쓰는 순간의 상태**로 거른다(compare-and-set). 이 가드는 그 조건이 빠지지 않게 잠근다.
 */
const SRC = readFileSync(join(__dirname, "server", "actions.ts"), "utf8");

describe("원스크린 ClassNote 발송 — 재클릭 경합 방어", () => {
  it("조건 = 워커가 집지도 보내지도 않은 행만", () => {
    expect(SRC).toContain('const CLASSNOTE_REQUEUE_OK = "classnote_status.is.null,classnote_status.not.in.(processing,success)";');
  });

  it("발송 대기 적재(queued/too_old)는 조건부이고, 0행이면 다시 올리지 않고 상태를 돌려준다", () => {
    const at = SRC.indexOf('classnote_status: allowed ? "queued" : "too_old"');
    expect(at).toBeGreaterThan(-1);
    const stmt = SRC.slice(at, at + 600);
    expect(stmt).toContain(".or(CLASSNOTE_REQUEUE_OK)");
    expect(stmt).toContain('.select("id")');
    expect(SRC.slice(at, at + 1200)).toMatch(/if \(!queuedRows\?\.length\)[\s\S]*already_sent/);
  });

  it("동명이인 차단 표시도 조건부 — 보낸 글을 '차단됨'으로 덮지 않는다", () => {
    const at = SRC.indexOf('classnote_status: "name_conflict"');
    expect(at).toBeGreaterThan(-1);
    expect(SRC.slice(at, at + 500)).toContain(".or(CLASSNOTE_REQUEUE_OK)");
  });
});
