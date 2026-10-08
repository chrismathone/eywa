import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { routeWindowSize, ROUTE_WINDOW_SIZE } from "@/components/workspace/window-geometry";
import { WINDOW_DIRTY_MESSAGE } from "@/components/workspace/window-bridge";
import { windowIdForHref } from "@/components/workspace/window-link";
import { defaultAppearance } from "@/features/timetable-lab/editor/appearance";

const APPEARANCE = defaultAppearance;

// 편집기 본체 대신 서는 대역 — 호스트가 넘긴 '미저장 알림' 함수만 붙잡아 둔다.
const hoisted = vi.hoisted(() => ({ onDirtyChange: null as ((dirty: boolean) => void) | null, appearance: null as unknown }));
vi.mock("next/dynamic", () => ({
  default: () =>
    function Stub(props: { onDirtyChange: (dirty: boolean) => void; appearance: unknown }) {
      hoisted.onDirtyChange = props.onDirtyChange;
      hoisted.appearance = props.appearance;
      return null;
    },
}));

/**
 * 시간표 편집기(연습본)의 앱 배선 가드.
 * ① 진입 버튼 · 편집기 화면 · 연습본 API가 **같은 권한 판정**을 쓴다(#77 — 화면에서만 감추면 주소로 들어온다).
 * ② 편집기는 화면을 열 때만 내려받는다(B5) · 창에서는 여백 없이 가득 쓴다 · 창을 닫을 때 미저장 확인을 거친다.
 */
const ROOT = resolve(process.cwd());
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const PAGE = read("src/app/(shell)/timetable/editor/page.tsx");
const LOADING = read("src/app/(shell)/timetable/editor/loading.tsx");
const HOST = read("src/app/(shell)/timetable/editor/_components/editor-host.tsx");
const TIMETABLE = read("src/app/(shell)/timetable/page.tsx");
const SHORTCUT = read("src/app/(shell)/timetable/_components/editor-shortcut.tsx");

describe("권한 — 버튼·화면·API가 판정 하나를 쓴다", () => {
  it("편집기 화면은 시간표 열람 게이트 뒤에 편집기 판정을 건다", () => {
    expect(PAGE).toMatch(/await requireAccess\("timetable"\)/);
    expect(PAGE).toMatch(/if \(!\(await canUseTimetableEditor\(user\.systemRole\)\)\)/);
    // 창 안에서 돌려보낼 때 embed를 지킨다(#133).
    expect(PAGE).toContain('"/timetable?embed=1"');
  });

  it("빈 연습본은 학원설정의 교시를 싣고 시작한다 — 내장 기본 교시로 운영시간을 판정하지 않는다", () => {
    expect(PAGE).toMatch(/<TimetableEditorHost appearance=\{blankAppearance\(await getTenantSettings\(\)\)\} \/>/);
    expect(read("src/app/(shell)/timetable/editor/_components/editor-impl.tsx")).toMatch(/new DraftStore\(\{ \.\.\.emptyDraft\(\), appearance \}\)/);
  });

  it("연습본 저장·불러오기와 기존 시간표 읽기도 같은 판정이다 — 따로 적은 권한 조합이 없다", () => {
    for (const path of ["src/features/timetable-lab/server/draft-http.ts", "src/app/api/timetable/lab/source/route.ts"]) {
      const source = read(path);
      expect(source, path).toMatch(/canUseTimetableEditor\(user\.systemRole\)/);
      expect(source, path).not.toContain("canManageTenant");
    }
  });

  it("시간표의 진입 버튼은 같은 판정을 통과한 사람에게, 영어를 볼 때만 보인다", () => {
    expect(TIMETABLE).toMatch(/const showEditorShortcut = subject === "english" && \(await canUseTimetableEditor\(user\.systemRole\)\);/);
    expect(TIMETABLE).toMatch(/\{showEditorShortcut && !isRooms \? <EditorShortcut \/> : null\}/);
    // 버튼은 한 곳에서만 그린다.
    expect(TIMETABLE.match(/<EditorShortcut \/>/g)).toHaveLength(1);
  });
});

describe("화면 — 창을 가득 쓰고, 편집기는 열 때만 내려받는다", () => {
  const rootClass = (source: string) => /<div className="([^"]*edge-to-edge[^"]*)">/.exec(source)?.[1];

  it("page와 loading의 루트 className이 같다(스켈레톤 → 본문에서 폭이 튀지 않는다)", () => {
    expect(rootClass(PAGE)).toBe("edge-to-edge timetable-editor-page h-full min-h-0");
    expect(rootClass(LOADING)).toBe(rootClass(PAGE));
  });

  it("편집기 본체는 브라우저에서만, 따로 내려받는다", () => {
    expect(HOST).toMatch(/dynamic\(\(\) => import\("\.\/editor-impl"\)/);
    expect(HOST).toMatch(/ssr: false/);
    expect(HOST).toMatch(/loading: \(\) => <EditorSkeleton \/>/);
    // 서버 페이지가 본체를 직접 끌어오면 지연 로드가 무너진다.
    expect(PAGE).not.toMatch(/editor-impl|features\/timetable-lab\/editor/);
  });

  it("버튼은 시간표 창을 바꾸지 않고 편집기 창을 따로 연다 · 창 크기가 등록돼 있다", () => {
    expect(SHORTCUT).toMatch(/<WindowLink href="\/timetable\/editor" title="시간표 편집기" frameTarget="window" \/>/);
    // 창 id는 시간표 메뉴 창('timetable')과 달라야 한다 — 같으면 버튼이 시간표 창을 앞으로 가져올 뿐 편집기가 안 열린다.
    expect(windowIdForHref("/timetable/editor")).toMatchObject({ id: "timetable/editor" });
    expect(windowIdForHref("/timetable")).toMatchObject({ id: "timetable" });
    expect(routeWindowSize("timetable/editor")).toEqual(ROUTE_WINDOW_SIZE["timetable/editor"]);
    // 시간표 창(1040)을 그대로 물려받으면 확인 패널을 열 때 격자가 서너 칸만 남는다.
    expect(ROUTE_WINDOW_SIZE["timetable/editor"].w).toBeGreaterThan(ROUTE_WINDOW_SIZE.timetable.w);
  });
});

describe("창 닫기 확인 — 미저장 여부를 부모 작업면에 알린다", () => {
  const post = vi.fn();
  const realParent = Object.getOwnPropertyDescriptor(window, "parent");

  beforeEach(() => {
    post.mockClear();
    Object.defineProperty(window, "parent", { configurable: true, value: { postMessage: post } });
  });
  afterEach(() => {
    cleanup();
    if (realParent) Object.defineProperty(window, "parent", realParent);
    else Reflect.deleteProperty(window, "parent");
  });

  it("바뀔 때만 보내고, 화면을 떠나면 반드시 푼다", async () => {
    const { TimetableEditorHost } = await import("./_components/editor-host");
    const view = render(<TimetableEditorHost appearance={APPEARANCE} />);
    expect(hoisted.appearance).toBe(APPEARANCE);
    hoisted.onDirtyChange!(false); // 처음부터 깨끗하면 보낼 것이 없다
    expect(post).not.toHaveBeenCalled();
    hoisted.onDirtyChange!(true);
    hoisted.onDirtyChange!(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toMatchObject({ type: WINDOW_DIRTY_MESSAGE, dirty: true });
    expect(post.mock.calls[0][1]).toBe(window.location.origin);
    view.unmount();
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[1][0]).toMatchObject({ type: WINDOW_DIRTY_MESSAGE, dirty: false });
  });

  it("저장해서 깨끗해진 뒤 떠나면 다시 보내지 않는다", async () => {
    const { TimetableEditorHost } = await import("./_components/editor-host");
    const view = render(<TimetableEditorHost appearance={APPEARANCE} />);
    hoisted.onDirtyChange!(true);
    hoisted.onDirtyChange!(false);
    expect(post).toHaveBeenCalledTimes(2);
    view.unmount();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("창 없이 열렸을 때 저장 안 한 채 다른 메뉴 링크를 누르면 묻는다 — 취소하면 이동하지 않는다", async () => {
    const { TimetableEditorHost } = await import("./_components/editor-host");
    const confirm = vi.fn().mockReturnValue(false);
    const realConfirm = Object.getOwnPropertyDescriptor(window, "confirm");
    Object.defineProperty(window, "confirm", { configurable: true, value: confirm });
    const link = (target?: string) => {
      const a = document.createElement("a");
      a.href = "/students";
      if (target) a.target = target;
      document.body.append(a);
      return a;
    };
    const away = link(), tab = link("_blank");
    render(<TimetableEditorHost appearance={APPEARANCE} />);
    // 막혔는가 = 클릭이 링크까지 닿지 못했는가(가드가 맨 앞에서 가로챈다). 닿은 클릭은 시험 환경이 실제로 이동하지 않게 여기서 멈춘다.
    const click = (a: HTMLAnchorElement) => {
      let reached = false;
      const stop = (event: Event) => { reached = true; event.preventDefault(); };
      a.addEventListener("click", stop);
      a.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
      a.removeEventListener("click", stop);
      return !reached;
    };
    try {
      expect(click(away)).toBe(false); // 깨끗하면 그냥 간다
      expect(confirm).not.toHaveBeenCalled();
      hoisted.onDirtyChange!(true);
      expect(click(away)).toBe(true); // 취소 → 이동을 막는다
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(click(tab)).toBe(false); // 새 탭은 이 화면을 떠나지 않는다
      expect(confirm).toHaveBeenCalledTimes(1);
      confirm.mockReturnValue(true);
      expect(click(away)).toBe(false); // 떠나겠다고 하면 막지 않는다
      expect(confirm).toHaveBeenCalledTimes(2);
    } finally {
      away.remove();
      tab.remove();
      if (realConfirm) Object.defineProperty(window, "confirm", realConfirm);
      else Reflect.deleteProperty(window, "confirm");
    }
  });
});
