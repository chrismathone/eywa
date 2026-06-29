import { describe, it, expect, beforeEach } from "vitest";
import { useWindowStore, windowId, instanceLabel, isDuplicate, baseWindowId, MAX_WINDOWS } from "./window-store";

const SID = windowId("route", "students/1");

function reset() {
  useWindowStore.setState({
    windows: {},
    order: [],
    focusedId: null,
    background: [{ id: "dashboard", title: "대시보드", href: "/dashboard" }],
    activeBackgroundId: "dashboard",
    live: {},
    nav: {},
    reloadNonce: {},
  });
}

describe("window-store reloadWindow()", () => {
  beforeEach(reset);

  it("호출할 때마다 그 창의 nonce를 1씩 올린다(다른 창 불변)", () => {
    expect(useWindowStore.getState().reloadNonce[SID] ?? 0).toBe(0);
    useWindowStore.getState().reloadWindow(SID);
    expect(useWindowStore.getState().reloadNonce[SID]).toBe(1);
    useWindowStore.getState().reloadWindow(SID);
    expect(useWindowStore.getState().reloadNonce[SID]).toBe(2);
    // 다른 창은 영향 없음
    expect(useWindowStore.getState().reloadNonce["route:classes"] ?? 0).toBe(0);
  });
});

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

describe("instanceLabel / isDuplicate / baseWindowId", () => {
  it("primary는 접미사 없음, 복제본만 (n)", () => {
    expect(instanceLabel("route:students", "학생목록")).toBe("학생목록");
    expect(instanceLabel("route:students#1", "학생목록")).toBe("학생목록 (2)");
    expect(instanceLabel("route:students#2", "학생목록")).toBe("학생목록 (3)");
  });
  it("isDuplicate / baseWindowId", () => {
    expect(isDuplicate("route:students")).toBe(false);
    expect(isDuplicate("route:students#1")).toBe(true);
    expect(baseWindowId("route:students#3")).toBe("route:students");
  });
});

describe("window-store duplicate()", () => {
  beforeEach(reset);

  it("nav 현재 URL·live 제목을 복제하고 params.id(base)는 보존, 원본 유지", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students/1", title: "박지율", href: "/students/1" });
    // 상세 → 수정으로 드릴인했다고 가정(nav 최신 = 수정, live 제목 변경)
    useWindowStore.setState({
      nav: { [SID]: ["/students/1", "/students/1/edit"] },
      live: { [SID]: { title: "박지율 · 수정", canBack: true } },
    });
    useWindowStore.getState().duplicate(SID);
    const dupId = `${SID}#1`;
    const dup = useWindowStore.getState().windows[dupId];
    expect(dup).toBeTruthy();
    expect(dup.params.href).toBe("/students/1/edit"); // 최초 href 아님 — nav 현재 URL
    expect(dup.params.title).toBe("박지율 · 수정"); // live 제목
    expect(dup.params.id).toBe("students/1"); // base 라우트 id 보존(baseWindowId 아님)
    expect(useWindowStore.getState().windows[SID]).toBeTruthy(); // 원본 유지
    expect(useWindowStore.getState().focusedId).toBe(dupId);
  });

  it("instance 번호 빈자리 재사용(#1 닫고 다시 복제 → #1)", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students/1", title: "박지율", href: "/students/1" });
    s.duplicate(SID); // #1
    s.duplicate(SID); // #2
    expect(useWindowStore.getState().windows[`${SID}#1`]).toBeTruthy();
    expect(useWindowStore.getState().windows[`${SID}#2`]).toBeTruthy();
    useWindowStore.getState().close(`${SID}#1`);
    useWindowStore.getState().duplicate(SID); // 빈 #1 재사용
    expect(useWindowStore.getState().windows[`${SID}#1`]).toBeTruthy();
    expect(useWindowStore.getState().windows[`${SID}#3`]).toBeFalsy();
  });

  it("MAX_WINDOWS 가득 차도 복제 원본은 보호(축출 대상 제외)", () => {
    const s = useWindowStore.getState();
    for (let i = 1; i <= MAX_WINDOWS; i++) {
      s.open("route", { id: `m${i}`, title: `메뉴${i}`, href: `/m${i}` });
    }
    const srcId = windowId("route", "m1");
    useWindowStore.setState({ focusedId: srcId });
    useWindowStore.getState().duplicate(srcId);
    const st = useWindowStore.getState();
    expect(st.windows[srcId]).toBeTruthy(); // 원본 보호
    expect(st.windows[`${srcId}#1`]).toBeTruthy(); // 복제본 생성
    expect(Object.keys(st.windows).length).toBe(MAX_WINDOWS); // 상한 유지(다른 창 축출)
  });

  it("복제본은 배경으로 못 감 — swapToBackground no-op + swapFocusedWithBackground 미전송", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students/1", title: "박지율", href: "/students/1" });
    s.duplicate(SID);
    const dupId = `${SID}#1`;
    // swapToBackground(복제본) = no-op
    useWindowStore.getState().swapToBackground(dupId);
    expect(useWindowStore.getState().windows[dupId]).toBeTruthy();
    expect(useWindowStore.getState().background.some((b) => b.id === "students/1")).toBe(false);
    // 스포트라이트 교체: 복제본 포커스여도 배경으로 안 보냄
    useWindowStore.setState({
      background: [
        { id: "dashboard", title: "대시보드", href: "/dashboard" },
        { id: "classes", title: "수업목록", href: "/classes" },
      ],
      activeBackgroundId: "dashboard",
      focusedId: dupId,
    });
    useWindowStore.getState().swapFocusedWithBackground("classes");
    expect(useWindowStore.getState().background.some((b) => b.id === "students/1")).toBe(false);
    expect(useWindowStore.getState().windows[dupId]).toBeTruthy(); // 복제본은 창으로 남음
  });
});

describe("window-store openNewInstance() — shift+클릭", () => {
  beforeEach(reset);

  it("처음엔 primary, 같은 라우트면 #n 새 인스턴스(반복 = 듀얼/멀티)", () => {
    const s = useWindowStore.getState();
    s.openNewInstance("route", { id: "students", title: "학생목록", href: "/students" });
    const primary = windowId("route", "students");
    expect(useWindowStore.getState().windows[primary]).toBeTruthy();
    s.openNewInstance("route", { id: "students", title: "학생목록", href: "/students" });
    expect(useWindowStore.getState().windows[`${primary}#1`]).toBeTruthy();
    s.openNewInstance("route", { id: "students", title: "학생목록", href: "/students" });
    expect(useWindowStore.getState().windows[`${primary}#2`]).toBeTruthy();
    expect(Object.keys(useWindowStore.getState().windows).length).toBe(3);
  });
});
