import { headers } from "next/headers";
import { PrintActions } from "@/app/(print)/enrollment/[id]/print/print-actions";
import { requireAccess } from "@/lib/auth/require-access";
import { kstToday } from "@/lib/date-kst";
import { buildCategoryMaps } from "@/features/inventory/category";
import { numberAssets, parseNoRanges, qrImageSrc } from "@/features/inventory/qr";
import { getInventoryCategories } from "@/features/inventory/server/category-queries";
import { getAssets } from "@/features/inventory/server/queries";
import { RangeForm } from "./range-form";

export const metadata = { title: "자산 QR 라벨 인쇄 — 재고관리 — aywa" };

/**
 * QR 라벨 시트(A4 세로) — 원장 2026-09-02: *"QR 라벨을 쉽게 인쇄해서 기기에 붙일 수 있게 … 간단하게 QR이 정사각형으로
 * 크게, 자산ID와 분류, 모델명 정도. QR 생성일까지."* + *"전체 또는 범위. 범위는 1~8, 10~15 등으로 번호 입력하면 해당 번호만"*.
 * 번호(No)는 표와 같은 고정 번호(마스터 순서 1부터). 폐기 자산은 기본으로 뺀다(`all=1`이면 포함 — 번호는 안 바뀐다).
 * 라벨 한 장 = 약 42×52mm(4열 × 7행 = 28장/쪽) — 일반 라벨지 크기에 맞춰 잘라 붙인다.
 */
export default async function InventoryQrPrintPage({ searchParams }: { searchParams: Promise<{ all?: string; range?: string }> }) {
  await requireAccess("inventory");
  const { all, range } = await searchParams;
  const embedded = (await headers()).get("x-embed") === "1";
  // 서로 독립 — 함께 받는다(B4).
  const [{ rows }, categories] = await Promise.all([getAssets(), getInventoryCategories()]);
  const cats = buildCategoryMaps(categories.rows);
  const numbered = numberAssets(rows);
  const parsed = parseNoRanges(range ?? "", numbered.length);
  const list = numbered.filter((a) => (all === "1" || a.status !== "disposed") && (!parsed.nos || parsed.nos.has(a.no)));
  const today = kstToday();

  return (
    <div className="print-portrait mx-auto max-w-[182mm] px-4 pt-4 print:px-0 print:pt-0">
      <div className="print:hidden">
        <PrintActions embedded={embedded} />
        <RangeForm range={range ?? ""} all={all === "1"} max={numbered.length} error={parsed.error} count={list.length} />
      </div>
      {list.length === 0 ? (
        <p className="py-10 text-center text-[13px] text-black/60">인쇄할 자산이 없습니다.</p>
      ) : (
        <ul className="grid grid-cols-4 gap-x-[3mm] gap-y-[3mm]">
          {list.map((a) => (
            <li
              key={a.id}
              className="flex flex-col items-center gap-[1.5mm] rounded-[2mm] border border-black/25 p-[2.5mm] break-inside-avoid"
              style={{ pageBreakInside: "avoid" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 라우트가 그 자리에서 그리는 SVG */}
              <img src={qrImageSrc(a.assetCode)} alt={`${a.assetCode} QR`} className="aspect-square w-[30mm]" />
              <span className="font-mono text-[12px] leading-none font-bold">{a.assetCode}</span>
              <span className="w-full truncate text-center text-[9.5px] leading-tight text-black/80">
                {cats.labelOf(a.category)} · {a.model ?? "모델 미기재"}
              </span>
              <span className="text-[8px] leading-none text-black/50">
                No.{a.no} · QR {today}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
