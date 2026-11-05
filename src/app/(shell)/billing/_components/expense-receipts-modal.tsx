"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Loader2, Trash2, Upload, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { writeLockedNote, writeLockedPlaceholder } from "@/lib/write-lock";
import type { MenuKey } from "@/lib/permissions";
import {
  addExpenseReceipt,
  issueReceiptUploadTicket,
  removeExpenseReceipt,
  setExpenseReceiptType,
  signExpenseReceipt,
  signExpenseReceipts,
} from "@/features/billing/server/expense-actions";
import type { ExpenseReceipt, ExpenseRow } from "@/features/billing/server/expense-queries";

// 사진류(브라우저가 <img>로 그릴 수 있는 형식)면 항상 썸네일 미리보기. PDF 등은 파일 카드.
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "bmp", "avif", "heic", "heif"]);
function isImageReceipt(name: string, path: string): boolean {
  const src = (name || path).split("?")[0]; // 레거시 Firebase URL의 쿼리스트링(?alt=media&token=…) 제거 후 확장자 판별
  const ext = src.includes(".") ? src.split(".").pop()!.toLowerCase() : "";
  return IMAGE_EXT.has(ext);
}

const RECEIPT_TYPES = ["영수증", "세금계산서", "견적서", "계산서", "카드전표", "현금영수증", "기타"];
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,application/pdf";

const inputCls =
  "border-line bg-background text-foreground w-full rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";

export function ExpenseReceiptsModal({
  expense,
  onClose,
  canEdit,
  lockedMenu = "billing",
}: {
  expense: ExpenseRow;
  onClose: () => void;
  /**
   * 증빙을 바꿀 수 있는가 — 부르는 화면이 서버 게이트(`expenseWriteScope`)와 같은 판정으로 계산해 넘긴다.
   * false면 열람만: 유형 선택은 비활성, 업로드·삭제·붙여넣기는 없다(원장 2026-11-05 읽기 권한 규칙 — write-lock.ts).
   */
  canEdit: boolean;
  /** 읽기 안내 문구의 메뉴 이름 — 사무실 지출 면 = billing(기본), 강사 지출결의서 = expense_requests. */
  lockedMenu?: MenuKey;
}) {
  const router = useRouter();
  const [receipts, setReceipts] = useState<ExpenseReceipt[]>(expense.receiptUrls);
  const [type, setType] = useState(expense.receiptType ?? "");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<ExpenseReceipt | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({}); // path → 서명 URL(썸네일/확대용)
  const [lightbox, setLightbox] = useState<string | null>(null); // 확대 중인 이미지 URL
  const [, startTransition] = useTransition();
  const uploadingRef = useRef(false); // 동시 업로드(연속 붙여넣기 등) 재진입 방지

  // 등록된 첨부 전체를 한 번에 서명해 썸네일을 그린다(업로드 후 갱신용). 만료 600s.
  const refreshUrls = useCallback(async () => {
    const fd = new FormData();
    fd.append("id", expense.id);
    const res = await signExpenseReceipts(undefined, fd);
    if (res?.urls) setUrls(res.urls);
  }, [expense.id]);

  // 마운트 시 첨부 일괄 서명(비동기 fetch → setState는 await 이후라 동기 아님).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fd = new FormData();
      fd.append("id", expense.id);
      const res = await signExpenseReceipts(undefined, fd);
      if (!cancelled && res?.urls) setUrls(res.urls);
    })();
    return () => {
      cancelled = true;
    };
  }, [expense.id]);

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
        // 1) 업로드 티켓 발급(서버가 권한·소유·형식·크기 검증, 경로 빌드) → 2) PUT → 3) 등록.
        const ext = file.name.includes(".")
          ? file.name.split(".").pop()!.toLowerCase()
          : file.type.split("/")[1] || "bin";
        const fdT = new FormData();
        fdT.set("expenseId", expense.id);
        fdT.set("ext", ext);
        fdT.set("contentType", file.type || "application/octet-stream");
        fdT.set("size", String(file.size));
        const tk = await issueReceiptUploadTicket(undefined, fdT);
        if (tk?.error || !tk?.ticket) {
          setError(tk?.error ?? "업로드 준비 실패");
          return;
        }
        const path = tk.ticket.path;
        try {
          await uploadToTicket(tk.ticket, file);
        } catch (e) {
          setError(e instanceof Error ? e.message : "업로드 실패");
          return;
        }
        const fd = new FormData();
        fd.append("id", expense.id);
        fd.append("path", path);
        fd.append("name", file.name);
        const res = await addExpenseReceipt(undefined, fd);
        if (res?.error) {
          // 등록 실패 시 객체 cleanup은 서버(addExpenseReceipt)가 처리 — GCS는 클라 삭제 권한 없음.
          setError(res.error);
          return;
        }
        setReceipts((prev) =>
          prev.some((r) => r.path === path) ? prev : [...prev, { path, name: file.name }],
        );
        void refreshUrls();
        startTransition(() => router.refresh());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    },
    [expense.id, router, startTransition, refreshUrls],
  );

  // Ctrl+V — 클립보드의 이미지/PDF를 붙여넣어 바로 첨부(영수증 스크린샷 캡처 후 붙여넣기 등). 모달 열린 동안만.
  useEffect(() => {
    // 읽기 권한이면 붙여넣기 업로드도 열지 않는다 — 단추를 숨겨도 Ctrl+V가 남으면 같은 거부가 뜬다.
    if (!canEdit) return;
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
  }, [handleUpload, canEdit]);

  // 라이트박스 Esc 닫기
  useEffect(() => {
    if (!lightbox) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

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
    // 레거시 http(s) 증빙(ijw Firebase 다운로드 URL)은 이미 공개 토큰 URL → 서버 서명 없이 바로 연다.
    if (/^https?:\/\//i.test(r.path)) {
      window.open(r.path, "_blank", "noopener,noreferrer");
      return;
    }
    const fd = new FormData();
    fd.append("path", r.path);
    const res = await signExpenseReceipt(undefined, fd);
    if (res?.url) window.open(res.url, "_blank", "noopener,noreferrer");
    else setError(res?.error ?? "열람 실패");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">증빙자료</p>
            <h2 className="text-foreground mt-1 text-lg font-bold">{expense.title}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-text-dim hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <span className="text-foreground block text-sm font-medium">증빙 유형</span>
            <select
              value={type}
              onChange={(e) => changeType(e.target.value)}
              disabled={!canEdit}
              className={`${inputCls} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {/* select엔 placeholder가 없어 빈 값 줄이 그 자리를 한다 — 읽기 권한이면 권한 안내로. */}
              <option value="">{canEdit ? "선택 안 함" : writeLockedPlaceholder(lockedMenu)}</option>
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
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {receipts.map((r) => {
                  const url = urls[r.path];
                  const isImg = isImageReceipt(r.name, r.path);
                  return (
                    <li
                      key={r.path}
                      className="border-line bg-bg-soft/40 group relative overflow-hidden rounded-md border"
                    >
                      {isImg && url ? (
                        <button
                          type="button"
                          onClick={() => setLightbox(url)}
                          className="block w-full"
                          aria-label={`${r.name} 확대`}
                          title="클릭하여 확대"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase 서명 URL 미리보기 */}
                          <img
                            src={url}
                            alt={r.name}
                            className="bg-card h-24 w-full object-cover transition group-hover:opacity-90"
                          />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleView(r)}
                          className="bg-card text-text-faint hover:text-blue flex h-24 w-full flex-col items-center justify-center gap-1.5"
                          aria-label={`${r.name} 열람`}
                          title="클릭하여 열람"
                        >
                          {isImg ? (
                            <Loader2 className="size-5 animate-spin" />
                          ) : (
                            <FileText className="size-6" />
                          )}
                          <span className="text-xs font-medium uppercase">
                            {isImg ? "불러오는 중" : "파일"}
                          </span>
                        </button>
                      )}
                      <div className="flex items-center gap-1 px-1.5 py-1">
                        <span className="text-text-dim min-w-0 flex-1 truncate text-xs" title={r.name}>
                          {r.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleView(r)}
                          className="text-text-faint hover:text-blue shrink-0 p-0.5"
                          aria-label="새 탭으로 열람"
                          title="새 탭으로 열기"
                        >
                          <ExternalLink className="size-3" />
                        </button>
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => setConfirmRemove(r)}
                            className="text-text-faint hover:text-danger shrink-0 p-0.5"
                            aria-label="삭제"
                          >
                            <Trash2 className="size-3" />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {!canEdit ? (
            // 업로드 칸 대신 안내 한 줄 — 유형 칸에 값이 차 있으면 위 select의 안내가 안 보인다.
            <p className="text-text-faint text-xs">{writeLockedNote(lockedMenu)}</p>
          ) : (
            <label className="border-line text-text-dim hover:text-foreground hover:bg-bg-soft flex cursor-pointer flex-col items-center gap-1.5 rounded-md border border-dashed px-3 py-5 transition">
              {uploading ? <Loader2 className="size-5 animate-spin" /> : <Upload className="size-5" />}
              <span className="text-foreground text-sm font-medium">
                {uploading ? "업로드 중…" : "파일 추가 또는 Ctrl+V 붙여넣기"}
              </span>
              <span className="text-text-faint text-xs">이미지 · PDF · 최대 10MB</span>
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
          )}

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

      {/* 이미지 확대 라이트박스 — 클릭/Esc로 닫기 */}
      {lightbox ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-label="이미지 확대"
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            className="absolute top-4 right-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="닫기"
          >
            <X className="size-5" />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element -- Supabase 서명 URL 확대 미리보기 */}
          <img
            src={lightbox}
            alt="증빙 확대"
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </div>
  );
}
