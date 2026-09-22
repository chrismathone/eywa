import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({ documents: vi.fn().mockResolvedValue({ rows: [], total: 0 }), access: vi.fn().mockResolvedValue(true) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-embed": "1" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/auth/require-access", () => ({ requireAccess: async () => ({ systemRole: "master" }) }));
vi.mock("@/lib/auth/perm-matrix", () => ({ canWriteTenant: mocks.access, canAccessTenant: async () => true }));
vi.mock("@/features/documents/server/queries", () => ({
  getDocumentsPage: mocks.documents, getDocumentCategoryCounts: async () => ({ all: 33, billing: 25, hr: 8 }),
}));
vi.mock("@/features/documents/server/linked-queries", () => ({ getLinkedPage: vi.fn(), getLinkedCounts: async () => ({ textbooks: 538, quotes: 17 }) }));
vi.mock("@/features/documents/server/category-queries", async () => {
  const { SYSTEM_CATEGORY_OPTIONS } = await import("@/features/documents/categories");
  return { getDocumentCategories: async () => [...SYSTEM_CATEGORY_OPTIONS,
    { key: "math", label: "수학 자료", isSystem: false, parentKey: "class" },
    { key: "middle", label: "중등", isSystem: false, parentKey: "math" },
    { key: "leaf", label: "1학년", isSystem: false, parentKey: "middle" },
    { key: "peer", label: "2학년", isSystem: false, parentKey: "middle" },
  ] };
});
vi.mock("@/features/documents/server/category-actions", () => ({
  createDocumentCategory: vi.fn(), reparentDocumentCategory: vi.fn(),
  renameDocumentCategory: vi.fn(), moveDocumentCategory: vi.fn(), deleteDocumentCategory: vi.fn(),
}));
vi.mock("./_components/document-toolbar", () => ({ DocumentToolbar: () => <div className="flex gap-2"><button>업로드</button><button>새 문서</button><button>링크 추가</button></div> }));
vi.mock("./_components/document-row", () => ({ DocumentRow: () => null }));
vi.mock("./_components/linked-row", () => ({ LinkedDocumentRow: () => null }));
import DocumentsPage from "./page";

afterEach(() => { cleanup(); mocks.access.mockResolvedValue(true); });

function preview(name: string) {
  if (!process.env.FOLDER_PREVIEW_DIR) return;
  mkdirSync(process.env.FOLDER_PREVIEW_DIR, { recursive: true });
  // HTML 내보내기에는 DOM property 상태가 포함되지 않아 선택값을 명시한다.
  for (const select of document.querySelectorAll("select")) for (const option of select.options) {
    if (option.selected) option.setAttribute("selected", ""); else option.removeAttribute("selected");
  }
  const body = document.body.innerHTML;
  writeFileSync(join(process.env.FOLDER_PREVIEW_DIR, `${name}.html`), `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./folders.css"></head><body style="font-family:Arial,'Malgun Gothic',sans-serif">${body}</body></html>`);
}

it("현재 경로와 바로 아래 폴더를 표시하고 폴더 이동 링크의 검색·정렬·임베드를 보존한다", async () => {
  render(await DocumentsPage({ searchParams: Promise.resolve({ cat: "middle", q: "시험", sort: "name", dir: "asc" }) }));
  const path = screen.getByRole("navigation", { name: "현재 폴더 경로" });
  expect(within(path).getAllByRole("link").map((a) => a.textContent)).toEqual(["전체 문서", "수업", "수학 자료", "중등"]);
  const target = screen.getAllByRole("link").find((a) => a.textContent?.startsWith("1학년"))!;
  const href = new URL(target.getAttribute("href")!, "https://example.test");
  expect(Object.fromEntries(href.searchParams)).toEqual({ cat: "leaf", q: "시험", sort: "name", dir: "asc", embed: "1" });
  expect(mocks.documents).toHaveBeenLastCalledWith({ category: "middle", q: "시험", sort: { key: "name", dir: "asc" } }, 1, 50);
});

it("폴더 관리·하위 생성 화면을 열 수 있고 읽기 전용 사용자에게 변경 버튼을 노출하지 않는다", async () => {
  const user = userEvent.setup();
  const view = render(await DocumentsPage({ searchParams: Promise.resolve({ cat: "middle" }) }));
  preview("folder-tree");
  await user.click(screen.getByRole("button", { name: "폴더 관리" }));
  await user.click(screen.getByRole("button", { name: "수업 / 수학 자료 / 중등 이동" }));
  preview("folder-move");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "하위 폴더 만들기" }));
  expect(screen.getByLabelText("상위 폴더")).toHaveValue("middle");
  preview("folder-create");
  view.unmount();
  mocks.access.mockResolvedValue(false);
  render(await DocumentsPage({ searchParams: Promise.resolve({ cat: "middle" }) }));
  expect(screen.queryByRole("button", { name: "폴더 관리" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "하위 폴더 만들기" })).not.toBeInTheDocument();
});
