import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Suspense, use, useEffect, useState, type ReactNode } from "react";

// next/link는 Next 라우터 없이는 onNavigate를 부르지 않는다 — 실제 link.js의 순서(사용자 onClick → defaultPrevented면
// 중단 → 수정키면 브라우저 몫 → preventDefault → onNavigate → 막히지 않았으면 이동)를 그대로 흉내 낸다.
const mocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), linkNav: vi.fn(), rename: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, onClick, onNavigate, children, ...rest }: {
    href: string; children: ReactNode; onClick?: (e: React.MouseEvent) => void;
    onNavigate?: (e: { preventDefault: () => void }) => void;
  }) => <a href={href} {...rest} onClick={(e) => {
    onClick?.(e);
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    let prevented = false;
    onNavigate?.({ preventDefault: () => { prevented = true; } });
    if (!prevented) mocks.linkNav(href);
  }}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock("@/features/documents/server/category-actions", () => ({ reparentDocumentCategory: vi.fn(), renameDocumentCategory: mocks.rename }));
vi.mock("@/features/documents/server/file-actions", () => ({ moveDocumentFile: vi.fn() }));
vi.mock("@/features/documents/server/favorite-actions", () => ({ setDocumentFolderFavorite: vi.fn() }));
import { FolderListSection, FolderNavigationProvider, FolderNavLink } from "./folder-navigation";
import { FolderInteractionProvider, FolderName } from "./folder-interactions";
import { FolderTree } from "./folder-tree";

const categories = [
  { key: "class", label: "수업", isSystem: true },
  { key: "math", label: "수학", isSystem: false, parentKey: "class" },
  { key: "middle", label: "중등", isSystem: false, parentKey: "math" },
  { key: "hr", label: "인사", isSystem: true },
  { key: "hr-sub", label: "계약", isSystem: false, parentKey: "hr" },
];
const hrefs = Object.fromEntries(categories.map((c) => [c.key, `/documents?cat=${c.key}`]));

// Next 라우터 흉내 — 실제 router.push는 루트 상태를 "아직 안 온 RSC 약속"으로 바꿔 트랜지션을 매달아 둔다.
// 그래야 이동 중(isPending)·낙관 값이 화면에 머문다. 모의 push가 곧장 끝나면 그 상태를 시험할 수 없다.
let navigate: ((p: Promise<void>) => void) | null = null;
function RouterSim({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Promise<void> | null>(null);
  useEffect(() => { navigate = setPending; }, []);
  if (pending) use(pending);
  return children;
}
const hang = () => navigate?.(new Promise<void>(() => {}));
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); navigate = null; });

function explorer(activeKey: string | null, canManage = true) {
  mocks.push.mockImplementation(hang);
  mocks.replace.mockImplementation(hang);
  return <Suspense fallback={null}><RouterSim><FolderInteractionProvider categories={categories} canManage={canManage}>
    <FolderNavigationProvider activeKey={activeKey}>
      <FolderTree categories={categories} counts={null} activeKey={activeKey} hrefs={hrefs} favoriteKeys={[]} />
      <FolderListSection>
        <div data-testid="card"><FolderName folder={categories[2]} href={hrefs.middle} /></div>
        <button type="button" onClick={mocks.refresh}>고정</button>
      </FolderListSection>
    </FolderNavigationProvider>
  </FolderInteractionProvider></RouterSim></Suspense>;
}

it("폴더를 누르면 보류 없이 곧바로 이동을 보내고, 그 자리에서 선택된 모양 + 목록 흐림을 보인다", () => {
  render(explorer(null));
  // 트리는 최상위만 보인다 — '수업'을 누른다.
  fireEvent.click(screen.getByRole("link", { name: "수업" }), { detail: 1 });
  expect(mocks.push).toHaveBeenCalledWith("/documents?cat=class"); // 타이머를 돌리지 않아도 이미 출발(예전엔 500ms 보류)
  expect(mocks.linkNav).not.toHaveBeenCalled(); // Next 기본 이동이 아니라 탐색기 이동으로 한 번만
  expect(screen.getByRole("link", { name: "수업" })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("status")).toHaveTextContent("폴더를 여는 중");
  expect(document.querySelector("section")).toHaveAttribute("aria-busy", "true");
});

it("더블클릭은 이름 변경 — 첫 클릭이 연 이동을 멈추고(지금 주소로 되돌림) 두 번째 클릭은 이동하지 않는다", async () => {
  // ⚠️ act() 안에서는 매달린 트랜지션 뒤의 동기 업데이트가 커밋되지 않는다(테스트 환경만의 현상 — 실제 브라우저는
  //    이동 중에도 입력이 된다). 그래서 이 시험만 실제 스케줄러로 돌리고 결과를 기다린다.
  const g = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const prevAct = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    window.history.replaceState(null, "", "/documents?cat=math");
    render(explorer("math"));
    const card = screen.getByTestId("card").querySelector("a")!;
    fireEvent.click(card, { detail: 1 });
    await waitFor(() => expect(document.querySelector("section")).toHaveAttribute("aria-busy", "true"));
    fireEvent.click(card, { detail: 2 });
    fireEvent.doubleClick(card);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "새 이름" })).toHaveValue("중등"));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/documents?cat=math", { scroll: false });
    // 되돌린 뒤엔 목록을 흐리지 않는다(선택 표시도 지금 폴더 그대로).
    await waitFor(() => expect(document.querySelector("section")).not.toHaveAttribute("aria-busy"));
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prevAct;
  }
});

it("읽기 전용 사용자는 더블클릭해도 한 번만 이동하고 편집 칸이 열리지 않는다", () => {
  render(explorer("math", false));
  const card = screen.getByTestId("card").querySelector("a")!;
  fireEvent.click(card, { detail: 1 });
  fireEvent.click(card, { detail: 2 });
  fireEvent.doubleClick(card);
  console.log("DEBUG", screen.getByTestId("card").innerHTML, "| section busy:", document.querySelector("section")?.getAttribute("aria-busy"), "| body len", document.body.innerHTML.length);
  expect(mocks.push).toHaveBeenCalledTimes(1);
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("첫 클릭으로 화면이 바뀐 뒤 같은 더블클릭의 나머지가 다른 버튼에 떨어지면 삼킨다", () => {
  render(explorer(null));
  fireEvent.click(screen.getByRole("link", { name: "수업" }), { detail: 1 });
  fireEvent.click(screen.getByRole("button", { name: "고정" }), { detail: 2 });
  expect(mocks.refresh).not.toHaveBeenCalled();
  // 한도(1초)가 지나면 평소대로 눌린다.
  vi.spyOn(performance, "now").mockReturnValue(performance.now() + 1500);
  fireEvent.click(screen.getByRole("button", { name: "고정" }), { detail: 2 });
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("폴더를 누른 뒤 다른 곳을 새로 더블클릭하면 그 두 번째 클릭은 삼키지 않는다(새 묶음)", () => {
  render(explorer(null));
  fireEvent.click(screen.getByRole("link", { name: "수업" }), { detail: 1 });
  fireEvent.click(screen.getByRole("button", { name: "고정" }), { detail: 1 });
  fireEvent.click(screen.getByRole("button", { name: "고정" }), { detail: 2 });
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
});

it("Ctrl·가운데 클릭(새 탭)은 탐색기 이동을 걸지 않는다", () => {
  render(explorer(null));
  fireEvent.click(screen.getByRole("link", { name: "수업" }), { detail: 1, ctrlKey: true });
  expect(mocks.push).not.toHaveBeenCalled();
});

it("탐색기 밖에서는 평범한 링크로 동작하고 창 안이면 embed를 잃지 않는다", async () => {
  render(<FolderNavLink href="/documents?cat=hr" folderKey="hr">인사</FolderNavLink>);
  fireEvent.click(screen.getByRole("link", { name: "인사" }), { detail: 1 });
  expect(mocks.push).not.toHaveBeenCalled();
  expect(mocks.linkNav).toHaveBeenCalledWith("/documents?cat=hr");
  cleanup();
  const { EmbedProvider } = await import("@/components/workspace/embed-context");
  render(<EmbedProvider embed><FolderNavigationProvider activeKey={null}>
    <FolderNavLink href="/documents?cat=hr" folderKey="hr">인사</FolderNavLink>
  </FolderNavigationProvider></EmbedProvider>);
  expect(screen.getByRole("link", { name: "인사" })).toHaveAttribute("href", "/documents?cat=hr&embed=1");
  fireEvent.click(screen.getByRole("link", { name: "인사" }), { detail: 1 });
  expect(mocks.push).toHaveBeenCalledWith("/documents?cat=hr&embed=1");
});

it("다른 폴더로 옮겨도 사용자가 펼쳐 둔 트리는 접히지 않고, 새 경로의 조상은 더 펼친다", () => {
  const view = render(explorer(null));
  fireEvent.click(screen.getByRole("button", { name: "인사 펼치기" }));
  expect(screen.getByRole("link", { name: "계약" })).toBeInTheDocument();
  act(() => view.rerender(explorer("middle")));
  expect(screen.getByRole("link", { name: "계약" })).toBeInTheDocument(); // 예전엔 트리를 다시 만들어 접혔다
  expect(screen.getAllByRole("link", { name: "중등" })[0]).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("button", { name: "수업 / 수학 접기" })).toBeInTheDocument();
});
