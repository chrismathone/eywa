import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWindowStore, windowId } from "./window-store";
import { KEEPALIVE_EXPIRE_MS, KEEPALIVE_MAX } from "./keepalive-rules";

vi.mock("sonner", () => ({ toast: { warning: vi.fn(), info: vi.fn() } }));

const T0 = 1_000_000_000_000;
const MIN = 60_000;
const id = (menu: string) => windowId("route", menu);

function reset() {
  useWindowStore.setState({
    owner: null,
    shellMode: null,
    shellEpoch: null,
    lastUsed: {},
    kaVisible: null,
    kaBack: null,
    kaActive: false,
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
const open = (menu: string) => useWindowStore.getState().open("route", { id: menu, title: menu, href: `/${menu}` });
const st = () => useWindowStore.getState();
const visibleIds = () => Object.values(st().windows).filter((w) => !w.minimized).map((w) => w.id);

describe("adoptOwner — 지점 방식이 바뀌면 영속된 창·유지 화면을 전부 닫는다", () => {
  beforeEach(reset);

  function seed(mode: "windows" | "keepalive" | "single" | null, epoch: string | null = mode ? "e1" : null) {
    open("students");
    open("classes");
    useWindowStore.setState({ owner: "t:u", shellMode: mode, shellEpoch: epoch, lastUsed: { [id("students")]: T0 } });
  }

  it("같은 방식·같은 판의 새로고침은 그대로 복원한다(창 모드도 지금처럼)", () => {
    seed("windows");
    st().adoptOwner("t:u", "windows", "e1");
    expect(Object.keys(st().windows)).toHaveLength(2);
    expect(st().shellMode).toBe("windows");
    reset();
    seed("keepalive");
    st().adoptOwner("t:u", "keepalive", "e1");
    expect(Object.keys(st().windows)).toHaveLength(2);
  });

  it("방식 표식이 없는 옛 영속본은 창 모드로 읽는다 — 창 모드 지점은 초기화되지 않고, 이때부터 방식·판을 적는다", () => {
    seed(null);
    st().adoptOwner("t:u", "windows", "2026-09-25T00:00:00+00:00");
    expect(Object.keys(st().windows)).toHaveLength(2);
    expect(st().shellMode).toBe("windows");
    expect(st().shellEpoch).toBe("2026-09-25T00:00:00+00:00");
  });

  it.each([
    ["windows", "keepalive"],
    ["keepalive", "windows"],
    ["windows", "single"],
    ["keepalive", "single"],
    ["single", "windows"],
    ["single", "keepalive"],
    [null, "single"],
    [null, "keepalive"],
  ] as const)("%s → %s 는 어느 방향이든 빈 상태로 시작한다(페이지를 새로 연 때 = 입력 표식 없음)", (from, to) => {
    seed(from);
    st().adoptOwner("t:u", to, "e2");
    const s = st();
    expect(s.windows).toEqual({});
    expect(s.order).toEqual([]);
    expect(s.focusedId).toBeNull();
    expect(s.lastUsed).toEqual({});
    expect(s.shellMode).toBe(to);
    expect(s.shellEpoch).toBe("e2");
    expect(s.owner).toBe("t:u");
  });

  it("🔴 같은 방식이라도 판이 다르면(바꿨다 되돌림) 빈 상태로 시작한다", () => {
    seed("windows", "e1");
    st().adoptOwner("t:u", "windows", "e2");
    expect(st().windows).toEqual({});
    expect(st().shellEpoch).toBe("e2");
  });

  it("🔴 다른 계정이면 입력 중이어도 전부 닫는다(남의 화면을 넘기지 않는다)", () => {
    seed("keepalive");
    st().setWindowDirty(id("students"), true);
    st().adoptOwner("other:user", "keepalive", "e1");
    expect(st().windows).toEqual({});
    expect(st().dirty).toEqual({});
  });

  it("방식을 안 넘기는 호출(판을 모를 때)은 계정만 본다 — 방식·판도 그대로 둔다", () => {
    seed("keepalive");
    st().adoptOwner("t:u");
    expect(Object.keys(st().windows)).toHaveLength(2);
    expect(st().shellMode).toBe("keepalive");
    expect(st().shellEpoch).toBe("e1");
    st().adoptOwner("other:user");
    expect(st().windows).toEqual({});
  });

  it("영속본에 방식·판·사용 시각을 싣는다(브라우저를 껐다 켜도 같은 기준)", () => {
    seed("keepalive");
    const persisted = useWindowStore.persist.getOptions().partialize!(st()) as Record<string, unknown>;
    expect(persisted.shellMode).toBe("keepalive");
    expect(persisted.shellEpoch).toBe("e1");
    expect(persisted.lastUsed).toEqual({ [id("students")]: T0 });
  });
});

describe("applyKeepalive — 한 화면씩 · 상한 · 만료", () => {
  beforeEach(() => {
    reset();
    useWindowStore.setState({ shellMode: "keepalive", kaActive: true });
  });

  it("다른 메뉴를 열면 이전 화면은 닫히지 않고 숨는다(창 목록에 그대로 남는다)", () => {
    open("students");
    st().applyKeepalive(T0);
    open("classes");
    st().applyKeepalive(T0 + MIN);
    expect(Object.keys(st().windows).sort()).toEqual([id("classes"), id("students")].sort());
    expect(visibleIds()).toEqual([id("classes")]);
    expect(st().windows[id("students")].minimized).toBe(true);
    // 다시 열면 그 화면이 돌아온다(문서를 새로 만들지 않는다 — 같은 창 항목)
    open("students");
    st().applyKeepalive(T0 + 2 * MIN);
    expect(visibleIds()).toEqual([id("students")]);
  });

  it("바뀔 게 없는 두 번째 호출은 상태를 건드리지 않는다(멱등)", () => {
    open("students");
    st().applyKeepalive(T0);
    const before = useWindowStore.getState();
    st().applyKeepalive(T0 + 1000);
    expect(useWindowStore.getState()).toBe(before);
  });

  it("6번째 화면을 열면 가장 오래 안 본 숨은 화면이 사라진다 — 상한은 5", () => {
    const menus = ["m0", "m1", "m2", "m3", "m4", "m5"];
    menus.forEach((m, i) => {
      open(m);
      st().applyKeepalive(T0 + i * MIN);
    });
    expect(KEEPALIVE_MAX).toBe(5);
    expect(Object.keys(st().windows)).toHaveLength(5);
    expect(st().windows[id("m0")]).toBeUndefined();
    expect(visibleIds()).toEqual([id("m5")]);
  });

  it("🔴 입력 중인 화면은 가장 오래됐어도 상한 정리에 말없이 안 사라진다", () => {
    ["m0", "m1", "m2", "m3", "m4"].forEach((m, i) => {
      open(m);
      st().applyKeepalive(T0 + i * MIN);
    });
    st().setWindowDirty(id("m0"), true);
    open("m5");
    st().applyKeepalive(T0 + 10 * MIN);
    expect(st().windows[id("m0")]).toBeDefined();
    expect(st().windows[id("m1")]).toBeUndefined(); // 다음으로 오래된 화면이 대신 간다
    expect(st().dirty[id("m0")]).toBe(true);
  });

  it("사용 없이 2시간이 지난 숨은 화면은 지운다 — 흔적(뒤로 기록·제목)까지", () => {
    open("students");
    st().applyKeepalive(T0);
    open("classes");
    st().applyKeepalive(T0 + MIN);
    st().observeIframe(id("students"), { title: "학생", url: "/students" });
    expect(st().nav[id("students")]).toBeDefined();
    st().applyKeepalive(T0 + MIN + KEEPALIVE_EXPIRE_MS + 1);
    expect(st().windows[id("students")]).toBeUndefined();
    expect(st().nav[id("students")]).toBeUndefined();
    expect(st().live[id("students")]).toBeUndefined();
    expect(st().windows[id("classes")]).toBeDefined(); // 보이는 화면은 쓰는 중
  });

  it("🔴 입력 중인 숨은 화면은 2시간이 지나도 안 지운다", () => {
    open("students");
    st().applyKeepalive(T0);
    open("classes");
    st().applyKeepalive(T0 + MIN);
    st().setWindowDirty(id("students"), true);
    st().applyKeepalive(T0 + 5 * 60 * MIN);
    expect(st().windows[id("students")]).toBeDefined();
  });

  it("복원 직후(시작)에는 보이던 화면도 같은 기준 — 3시간 만에 돌아오면 빈 첫 화면", () => {
    open("students");
    st().applyKeepalive(T0);
    st().applyKeepalive(T0 + 3 * 60 * MIN, { expireVisible: true });
    expect(st().windows).toEqual({});
    expect(st().focusedId).toBeNull();
  });

  it("보이던 화면을 닫으면(autoClose 등) 직전 화면이 다시 보인다", () => {
    open("students");
    st().applyKeepalive(T0);
    open("classes");
    st().applyKeepalive(T0 + MIN);
    // 창 엔진의 close — autoClose 창은 보관 없이 파괴된다
    useWindowStore.getState().open("route", { id: "students/new", title: "새 원생", href: "/students/new", autoClose: true });
    st().applyKeepalive(T0 + 2 * MIN);
    expect(visibleIds()).toEqual([id("students/new")]);
    st().close(id("students/new"));
    st().applyKeepalive(T0 + 3 * MIN);
    expect(visibleIds()).toEqual([id("classes")]);
  });

  it("🔴 '오늘'에서 연 생성폼을 닫으면 첫 화면으로 — 예전에 떠난 화면이 튀어나오지 않는다", () => {
    open("students");
    st().applyKeepalive(T0);
    st().showDesktop(); // '오늘'
    st().applyKeepalive(T0 + MIN);
    useWindowStore.getState().open("route", { id: "students/new", title: "새 원생", href: "/students/new", autoClose: true });
    st().applyKeepalive(T0 + 2 * MIN);
    expect(visibleIds()).toEqual([id("students/new")]);
    st().close(id("students/new"));
    st().applyKeepalive(T0 + 3 * MIN);
    expect(visibleIds()).toEqual([]);
    expect(st().focusedId).toBeNull();
    expect(st().windows[id("students")]).toBeDefined(); // 숨은 채 남아 있다
  });

  it("앨범(스포트라이트)은 켜지지 않는다", () => {
    open("students");
    st().enterSpotlight();
    expect(st().spotlight).toBe(true);
    st().applyKeepalive(T0);
    expect(st().spotlight).toBe(false);
  });

  it("'오늘'(전부 숨김)이면 보이는 화면이 없고 모두 남아 있다", () => {
    open("students");
    st().applyKeepalive(T0);
    st().showDesktop();
    st().applyKeepalive(T0 + MIN);
    expect(visibleIds()).toEqual([]);
    expect(Object.keys(st().windows)).toHaveLength(1);
  });
});

describe("창 모드 전용 기능은 이 방식에서 막힌다", () => {
  beforeEach(reset);

  it("Shift+클릭(새 인스턴스)은 같은 화면을 연다 — 복제가 생기지 않는다", () => {
    useWindowStore.setState({ shellMode: "keepalive", kaActive: true });
    open("students");
    st().openNewInstance("route", { id: "students", title: "학생", href: "/students" });
    expect(Object.keys(st().windows)).toEqual([id("students")]);
  });

  it("창 복제는 거절된다", () => {
    useWindowStore.setState({ shellMode: "keepalive", kaActive: true });
    open("students");
    expect(st().duplicate(id("students"))).toBe(false);
    expect(Object.keys(st().windows)).toEqual([id("students")]);
  });

  it("🔴 판정은 영속본이 아니라 **지금 그려진 방식** — 라이선스 조회 실패로 이 요청만 창 모드로 그려지면 복제가 된다", () => {
    useWindowStore.setState({ shellMode: "keepalive", kaActive: false });
    open("students");
    expect(st().duplicate(id("students"))).toBe(true);
  });

  it("🔴 창 모드에서는 종전 그대로 — 새 인스턴스·복제가 된다(회귀 금지)", () => {
    useWindowStore.setState({ shellMode: "windows", kaActive: false });
    open("students");
    st().openNewInstance("route", { id: "students", title: "학생", href: "/students" });
    expect(Object.keys(st().windows)).toHaveLength(2);
    expect(st().duplicate(id("students"))).toBe(true);
    expect(Object.keys(st().windows)).toHaveLength(3);
  });
});
