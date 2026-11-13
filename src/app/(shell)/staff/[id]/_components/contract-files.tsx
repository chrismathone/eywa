"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Paperclip, Trash2, Upload } from "@/components/icons/aywa-icon-compat";
import { saveFileAs } from "@/lib/http/download-file";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { issueContractPdfTicket } from "@/features/staff/contract/server/contract-extract-actions";
import {
  deleteStaffContractFile,
  registerStaffContractFile,
  signStaffContractFileUrl,
} from "@/features/staff/contract/server/contract-file-actions";
import type { ContractFileRow } from "@/features/staff/contract/server/contract-queries";

function fmtSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 계약서 파일 보관(원장 지시 2026-08-03) — 상세 계약현황 카드의 파일 섹션.
 * 올리기(PDF)·다운로드·삭제. **올리기는 보관만 한다**(원장 지시 2026-08-05: "두 버튼이 동일하면
 * 의미가 없다 — 올리기=보관만, 불러오기=추출·폼채움". 08-03의 '어느 버튼이든 동일 동작'을 뒤집음).
 * 추출·계약 기입은 기입 폼의 '계약서 PDF 불러오기'가 전담 — 혼동 방지는 버튼 title 문구가 맡는다.
 */
export function ContractFiles({
  userId,
  files,
  canWrite,
  aiOn,
}: {
  userId: string;
  files: ContractFileRow[];
  canWrite: boolean;
  aiOn: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  async function handleUpload(file: File) {
    if (file.type !== "application/pdf") {
      toast.error("PDF만 올릴 수 있습니다 — 한글 파일은 PDF로 저장해 주세요");
      return;
    }
    setBusy(true);
    try {
      const tf = new FormData();
      tf.set("contentType", file.type);
      tf.set("size", String(file.size));
      const ticket = await issueContractPdfTicket(undefined, tf);
      if (!ticket?.ticket) {
        toast.error(ticket?.error ?? "업로드 준비에 실패했습니다");
        return;
      }
      await uploadToTicket(ticket.ticket, file);

      const rf = new FormData();
      rf.set("userId", userId);
      rf.set("path", ticket.ticket.path);
      rf.set("fileName", file.name);
      rf.set("fileSize", String(file.size));
      const res = await registerStaffContractFile(undefined, rf);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(res?.notice ?? (aiOn ? "계약서를 보관했습니다 — 계약에 반영하려면 '계약서 PDF 불러오기'를 쓰세요" : "계약서를 보관했습니다"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "업로드에 실패했습니다");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDownload(id: string) {
    setRowBusy(id);
    try {
      const res = await signStaffContractFileUrl(id);
      if (!res.url) {
        toast.error(res.error ?? "다운로드 URL 생성 실패");
        return;
      }
      // 파일명은 서명 URL 헤더가 아니라 우리가 정한다 — 한글·괄호 이름이 `%EA%B9%80…`로 저장되던 버그(documents 규약).
      await saveFileAs(res.url, res.fileName ?? "계약서.pdf");
    } finally {
      setRowBusy(null);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`'${name}' 계약서를 삭제할까요? 원본 파일도 함께 지워집니다.`)) return;
    setRowBusy(id);
    try {
      const df = new FormData();
      df.set("docId", id);
      df.set("userId", userId);
      const res = await deleteStaffContractFile(undefined, df);
      if (res?.error) toast.error(res.error);
      else toast.success(res?.notice ?? "삭제했습니다");
    } finally {
      setRowBusy(null);
    }
  }

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="micro">계약서/사직서 파일</p>
        {canWrite ? (
          <>
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
            />
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="border-line text-text-dim hover:border-primary/40 hover:text-primary inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs transition disabled:opacity-50"
              title={aiOn ? "계약서 PDF를 파일로만 보관합니다 — 계약 기간·조건에 반영하려면 계약 기입의 '계약서 PDF 불러오기'를 쓰세요" : "계약서 PDF를 파일로 보관합니다"}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              {busy ? "올리는 중…" : "계약서 올리기"}
            </button>
          </>
        ) : null}
      </div>

      {files.length === 0 ? (
        <p className="text-text-faint text-xs">보관된 계약서가 없습니다 — PDF를 올리면 여기에 쌓입니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li
              key={f.id}
              className="border-line flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
            >
              <button
                type="button"
                onClick={() => void handleDownload(f.id)}
                disabled={rowBusy === f.id}
                className="text-foreground hover:text-primary flex min-w-0 items-center gap-1.5 text-left text-xs font-medium transition disabled:opacity-50"
                title="내려받기"
              >
                <Paperclip className="text-text-faint size-3.5 shrink-0" />
                <span className="truncate">{f.fileName}</span>
              </button>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-text-faint num text-xs">
                  {f.createdAt.slice(0, 10)}
                  {fmtSize(f.fileSize) ? ` · ${fmtSize(f.fileSize)}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => void handleDownload(f.id)}
                  disabled={rowBusy === f.id}
                  aria-label={`${f.fileName} 내려받기`}
                  className="text-text-faint hover:text-primary transition disabled:opacity-50"
                >
                  {rowBusy === f.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Download className="size-3.5" />
                  )}
                </button>
                {canWrite ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete(f.id, f.fileName)}
                    disabled={rowBusy === f.id}
                    aria-label={`${f.fileName} 삭제`}
                    className="text-text-faint hover:text-danger transition disabled:opacity-50"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
