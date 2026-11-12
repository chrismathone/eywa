"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/aywa-icons";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import { HrefSelect } from "@/components/href-select";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { ToolbarButton } from "@/components/toolbar";
import { deleteVendor } from "@/features/inventory/server/vendor-actions";
import { matchesVendorCategory, matchesVendorQuery, NO_CATEGORY, telHref, vendorCategoryChips } from "@/features/inventory/vendor";
import type { InventoryVendor } from "@/features/inventory/types";
import { phoneLabel } from "@/lib/format/phone";
import { DashCell } from "./cell-bits";
import { useSubmit } from "./form-bits";
import { ListToolbar } from "./list-toolbar";
import { SortableTable, type Column } from "./sortable-table";
import { VendorDialog } from "./vendor-dialog";
import { VENDOR_EXCEL_URL, VendorExcelDialog } from "./vendor-excel-dialog";
import { useSort } from "./use-sort";

const ALL = "__all__";

/**
 * 번호 칸 — 번호를 누르면 전화(폰에선 바로 걸린다), 옆 아이콘은 복사(PC에서 받아 적을 때).
 * 🔑 둘 다 `a`/`button`이라 표의 "행 클릭 = 수정"이 가로채지 않는다(sortable-table이 거른다).
 */
function PhoneCell({ v: raw }: { v: string | null }) {
  const v = phoneLabel(raw);
  if (!v) return <DashCell v={null} />;
  const href = telHref(v);
  const copy = () => {
    void navigator.clipboard?.writeText(v).then(
      () => toast.success(`복사했습니다 — ${v}`),
      () => toast.error("복사하지 못했습니다"),
    );
  };
  return (
    <span className="inline-flex max-w-full items-center gap-1">
      {href ? (
        <a href={href} className="num text-primary truncate font-medium hover:underline" title={`${v} — 전화 걸기`}>{v}</a>
      ) : (
        <span className="num truncate">{v}</span>
      )}
      <button type="button" onClick={copy} className="text-text-faint hover:text-foreground shrink-0 rounded p-0.5" aria-label={`${v} 복사`} title="복사">
        <EyIcon name="copy" size={12} />
      </button>
    </span>
  );
}

/**
 * 행 끝 [수정] [삭제] — 원장 2026-10-26 *"업체를 등록하면 수정도 삭제도 안됌"*: 수정은 행 더블클릭뿐이라 눈에 안 보였다.
 * 더블클릭은 그대로 두고, 보이는 버튼을 함께 단다. 삭제는 한 번 더 묻는다(되돌릴 수 없다).
 */
function RowActions({ vendor, onEdit }: { vendor: InventoryVendor; onEdit: () => void }) {
  const { busy, submit } = useSubmit();
  const [asking, setAsking] = useState(false);
  const run = () => {
    const fd = new FormData();
    fd.set("id", vendor.id);
    // 실패 사유는 useSubmit이 갖고 있지만 칸이 좁아 토스트로 알린다.
    void submit(fd, async (f) => {
      const res = await deleteVendor(f);
      if (res?.error) toast.error(res.error);
      return res;
    }, "업체를 지웠습니다").then(() => setAsking(false));
  };
  return (
    // 버튼 위 더블클릭이 행 더블클릭(수정 창)으로 새지 않게 — 삭제를 두 번 누르면 확인창 위에 수정 창이 겹친다.
    <span className="inline-flex items-center gap-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={onEdit} className="text-primary rounded px-1.5 py-0.5 text-xs font-semibold hover:underline">수정</button>
      <button type="button" onClick={() => setAsking(true)} disabled={busy} className="text-danger rounded px-1.5 py-0.5 text-xs font-semibold hover:underline disabled:opacity-40">삭제</button>
      <ConfirmDialog
        open={asking}
        title={`업체 삭제 — ${vendor.name}`}
        message="이 업체를 목록에서 지웁니다. 되돌릴 수 없습니다."
        confirmLabel="삭제"
        danger
        onConfirm={run}
        onCancel={() => setAsking(false)}
      />
    </span>
  );
}

const TextCell = ({ v }: { v: string | null }) => (v ? <span title={v}>{v}</span> : <DashCell v={null} />);

/**
 * 업체리스트 면 — 서점·출판사·정수기·인테리어 등 거래처 연락처(원장 2026-10-22).
 * 열 = 분류 · 업체명 · 대표전화 · 담당자 · 담당자 연락처 · 주소 · 사업자등록번호 · 비고. 수정은 행 더블클릭.
 * 분류 필터는 **이미 적힌 분류**에서 나온다(코드 목록 없음 — `vendorCategoryChips`).
 */
export function VendorsFace({ vendors, canWrite }: { vendors: InventoryVendor[]; canWrite: boolean }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);
  const [editing, setEditing] = useState<InventoryVendor | "new" | null>(null);
  const [excelOpen, setExcelOpen] = useState(false);
  const { sort, toggle } = useSort();
  const chips = useMemo(() => vendorCategoryChips(vendors), [vendors]);
  // 고른 분류가 사라졌으면(마지막 업체를 지움) 전체로 — 빈 표가 "업체가 없다"로 읽히지 않게.
  const activeCategory = category !== ALL && chips.some((c) => c.key === category) ? category : null;
  const rows = useMemo(
    () => vendors.filter((v) => matchesVendorCategory(v, activeCategory) && matchesVendorQuery(v, query)),
    [vendors, activeCategory, query],
  );
  const categories = useMemo(() => chips.filter((c) => c.key !== NO_CATEGORY).map((c) => c.label), [chips]);

  const columns = useMemo((): Column<InventoryVendor>[] => [
    { key: "category", label: "분류", width: 88, render: (v) => <DashCell v={v.category} />, className: "whitespace-nowrap" },
    { key: "name", label: "업체명", width: 150, render: (v) => <span className="font-semibold" title={v.name}>{v.name}</span>, className: "whitespace-nowrap" },
    { key: "phone", label: "대표전화", width: 150, render: (v) => <PhoneCell v={v.phone} />, className: "whitespace-nowrap" },
    { key: "contactName", label: "담당자", width: 84, render: (v) => <DashCell v={v.contactName} />, className: "whitespace-nowrap" },
    { key: "contactPhone", label: "담당자 연락처", width: 150, render: (v) => <PhoneCell v={v.contactPhone} />, className: "whitespace-nowrap" },
    { key: "address", label: "주소", minWidth: 180, render: (v) => <TextCell v={v.address} />, className: "whitespace-nowrap" },
    { key: "bizNo", label: "사업자등록번호", width: 124, render: (v) => <DashCell v={v.bizNo} num />, className: "whitespace-nowrap" },
    { key: "note", label: "비고", minWidth: 140, render: (v) => <TextCell v={v.note} />, className: "whitespace-nowrap" },
  ], []);

  return (
    <section className="flex flex-col gap-2">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="업체명, 담당자, 번호, 주소 검색"
        filters={
          chips.length > 0 ? (
            <HrefSelect
              axisLabel="분류"
              ariaLabel="업체 분류 필터"
              value={activeCategory ?? ALL}
              options={[{ value: ALL, label: "전체" }, ...chips.map((c) => ({ value: c.key, label: `${c.label} ${c.count}` }))]}
              onSelect={(v) => setCategory(v)}
            />
          ) : null
        }
        summary={`${rows.length}곳`}
        actions={
          <>
            {/* 엑셀 내보내기/가져오기(원장 2026-10-26 *"엑셀 시트로 넣고 뺄수있게"*) — 자산 면과 같은 부품·같은 자리. */}
            <ExcelMenu exportHref={VENDOR_EXCEL_URL} onImport={canWrite ? () => setExcelOpen(true) : null} />
            {canWrite ? <ToolbarButton variant="primary" onClick={() => setEditing("new")}>+ 업체 등록</ToolbarButton> : null}
          </>
        }
      />
      <div className="bg-card shadow-card rounded-2xl p-2">
        <SortableTable
          columns={columns}
          rows={rows}
          rowKey={(v) => v.id}
          sort={sort}
          onSort={toggle}
          emptyText={vendors.length === 0 ? (canWrite ? "등록된 업체가 없습니다 — '+ 업체 등록'으로 추가하세요" : "등록된 업체가 없습니다") : "조건에 맞는 업체가 없습니다"}
          onRowDoubleClick={canWrite ? (v) => setEditing(v) : undefined}
          actions={canWrite ? (v) => <RowActions vendor={v} onEdit={() => setEditing(v)} /> : undefined}
        />
      </div>
      {editing ? (
        <VendorDialog vendor={editing === "new" ? undefined : editing} categories={categories} onClose={() => setEditing(null)} />
      ) : null}
      {excelOpen ? <VendorExcelDialog onClose={() => setExcelOpen(false)} /> : null}
    </section>
  );
}
