"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Upload } from "@/components/icons/eywa-icon-compat";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  extractContractFromPdf,
  issueContractPdfTicket,
} from "@/features/staff/server/contract-extract-actions";
import type { ContractExtract } from "@/features/staff/contract-extract";

/**
 * 계약서 PDF에서 기간·조건 읽어오기(원장 지시 2026-07-31).
 * 읽은 값은 **폼에 채우기만** 하고 저장은 사람이 한다 — 계약 기간·금액은 틀리면 곧장 돈 문제라,
 * 이력서 자동입력과 같이 "AI가 채우고 사람이 확인"으로 둔다.
 * ⚠️ HWP는 지원하지 않는다(한글 전용 포맷 파서가 서버리스에서 불안정) — 한글에서 PDF로 저장해 올린다.
 */
export function ContractPdfPicker({ onExtract }: { onExtract: (data: ContractExtract) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function handle(file: File) {
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

      const ef = new FormData();
      ef.set("path", ticket.ticket.path);
      const res = await extractContractFromPdf(undefined, ef);
      if (!res?.ok || !res.data) {
        toast.error(res?.error ?? "계약서를 읽지 못했습니다");
        return;
      }
      onExtract(res.data);
      if (res.notice) toast.success(res.notice);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "계약서 읽기에 실패했습니다");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = ""; // 같은 파일을 다시 골라도 change가 뜨게
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handle(f);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="border-line text-text-dim hover:border-primary/40 hover:text-primary inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-[11px] transition disabled:opacity-50"
        title="계약서 PDF에서 기간·조건을 읽어 아래 칸을 채웁니다 (저장은 확인 후)"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        {busy ? "읽는 중…" : "계약서 PDF 불러오기"}
      </button>
    </>
  );
}
