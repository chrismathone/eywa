import { describe, expect, it } from "vitest";
import {
  CN_LIVE_BOOST_POLL_MS,
  CN_LIVE_MAX_CLASSES,
  CN_LIVE_POLL_MS,
  cnLiveDelay,
  cnLiveUrl,
  cnSyncRequested,
  parseCnLiveQuery,
} from "./classnote-match-live";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("C.N 아이콘 새로고침 없는 갱신 규칙(원장 2026-11-04)", () => {
  it("평소 60초 · 동기화를 요청한 직후(짧은 주기 시간 안)엔 15초", () => {
    expect(cnLiveDelay(1_000, 0)).toBe(CN_LIVE_POLL_MS);
    expect(cnLiveDelay(1_000, 2_000)).toBe(CN_LIVE_BOOST_POLL_MS);
    expect(cnLiveDelay(2_000, 2_000)).toBe(CN_LIVE_POLL_MS);
  });

  it("🔴 짧은 주기는 서버가 동기화를 **요청한** 결과에서만 — 요청 못 한 막힘(자동 배정 대기·보류·보드 없음)엔 켜지 않는다", () => {
    for (const s of ["board_enrolling", "board_class_pending", "board_hold_recheck"]) expect(cnSyncRequested(s)).toBe(true);
    for (const s of ["board_enrolling_auto", "board_hold", "board_hold_admin", "board_left", "board_missing", "queued", null, undefined]) {
      expect(cnSyncRequested(s)).toBe(false);
    }
  });

  it("주소는 반을 중복 없이 정렬해 싣고, 라우트는 같은 값으로 읽는다", () => {
    const url = cnLiveUrl({ date: "2026-11-04", classIds: [B, A, B], known: "3.12.2.17" });
    const parsed = parseCnLiveQuery(new URL(url, "https://aywa.example").searchParams);
    expect(parsed).toEqual({ date: "2026-11-04", classIds: [A, B], known: "3.12.2.17" });
    // 버전을 모르면(첫 렌더 실패) known을 싣지 않는다 — 서버는 다른 값으로 보고 지도를 준다.
    expect(cnLiveUrl({ date: "2026-11-04", classIds: [A] })).not.toContain("known=");
  });

  it("🔴 주소의 값은 믿지 않는다 — 반 id 모양·개수 상한·버전 길이", () => {
    const many = Array.from({ length: CN_LIVE_MAX_CLASSES + 5 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const qs = new URLSearchParams({ classes: [...many, "drop table", A].join(","), known: "x".repeat(200) });
    const parsed = parseCnLiveQuery(qs);
    expect(parsed.classIds).toHaveLength(CN_LIVE_MAX_CLASSES);
    expect(parsed.classIds).not.toContain("drop table");
    expect(parsed.known).toBeNull();
    expect(parseCnLiveQuery(new URLSearchParams()).classIds).toEqual([]);
  });
});
