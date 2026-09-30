import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as worker from "../../../scripts/_classnote/parent-reply-guard.mjs";
import * as app from "./reply-policy";

/**
 * 앱(reply-policy.ts)과 워커(parent-reply-guard.mjs)가 **같은 값**을 든다 — 런타임이 달라 한 벌을 못 나눈다.
 * 한쪽만 바꾸면(예: 테스트 보드 추가) 앱은 받는데 워커가 거절하거나, 그 반대가 된다.
 */
describe("답글 가드 — 앱·워커 한 벌", () => {
  it("모드·길이·테스트 대상이 같다", () => {
    expect(app.REPLY_MODE).toBe(worker.REPLY_MODE);
    expect(app.REPLY_BODY_MAX).toBe(worker.REPLY_BODY_MAX);
    expect(app.REPLY_AUTHOR_MAX).toBe(worker.REPLY_AUTHOR_MAX);
    expect(JSON.parse(JSON.stringify(app.REPLY_TEST_TARGETS))).toEqual(JSON.parse(JSON.stringify(worker.REPLY_TEST_TARGETS)));
  });

  it("앱이 받은 테스트 대상은 워커 사전 판정도 통과한다(앱이 적는 보드 번호 그대로)", () => {
    for (const b of app.REPLY_TEST_TARGETS.boards) {
      const allowed = app.replyTargetAllowed(app.REPLY_MODE, { boardName: b.name, childId: 5268389 });
      expect(allowed.ok).toBe(true);
      const boardId = allowed.ok ? allowed.boardId : null;
      expect(worker.preflightReplyRow({ row: { board_id: boardId, child_id: 5268389, classnote_post_id: 1, author_label: "a b", body: "x" } }).ok).toBe(true);
    }
  });

  it("워커 쓰기 허가증도 같은 대상만 통과시킨다(앱이 받은 테스트 보드 = 워커가 쓰는 보드)", () => {
    for (const b of app.REPLY_TEST_TARGETS.boards) {
      const permit = worker.evaluateReplyTarget({
        row: { board_id: b.id, child_id: 5268389, classnote_post_id: 7 },
        post: { status: 200, cls: b.id, child: 5268389 },
        boardChildren: [{ id: 5268389, name: "학원이" }],
      });
      expect(permit.ok).toBe(true);
      expect(worker.assertReplyWritePermit(permit, 7)).toBe(true);
    }
    expect(() => worker.assertReplyWritePermit({ ok: true, boardId: 1234567, childId: 5268389, postId: 7 }, 7)).toThrow();
  });

  it("본문 정규화가 같다(앱이 저장한 본문 = 워커가 비교·게시하는 본문)", () => {
    for (const s of ["  a\r\nb  ", "\n가\r나\n", "x"]) {
      const v = app.validateReplyBody(s);
      expect(v.ok && v.body).toBe(worker.normalizeReplyText(s));
    }
  });

  it("연동 PC가 알리는 기능 표시(caps.parentReply)를 데몬이 실제로 싣는다", () => {
    const daemon = readFileSync(join(process.cwd(), "scripts/_classnote/watch-classnote-queue.mjs"), "utf8");
    expect(daemon).toMatch(/WORKER_CAPS\s*=\s*\{[^}]*parentReply:\s*true/);
    expect(daemon).toMatch(/processParentRepliesOnce\(/);
  });

  it("벨의 답글 버튼 조회는 표 유무를 HEAD로 묻지 않는다(표가 없어도 오류가 안 나 버튼이 선다, #95)", () => {
    const dir = join(process.cwd(), "src/features/classnote-reply/server");
    const actions = readFileSync(join(dir, "reply-actions.ts"), "utf8");
    const data = readFileSync(join(dir, "reply-data.ts"), "utf8");
    expect(actions).toMatch(/replyTableReady\(admin, g\.user\.tenantId\)/);
    expect(`${actions}${data}`.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/head:\s*true/);
  });
});
