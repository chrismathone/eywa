import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  incrementalSince,
  isChangeNotification,
  isGoneError,
  isPlainEventId,
  needsChannelRenewal,
  seriesInstanceIds,
  splitChanges,
  verifyPushHeaders,
} from "./google-push";

const stored = { channelId: "ch-1", channelToken: "tok-secret", resourceId: "res-1" };
const hdr = (o: Partial<Parameters<typeof verifyPushHeaders>[0]> = {}) => ({
  channelId: "ch-1",
  channelToken: "tok-secret",
  resourceId: "res-1",
  resourceState: "exists",
  ...o,
});

describe("구글 캘린더 푸시 — 헤더 검증", () => {
  it("우리 채널·토큰·리소스가 모두 맞아야 통과", () => {
    expect(verifyPushHeaders(hdr(), stored)).toBe(true);
  });
  it("🔴 토큰이 틀리거나 비면 거절(공개 주소라 누구나 두드린다)", () => {
    expect(verifyPushHeaders(hdr({ channelToken: "tok-secreT" }), stored)).toBe(false);
    expect(verifyPushHeaders(hdr({ channelToken: null }), stored)).toBe(false);
    expect(verifyPushHeaders(hdr(), { ...stored, channelToken: "" })).toBe(false);
  });
  it("채널 id·리소스 id가 다르면 거절, 저장된 줄이 없으면 거절", () => {
    expect(verifyPushHeaders(hdr({ channelId: "ch-2" }), stored)).toBe(false);
    expect(verifyPushHeaders(hdr({ resourceId: "res-2" }), stored)).toBe(false);
    expect(verifyPushHeaders(hdr(), null)).toBe(false);
  });
  it("리소스 id를 아직 모르면(저장 전) 채널·토큰만 본다", () => {
    expect(verifyPushHeaders(hdr({ resourceId: "anything" }), { ...stored, resourceId: null })).toBe(true);
  });
  it("'sync' 인사는 변경이 아니다", () => {
    expect(isChangeNotification("sync")).toBe(false);
    expect(isChangeNotification("exists")).toBe(true);
    expect(isChangeNotification("not_exists")).toBe(true);
    expect(isChangeNotification(null)).toBe(false);
  });
});

describe("채널 갱신 판정", () => {
  const now = Date.parse("2026-09-30T00:00:00Z");
  it("없거나 깨진 만료는 새로 연다", () => {
    expect(needsChannelRenewal(null, now)).toBe(true);
    expect(needsChannelRenewal("엉터리", now)).toBe(true);
  });
  it("36시간 안에 만료되면 새로, 넉넉하면 유지", () => {
    expect(needsChannelRenewal("2026-10-01T06:00:00Z", now)).toBe(true);
    expect(needsChannelRenewal("2026-10-05T00:00:00Z", now)).toBe(false);
  });
});

describe("증분 시작점", () => {
  const now = Date.parse("2026-09-30T12:00:00Z");
  it("지난 동기화 5분 전부터 본다(시계 어긋남·조회 중 변경 여유)", () => {
    expect(incrementalSince("2026-09-30T11:00:00.000Z", now)).toBe("2026-09-30T10:55:00.000Z");
  });
  it("기록이 없으면 하루 전부터", () => {
    expect(incrementalSince(null, now)).toBe("2026-09-29T12:00:00.000Z");
  });
});

describe("바뀐 일정 나누기", () => {
  it("취소된 일정은 지울 목록, 정상 일정은 넣을 행, 날짜 없는 일정은 둘 다 아님", () => {
    const { rows, cancelledIds } = splitChanges(
      [
        { id: "a", status: "confirmed", summary: "레테", start: { dateTime: "2026-09-30T07:30:00Z" }, end: { dateTime: "2026-09-30T08:30:00Z" } },
        { id: "b", status: "cancelled" },
        { id: "c", status: "confirmed", summary: "날짜 없음" },
        { id: "", status: "cancelled" },
      ],
      "01. 입학",
    );
    expect(rows.map((r) => r.googleEventId)).toEqual(["a"]);
    expect(rows[0]!.startTime).toBe("16:30");
    expect(cancelledIds).toEqual(["b"]);
  });
});

describe("반복 일정 시리즈 삭제(원본 id만 취소로 옴)", () => {
  it("🔴 원본id_ 로 시작하는 회차만 — 밑줄까지 맞아야 한다", () => {
    const ids = ["abc_20261001T070000Z", "abc_20261008T070000Z", "abcd_20261001T070000Z", "abc", "xyz_20261001"];
    expect(seriesInstanceIds("abc", ids)).toEqual(["abc_20261001T070000Z", "abc_20261008T070000Z"]);
  });
  it("🔴 '이후 모든 일정' 수정이 만든 새 시리즈(원본id_R…)는 지우지 않는다", () => {
    const ids = ["abc_20261001T070000Z", "abc_R20261008T070000Z", "abc_R20261008T070000Z_20261015T070000Z"];
    expect(seriesInstanceIds("abc", ids)).toEqual(["abc_20261001T070000Z"]);
  });
  it("🔴 이번 회차에 방금 넣거나 고친 행은 지우지 않는다", () => {
    const ids = ["abc_20261001T070000Z", "abc_20261008T070000Z"];
    expect(seriesInstanceIds("abc", ids, new Set(["abc_20261008T070000Z"]))).toEqual(["abc_20261001T070000Z"]);
  });
  it("LIKE에 넣을 수 있는 id만(영숫자) — %·쉼표·밑줄 섞인 값은 거른다", () => {
    expect(isPlainEventId("7kq3d0v2s8h1abc")).toBe(true);
    expect(isPlainEventId("abc_20261001")).toBe(false);
    expect(isPlainEventId("a%b")).toBe(false);
    expect(isPlainEventId("ab")).toBe(false);
  });
});

describe("410 판정(시작점이 너무 오래됨 → 전체 임포트)", () => {
  it("여러 모양의 410을 알아본다", () => {
    expect(isGoneError({ code: 410 })).toBe(true);
    expect(isGoneError({ response: { status: 410 } })).toBe(true);
    expect(isGoneError({ code: 404 })).toBe(false);
    expect(isGoneError(null)).toBe(false);
  });
});

describe("배선 가드", () => {
  const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  it("🔴 웹훅은 저장된 줄로 검증하고, 테넌트를 요청이 아니라 그 줄에서 얻는다", () => {
    const src = read("src/app/api/calendar/google-push/route.ts");
    expect(src).toMatch(/verifyPushHeaders\(/);
    expect(src).toMatch(/findByChannel\(/);
    expect(src).toMatch(/state\.tenant_id/);
    expect(src).toMatch(/after\(/);
    expect(src).not.toMatch(/searchParams|req\.json\(/);
  });
  it("전체 임포트와 증분이 같은 반영 함수(applyRows·deleteByGoogleIds)를 지난다", () => {
    for (const f of ["src/features/calendar/server/google-import.ts", "src/features/calendar/server/google-incremental.ts"]) {
      const src = read(f);
      expect(src).toMatch(/applyRows\(/);
      expect(src).toMatch(/deleteByGoogleIds\(/);
      expect(src).toMatch(/loadTombstones\(/);
    }
  });
  it("크론이 채널을 연다 · 표가 없으면 조용히 꺼진다(#95)", () => {
    // 크론 본체는 google-cron.ts(새벽 한 번, 가볍게) — 라우트는 그 함수를 부른다.
    expect(read("src/app/api/cron/google-calendar-import/route.ts")).toMatch(/runCalendarCronLight\(/);
    expect(read("src/features/calendar/server/google-cron.ts")).toMatch(/ensureCalendarChannels\(/);
    expect(read("src/features/calendar/server/sync-state.ts")).toMatch(/isMissingTable/);
  });
  it("🔴 전체 임포트도 증분과 같은 잠금(acquireLock)을 잡는다 — 겹치면 같은 일정 삽입이 부딪힌다", () => {
    const full = read("src/features/calendar/server/google-import.ts");
    expect(full).toMatch(/acquireLock\(/);
    expect(full).toMatch(/unlock\(/);
    expect(read("src/features/calendar/server/google-incremental.ts")).toMatch(/acquireLock\(/);
  });
  it("🔴 바뀐 게 0건이면 시작점을 옮기지 않는다 · 취소는 시리즈 회차까지 지운다", () => {
    const src = read("src/features/calendar/server/google-incremental.ts");
    // 웹훅 경로엔 advanceOnEmpty가 없다(새벽 크론만 넘긴다 — cron-plan.test.ts 가드).
    expect(src).toMatch(/events\.length === 0\) return \{ ok: true, advance: opts\.advanceOnEmpty === true/);
    expect(src).toMatch(/expandCancelledSeries\(/);
  });
  it("🔴 잠금은 내 표식일 때만 푼다(5분 뒤 남이 가져간 잠금을 풀지 않게)", () => {
    expect(read("src/features/calendar/server/sync-state.ts")).toMatch(/\.eq\("running_since", token\)/);
  });
  it("🔴 증분은 조회에 성공하면 쓰기 실패가 있어도 시작점을 옮긴다(410 고리 방지)", () => {
    expect(read("src/features/calendar/server/google-incremental.ts")).toMatch(/const advanceTo = result\.advance \? startedAt : null/);
  });
  it("🔴 크론은 캘린더 하나의 잠금 오류로 전체가 죽지 않는다", () => {
    expect(read("src/features/calendar/server/google-import.ts")).toMatch(/동기화 잠금 실패/);
  });
  it("🔴 dirty는 돌고 있는 줄에만 세운다(끝난 회차가 못 보고 알림이 사라지는 경합)", () => {
    expect(read("src/features/calendar/server/sync-state.ts")).toMatch(/\.not\("running_since", "is", null\)/);
  });
  it("🔴 증분 조회는 창(timeMin/timeMax)과 updatedMin을 함께 쓴다 — syncToken 금지(창과 같이 못 씀)", () => {
    const src = read("src/features/calendar/server/google-incremental.ts");
    expect(src).toMatch(/updatedMin:/);
    expect(src).toMatch(/timeMin:/);
    expect(src).not.toMatch(/syncToken/);
  });
});
