// 관리자 직접 작성의 과목 기본값 + 재클릭 중복 게시 방어(관리자 경로) — 2026-10-02 발송 배선 점검.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultComposeSubject } from "./compose-default-subject";

const s = (key: string, board: string | null, sendable = true) => ({ key, board, sendable });

describe("defaultComposeSubject — 고를 알림장이 하나뿐일 때만 자동 선택", () => {
  it("수강 중인 발송 가능 과목이 하나면 그 과목", () => {
    expect(defaultComposeSubject([s("math", "(수학)홍길동")], [])?.key).toBe("math");
    expect(defaultComposeSubject([s("science", null, false), s("english", "(영어)홍길동")], [])?.key).toBe("english");
  });
  it("🔴 두 과목을 다 들으면 고르지 않는다 — 조회 순서의 첫 과목으로 잡지 않는다", () => {
    expect(defaultComposeSubject([s("english", "(영어)홍길동"), s("math", "(수학)홍길동")], [s("math", "(수학)홍길동")])).toBeNull();
    expect(defaultComposeSubject([s("math", "(수학)홍길동"), s("english", "(영어)홍길동")], [])).toBeNull();
  });
  it("같은 알림장으로 가는 과목(math·subject_1)은 하나로 본다", () => {
    expect(defaultComposeSubject([s("math", "(수학)홍길동"), s("subject_1", "(수학)홍길동")], [])?.key).toBe("math");
  });
  it("수강 중인 발송 가능 과목이 없으면 학원 발송 과목이 한 알림장일 때만", () => {
    expect(defaultComposeSubject([], [s("math", "(수학)학원이")])?.key).toBe("math");
    expect(defaultComposeSubject([s("science", null, false)], [s("math", "(수학)학원이"), s("english", "(영어)학원이")])).toBeNull();
    expect(defaultComposeSubject([], [])).toBeNull();
  });
});

/**
 * 🔴 관리자 경로의 재클릭 중복 게시 방어 — 강사 경로(onescreen/classnote-requeue-guard.test.ts)와 같은 규약.
 * 발송 상태를 쓰는 update는 **쓰는 순간의 상태**로 거른다(워커가 집었거나 보낸 행은 덮지 않는다).
 */
describe("관리자 직접 작성 발송 — 재클릭 경합 방어(배선)", () => {
  const COMPOSE = readFileSync(join(__dirname, "server", "compose-actions.ts"), "utf8");
  const ATTACH = readFileSync(join(__dirname, "..", "onescreen", "server", "attachment-actions.ts"), "utf8");
  const FACE = readFileSync(join(__dirname, "..", "..", "app", "(shell)", "lesson-reports", "_components", "compose-face.tsx"), "utf8");

  it("조건 = 워커가 집지도 보내지도 않은 행만(강사 경로와 같은 값)", () => {
    expect(COMPOSE).toContain('const CLASSNOTE_REQUEUE_OK = "classnote_status.is.null,classnote_status.not.in.(processing,success)";');
  });
  it("발송 대기 적재는 조건부이고, 0행이면 다시 올리지 않고 상태를 돌려준다", () => {
    const at = COMPOSE.indexOf('classnote_status: allowed ? "queued" : "too_old"');
    expect(at).toBeGreaterThan(-1);
    const end = COMPOSE.indexOf("if (!queuedRows?.length)", at);
    expect(end).toBeGreaterThan(at);
    const stmt = COMPOSE.slice(at, end);
    expect(stmt).toContain(".or(CLASSNOTE_REQUEUE_OK)");
    expect(stmt).toContain('.select("id")');
    expect(COMPOSE.slice(end, end + 150)).toContain("if (!queuedRows?.length) return await unqueuedStatus(");
    expect(stmt).toContain('queueQuery.eq("makeup_class_id", saved.makeupClassId)');
    // 0행의 답 = 지금 상태 그대로(처리 중 / 이미 발송) · 그 밖은 지어내지 않고 오류
    const helper = COMPOSE.slice(COMPOSE.indexOf("async function unqueuedStatus("));
    expect(helper.slice(0, 900)).toMatch(/st === "processing" \|\| st === "success"[\s\S]*already_sent[\s\S]*ok: false/);
  });
  it("동명이인 차단 표시도 조건부 — 보낸 글을 '차단됨'으로 덮지 않는다", () => {
    const at = COMPOSE.indexOf('classnote_status: "name_conflict"');
    expect(at).toBeGreaterThan(-1);
    expect(COMPOSE.slice(at, at + 500)).toContain(".or(CLASSNOTE_REQUEUE_OK)");
    expect(COMPOSE.slice(at, at + 700)).toContain("if (!conflictRows?.length) return await unqueuedStatus(");
  });
  it("첨부 추가·삭제의 발송 상태 리셋도 조건부 — 보낸 글·회수 진행 중인 글은 지우지 않는다(처리 중은 종전대로 리셋 = 발송 취소)", () => {
    const resets = ATTACH.split(".update({ attachments: next, ...CLASSNOTE_RESET })").slice(1);
    expect(resets).toHaveLength(2);
    for (const tail of resets) {
      expect(tail.slice(0, 200)).toContain(".or(RESET_OK)");
      // 0행이면 반드시 멈추고 사유를 돌려준다 — 이 줄이 빠지면 DB는 그대로인데 파일만 지워지거나 고아 파일이 남는다.
      expect(tail.slice(0, 600)).toMatch(/if \(!resetRows\?\.length\)[\s\S]*resetBlockedError\(/);
    }
    expect(ATTACH).toContain('const RESET_OK = "classnote_status.is.null,classnote_status.not.in.(success,recall_requested,recalling,recall_failed)";');
    expect(ATTACH).toMatch(/status === "success"\) return SENT_LOCK_ERROR/);
  });
  it("화면은 '이미 발송됨'을 따로 안내한다 — '처리했습니다'로 뭉개지 않는다", () => {
    expect(FACE).toMatch(/already_sent: \{ kind: "warn"/);
  });
  it("화면의 과목 기본값은 defaultComposeSubject를 거친다 — '첫 번째 과목'으로 되돌리지 않는다", () => {
    expect(FACE).toContain("defaultComposeSubject(res.subjects ?? [], fallback)");
    expect(FACE).not.toMatch(/find\(\(s\) => s\.sendable\) \?\? fallback\[0\]/);
  });
});
