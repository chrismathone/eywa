import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FIXTURE_WORK } from "@/features/work-requests/testing/fixture";
import { receivedBy, urgentFirst } from "@/features/work-requests/model";

// 창은 document.body로 포털한다 — 서버 렌더 시험에서는 그 자리에 그대로 그린다.
vi.mock("react-dom", async (orig) => ({ ...(await orig<typeof import("react-dom")>()), createPortal: (node: unknown) => node }));
vi.mock("@/features/work-requests/server/actions", () => ({ actOnWorkRequest: vi.fn() }));

const { ReceivedList } = await import("./received-list");
const { WorkActions } = await import("./work-actions");
const { WorkProvider } = await import("./work-context");

describe("받은 업무 요청 목록 · 읽기 전용", () => {
  it("진행 중 / 지난 요청으로 가른다 · 내 차례는 '내 보고 차례'", () => {
    const html = renderToStaticMarkup(<ReceivedList items={urgentFirst(receivedBy(FIXTURE_WORK.items, "u2"), "u2", "2026-11-03")} me="u2" today="2026-11-03" onClose={() => undefined} onOpen={() => undefined} />);
    expect(html).toContain("10월 미납 5건 대조");
    expect(html).toContain("내 보고 차례");
    expect(html).not.toContain("지난 요청");
    const t0 = renderToStaticMarkup(<ReceivedList items={receivedBy(FIXTURE_WORK.items, "t0")} me="t0" today="2026-11-03" onClose={() => undefined} onOpen={() => undefined} />);
    expect(t0).toContain("지난 요청");
    expect(t0).toContain("중2 심화A 인수인계");
  });
  it("🔴 강사뷰(읽기 · 전체)면 확인 · 보고 단추가 없다 — 그 강사 대신 보고하지 않는다(서버도 막는다)", () => {
    const item = FIXTURE_WORK.items.find((i) => i.id === "w1")!;
    const as = (readonly: boolean) => renderToStaticMarkup(
      <WorkProvider today="2026-11-03" tick={0} demo={{ ...FIXTURE_WORK, me: "u2", readonly }}><WorkActions item={item} me="u2" links={[]} /></WorkProvider>,
    );
    expect(as(false)).toContain(">보고<");
    expect(as(true)).not.toContain(">보고<");
    expect(as(true)).toContain("강사뷰에서는 보기만");
  });
});

describe("받은 업무 요청 줄의 갱신 간격", () => {
  it("받은 것이 있으면 1분 · 없으면 5분(전 강사가 띄워 두는 화면)", async () => {
    const { refreshMsOf } = await import("@/features/work-requests/components/my-work-requests");
    expect(refreshMsOf(1)).toBe(60_000);
    expect(refreshMsOf(0)).toBe(300_000);
  });
});
