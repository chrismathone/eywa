import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as worker from "../../../scripts/_classnote/parent-reply-guard.mjs";
import * as workerReaction from "../../../scripts/_classnote/parent-reaction-guard.mjs";
import { reportSchema } from "@/features/owner/settings-types";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import * as reaction from "./reaction-policy";
import * as app from "./reply-policy";

/**
 * 앱(reply-policy.ts·reaction-policy.ts)과 워커(parent-reply-guard.mjs·parent-reaction-guard.mjs)가 **같은 값**을 든다 — 런타임이 달라 한 벌을 못 나눈다.
 * 한쪽만 바꾸면(예: 테스트 보드 추가) 앱은 받는데 워커가 거절하거나, 그 반대가 된다.
 */
const MODES = ["off", "test", "on"] as const;

describe("답글 가드 — 앱·워커 한 벌", () => {
  it("길이·테스트 대상이 같다", () => {
    expect(app.REPLY_BODY_MAX).toBe(worker.REPLY_BODY_MAX);
    expect(app.REPLY_AUTHOR_MAX).toBe(worker.REPLY_AUTHOR_MAX);
    expect(JSON.parse(JSON.stringify(app.REPLY_TEST_TARGETS))).toEqual(JSON.parse(JSON.stringify(worker.REPLY_TEST_TARGETS)));
  });

  it("모드는 셋(끔·시험·전체)이고 설정 스키마·워커·기본값이 같은 값을 쓴다 — 기본은 끔, 그 밖의 값은 받지 않는다", () => {
    expect([...worker.REPLY_MODES]).toEqual([...MODES]);
    expect(DEFAULT_SETTINGS.report.classnoteParentReplyMode).toBe("off");
    for (const mode of MODES) expect(reportSchema.safeParse({ ...DEFAULT_SETTINGS.report, classnoteParentReplyMode: mode }).success).toBe(true);
    for (const bad of ["pilot", "ON", "", null, true]) expect(reportSchema.safeParse({ ...DEFAULT_SETTINGS.report, classnoteParentReplyMode: bad }).success).toBe(false);
    // 옛 저장분(칸 없음)은 끔으로 읽힌다.
    const { classnoteParentReplyMode: _omit, ...legacy } = DEFAULT_SETTINGS.report;
    void _omit;
    const parsed = reportSchema.safeParse(legacy);
    expect(parsed.success && parsed.data.classnoteParentReplyMode).toBe("off");
  });

  it("워커가 읽는 설정 칸 이름 = 스키마의 칸 이름(한쪽만 바꾸면 워커는 늘 끔으로 읽는다)", () => {
    const core = readFileSync(join(process.cwd(), "scripts/_classnote/classnote-parent-reply-core.mjs"), "utf8");
    expect(core).toMatch(/data->'report'->>'classnoteParentReplyMode'/);
    expect("classnoteParentReplyMode" in reportSchema.shape).toBe(true);
  });

  it("앱이 받은 테스트 대상은 워커 사전 판정도 통과한다(앱이 적는 보드 번호 그대로) — 시험·전체 둘 다", () => {
    for (const mode of ["test", "on"] as const) {
      for (const b of app.REPLY_TEST_TARGETS.boards) {
        const allowed = app.replyTargetAllowed(mode, { boardName: b.name, childId: 5268389 });
        expect(allowed.ok).toBe(true);
        const boardId = allowed.ok ? allowed.boardId : null;
        expect(boardId).toBe(b.id);
        expect(worker.preflightReplyRow({ mode, row: { board_id: boardId, child_id: 5268389, classnote_post_id: 1, author_label: "a b", body: "x" } }).ok).toBe(true);
      }
    }
  });

  it("끔이면 앱도 워커도 아무것도 받지 않는다(시험 보드여도)", () => {
    for (const b of app.REPLY_TEST_TARGETS.boards) {
      expect(app.replyTargetAllowed("off", { boardName: b.name, childId: 5268389 }).ok).toBe(false);
      expect(worker.preflightReplyRow({ mode: "off", row: { board_id: b.id, child_id: 5268389, classnote_post_id: 1, author_label: "a b", body: "x" } }).ok).toBe(false);
    }
    // 타입 밖 값이 흘러들어도 열리지 않는다.
    expect(app.replyTargetAllowed("pilot" as never, { boardName: "BS3Q", childId: 1 }).ok).toBe(false);
  });

  it("워커 쓰기 허가증도 같은 대상만 통과시킨다(앱이 받은 테스트 보드 = 워커가 쓰는 보드)", () => {
    for (const b of app.REPLY_TEST_TARGETS.boards) {
      const permit = worker.evaluateReplyTarget({
        mode: "test",
        row: { board_id: b.id, child_id: 5268389, classnote_post_id: 7 },
        post: { status: 200, cls: b.id, child: 5268389 },
        boardChildren: [{ id: 5268389, name: "학원이" }],
      });
      expect(permit.ok).toBe(true);
      expect(worker.assertReplyWritePermit(permit, 7, "test")).toBe(true);
    }
    expect(() => worker.assertReplyWritePermit({ ok: true, boardId: 1234567, childId: 5268389, postId: 7 }, 7, "test")).toThrow();
  });

  it("전체 모드 사전 확인(앱)이 받는 자리 = 워커 사전 판정이 받는 자리 — 학생·원아가 확정된 행만", () => {
    const place = (studentId: string | null, childId: number | null, boardIsClass = true, boardName = "BS3Q") =>
      app.replyPlaceConfirmed({ mode: "on", testBoardId: null, boardIsClass, boardName, studentId, childId }).ok;
    const pre = (student_id: string | null, child_id: number | null) =>
      worker.preflightReplyRow({ mode: "on", row: { message_id: "m", student_id, child_id, board_id: null, classnote_post_id: 1, author_label: "a b", body: "x" } }).ok;
    for (const [s, c] of [["s1", 7], [null, 7], ["s1", null]] as const) expect(place(s, c)).toBe(pre(s, c));
    expect(place("s1", 7, false, "영어 그룹반")).toBe(false); // 연결 없는 보드 — 워커 ③이 거절하는 자리
    // 1인 보드 — 앱·워커가 같은 모양만 1인 보드로 보고, 같은 이름 대조를 한다.
    for (const name of ["(수학)김하나", "(영어) 김 하나", "(국어)김하나", "[수학] 테스트반", "BS3Q", "(수학)"])
      expect(app.personalBoardStudentName(name)).toBe(worker.personalBoardOf(name)?.name ?? null);
    const personal = (studentBoardName: string | null) =>
      app.replyPlaceConfirmed({ mode: "on", testBoardId: null, boardIsClass: false, boardName: "(수학)김하나", studentId: "s1", childId: 7, studentBoardName }).ok;
    const facts = (studentNames: string[]) => ({
      message: { id: "m", source: "post", classnote_post_id: 1, classnote_comment_id: null, child_id: 7 },
      classBoards: [], memberStudentIds: [], childLinkStudentId: "s1", studentNames,
    });
    const workerOk = (studentNames: string[]) =>
      worker.evaluateReplyTarget({
        mode: "on", row: { message_id: "m", student_id: "s1", child_id: 7, board_id: null, classnote_post_id: 1, reply_to_comment_id: null },
        post: { status: 200, cls: 3000001, child: 7, className: "(수학)김하나" }, boardChildren: [{ id: 7, name: "김하나" }], facts: facts(studentNames),
      }).ok;
    for (const n of ["김하나", "김 하나", "김하나B", "이두리"]) expect(personal(n)).toBe(workerOk([n]));
    expect(personal(null)).toBe(workerOk([]));
  });

  it("본문 정규화가 같다(앱이 저장한 본문 = 워커가 비교·게시하는 본문)", () => {
    for (const s of ["  a\r\nb  ", "\n가\r나\n", "x"]) {
      const v = app.validateReplyBody(s);
      expect(v.ok && v.body).toBe(worker.normalizeReplyText(s));
    }
  });

  it("공감 종류·라벨이 같다(앱이 받은 종류 = 워커가 누르는 종류)", () => {
    expect([...reaction.REACTION_TYPES]).toEqual([...workerReaction.REACTION_TYPES]);
    expect({ ...reaction.REACTION_LABELS }).toEqual({ ...workerReaction.REACTION_LABELS });
    for (const t of reaction.REACTION_TYPES) {
      const row = { board_id: 1317083, child_id: 5268389, classnote_post_id: 1, author_label: "a b", reaction_type: t };
      expect(workerReaction.preflightReactionRow({ mode: "test", row }).ok).toBe(true);
    }
  });

  it("연동 PC가 알리는 기능 표시(caps.parentReply·parentReaction)를 데몬이 실제로 싣는다", () => {
    const daemon = readFileSync(join(process.cwd(), "scripts/_classnote/watch-classnote-queue.mjs"), "utf8");
    expect(daemon).toMatch(/WORKER_CAPS\s*=\s*\{[^}]*parentReply:\s*true/);
    expect(daemon).toMatch(/WORKER_CAPS\s*=\s*\{[^}]*parentReplySettings:\s*true/);
    // 앱이 요구하는 표식 = 데몬이 싣는 표식(한쪽만 이름을 바꾸면 앱이 영영 요청을 안 받는다).
    const caps = Object.fromEntries([...(/WORKER_CAPS\s*=\s*\{([^}]*)\}/.exec(daemon)?.[1] ?? "").matchAll(/(\w+):\s*true/g)].map((m) => [m[1], true]));
    const hb = [{ last_seen: new Date().toISOString(), last_results: { postMode: true, caps } }];
    expect(app.workerReadyForReplies(hb, Date.now(), "parentReply")).toBe(true);
    expect(app.workerReadyForReplies(hb, Date.now(), "parentReaction")).toBe(true);
    expect(daemon).toMatch(/WORKER_CAPS\s*=\s*\{[^}]*parentReaction:\s*true/);
    expect(daemon).toMatch(/processParentRepliesOnce\(/);
    expect(daemon).toMatch(/processParentReactionsOnce\(/);
  });

  it("벨의 답글·공감 버튼 조회는 표 유무를 HEAD로 묻지 않는다(표가 없어도 오류가 안 나 버튼이 선다, #95)", () => {
    const dir = join(process.cwd(), "src/features/classnote-reply/server");
    const read = (f: string) => readFileSync(join(dir, f), "utf8");
    const actions = read("reply-actions.ts");
    expect(actions).toMatch(/replyTableReady\(admin, g\.user\.tenantId\)/);
    expect(actions).toMatch(/reactionReady\(admin, g\.user\.tenantId\)/);
    const all = ["reply-actions.ts", "reply-data.ts", "reply-queries.ts", "reaction-actions.ts", "reaction-data.ts"].map(read).join("\n");
    expect(all.replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/head:\s*true/);
  });
});
