"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Paperclip, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { createClient } from "@/lib/supabase/client";
import {
  addExpenseReceipt,
  removeExpenseReceipt,
  setExpenseReceiptType,
  signExpenseReceipt,
} from "@/features/billing/server/expense-actions";
import type { ExpenseReceipt, ExpenseRow } from "@/features/billing/server/expense-queries";

const RECEIPT_TYPES = ["영수증", "세금계산서", "견적서", "계산서", "카드전표", "현금영수증", "기타"];
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

const inputCls =
  "border-line bg-background text-foreground w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

export function ExpenseReceiptsModal({
  expense,
  onClose,
}: {
  expense: ExpenseRow;
  onClose: () => void;
}) {
  const router = useRouter();
  const [receipts, setReceipts] = useState<ExpenseReceipt[]>(expense.receiptUrls);
  const [type, setType] = useState(expense.receiptType ?? "");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ExpenseReceipt | null>(null);
  const [, startTransition] = useTransition();
  const uploadingRef = useRef(false); // 동시 업로드(연속 붙여넣기 등) 재진입 방지

  function changeType(next: string) {
    setType(next);
    const fd = new FormData();
    fd.append("id", expense.id);
    fd.append("receiptType", next);
    startTransition(async () => {
      await setExpenseReceiptType(undefined, fd);
      router.refresh();
    });
  }

  const handleUpload = useCallback(
    async (file: File) => {
      if (uploadingRef.current) return;
      setError(null);
      if (file.size > MAX_BYTES) {
        setError("파일이 너무 큽니다 (최대 10MB)");
        return;
      }
      uploadingRef.current = true;
      setUploading(true);
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const tenantId = (user?.app_metadata as { tenant_id?: string } | undefined)?.tenant_id;
        if (!tenantId) {
          setError("로그인이 만료되었습니다");
          return;
        }
        const ext = file.name.includes(".")
          ? file.name.split(".").pop()!.toLowerCase()
          : file.type.split("/")[1] || "bin";
        const path = `${tenantId}/${expense.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("expense-receipts")
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (upErr) {
          setError(`업로드 실패: ${upErr.message}`);
          return;
        }
        const fd = new FormData();
        fd.append("id", expense.id);
        fd.append("path", path);
        fd.append("name", file.name);
        const res = await addExpenseReceipt(undefined, fd);
        if (res?.error) {
          // 등록 실패 → 방금 올린 객체 정리(고아 파일 방지). 본인 테넌트 경로라 RLS delete 허용.
          await supabase.storage.from("expense-receipts").remove([path]).catch(() => {});
          setError(res.error);
          return;
        }
        setReceipts((prev) =>
          prev.some((r) => r.path === path) ? prev : [...prev, { path, name: file.name }],
        );
        startTransition(() => router.refresh());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    },
    [expense.id, router, startTransition],
  );

  // Ctrl+V — 클립보드의 이미지/PDF를 붙여넣어 바로 첨부(영수증 스크린샷 캡처 후 붙여넣기 등). 모달 열린 동안만.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind !== "file") continue;
        const f = it.getAsFile();
        if (f && (f.type.startsWith("image/") || f.type === "application/pdf")) {
          e.preventDefault();
          const ext = f.type.split("/")[1] || "png";
          // 클립보드 이미지는 이름이 비거나 "image.png"라 보기 좋은 이름 부여(저장 경로는 별도 uuid).
          const named =
            !f.name || f.name === "image.png" ? new File([f], `붙여넣기.${ext}`, { type: f.type }) : f;
          void handleUpload(named);
          return;
        }
      }
    }
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [handleUpload]);

  function doRemove(r: ExpenseReceipt) {
    setReceipts((prev) => prev.filter((x) => x.path !== r.path));
    const fd = new FormData();
    fd.append("id", expense.id);
    fd.append("path", r.path);
    startTransition(async () => {
      await removeExpenseReceipt(undefined, fd);
      router.refresh();
    });
  }

  async function handleView(r: ExpenseReceipt) {
    setError(null);
    const fd = new FormData();
    fd.append("path", r.path);
    const res = await signExpenseReceipt(undefined, fd);
    if (res?.url) window.open(res.url, "_blank", "noopener,noreferrer");
    else setError(res?.error ?? "열람 실패");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">증빙자료</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">{expense.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-text-dim hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">증빙 유형</span>
            <select value={type} onChange={(e) => changeType(e.target.value)} className={inputCls}>
              <option value="">선택 안 함</option>
              {RECEIPT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">
              첨부 파일 {receipts.length > 0 ? `(${receipts.length})` : ""}
            </span>
            {receipts.length === 0 ? (
              <p className="text-text-faint border-line rounded-md border border-dashed px-3 py-4 text-center text-xs">
                첨부된 증빙이 없습니다.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {receipts.map((r) => (
                  <li key={r.path} className="border-line bg-bg-soft/40 flex items-center gap-2 rounded-md border px-3 py-2">
                    <Paperclip className="text-text-faint size-3.5 shrink-0" />
                    <span className="text-foreground min-w-0 flex-1 truncate text-xs">{r.name}</span>
                    <button type="button" onClick={() => handleView(r)} className="text-text-faint hover:text-blue p-1" aria-label="열람">
                      <ExternalLink className="size-3.5" />
                    </button>
                    <button type="button" onClick={() => setConfirmRemove(r)} className="text-text-faint hover:text-danger p-1" aria-label="삭제">
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <label className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 transition">
            {uploading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
            <span className="text-foreground text-sm font-medium">
              {uploading ? "업로드 중…" : "파일 추가 또는 Ctrl+V 붙여넣기"}
            </span>
            <span className="text-text-faint text-[11px]">이미지 · PDF · 최대 10MB</span>
            <input
              type="file"
              accept={ACCEPT}
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
                e.target.value = "";
              }}
              className="hidden"
            />
          </label>

          {error ? (
            <p className="text-danger bg-danger-soft border-danger/20 rounded-md border px-3 py-2 text-sm">{error}</p>
          ) : null}

          <div className="border-line flex justify-end border-t pt-4">
            <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmRemove}
        title="첨부 삭제"
        message={confirmRemove ? `'${confirmRemove.name}' 첨부를 삭제합니다.` : ""}
        confirmLabel="삭제"
        danger
        onConfirm={() => {
          const r = confirmRemove;
          setConfirmRemove(null);
          if (r) doRemove(r);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}
