import { describe, it, expect, beforeEach } from "vitest";
import { useWindowStore, windowId, instanceLabel, isDuplicate, baseWindowId, MAX_WINDOWS, CACHE_MAX } from "./window-store";

const SID = windowId("route", "students/1");

function reset() {
  useWindowStore.setState({
    owner: null,
    windows: {},
    order: [],
    focusedId: null,
    live: {},
    nav: {},
    reloadNonce: {},
    dirty: {},
    cached: [],
    spotlight: false,
    spotlightRaised: [],
  });
}

describe("window-store showDesktop() — 오늘은 main 데스크톱", () => {
  beforeEach(reset);

  it("일반 창은 안전하게 최소화하고 legacy dashboard 창·복제본·warm 캐시와 런타임 흔적은 제거한다", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students", title: "학생목록", href: "/students" });
    const students = windowId("route", "students");
    s.setWindowDirty(students, true);

    s.open("route", { id: "dashboard", title: "오늘", href: "/dashboard" });
    const dashboard = windowId("route", "dashboard");
    s.observeIframe(dashboard, { title: "오늘", url: "/dashboard?embed=1" });
    s.reloadWindow(dashboard);
    s.duplicate(dashboard);
    const duplicate = `${dashboard}#1`;
    s.close(dashboard); // primary는 warm cache, 복제본은 열린 상태

    useWindowStore.setState({
      spotlight: true,
      spotlightRaised: [duplicate],
      dirty: { ...useWindowStore.getState().dirty, [duplicate]: true },
    });
    useWindowStore.getState().showDesktop();

    const st = useWindowStore.getState();
    expect(Object.keys(st.windows)).toEqual([students]);
    expect(st.windows[students].minimized).toBe(true);
    expect(st.dirty[students]).toBe(true); // 다른 창의 미저장 상태는 보존
    expect(st.order).toEqual([students]);
    expect(st.focusedId).toBe(null);
    expect(st.cached).not.toContain(dashboard);
    expect(st.live[dashboard]).toBeUndefined();
    expect(st.nav[dashboard]).toBeUndefined();
    expect(st.reloadNonce[dashboard]).toBeUndefined();
    expect(st.dirty[duplicate]).toBeUndefined();
    expect(st.spotlight).toBe(false);
    expect(st.spotlightRaised).toEqual([]);
  });

  it("같은 owner의 영속 레이아웃 채택 때 legacy dashboard iframe만 제거하고 일반 창은 유지한다", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students", title: "학생목록", href: "/students" });
    s.open("route", { id: "dashboard", title: "오늘", href: "/dashboard" });
    s.duplicate(windowId("route", "dashboard"));
    useWindowStore.setState({ owner: "tenant:user" });

    useWindowStore.getState().adoptOwner("tenant:user");

    const st = useWindowStore.getState();
    expect(st.windows[windowId("route", "students")]).toBeTruthy();
    expect(st.windows[windowId("route", "students")].minimized).toBe(false);
    expect(Object.keys(st.windows).some((id) => id.startsWith("route:dashboard"))).toBe(false);
    expect(st.order.some((id) => id.startsWith("route:dashboard"))).toBe(false);
  });
});

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

describe("window-store close() — BL3 warm 캐시(재오픈 즉시화)", () => {
  beforeEach(reset);

  const A = windowId("route", "a");
  const B = windowId("route", "b");
  const C = windowId("route", "c");
  const openRoute = (id: string) =>
    useWindowStore.getState().open("route", { id, title: id, href: `/${id}` });

  it("라우트 창을 닫으면 파괴 대신 warm 보존 — mounted 유지·order서 제거·cached 추가·minimized", () => {
    openRoute("a");
    useWindowStore.getState().close(A);
    const st = useWindowStore.getState();
    expect(st.windows[A]).toBeTruthy(); // 여전히 마운트(iframe 보존)
    expect(st.windows[A].minimized).toBe(true); // hidden
    expect(st.order).not.toContain(A); // 모든 창 UI(스위처·점)에서 사라짐
    expect(st.cached).toContain(A);
    expect(st.focusedId).toBe(null); // 유일 창이었음
  });

  it("닫은 창을 다시 열면 즉시 복원 — cached서 제거·order 복귀·minimized 해제·포커스, 중복 생성 X", () => {
    openRoute("a");
    useWindowStore.getState().close(A);
    openRoute("a"); // 재오픈
    const st = useWindowStore.getState();
    expect(st.cached).not.toContain(A);
    expect(st.order).toContain(A);
    expect(st.windows[A].minimized).toBe(false);
    expect(st.focusedId).toBe(A);
    expect(Object.keys(st.windows).length).toBe(1);
  });

  it("복제본·생성폼(autoClose)·더티·학생요약 창은 warm 보존 안 함 — 완전 파괴", () => {
    // 복제본(#n)
    openRoute("a");
    useWindowStore.getState().duplicate(A);
    const dup = `${A}#1`;
    useWindowStore.getState().close(dup);
    expect(useWindowStore.getState().windows[dup]).toBeFalsy();
    expect(useWindowStore.getState().cached).not.toContain(dup);
    // autoClose 생성폼
    useWindowStore
      .getState()
      .open("route", { id: "enrollment/new", title: "새 상담", href: "/enrollment/new", autoClose: true });
    const formId = windowId("route", "enrollment/new");
    useWindowStore.getState().close(formId);
    expect(useWindowStore.getState().windows[formId]).toBeFalsy();
    expect(useWindowStore.getState().cached).not.toContain(formId);
    // 더티(미저장) 창
    openRoute("b");
    useWindowStore.getState().setWindowDirty(B, true);
    useWindowStore.getState().close(B);
    expect(useWindowStore.getState().windows[B]).toBeFalsy();
    expect(useWindowStore.getState().cached).not.toContain(B);
    // 학생 요약(peek, kind student)
    useWindowStore.getState().open("student", { id: "1", title: "박지율" });
    const stu = windowId("student", "1");
    useWindowStore.getState().close(stu);
    expect(useWindowStore.getState().windows[stu]).toBeFalsy();
    expect(useWindowStore.getState().cached).not.toContain(stu);
  });

  it("LRU 상한 — CACHE_MAX 초과 시 가장 오래된 warm 창을 실제 파괴(live/nav도 정리)", () => {
    openRoute("a");
    openRoute("b");
    openRoute("c");
    const s = useWindowStore.getState();
    s.close(A); // cached [A]
    s.close(B); // cached [A,B]
    s.close(C); // cached [A,B,C] → 상한 초과 → A 파괴
    const st = useWindowStore.getState();
    expect(st.cached).toEqual([B, C]);
    expect(st.cached.length).toBe(CACHE_MAX);
    expect(st.windows[A]).toBeFalsy(); // 가장 오래된 것 파괴
    expect(st.windows[B]).toBeTruthy();
    expect(st.windows[C]).toBeTruthy();
    expect(st.live[A]).toBeUndefined();
    expect(st.nav[A]).toBeUndefined();
  });

  it("warm 창을 다시 열고 닫으면 LRU 끝으로 갱신 — 오래된 것으로 오인해 evict 안 됨", () => {
    openRoute("a");
    openRoute("b");
    useWindowStore.getState().close(A); // cached [A]
    useWindowStore.getState().close(B); // cached [A,B]
    openRoute("a"); // A 재오픈 → cached [B]
    expect(useWindowStore.getState().cached).toEqual([B]);
    useWindowStore.getState().close(A); // cached [B,A]
    expect(useWindowStore.getState().cached).toEqual([B, A]);
    openRoute("c");
    useWindowStore.getState().close(C); // cached [B,A,C] → B evict
    const st = useWindowStore.getState();
    expect(st.cached).toEqual([A, C]);
    expect(st.windows[B]).toBeFalsy();
  });
});
