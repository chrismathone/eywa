// 오래된 글의 학부모 댓글 신호(알림 목록) — 순수 판정(2026-10-02 김근호: 15일 전 글에 달린 "오늘 학원 쉽니다"를 아무도 몰랐다).
import { describe, expect, it } from "vitest";
import {
  EVENT_POST_MAX_AGE_DAYS,
  dropAlreadyBelled,
  eventsPageDone,
  markAfterFailures,
  pickEventComments,
  postTooOld,
  selectCommentEvents,
  settleFirstSeen,
} from "./parent-comment-events.mjs";

const NOW = Date.parse("2026-10-02T09:00:00Z");
const ago = (min) => new Date(NOW - min * 60_000).toISOString();
const ev = (id, min, objectId, code = "report_comment") => ({ id, created: ago(min), code, object_id: objectId });

describe("selectCommentEvents — 새 댓글이 달린 스냅샷 밖 글", () => {
  it("지난번에 본 번호보다 큰 댓글 알림만 · 스냅샷 경로가 맡는 글은 뺀다 · 오래된 것부터 · 다음 워터마크는 가장 큰 번호", () => {
    const events = [ev(105, 1, 900), ev(104, 2, 50), ev(103, 3, 800, "report"), ev(102, 4, 700), ev(100, 30, 600)];
    const r = selectCommentEvents(events, { lastId: 101, windowIds: new Set([50]), nowMs: NOW });
    expect(r.reportIds).toEqual([700, 900]);
    expect(r.picked).toEqual([{ reportId: 700, id: 102, created: ago(4) }, { reportId: 900, id: 105, created: ago(1) }]);
    expect(r.top).toEqual({ id: 105, created: ago(1) });
    expect(r.overflow).toBe(0);
    expect(r.pending).toEqual([]);
  });
  it("공지 댓글(notice_comment)·새 글(report) 줄은 건너뛴다 — 워터마크에는 반영된다", () => {
    const r = selectCommentEvents([ev(11, 1, 5, "notice_comment"), ev(10, 2, 6, "report")], { lastId: 9, windowIds: new Set(), nowMs: NOW });
    expect(r.reportIds).toEqual([]);
    expect(r.top?.id).toBe(11);
  });
  it("같은 글의 줄이 두 번 보여도 한 번만(가장 큰 번호로) · 3일 지난 알림은 건너뛴다(밀린 알림 폭주 방지)", () => {
    const events = [ev(30, 1, 900), ev(29, 2, 900), ev(28, 60 * 24 * 4, 800)];
    const r = selectCommentEvents(events, { lastId: 1, windowIds: new Set(), nowMs: NOW });
    expect(r.picked).toEqual([{ reportId: 900, id: 30, created: ago(1) }]);
  });
  it("줄이 하나도 없으면 워터마크를 건드리지 않는다(top=null)", () => {
    expect(selectCommentEvents([], { lastId: 5, windowIds: new Set(), nowMs: NOW }).top).toBeNull();
  });
  it("🔴 상한을 넘으면 오래된 것부터 처리하고, 워터마크는 처리한 줄까지만(시각은 지난 값 그대로) — 남은 글은 다음 폴이 이어받는다", () => {
    const many = Array.from({ length: 5 }, (_, i) => ev(100 - i, i + 1, 1000 + i)); // 번호 100..96 ↔ 글 1000..1004
    const r = selectCommentEvents(many, { lastId: 1, lastCreated: ago(90), windowIds: new Set(), nowMs: NOW, cap: 3 });
    expect(r.reportIds).toEqual([1004, 1003, 1002]); // 번호 96·97·98
    expect(r.overflow).toBe(2);
    expect(r.pending).toEqual([1001, 1000]);
    expect(r.top).toEqual({ id: 98, created: ago(90) }); // 남은 첫 줄(99) 바로 앞 · 시각은 그대로(남은 글의 앞선 댓글을 놓치지 않게)
    expect(r.head).toEqual({ id: 100, created: ago(1) }); // 실제 맨 위 줄 — 첫 실행의 기준선은 이것
    // 다음 폴 — 남은 두 줄을 그대로 받는다
    const next = selectCommentEvents(many, { lastId: r.top.id, lastCreated: r.top.created, windowIds: new Set(), nowMs: NOW, cap: 3 });
    expect(next.reportIds).toEqual([1001, 1000]);
    expect(next.top).toEqual({ id: 100, created: ago(1) });
  });
});

describe("markAfterFailures — 읽지 못한 글이 있을 때의 워터마크", () => {
  const top = { id: 200, created: ago(1) };
  it("실패가 없으면 그대로", () => {
    expect(markAfterFailures(top, [], { lastCreated: ago(30), nowMs: NOW })).toBe(top);
    expect(markAfterFailures(null, [{ id: 5, created: ago(1) }], { nowMs: NOW })).toBeNull();
  });
  it("한 시간 안에 선 실패 줄 중 가장 오래된 것 바로 앞까지만 옮긴다(시각은 지난 값)", () => {
    const failed = [{ id: 150, created: ago(20) }, { id: 120, created: ago(40) }];
    expect(markAfterFailures(top, failed, { lastCreated: ago(90), nowMs: NOW })).toEqual({ id: 119, created: ago(90) });
  });
  it("한 시간이 지난 실패 줄은 포기하고 지나간다(한 글이 경로 전체를 오래 막지 않게)", () => {
    expect(markAfterFailures(top, [{ id: 120, created: ago(61) }], { lastCreated: ago(90), nowMs: NOW })).toBe(top);
  });
});

describe("settleFirstSeen — 스냅샷이 처음 보는 글(댓글이 이미 달린)의 기준선", () => {
  const row = (id, n, min) => ({ id, num_comments: n, created: ago(min) });
  it("알림 목록 경로가 읽은 글은 읽은 댓글 수로 · 아직 못 읽은 어린 글과 밀려 있는 글은 기준선을 미룬다 · 한 시간 넘은 글은 종전대로", () => {
    const rows = [row(1, 2, 5), row(2, 1, 5), row(3, 1, 600), row(4, 1, 600), row(5, 0, 5), row(6, 3, 5)];
    const counts = { 6: 2 }; // 6번은 이미 스냅샷에 있던 글 — 손대지 않는다
    const next = { 1: 2, 2: 1, 3: 1, 4: 1, 5: 0, 6: 3 };
    settleFirstSeen(rows, counts, next, { read: new Map([[1, 3]]), pending: new Set([4]), nowMs: NOW });
    expect(next).toEqual({ 1: 3, 3: 1, 5: 0, 6: 3 });
  });
  it("🔴 알림 목록 조회가 통째로 실패한 폴 — 3일 안에 올라온 글은 기준선을 잡지 않아 다음 폴에 다시 받는다(연동 PC가 오래 꺼졌다 켜진 경우)", () => {
    const next = { 1: 1, 2: 1, 3: 1 };
    settleFirstSeen([row(1, 1, 3), row(2, 1, 90), row(3, 1, 60 * 24 * 4)], {}, next, { read: new Map(), pending: new Set(), failed: true, nowMs: NOW });
    expect(next).toEqual({ 3: 1 });
    // 조회는 됐는데 줄이 아직 안 선 평소 폴은 한 시간까지만 미룬다
    const usual = { 1: 1, 2: 1 };
    settleFirstSeen([row(1, 1, 3), row(2, 1, 90)], {}, usual, { read: new Map(), pending: new Set(), nowMs: NOW });
    expect(usual).toEqual({ 2: 1 });
  });
  it("읽은 글은 피드가 댓글 0이라고 했어도 읽은 댓글 수로 기준선을 잡는다(피드 조회와 알림 목록 조회 사이에 달린 댓글)", () => {
    const next = { 9: 0 };
    settleFirstSeen([row(9, 0, 2)], {}, next, { read: new Map([[9, 1]]), pending: new Set(), nowMs: NOW });
    expect(next).toEqual({ 9: 1 });
  });
});

describe("eventsPageDone — 어디까지 거슬러 읽나", () => {
  it("지난번 번호에 닿았으면 멈춘다 · 아직 위쪽이면 계속", () => {
    expect(eventsPageDone([ev(20, 1, 1), ev(10, 2, 2)], { lastId: 10, nowMs: NOW })).toBe(true);
    expect(eventsPageDone([ev(20, 1, 1), ev(15, 2, 2)], { lastId: 10, nowMs: NOW })).toBe(false);
  });
  it("마지막 줄이 3일보다 오래됐으면 멈춘다 · 빈 페이지도 멈춘다", () => {
    expect(eventsPageDone([ev(20, 60 * 24 * 4, 1)], { lastId: 1, nowMs: NOW })).toBe(true);
    expect(eventsPageDone([], { lastId: 1, nowMs: NOW })).toBe(true);
  });
});

describe("pickEventComments — 그 글의 댓글 중 이번에 새로 달린 학부모 댓글", () => {
  const c = (id, min, type = "parent") => ({ id, created: ago(min), author: { type }, content: `c${id}` });
  it("기준 시각 뒤의 학부모 댓글만 · 강사 답글 제외 · 오래된 순으로", () => {
    const list = [c(5, 1), c(4, 2, "teacher"), c(3, 5), c(2, 60), c(1, 600)];
    const picked = pickEventComments(list, { sinceMs: NOW - 10 * 60_000, nowMs: NOW });
    expect(picked.map((k) => k.id)).toEqual([3, 5]);
  });
  it("3일 지난 댓글은 고르지 않는다 · 기준 시각을 모르면 3일 안의 학부모 댓글 전부(중복은 호출부가 링크로 거른다)", () => {
    const list = [c(3, 1), c(2, 60 * 24 * 2), c(1, 60 * 24 * 5)];
    expect(pickEventComments(list, { sinceMs: NaN, nowMs: NOW }).map((k) => k.id)).toEqual([2, 3]);
  });
  it("번호·시각이 없는 댓글은 버린다", () => {
    expect(pickEventComments([{ author: { type: "parent" }, created: ago(1) }, { id: 9, author: { type: "parent" } }], { sinceMs: 0, nowMs: NOW })).toEqual([]);
  });
});

describe("postTooOld — 30일 지난 글은 알리지 않는다", () => {
  it("경계: 30일 안은 받고 31일째는 건너뛴다 · 시각을 못 읽으면 건너뛴다", () => {
    const day = 24 * 60 * 60_000;
    expect(EVENT_POST_MAX_AGE_DAYS).toBe(30);
    expect(postTooOld({ created: new Date(NOW - 15 * day).toISOString() }, { nowMs: NOW })).toBe(false);
    expect(postTooOld({ created: new Date(NOW - 29.9 * day).toISOString() }, { nowMs: NOW })).toBe(false);
    expect(postTooOld({ created: new Date(NOW - 30.1 * day).toISOString() }, { nowMs: NOW })).toBe(true);
    expect(postTooOld({}, { nowMs: NOW })).toBe(true);
  });
});

describe("dropAlreadyBelled — 이미 보낸 댓글 벨은 다시 넣지 않는다", () => {
  const fakeSql = (sent) => {
    const calls = [];
    const sql = (strings, ...values) => {
      calls.push({ text: strings.join("?"), values });
      return Promise.resolve(sent);
    };
    return { sql, calls };
  };
  const row = (link, recipient, fromEvent) => ({ link, recipient_id: recipient, fromEvent });
  it("두 경로의 줄을 다 본다 — 같은 링크·같은 사람이 이미 있으면 뺀다", async () => {
    const { sql, calls } = fakeSql([{ link: "L1", recipient_id: "u1" }]);
    const rows = [row("L1", "u1", true), row("L1", "u2", true), row("L2", "u1", true), row("L1", "u1", false)];
    const out = await dropAlreadyBelled(sql, "t1", rows);
    expect(out.dropped).toBe(2);
    expect(out.rows).toEqual([row("L1", "u2", true), row("L2", "u1", true)]);
    expect(calls).toHaveLength(1);
    expect(calls[0].values).toEqual(["t1", ["L1", "L2"]]);
  });
  it("넣을 벨이 없으면 조회하지 않는다", async () => {
    const { sql, calls } = fakeSql([]);
    expect(await dropAlreadyBelled(sql, "t1", [])).toEqual({ rows: [], dropped: 0 });
    expect(calls).toEqual([]);
  });
});
