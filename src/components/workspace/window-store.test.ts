import { describe, it, expect, beforeEach } from "vitest";
import { useWindowStore, windowId } from "./window-store";

const SID = windowId("route", "students/1");

function reset() {
  useWindowStore.setState({
    windows: {},
    order: [],
    focusedId: null,
    background: [{ id: "dashboard", title: "대시보드", href: "/dashboard" }],
    activeBackgroundId: "dashboard",
    live: {},
  });
}

describe("window-store open()", () => {
  beforeEach(reset);

  it("새 라우트 창을 연다", () => {
    useWindowStore.getState().open("route", { id: "students/1", title: "박지율", href: "/students/1" });
    const w = useWindowStore.getState().windows[SID];
    expect(w).toBeTruthy();
    expect(w.params.href).toBe("/students/1");
    expect(useWindowStore.getState().focusedId).toBe(SID);
  });

  it("같은 href로 다시 열면 포커스만 — 중복 생성 X, href 불변", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students/1", title: "박지율", href: "/students/1" });
    s.open("route", { id: "students/1", title: "박지율", href: "/students/1" });
    const st = useWindowStore.getState();
    expect(Object.keys(st.windows).length).toBe(1);
    expect(st.windows[SID].params.href).toBe("/students/1");
  });

  it("이미 열린 창을 다른 href(탭)로 열면 그 경로로 이동 — href 갱신, 창 1개 유지", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students/1", title: "박지율", href: "/students/1" });
    s.open("route", { id: "students/1", title: "박지율", href: "/students/1?tab=attendance" });
    const st = useWindowStore.getState();
    expect(Object.keys(st.windows).length).toBe(1);
    expect(st.windows[SID].params.href).toBe("/students/1?tab=attendance");
    expect(st.focusedId).toBe(SID);
  });

  it("최소화된 창을 다른 href로 열면 복원 + 이동", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students/1", title: "박지율", href: "/students/1" });
    useWindowStore.getState().minimize(SID);
    expect(useWindowStore.getState().windows[SID].minimized).toBe(true);
    useWindowStore.getState().open("route", { id: "students/1", title: "박지율", href: "/students/1?tab=billing" });
    const w = useWindowStore.getState().windows[SID];
    expect(w.minimized).toBe(false);
    expect(w.params.href).toBe("/students/1?tab=billing");
  });

  it("다른 href로 이동해도 창 위치(rect)는 유지", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students/1", title: "박지율", href: "/students/1" });
    const before = useWindowStore.getState().windows[SID].rect;
    useWindowStore.getState().open("route", { id: "students/1", title: "박지율", href: "/students/1?tab=attendance" });
    expect(useWindowStore.getState().windows[SID].rect).toEqual(before);
  });
});
