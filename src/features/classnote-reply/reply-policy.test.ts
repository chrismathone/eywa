import { describe, expect, it } from "vitest";
import {
  REPLY_AUTHOR_MAX,
  REPLY_BODY_MAX,
  buildReplyAuthorName,
  canChangeReply,
  replyBoardKnown,
  replyPlaceConfirmed,
  replyStatusView,
  replyTargetAllowed,
  teacherReplyLabel,
  testTargetBoardId,
  validateReplyBody,
  workerReadyForReplies,
} from "./reply-policy";

describe("모드(끔·시험·전체)별 대상", () => {
  it("보드 이름과 원아가 둘 다 맞아야 한다", () => {
    expect(testTargetBoardId({ boardName: "[수학] 테스트반", childId: 5268389 })).toBe(1317083);
    expect(testTargetBoardId({ boardName: " (수학)학원이 ", childId: 5268389 })).toBe(1291581);
    expect(testTargetBoardId({ boardName: "[수학] 테스트반", childId: 5287888 })).toBeNull(); // 학원삼
    expect(testTargetBoardId({ boardName: "(영어)학원이", childId: 5268389 })).toBeNull();
    expect(testTargetBoardId({ boardName: "BS3Q", childId: 5268389 })).toBeNull();
    expect(testTargetBoardId({ boardName: "[수학] 테스트반", childId: null })).toBeNull();
  });

  it("시험은 학원이 테스트 보드의 글만, 끔은 전부 막는다(기능이 있다는 것도 알리지 않는다)", () => {
    expect(replyTargetAllowed("test", { boardName: "(수학)학원이", childId: 5268389 })).toEqual({ ok: true, boardId: 1291581 });
    expect(replyTargetAllowed("test", { boardName: "(수학)박서연E", childId: 1 }).ok).toBe(false);
    const off = replyTargetAllowed("off", { boardName: "(수학)학원이", childId: 5268389 });
    expect(off).toEqual({ ok: false, reason: "사용할 수 없는 기능입니다" });
    expect(replyTargetAllowed("pilot" as never, { boardName: "BS3Q", childId: 1 }).ok).toBe(false);
  });

  it("전체는 어느 글이든 받는다(자격·대상 확정은 서버가 따로 본다) — 시험 보드면 보드 번호를 싣는다", () => {
    expect(replyTargetAllowed("on", { boardName: "BS3Q", childId: 7 })).toEqual({ ok: true, boardId: null });
    expect(replyTargetAllowed("on", { boardName: "(수학)박서연E", childId: 1 })).toEqual({ ok: true, boardId: null });
    expect(replyTargetAllowed("on", { boardName: "[수학] 테스트반", childId: 5268389 })).toEqual({ ok: true, boardId: 1317083 });
  });

  it("전체 모드에서 목록이 버튼을 세우는 보드 — 연결된 반 보드·1인 보드 모양만(영어 그룹반 등은 세우지 않는다)", () => {
    const on = { mode: "on" as const, testBoardId: null, boardIsClass: false, boardName: "BS3Q" };
    expect(replyBoardKnown({ ...on, boardIsClass: true })).toBe(true);
    expect(replyBoardKnown({ ...on, boardName: "(수학)김하나" })).toBe(true);
    for (const boardName of ["[EIE] Level 3", "PB2a", "(국어)김하나", null]) expect(replyBoardKnown({ ...on, boardName })).toBe(false);
    expect(replyBoardKnown({ ...on, testBoardId: 1317083, boardName: "[수학] 테스트반" })).toBe(true);
    expect(replyBoardKnown({ ...on, mode: "test", boardName: "PB2a" })).toBe(true); // 시험 모드는 replyTargetAllowed가 이미 걸렀다
  });

  it("전체 모드 사전 확인 — 연결된 반 보드·1인 보드이고 학생·원아가 확정된 글만", () => {
    const base = { mode: "on" as const, testBoardId: null, boardIsClass: true, boardName: "BS3Q", studentId: "s1", childId: 7 };
    expect(replyPlaceConfirmed(base)).toEqual({ ok: true });
    const personal = { ...base, boardIsClass: false, boardName: "(수학) 김하나" };
    expect(replyPlaceConfirmed({ ...personal, studentBoardName: "김하나" }).ok).toBe(true);
    // 1인 보드는 보드 이름이 확정 연결된 학생의 보드 이름과 같아야 한다(형제·동명이인 보드에 쓴 글은 받지 않는다).
    for (const studentBoardName of ["김하나B", "이두리", null, undefined]) {
      const r = replyPlaceConfirmed({ ...personal, studentBoardName });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/1인 보드와 달라/);
    }
    expect(replyPlaceConfirmed({ ...base, boardIsClass: false, boardName: "(국어)김하나", studentBoardName: "김하나" }).ok).toBe(false); // 발송 보드가 없는 과목
    const unknown = replyPlaceConfirmed({ ...base, boardIsClass: false, boardName: "영어 그룹반" });
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.reason).toMatch(/연결된 반 보드나 1인 보드/);
    for (const miss of [{ studentId: null }, { childId: null }]) {
      const r = replyPlaceConfirmed({ ...base, ...miss });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/학생을 확정하지 못해/);
    }
    // 시험 보드·시험 모드는 이 확인을 거치지 않는다(시험 규칙이 따로 막는다).
    expect(replyPlaceConfirmed({ ...base, testBoardId: 1317083, boardIsClass: false, boardName: "x", studentId: null }).ok).toBe(true);
    expect(replyPlaceConfirmed({ ...base, mode: "test", studentId: null }).ok).toBe(true);
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

  it("🔴 연동 PC가 한 번 이상 시도한 대기 행은 고치거나 취소할 수 없다(게시 요청이 나갔을 수 있다 — 관리자급도)", () => {
    expect(canChangeReply({ ...base, status: "queued", retryCount: 0 })).toBe(true);
    expect(canChangeReply({ ...base, status: "queued", retryCount: 1 })).toBe(false);
    expect(canChangeReply({ ...base, status: "queued", retryCount: 2, manager: true })).toBe(false);
    // 멈춤 복구로 돌아온 행(시도 횟수는 0이지만 연동 PC가 집은 적이 있다)도 같다.
    expect(canChangeReply({ ...base, status: "queued", retryCount: 0, claimed: true })).toBe(false);
    expect(canChangeReply({ ...base, status: "queued", retryCount: 0, claimed: false })).toBe(true);
    // 게시된 답글은 시도 횟수와 무관하다(수정·삭제는 워커가 ClassNote 댓글을 다시 읽어 한다).
    expect(canChangeReply({ ...base, status: "success", retryCount: 1 })).toBe(true);
    expect(canChangeReply({ ...base, status: "success", claimed: true })).toBe(true);
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
  const NEW = { parentReply: true, parentReplySettings: true };
  it("살아 있고 · 실게시 PC이고 · 답글을 알고(caps.parentReply) · 설정 모드를 읽는 판(caps.parentReplySettings)이어야", () => {
    expect(workerReadyForReplies([row(NEW)], now)).toBe(true);
    expect(workerReadyForReplies([row({ parentReply: true })], now)).toBe(false); // 모드가 코드 상수(시험)인 옛 판 — '전체' 요청을 전부 실패시킨다
    expect(workerReadyForReplies([row({ syncRequests: true })], now)).toBe(false); // 답글을 모르는 옛 워커
    expect(workerReadyForReplies([row(NEW, false)], now)).toBe(false); // dry-run PC
    expect(workerReadyForReplies([row(NEW, true, 6 * 60_000)], now)).toBe(false); // 5분 넘게 조용
    expect(workerReadyForReplies([], now)).toBe(false);
  });

  it("🔴 살아 있는 실게시 PC가 여럿이면 **전부** 새 판이어야 한다(옛 판이 담당이면 아무도 안 집는다)", () => {
    expect(workerReadyForReplies([row(NEW), row({ syncRequests: true })], now)).toBe(false);
    expect(workerReadyForReplies([row(NEW), row(NEW)], now)).toBe(true);
    // 죽었거나 dry-run인 옛 판은 세지 않는다.
    expect(workerReadyForReplies([row(NEW), row({ syncRequests: true }, true, 6 * 60_000), row({}, false)], now)).toBe(true);
    expect(workerReadyForReplies([row({ ...NEW, parentReaction: true }), row(NEW)], now, "parentReaction")).toBe(false);
  });

  it("공감은 caps.parentReaction이 따로 있어야 한다(답글만 아는 워커엔 공감 요청을 받지 않는다)", () => {
    expect(workerReadyForReplies([row({ parentReply: true })], now, "parentReaction")).toBe(false);
    expect(workerReadyForReplies([row({ parentReply: true, parentReaction: true })], now, "parentReaction")).toBe(true);
    expect(workerReadyForReplies([row({ parentReaction: true }, false)], now, "parentReaction")).toBe(false);
  });
});
