import { FaceTabs, type Face } from "@/components/face-tabs";
import { TextbooksPanel } from "./textbooks-panel";
import { CatalogPanel } from "./catalog-panel";

type Sp = Record<string, string | undefined>;

// 교재 면 — 내부탭 2개: 목록(교재신청 textbook_orders) / 교재 단가표(catalog).
// 교재 단가표는 수강료 계산기 면과 같은 CatalogPanel을 재사용(두 곳에서 동일 탭). base로 위치 보존.
const SUB_FACES: Face[] = [
  { key: "list", label: "목록", href: "/billing?tab=textbooks" },
  { key: "catalog", label: "교재 단가표", href: "/billing?tab=textbooks&tsub=catalog" },
];

export async function TextbooksFace({ sp }: { sp: Sp }) {
  const sub = sp.tsub === "catalog" ? "catalog" : "list";
  return (
    <div className="space-y-4">
      <FaceTabs faces={SUB_FACES} active={sub} ariaLabel="교재 면 전환" />
      {sub === "catalog" ? (
        <CatalogPanel sp={sp} base={{ tab: "textbooks", tsub: "catalog" }} />
      ) : (
        <TextbooksPanel sp={sp} />
      )}
    </div>
  );
}
