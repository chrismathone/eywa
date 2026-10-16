import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useWindowStore, windowId, instanceLabel, isDuplicate, baseWindowId, MAX_WINDOWS, CACHE_MAX } from "./window-store";
import { ROUTE_WINDOW_SIZE } from "./window-geometry";

// 창 개수 한도에 막혔을 때의 안내(sonner) — 실제 토스트 대신 호출만 본다.
const { toastWarning } = vi.hoisted(() => ({ toastWarning: vi.fn() }));
vi.mock("sonner", () => ({ toast: { warning: toastWarning, info: vi.fn() } }));

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
    busy: {},
    pendingNav: {},
    homeNonce: {},
    cached: [],
    spotlight: false,
    spotlightRaised: [],
  });
}

describe("window-store showDesktop() — 배경(메뉴 화면) 보이기", () => {
  beforeEach(reset);

  // 🔴 2026-09-07 뒤집힘(원장: *"운영실도 다른창들처럼 만들어주고"*) — 옛 규약은 "showDesktop이 dashboard
  //    창·복제본·warm 캐시를 **제거**한다"였다. 이제 운영실은 보통 창이라 **지우면 안 된다**(원장이 방금
  //    연 창이 배경으로 갈 때마다 사라진다). showDesktop이 하는 일은 **최소화**뿐이다.
  it("열린 창은 지우지 않고 전부 최소화한다 — 운영실 창도 그대로 남는다", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students", title: "학생목록", href: "/students" });
    const students = windowId("route", "students");
    s.setWindowDirty(students, true);
    s.open("route", { id: "dashboard", title: "운영실", href: "/dashboard" });
    const dashboard = windowId("route", "dashboard");

    useWindowStore.getState().showDesktop();

    const st = useWindowStore.getState();
    expect(new Set(Object.keys(st.windows))).toEqual(new Set([students, dashboard]));
    expect(st.windows[students].minimized).toBe(true);
    expect(st.windows[dashboard].minimized).toBe(true);
    expect(st.dirty[students]).toBe(true); // 미저장 상태는 보존
    expect(st.focusedId).toBe(null);
    expect(st.spotlight).toBe(false);
  });

  it("owner 채택(복원) 때도 운영실 창을 지우지 않는다", () => {
    const s = useWindowStore.getState();
    s.open("route", { id: "students", title: "학생목록", href: "/students" });
    s.open("route", { id: "dashboard", title: "운영실", href: "/dashboard" });
    useWindowStore.setState({ owner: "tenant:user" });

    useWindowStore.getState().adoptOwner("tenant:user");

    const st = useWindowStore.getState();
    expect(st.windows[windowId("route", "students")]).toBeTruthy();
    expect(st.windows[windowId("route", "dashboard")]).toBeTruthy();
  });
});

describe("window-store observeIframe() — 첫 화면이 바뀐 뒤의 첫 로드(reset)", () => {
  // 창이 있어야 보고를 받는다 — 없는 창의 보고는 스토어가 버린다(리뷰 2026-09-11).
  beforeEach(() => {
    reset();
    useWindowStore.getState().open("route", { id: "students/1", title: "원생", href: "/students/1" });
  });

  it("reset이면 스택을 그 주소 하나로 다시 시작한다(← 없음)", () => {
    const s = useWindowStore.getState();
    s.observeIframe(SID, { title: "원생", url: "/students/1?embed=1" });
    s.observeIframe(SID, { title: "수정", url: "/students/1/edit?embed=1" });
    expect(useWindowStore.getState().live[SID]?.canBack).toBe(true);

    useWindowStore.getState().observeIframe(SID, { title: "다른 원생", url: "/students/2?embed=1", reset: true });
    expect(useWindowStore.getState().nav[SID]).toEqual(["/students/2?embed=1"]);
    expect(useWindowStore.getState().live[SID]?.canBack).toBe(false);
  });

  it("reset이 없으면 종전 그대로 — 경로가 바뀌면 쌓고 쿼리만 바뀌면 바꿔 끼운다", () => {
    const s = useWindowStore.getState();
    s.observeIframe(SID, { title: "수납", url: "/billing?embed=1" });
    s.observeIframe(SID, { title: "수납", url: "/billing?tab=textbooks&embed=1" });
    expect(useWindowStore.getState().nav[SID]).toEqual(["/billing?tab=textbooks&embed=1"]);
    useWindowStore.getState().observeIframe(SID, { title: "상세", url: "/billing/x?embed=1" });
    expect(useWindowStore.getState().nav[SID]).toHaveLength(2);
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

  // ⚠️ 아래 두 테스트는 CACHE_MAX 값을 **하드코딩하지 않는다** — 상한을 조정해도(2026-07-29: 2→4)
  //    테스트가 규칙(LRU·상한 준수)을 계속 검증하도록 개수를 상수에서 도출한다.
  const names = (n: number) => Array.from({ length: n }, (_, i) => `warm${i}`);
  const idsOf = (ns: string[]) => ns.map((n) => windowId("route", n));

  it("LRU 상한 — CACHE_MAX 초과 시 가장 오래된 warm 창을 실제 파괴(live/nav도 정리)", () => {
    const ns = names(CACHE_MAX + 1); // 상한을 딱 1개 넘긴다
    ns.forEach(openRoute);
    const ids = idsOf(ns);
    ids.forEach((id) => useWindowStore.getState().close(id));

    const st = useWindowStore.getState();
    const [oldest, ...survivors] = ids;
    expect(st.cached).toEqual(survivors); // 가장 먼저 닫힌 것만 빠진다
    expect(st.cached.length).toBe(CACHE_MAX);
    expect(st.windows[oldest!]).toBeFalsy(); // 가장 오래된 것 파괴
    for (const id of survivors) expect(st.windows[id]).toBeTruthy();
    expect(st.live[oldest!]).toBeUndefined();
    expect(st.nav[oldest!]).toBeUndefined();
  });

  it("warm 창을 다시 열고 닫으면 LRU 끝으로 갱신 — 오래된 것으로 오인해 evict 안 됨", () => {
    const ns = names(CACHE_MAX); // 상한을 정확히 채운다(아직 evict 없음)
    ns.forEach(openRoute);
    const ids = idsOf(ns);
    ids.forEach((id) => useWindowStore.getState().close(id));
    expect(useWindowStore.getState().cached).toEqual(ids);

    const [first, second, ...rest] = ids;
    openRoute(ns[0]!); // 가장 오래된 것을 재오픈 → warm 풀에서 빠진다
    expect(useWindowStore.getState().cached).toEqual([second!, ...rest]);
    useWindowStore.getState().close(first!); // 다시 닫으면 LRU **끝**으로
    expect(useWindowStore.getState().cached).toEqual([second!, ...rest, first!]);

    openRoute("extra"); // 한 개 더 → 상한 초과
    const extra = windowId("route", "extra");
    useWindowStore.getState().close(extra);

    const st = useWindowStore.getState();
    // 재오픈으로 갱신된 first가 아니라, 이제 가장 오래된 second가 evict된다.
    expect(st.cached).toEqual([...rest, first!, extra]);
    expect(st.windows[second!]).toBeFalsy();
    expect(st.windows[first!]).toBeTruthy();
  });
});

/**
 * 창 개수 한도(MAX_WINDOWS) — 전수검사 2026-09-11: 창 7번째를 열면 가장 뒤 창이 **확인 없이** 사라졌다
 * (작성 중인 글·녹음 중인 창 포함). 게다가 `windows`만 지워 제목·뒤로 기록·새로고침 표식이 남아, 같은 메뉴를
 * 다시 열면 새 창에 옛 상세로 가는 ←가 섰다. 세 입구(open·openNewInstance·duplicate)가 같은 규칙이어야 한다.
 */
describe("window-store 창 개수 한도 — 미저장·녹음 중 창은 밀어내지 않는다", () => {
  beforeEach(() => {
    reset();
    toastWarning.mockClear();
  });

  const [m1, m2, m3, m4, m5, m6, m7] = Array.from({ length: MAX_WINDOWS + 1 }, (_, i) =>
    windowId("route", `m${i + 1}`),
  );
  const openM = (n: number) =>
    useWindowStore.getState().open("route", { id: `m${n}`, title: `메뉴${n}`, href: `/m${n}` });
  /** 창을 한도까지 연다 — 가장 뒤 = m1, 지금 보는 창 = m6. */
  function fill() {
    for (let i = 1; i <= MAX_WINDOWS; i++) openM(i);
  }

  it("🔴 가장 뒤 창이 미저장이면 건너뛰고 그다음 깨끗한 창을 밀어낸다", () => {
    fill();
    useWindowStore.getState().setWindowDirty(m1, true);

    openM(7);

    const st = useWindowStore.getState();
    expect(st.windows[m1]).toBeTruthy(); // 작성 중인 글이 든 창은 남는다
    expect(st.dirty[m1]).toBe(true);
    expect(st.windows[m2]).toBeFalsy(); // 대신 그다음 깨끗한 창이 밀려난다
    expect(st.windows[m7]).toBeTruthy();
    expect(st.order).toHaveLength(MAX_WINDOWS);
  });

  it("🔴 녹음 중(busy) 창도 밀어내지 않는다 — iframe째 사라지면 녹음이 날아간다", () => {
    fill();
    useWindowStore.getState().setWindowBusy(m1, true);

    openM(7);

    const st = useWindowStore.getState();
    expect(st.windows[m1]).toBeTruthy();
    expect(st.busy[m1]).toBe(true);
    expect(st.windows[m2]).toBeFalsy();
  });

  it("🔴 밀어낸 창의 흔적(제목·뒤로 기록·새로고침 표식)을 함께 지운다 — 같은 메뉴를 다시 열면 ← 없는 새 창", () => {
    fill();
    const s = useWindowStore.getState();
    s.observeIframe(m1, { title: "메뉴1", url: "/m1?embed=1" });
    s.observeIframe(m1, { title: "상세", url: "/m1/abc?embed=1" });
    s.reloadWindow(m1);

    openM(7); // 가장 뒤(깨끗한) m1이 밀려난다

    let st = useWindowStore.getState();
    expect(st.windows[m1]).toBeFalsy();
    expect(st.live[m1]).toBeUndefined();
    expect(st.nav[m1]).toBeUndefined();
    expect(st.reloadNonce[m1]).toBeUndefined();

    openM(1); // 다시 연다 — 새 RouteWindow의 첫 보고가 옛 기록 위에 쌓이면 안 된다
    useWindowStore.getState().observeIframe(m1, { title: "메뉴1", url: "/m1?embed=1" });
    st = useWindowStore.getState();
    expect(st.nav[m1]).toEqual(["/m1?embed=1"]);
    expect(st.live[m1]?.canBack).toBe(false);
  });

  it("🔴 밀어낼 창이 없으면 새 창을 열지 않고 이유를 알린다", () => {
    fill();
    const s = useWindowStore.getState();
    [m1, m2, m3].forEach((id) => s.setWindowDirty(id, true));
    [m4, m5].forEach((id) => s.setWindowBusy(id, true));
    const before = useWindowStore.getState().order;

    const opened = useWindowStore.getState().open("route", { id: "m7", title: "메뉴7", href: "/m7" });

    const st = useWindowStore.getState();
    expect(opened).toBe(false);
    expect(st.windows[m7]).toBeFalsy();
    expect(st.order).toEqual(before); // 아무 창도 사라지지 않았다
    expect(st.focusedId).toBe(m6);
    expect(toastWarning).toHaveBeenCalledTimes(1);
    expect(String(toastWarning.mock.calls[0]?.[0])).toContain("창을 하나 닫은 뒤");
  });

  it("새 인스턴스(shift+클릭)·창 복제도 같은 규칙 — 미저장 창을 건너뛴다", () => {
    fill();
    useWindowStore.getState().setWindowDirty(m1, true);

    useWindowStore.getState().openNewInstance("route", { id: "m6", title: "메뉴6", href: "/m6" });
    let st = useWindowStore.getState();
    expect(st.windows[`${m6}#1`]).toBeTruthy();
    expect(st.windows[m1]).toBeTruthy();
    expect(st.windows[m2]).toBeFalsy();

    useWindowStore.getState().duplicate(`${m6}#1`); // 지금 보는 창을 복제
    st = useWindowStore.getState();
    expect(st.windows[`${m6}#2`]).toBeTruthy();
    expect(st.windows[m1]).toBeTruthy();
    expect(st.windows[m3]).toBeFalsy();
    expect(st.order).toHaveLength(MAX_WINDOWS);
  });

  it("자리가 없으면 새 인스턴스·창 복제도 열지 않고 알린다", () => {
    fill();
    const s = useWindowStore.getState();
    [m1, m2, m3, m4, m5].forEach((id) => s.setWindowDirty(id, true));

    expect(
      useWindowStore.getState().openNewInstance("route", { id: "m6", title: "메뉴6", href: "/m6" }),
    ).toBe(false);
    expect(useWindowStore.getState().duplicate(m6)).toBe(false);

    const st = useWindowStore.getState();
    expect(Object.keys(st.windows)).toHaveLength(MAX_WINDOWS);
    expect(st.focusedId).toBe(m6);
    expect(toastWarning).toHaveBeenCalledTimes(2);
  });
});

/**
 * 스포트라이트(앨범) 중 연 창 — 전수검사 2026-09-11: 사이드바·메뉴 판·팰릿·알림으로 연 창이 포커스만 받고
 * 위에 안 올라가 **투명(opacity 0)·클릭 불가**로 떴다(아래 카드 줄에 카드만 한 장 늘었다).
 * 원장 결정 = 앨범 위로 올린다(카드 클릭과 같은 규칙: 최대 3개, 넘치면 가장 오래 올라와 있던 것부터 내림).
 */
describe("window-store 스포트라이트 중 연 창은 앨범 위로 올린다", () => {
  beforeEach(reset);

  const STU = windowId("route", "students");
  const CLS = windowId("route", "classes");
  const MEET = windowId("route", "meetings");
  const openR = (id: string) =>
    useWindowStore.getState().open("route", { id, title: id, href: `/${id}` });
  /** 앨범 — 수업목록만 위, 원생목록은 아래 카드 줄. */
  function album() {
    openR("students");
    openR("classes");
    useWindowStore.getState().enterSpotlight(CLS);
    expect(useWindowStore.getState().spotlightRaised).toEqual([CLS]);
  }

  it("🔴 새 창은 포커스만 받고 가려지지 않는다 — 위로 올라온다", () => {
    album();
    openR("meetings");
    const st = useWindowStore.getState();
    expect(st.spotlight).toBe(true);
    expect(st.focusedId).toBe(MEET);
    expect(st.spotlightRaised).toContain(MEET);
  });

  it("🔴 아래 카드 줄에 있던 창을 다시 열어도 위로 올라온다", () => {
    album();
    openR("students");
    expect(useWindowStore.getState().spotlightRaised).toContain(STU);
  });

  it("새 인스턴스(shift+클릭)·복원도 같은 규칙", () => {
    album();
    useWindowStore.getState().openNewInstance("route", { id: "classes", title: "classes", href: "/classes" });
    expect(useWindowStore.getState().spotlightRaised).toContain(`${CLS}#1`);

    useWindowStore.getState().minimize(STU); // 카드 줄의 창을 최소화했다가
    useWindowStore.getState().restore(STU); // 되살리면
    expect(useWindowStore.getState().spotlightRaised).toContain(STU);
    expect(useWindowStore.getState().focusedId).toBe(STU);
  });

  it("위에 올라오는 창은 최대 3개 — 넘치면 가장 오래 올라와 있던 것부터 내린다", () => {
    album(); // [수업목록]
    openR("meetings");
    openR("staff");
    openR("billing");
    expect(useWindowStore.getState().spotlightRaised).toEqual([
      MEET,
      windowId("route", "staff"),
      windowId("route", "billing"),
    ]);
  });

  it("스포트라이트가 아니면 아무것도 올리지 않는다", () => {
    openR("students");
    useWindowStore.getState().restore(STU);
    expect(useWindowStore.getState().spotlightRaised).toEqual([]);
  });
});

/**
 * 리사이즈 바닥 = 창이 **지금 보는 화면**의 최소 크기 — 경로형 면이 부모 창 id로 합쳐진 뒤(전수검사 2026-09-11)
 * 출석부 창(1280) 안에서 뜬 출결 모드(560)가 1280에서 멈췄다. 여는 크기는 그대로 창 id 기준이다.
 */
describe("window-store resizeBy() — 최소 크기는 창이 지금 보는 화면 기준", () => {
  const ATT = windowId("route", "attendance");
  const QUICK = ROUTE_WINDOW_SIZE["attendance/quick"];
  let bounds: { width: number; height: number };
  beforeEach(() => {
    reset();
    bounds = useWindowStore.getState().bounds;
    useWindowStore.setState({ bounds: { width: 1600, height: 1000 } });
  });
  afterEach(() => {
    useWindowStore.setState({ bounds });
  });

  it("🔴 출석부 창에서 출결 모드를 보고 있으면 출결 모드 폭까지 줄어든다(1280에서 멈추지 않는다)", () => {
    useWindowStore.getState().open("route", { id: "attendance", title: "출결 모드", href: "/attendance/quick" });
    expect(useWindowStore.getState().windows[ATT]?.rect.w).toBe(ROUTE_WINDOW_SIZE.attendance.w); // 여는 크기는 id 기준
    useWindowStore.getState().resizeBy(ATT, { x: 0, y: 0, w: 1280, h: 900 }, "e", -2000, 0);
    expect(useWindowStore.getState().windows[ATT]?.rect.w).toBe(QUICK.w);
  });

  it("🔴 다른 메뉴로 드릴인한 화면은 종전대로 창 크기 — 원생 창 안의 콜&상담 상세가 바닥을 1120으로 올리지 않는다", () => {
    const STU = windowId("route", "students");
    useWindowStore.getState().open("route", { id: "students", title: "원생목록", href: "/students" });
    useWindowStore.getState().observeIframe(STU, { title: "원생목록", url: "/students?embed=1" });
    useWindowStore.getState().observeIframe(STU, { title: "상담 상세", url: "/enrollment/abc?embed=1" });
    useWindowStore.getState().resizeBy(STU, { x: 0, y: 0, w: 1300, h: 900 }, "e", -2000, 0);
    expect(useWindowStore.getState().windows[STU]?.rect.w).toBe(ROUTE_WINDOW_SIZE.students.w);
  });

  it("같은 창이 월별 출석부로 돌아오면(뒤로 기록 맨 위) 다시 1280에서 멈춘다", () => {
    useWindowStore.getState().open("route", { id: "attendance", title: "출결 모드", href: "/attendance/quick" });
    useWindowStore.getState().observeIframe(ATT, { title: "출결 모드", url: "/attendance/quick?embed=1" });
    useWindowStore.getState().observeIframe(ATT, { title: "출석부", url: "/attendance?embed=1" });
    useWindowStore.getState().resizeBy(ATT, { x: 0, y: 0, w: 1400, h: 900 }, "e", -2000, 0);
    expect(useWindowStore.getState().windows[ATT]?.rect.w).toBe(ROUTE_WINDOW_SIZE.attendance.w);
  });
});

/**
 * 보관(닫힌) 창 되살리기 — 리뷰 2026-09-11: 되살리기가 창 개수 한도를 우회했고(7개 → 다음 새 창이 둘을 밀어냄),
 * '첫 화면' 규칙이 메뉴 입구에만 있어 창 링크·알림·인쇄로 되살리면 옛 상세와 ←가 그대로였다.
 */
describe("window-store 보관 창 되살리기 — 창 개수 한도·첫 화면·새 인스턴스", () => {
  beforeEach(() => {
    reset();
    toastWarning.mockClear();
  });

  const A = windowId("route", "a");
  const openA = () => useWindowStore.getState().open("route", { id: "a", title: "가", href: "/a" });
  const openM = (n: number) =>
    useWindowStore.getState().open("route", { id: `m${n}`, title: `메뉴${n}`, href: `/m${n}` });
  /** 가 창에서 상세까지 들어갔다가 닫는다(보관). */
  function closeAtDetail() {
    openA();
    useWindowStore.getState().observeIframe(A, { title: "가", url: "/a?embed=1" });
    useWindowStore.getState().observeIframe(A, { title: "상세", url: "/a/x?embed=1" });
    useWindowStore.getState().close(A);
    expect(useWindowStore.getState().cached).toContain(A);
  }

  it("🔴 되살려도 한도를 넘지 않는다 — 뒤 창 하나를 밀어내고, 다음 새 창이 둘을 한꺼번에 밀지 않는다", () => {
    closeAtDetail();
    for (let i = 1; i <= MAX_WINDOWS; i++) openM(i);

    expect(openA()).toBe(true);
    let st = useWindowStore.getState();
    expect(st.order).toHaveLength(MAX_WINDOWS);
    expect(st.order).toContain(A);
    expect(st.windows[windowId("route", "m1")]).toBeFalsy();

    openM(7);
    st = useWindowStore.getState();
    expect(st.order).toHaveLength(MAX_WINDOWS);
    expect(st.windows[windowId("route", "m2")]).toBeFalsy();
    expect(st.windows[windowId("route", "m3")]).toBeTruthy(); // 한 번에 하나만
  });

  it("자리가 없으면 되살리지 않고 알린다", () => {
    closeAtDetail();
    for (let i = 1; i <= MAX_WINDOWS; i++) openM(i);
    for (let i = 1; i < MAX_WINDOWS; i++) useWindowStore.getState().setWindowDirty(windowId("route", `m${i}`), true);

    expect(openA()).toBe(false);
    const st = useWindowStore.getState();
    expect(st.cached).toContain(A);
    expect(st.windows[A]?.minimized).toBe(true);
    expect(st.order).not.toContain(A);
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it("🔴 어느 입구든 첫 화면 주소로 되살리면 첫 화면으로 — 기록 [첫 화면]·← 없음·'첫 화면으로' 표식", () => {
    closeAtDetail();
    openA(); // 창 링크·알림·인쇄처럼 openMenuWindow를 안 거치는 입구도 같은 store.open
    const st = useWindowStore.getState();
    expect(st.nav[A]).toEqual(["/a"]);
    expect(st.live[A]?.canBack).toBe(false);
    expect(st.homeNonce[A]).toBe(1);
  });

  it("첫 화면에서 닫았는데 기록이 여러 칸이면 기록만 줄이고 다시 불러오지 않는다", () => {
    openA();
    const s = useWindowStore.getState();
    s.observeIframe(A, { title: "가", url: "/a?embed=1" });
    s.observeIframe(A, { title: "상세", url: "/a/x?embed=1" });
    s.observeIframe(A, { title: "가", url: "/a?embed=1" }); // 창 안 링크로 목록에 돌아옴 — 기록 3칸
    useWindowStore.getState().close(A);

    openA();
    const st = useWindowStore.getState();
    expect(st.nav[A]).toEqual(["/a?embed=1"]);
    expect(st.live[A]?.canBack).toBe(false);
    expect(st.homeNonce[A]).toBeUndefined();
  });

  it("🔴 다른 화면(면)으로 옮기면 ←를 즉시 거둔다 — 새 문서가 뜨기 전 옛 ←로 고른 화면이 취소되지 않게", () => {
    openA();
    const s = useWindowStore.getState();
    s.observeIframe(A, { title: "가", url: "/a?embed=1" });
    s.observeIframe(A, { title: "상세", url: "/a/x?embed=1" });

    useWindowStore.getState().open("route", { id: "a", title: "가 — 면", href: "/a/face" });

    const st = useWindowStore.getState();
    expect(st.windows[A]?.params.href).toBe("/a/face");
    expect(st.nav[A]).toEqual(["/a/face"]);
    expect(st.live[A]).toEqual({ title: "가 — 면", canBack: false });
    expect(st.homeNonce[A]).toBeUndefined(); // 주소가 바뀌면 iframe src 교체가 옮긴다
  });

  it("🔴 원본이 보관 중이면 shift+클릭은 새 번호 대신 원본을 되살린다", () => {
    openA();
    useWindowStore.getState().close(A);

    useWindowStore.getState().openNewInstance("route", { id: "a", title: "가", href: "/a" });

    const st = useWindowStore.getState();
    expect(st.order).toEqual([A]);
    expect(st.windows[`${A}#1`]).toBeFalsy();
    expect(st.cached).not.toContain(A);
    expect(st.windows[A]?.minimized).toBe(false);
  });
});

/**
 * 녹음 중·미저장 창의 이동 — 리뷰 2026-09-11: ←·메뉴 '첫 화면으로'가 녹음 중인 창에도 걸렸고, 미저장 창에선 이동 **전에**
 * 기록을 바꿔 떠나기 확인에서 '머무르기'를 고르면 기록과 화면이 어긋났다.
 */
describe("window-store 녹음 중·미저장 창의 이동", () => {
  beforeEach(() => {
    reset();
    toastWarning.mockClear();
  });

  const A = windowId("route", "a");
  function atDetail() {
    useWindowStore.getState().open("route", { id: "a", title: "가", href: "/a" });
    useWindowStore.getState().observeIframe(A, { title: "가", url: "/a?embed=1" });
    useWindowStore.getState().observeIframe(A, { title: "상세", url: "/a/x?embed=1" });
  }

  it("🔴 녹음 중인 창은 어느 입구로도 다른 화면으로 옮기지 않는다 — 앞으로만 부르고 이유를 알린다", () => {
    atDetail();
    useWindowStore.getState().setWindowBusy(A, true);

    useWindowStore.getState().open("route", { id: "a", title: "가 — 면", href: "/a/face" });

    const st = useWindowStore.getState();
    expect(st.windows[A]?.params.href).toBe("/a");
    expect(st.nav[A]).toHaveLength(2);
    expect(st.focusedId).toBe(A);
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it("🔴 녹음 중이면 ←·첫 화면이 아무것도 바꾸지 않는다(첫 화면은 이유를 알린다)", () => {
    atDetail();
    useWindowStore.getState().setWindowBusy(A, true);

    expect(useWindowStore.getState().backNav(A)).toBeNull();
    expect(useWindowStore.getState().homeNav(A)).toBeNull();
    expect(useWindowStore.getState().nav[A]).toHaveLength(2);
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it("🔴 미저장 창의 ←는 기록을 바로 바꾸지 않는다 — '머무르기'면 그대로, 새 문서가 그 주소로 뜨면 그때 바꾼다", () => {
    atDetail();
    useWindowStore.getState().setWindowDirty(A, true);

    expect(useWindowStore.getState().backNav(A)).toBe("/a?embed=1");
    let st = useWindowStore.getState();
    expect(st.nav[A]).toHaveLength(2); // 떠나기 확인이 떠 있는 동안
    expect(st.live[A]?.canBack).toBe(true);

    // 옛 문서의 보고(제목 변경 등)가 와도 의도는 남는다
    useWindowStore.getState().observeIframe(A, { title: "상세", url: "/a/x?embed=1" });
    // '떠나기'를 고르면 새 문서가 그 주소로 뜬다 — 새 문서의 첫 로드 보고(RouteWindow onLoad)
    useWindowStore.getState().observeIframe(A, { title: "가", url: "/a?embed=1", load: true });
    st = useWindowStore.getState();
    expect(st.nav[A]).toEqual(["/a?embed=1"]);
    expect(st.live[A]?.canBack).toBe(false);
    expect(st.pendingNav[A]).toBeUndefined();
  });

  it("미저장 창에서 '머무르기' 뒤 창 안에서 다른 곳으로 가면 의도는 버리고 종전대로 쌓는다", () => {
    atDetail();
    useWindowStore.getState().setWindowDirty(A, true);
    useWindowStore.getState().backNav(A);

    useWindowStore.getState().observeIframe(A, { title: "수정", url: "/a/x/edit?embed=1" });

    const st = useWindowStore.getState();
    expect(st.nav[A]).toEqual(["/a?embed=1", "/a/x?embed=1", "/a/x/edit?embed=1"]);
    expect(st.pendingNav[A]).toBeUndefined();
  });

  it("미저장 창의 첫 화면 이동도 같다 — 새 문서가 뜰 때 기록을 첫 화면 하나로", () => {
    atDetail();
    useWindowStore.getState().setWindowDirty(A, true);

    expect(useWindowStore.getState().homeNav(A)).toBe("/a");
    expect(useWindowStore.getState().nav[A]).toHaveLength(2);

    useWindowStore.getState().observeIframe(A, { title: "가", url: "/a?embed=1", load: true });
    expect(useWindowStore.getState().nav[A]).toEqual(["/a?embed=1"]);
  });

  it("🔴 '머무르기' 뒤 같은 문서의 보고는 첫 화면 의도를 소비하지 않는다 — 새 문서의 로드 보고만", () => {
    // 지금 문서의 경로가 첫 화면과 같고 쿼리만 다른 경우(달을 옮긴 목록) — 경로만 보면 '도착'으로 오인한다.
    useWindowStore.getState().open("route", { id: "a", title: "가", href: "/a" });
    const s = useWindowStore.getState();
    s.observeIframe(A, { title: "가", url: "/a?embed=1" });
    s.observeIframe(A, { title: "상세", url: "/a/x?embed=1" });
    s.observeIframe(A, { title: "가 10월", url: "/a?month=10&embed=1" });
    useWindowStore.getState().setWindowDirty(A, true);
    expect(useWindowStore.getState().homeNav(A)).toBe("/a");

    // '머무르기' — 같은 문서가 제목을 바꿔 보고한다
    useWindowStore.getState().observeIframe(A, { title: "가 10월 · 수정 중", url: "/a?month=10&embed=1" });
    expect(useWindowStore.getState().nav[A]).toHaveLength(3);
    expect(useWindowStore.getState().live[A]?.canBack).toBe(true);

    // 나중에 진짜로 떠나 새 문서가 뜨면 그때 첫 화면 하나로
    useWindowStore.getState().observeIframe(A, { title: "가", url: "/a?embed=1", load: true });
    expect(useWindowStore.getState().nav[A]).toEqual(["/a?embed=1"]);
  });
});

describe("window-store 해시만 다른 주소는 같은 화면", () => {
  beforeEach(reset);
  const A = windowId("route", "a");

  it("🔴 첫 화면 주소에 해시가 있어도 해시만 다르면 이미 첫 화면 — 다시 눌러도 옮기지 않고, 되살려도 다시 불러오지 않는다", () => {
    // 해시만 다른 이동은 새 문서 로드가 없어 스켈레톤이 영영 안 걷힌다(재리뷰 2026-09-11).
    useWindowStore.getState().open("route", { id: "a", title: "가", href: "/a#top" });
    useWindowStore.getState().observeIframe(A, { title: "가", url: "/a?embed=1" });
    expect(useWindowStore.getState().homeNav(A)).toBeNull();

    useWindowStore.getState().close(A);
    useWindowStore.getState().open("route", { id: "a", title: "가", href: "/a#top" });
    expect(useWindowStore.getState().homeNonce[A]).toBeUndefined();
  });
});

describe("window-store 없는 창의 보고는 흔적을 되살리지 않는다", () => {
  beforeEach(reset);

  it("🔴 닫힌(파괴된) 창의 늦은 제목·주소·잠금 보고는 버린다 — 같은 id로 다시 연 창이 물려받지 않게", () => {
    const A = windowId("route", "a");
    useWindowStore.getState().open("route", { id: "a", title: "가", href: "/a" });
    useWindowStore.getState().setWindowDirty(A, true); // 미저장 창은 보관하지 않고 파괴한다
    useWindowStore.getState().close(A);

    useWindowStore.getState().observeIframe(A, { title: "상세", url: "/a/x?embed=1" });
    useWindowStore.getState().setWindowBusy(A, true);

    const st = useWindowStore.getState();
    expect(st.windows[A]).toBeFalsy();
    expect(st.nav[A]).toBeUndefined();
    expect(st.live[A]).toBeUndefined();
    expect(st.busy[A]).toBeUndefined();
  });
});
/** 원장 2026-10-16 "창 모드의 경우 창이 그냥 여러개 열리면 바로 이해 될것 같고" — 녹음 중 작성 창이 있으면 새 작성 창. */
describe("window-store openForm() — 녹음이 걸린 작성 창이 있으면 새 작성 창", () => {
  const FORM = windowId("route", "enrollment/new");
  const params = { id: "enrollment/new", title: "신규 콜&상담", href: "/enrollment/new", autoClose: true };
  beforeEach(() => {
    reset();
    useWindowStore.setState({ kaActive: false });
  });
  afterEach(() => useWindowStore.setState({ kaActive: false }));

  it("녹음이 안 걸렸으면 종전처럼 그 작성 창으로(한 벌만)", () => {
    const s = useWindowStore.getState();
    s.openForm("route", params);
    s.openForm("route", params);
    expect(Object.keys(useWindowStore.getState().windows)).toEqual([FORM]);
  });

  it("작성 창이 녹음 중이면 새 작성 창 — 임시 저장 칸을 가르는 form 표식을 단다 · 둘 다 녹음 중이면 또 하나", () => {
    const s = useWindowStore.getState();
    s.openForm("route", params);
    s.setWindowBusy(FORM, true);
    s.openForm("route", params);
    let st = useWindowStore.getState();
    expect(st.windows[`${FORM}#1`]?.params.href).toMatch(/^\/enrollment\/new\?form=[\w-]+$/);
    expect(st.windows[`${FORM}#1`]?.params.autoClose).toBe(true);
    expect(st.focusedId).toBe(`${FORM}#1`);
    expect(st.windows[FORM]?.params.href).toBe("/enrollment/new");
    st.setWindowBusy(`${FORM}#1`, true);
    st.openForm("route", params);
    st = useWindowStore.getState();
    expect(st.windows[`${FORM}#2`]).toBeDefined();
    expect(st.windows[`${FORM}#2`]?.params.href).not.toBe(st.windows[`${FORM}#1`]?.params.href);
  });

  it("녹음이 안 걸린 작성 창이 따로 있으면 새로 열지 않고 그 창을 앞으로", () => {
    const s = useWindowStore.getState();
    s.openForm("route", params);
    s.setWindowBusy(FORM, true);
    s.openForm("route", params);
    const before = useWindowStore.getState().windows[`${FORM}#1`]?.params.href;
    s.focus(FORM);
    s.setWindowDirty(`${FORM}#1`, true);
    s.openForm("route", params);
    const st = useWindowStore.getState();
    expect(st.windows[`${FORM}#2`]).toBeUndefined();
    expect(st.focusedId).toBe(`${FORM}#1`);
    // 🔴 앞으로만 — 표식을 떼고 '새 X' 주소로 옮기면 쓰던 것이 사라지고 녹음 중인 첫 작성 화면의 임시 저장 칸을 쓴다(재리뷰 2026-10-16).
    expect(st.windows[`${FORM}#1`]?.params.href).toBe(before);
    expect(before).toMatch(/form=/);
  });

  it("🔴 입력 중인 작성 창은 다른 주소로 옮기지 않는다 — 새 작성 창을 연다", () => {
    const s = useWindowStore.getState();
    s.openForm("route", params);
    s.setWindowBusy(FORM, true);
    s.openForm("route", params);
    const before = useWindowStore.getState().windows[`${FORM}#1`]?.params.href;
    s.setWindowDirty(`${FORM}#1`, true);
    useWindowStore.getState().openForm("route", { ...params, href: "/enrollment/new?studentId=b" });
    const st = useWindowStore.getState();
    expect(st.windows[`${FORM}#1`]?.params.href).toBe(before);
    expect(st.windows[`${FORM}#2`]?.params.href).toMatch(/^\/enrollment\/new\?studentId=b&form=[\w-]+$/);
    expect(st.focusedId).toBe(`${FORM}#2`);
  });

  it("이전 화면 유지 방식도 녹음 중 작성 화면만 예외로 한 벌 더 — Shift+클릭 복제는 여전히 없다", () => {
    useWindowStore.setState({ kaActive: true });
    const s = useWindowStore.getState();
    s.openNewInstance("route", { id: "students", title: "원생", href: "/students" });
    s.openNewInstance("route", { id: "students", title: "원생", href: "/students" });
    expect(useWindowStore.getState().windows[`${windowId("route", "students")}#1`]).toBeUndefined();
    s.openForm("route", params);
    s.setWindowBusy(FORM, true);
    s.openForm("route", params);
    expect(useWindowStore.getState().windows[`${FORM}#1`]?.params.href).toMatch(/form=/);
  });

  it("🔴 보관(닫힌) 원본이 있어도 새 작성 창은 새 번호로 — 원본을 되살려 그 첫 화면 주소를 바꾸지 않는다", () => {
    const s = useWindowStore.getState();
    s.openForm("route", params);
    s.setWindowBusy(FORM, true);
    s.openForm("route", params);
    s.setWindowBusy(`${FORM}#1`, true);
    s.setWindowBusy(FORM, false);
    useWindowStore.setState({ cached: [FORM] });
    useWindowStore.getState().openForm("route", params);
    const st = useWindowStore.getState();
    expect(st.windows[`${FORM}#2`]?.params.href).toMatch(/form=/);
    expect(st.windows[FORM]?.params.href).toBe("/enrollment/new");
    expect(st.windows[FORM]?.params.autoClose).toBe(true);
    expect(st.cached).toContain(FORM);
  });

  it("녹음이 안 걸린 작성 창이 있는데 다른 주소(학생을 고른 '상담 기록 +')면 그 창을 그 주소로 옮긴다 — 그 창의 form 표식은 그대로", () => {
    const s = useWindowStore.getState();
    s.openForm("route", params);
    s.setWindowBusy(FORM, true);
    s.openForm("route", params);
    const formId = new URL(useWindowStore.getState().windows[`${FORM}#1`]!.params.href!, "http://x").searchParams.get("form");
    useWindowStore.getState().openForm("route", { ...params, href: "/enrollment/new?studentId=b" });
    const st = useWindowStore.getState();
    const href = `/enrollment/new?studentId=b&form=${formId}`;
    expect(st.windows[`${FORM}#1`]?.params.href).toBe(href);
    expect(st.nav[`${FORM}#1`]).toEqual([href]);
    expect(st.focusedId).toBe(`${FORM}#1`);
    expect(st.windows[FORM]?.params.href).toBe("/enrollment/new");
  });
});
