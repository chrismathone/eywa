import { describe, expect, it } from "vitest";
import {
  REPLY_AUTHOR_MAX,
  REPLY_BODY_MAX,
  buildReplyAuthorName,
  canChangeReply,
  replyStatusView,
  replyTargetAllowed,
  teacherReplyLabel,
  testTargetBoardId,
  validateReplyBody,
  workerReadyForReplies,
} from "./reply-policy";

describe("dev 단계 하드 가드 — 학원이 테스트 보드의 학원이 글만", () => {
  it("보드 이름과 원아가 둘 다 맞아야 한다", () => {
    expect(testTargetBoardId({ boardName: "[수학] 테스트반", childId: 5268389 })).toBe(1317083);
    expect(testTargetBoardId({ boardName: " (수학)학원이 ", childId: 5268389 })).toBe(1291581);
    expect(testTargetBoardId({ boardName: "[수학] 테스트반", childId: 5287888 })).toBeNull(); // 학원삼
    expect(testTargetBoardId({ boardName: "(영어)학원이", childId: 5268389 })).toBeNull();
    expect(testTargetBoardId({ boardName: "BS3Q", childId: 5268389 })).toBeNull();
    expect(testTargetBoardId({ boardName: "[수학] 테스트반", childId: null })).toBeNull();
  });

  it("test 모드는 그 밖을 막고, off·pilot·on도 지금은 막는다", () => {
    expect(replyTargetAllowed("test", { boardName: "(수학)학원이", childId: 5268389 })).toEqual({ ok: true, boardId: 1291581 });
    expect(replyTargetAllowed("test", { boardName: "(수학)박서연E", childId: 1 }).ok).toBe(false);
    expect(replyTargetAllowed("off", { boardName: "(수학)학원이", childId: 5268389 }).ok).toBe(false);
    expect(replyTargetAllowed("on", { boardName: "(수학)학원이", childId: 5268389 }).ok).toBe(false);
  });
});

describe("본문·게시 명의", () => {
  it("본문은 앞뒤 공백·CRLF만 정리하고 1,000자까지", () => {
    expect(validateReplyBody("  네\r\n확인했습니다  ")).toEqual({ ok: true, body: "네\n확인했습니다" });
    expect(validateReplyBody("   ").ok).toBe(false);
    expect(validateReplyBody("가".repeat(REPLY_BODY_MAX)).ok).toBe(true);
    const long = validateReplyBody("가".repeat(REPLY_BODY_MAX + 1));
    expect(long.ok).toBe(false);
    if (!long.ok) expect(long.error).toMatch(/1000자/);
  });

  it("강사 호칭 = 발송용 이름 > 표시 이름", () => {
    expect(teacherReplyLabel({ reportDisplayName: " 수진T ", displayName: "이수진" })).toBe("수진T");
    expect(teacherReplyLabel({ reportDisplayName: "", displayName: "이수진" })).toBe("이수진");
  });

  it("반 보드 = `<보드(반) 이름> <호칭>`", () => {
    expect(buildReplyAuthorName({ boardName: "BS3Q", boardIsClass: true, className: "BS3Q", teacherLabel: "수진T" })).toBe("BS3Q 수진T");
    expect(buildReplyAuthorName({ boardName: "[수학] 테스트반", boardIsClass: true, className: null, teacherLabel: "원장" })).toBe("[수학] 테스트반 원장");
  });

  it("1인 보드는 학생 이름을 명의로 쓰지 않는다 — 그 과목 반 이름, 모르면 과목 라벨", () => {
    for (const boardIsClass of [true, false]) {
      expect(buildReplyAuthorName({ boardName: "(수학)학원이", boardIsClass, className: "BS3Q", teacherLabel: "수진T" })).toBe("BS3Q 수진T");
      expect(buildReplyAuthorName({ boardName: "(수학)학원이", boardIsClass, className: null, teacherLabel: "수진T" })).toBe("수학 수진T");
      expect(buildReplyAuthorName({ boardName: "(수학)학원이", boardIsClass, className: null, teacherLabel: "수진T" })).not.toMatch(/학원이/);
    }
  });

  it("반 보드로 확인되지 않은 보드 이름은 명의에 싣지 않는다(접두 없는 1인 보드 = 학생 이름일 수 있다)", () => {
    expect(buildReplyAuthorName({ boardName: "홍길동", boardIsClass: false, className: "BS3Q", teacherLabel: "수진T" })).toBe("BS3Q 수진T");
    expect(buildReplyAuthorName({ boardName: "홍길동", boardIsClass: false, className: null, teacherLabel: "수진T" })).toBe("수진T");
    expect(buildReplyAuthorName({ boardName: "홍길동", boardIsClass: false, className: null, teacherLabel: "수진T" })).not.toMatch(/홍길동/);
  });

  it(`명의는 ${REPLY_AUTHOR_MAX}자를 넘지 않고, 줄여도 호칭은 남긴다`, () => {
    const name = buildReplyAuthorName({ boardName: "가".repeat(80), boardIsClass: true, className: null, teacherLabel: "수진T" });
    expect(name.length).toBeLessThanOrEqual(REPLY_AUTHOR_MAX);
    expect(name.endsWith("수진T")).toBe(true);
  });
});

describe("수정·삭제 권한과 상태 표시", () => {
  const base = { userId: "u1", role: "teacher", authorUserId: "u1", status: "success" as const };
  it("작성자 본인은 자기 답글, 관리자급은 모두 — 대기·게시됨일 때만", () => {
    expect(canChangeReply(base)).toBe(true);
    expect(canChangeReply({ ...base, authorUserId: "u2" })).toBe(false);
    expect(canChangeReply({ ...base, authorUserId: "u2", role: "manager" })).toBe(true);
    expect(canChangeReply({ ...base, authorUserId: "u2", role: "master" })).toBe(true);
    expect(canChangeReply({ ...base, status: "queued" })).toBe(true);
    // 서버가 정한 관리자급(보호된 계정 자동 통과)은 역할과 무관하게 모두 — 그래도 상태 조건은 그대로
    expect(canChangeReply({ ...base, authorUserId: "u2", manager: true })).toBe(true);
    expect(canChangeReply({ ...base, authorUserId: "u2", manager: true, status: "failed" })).toBe(false);
    for (const s of ["processing", "failed", "deleted", "edit_requested", "delete_requested"] as const)
      expect(canChangeReply({ ...base, status: s })).toBe(false);
  });

  it("상태는 한글 라벨 + 의미색 tone(raw 코드 노출 금지)", () => {
    expect(replyStatusView({ status: "queued" })).toMatchObject({ label: "올리기 대기", tone: "info", busy: true });
    expect(replyStatusView({ status: "failed" })).toMatchObject({ tone: "critical", busy: false });
    expect(replyStatusView({ status: "success" }).label).toBe("게시됨");
    expect(replyStatusView({ status: "success", editedAt: "2026-09-30T10:00:00Z" }).label).toBe("게시됨(수정됨)");
    expect(replyStatusView({ status: "success", error: "x", failedAction: "delete" })).toMatchObject({ label: "게시됨 · 삭제 실패", tone: "caution" });
    expect(replyStatusView({ status: "deleted" }).tone).toBe("inert");
  });
});

describe("연동 PC 준비", () => {
  const now = Date.parse("2026-09-30T10:00:00Z");
  const row = (caps: Record<string, unknown>, postMode = true, ago = 60_000) => ({
    last_seen: new Date(now - ago).toISOString(),
    last_results: { postMode, caps },
  });
  it("살아 있고 · 실게시 PC이고 · caps.parentReply가 있어야", () => {
    expect(workerReadyForReplies([row({ parentReply: true })], now)).toBe(true);
    expect(workerReadyForReplies([row({ syncRequests: true })], now)).toBe(false); // 옛 워커(지금 연동 PC)
    expect(workerReadyForReplies([row({ parentReply: true }, false)], now)).toBe(false); // dry-run PC
    expect(workerReadyForReplies([row({ parentReply: true }, true, 6 * 60_000)], now)).toBe(false); // 5분 넘게 조용
    expect(workerReadyForReplies([], now)).toBe(false);
  });
});
