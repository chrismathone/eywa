import { describe, expect, it } from "vitest";
import { buildReadUpdates, extractReadToken, summarizeReadScan } from "./classnote-read-core.mjs";

const EDU = "3f2b1a5c-1111-4222-8333-444455556666";
const EYWA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const row = (over = {}) => ({
  is_sent_from_center: true,
  content: `수업 보고서입니다\nhttps://edutrix.vercel.app/share/${EDU}`,
  read_by_parent: { date_read: "2026-07-18T05:00:00Z" },
  ...over,
});

describe("extractReadToken", () => {
  it("edutrix 공유링크 uuid를 뽑는다(소문자 정규화)", () => {
    expect(extractReadToken(`전송\nhttps://edutrix.vercel.app/share/${EDU.toUpperCase()}`)).toEqual({
      kind: "edutrix",
      token: EDU,
    });
  });

  it("eywa 공개 링크(/r/{token})는 eywa 종류로 뽑는다(도메인 무관)", () => {
    expect(extractReadToken(`보고서 https://eywa-alpha.vercel.app/r/${EYWA}`)).toEqual({ kind: "eywa", token: EYWA });
    expect(extractReadToken(`http://localhost:3100/r/${EYWA}`)).toEqual({ kind: "eywa", token: EYWA });
  });

  it("둘 다 있으면 edutrix 우선(현 발송 주체)", () => {
    const both = `https://edutrix.vercel.app/share/${EDU} 와 https://x.com/r/${EYWA}`;
    expect(extractReadToken(both)).toEqual({ kind: "edutrix", token: EDU });
  });

  it("링크 없음·빈 값·비문자열은 null", () => {
    expect(extractReadToken("링크 없는 본문")).toBeNull();
    expect(extractReadToken("")).toBeNull();
    expect(extractReadToken(null)).toBeNull();
    expect(extractReadToken(undefined)).toBeNull();
  });
});

describe("buildReadUpdates", () => {
  it("학원 발송분 + 읽음 + 토큰이 모두 있어야 후보", () => {
    const rows = [
      row(), // ✅
      row({ is_sent_from_center: false }), // 학부모 글 — 제외
      row({ read_by_parent: { date_read: null } }), // 미읽음 — 제외
      row({ read_by_parent: null }), // 필드 없음 — 제외
      row({ content: "링크 없는 본문" }), // 토큰 없음 — 제외
    ];
    const out = buildReadUpdates(rows);
    expect(out).toEqual([{ kind: "edutrix", token: EDU, readAt: "2026-07-18T05:00:00Z" }]);
  });

  it("같은 토큰이 여러 번이면 가장 이른 읽음 시각 채택", () => {
    const out = buildReadUpdates([
      row({ read_by_parent: { date_read: "2026-07-18T09:00:00Z" } }),
      row({ read_by_parent: { date_read: "2026-07-18T03:00:00Z" } }),
      row({ read_by_parent: { date_read: "2026-07-18T12:00:00Z" } }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].readAt).toBe("2026-07-18T03:00:00Z");
  });

  it("edutrix·eywa 토큰은 별개 후보로 유지(각기 다른 컬럼에 조인)", () => {
    const out = buildReadUpdates([
      row(),
      row({ content: `https://eywa-alpha.vercel.app/r/${EYWA}` }),
    ]);
    expect(out.map((o) => o.kind).sort()).toEqual(["edutrix", "eywa"]);
  });

  it("빈 입력·null 안전", () => {
    expect(buildReadUpdates([])).toEqual([]);
    expect(buildReadUpdates(null)).toEqual([]);
    expect(buildReadUpdates([null, undefined])).toEqual([]);
  });
});

describe("summarizeReadScan", () => {
  it("학원 발송분만 세고 읽음/미읽음/링크없음을 분리한다", () => {
    const scan = summarizeReadScan([
      row(),
      row({ read_by_parent: { date_read: null } }),
      row({ content: "링크 없음" }),
      row({ is_sent_from_center: false }), // 학부모 글 — 전부 제외
    ]);
    expect(scan).toEqual({ sent: 3, read: 2, unread: 1, noToken: 1 });
  });
});
