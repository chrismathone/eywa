"use client";

import { useActionState, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { AlertCircle, FilePlus2, Loader2, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  createTextDocument,
  issueDocumentUploadTicket,
  registerUploadedDocument,
} from "@/features/documents/server/actions";
import { CATEGORY_LABEL, DOCUMENT_CATEGORIES, type DocumentCategory } from "@/features/documents/categories";

const inputCls =
  "border-line bg-background text-foreground placeholder:text-text-faint w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/40";
const CATEGORY_OPTIONS = DOCUMENT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }));

export function DocumentToolbar({
  canWrite,
  initialQuery,
  category,
}: {
  canWrite: boolean;
  initialQuery: string;
  category: DocumentCategory | null;
}) {
  const [dialog, setDialog] = useState<"upload" | "text" | null>(null);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 검색 — GET 폼(현재 폴더 유지, page 리셋) */}
      <form action="/documents" className="relative">
        {category ? <input type="hidden" name="cat" value={category} /> : null}
        <Search className="text-text-faint pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <input
          type="search"
          name="q"
          defaultValue={initialQuery}
          placeholder="문서 검색..."
          className={`${inputCls} h-8 w-48 pl-8`}
          aria-label="문서 검색"
        />
      </form>
      {canWrite ? (
        <>
          <Button variant="outline" onClick={() => setDialog("text")}>
            <FilePlus2 className="size-4" /> 새 문서
          </Button>
          <Button onClick={() => setDialog("upload")}>
            <Upload className="size-4" /> 업로드
          </Button>
        </>
      ) : null}
      {dialog === "upload" ? (
        <UploadDialog defaultCategory={category ?? "other"} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "text" ? (
        <TextDocDialog defaultCategory={category ?? "other"} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}

function DialogShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="bg-background border-line max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg border p-6 shadow-lg">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <p className="eyebrow">데이터베이스</p>
            <h2 className="text-foreground mt-1 text-lg font-semibold">{title}</h2>
          </div>
          <button type="button" onClick={onClose} className="text-text-dim hover:text-foreground" aria-label="닫기">
            <X className="size-4" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-foreground block text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function ErrorNote({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <p className="text-danger bg-danger-soft border-danger/20 inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm">
      <AlertCircle className="size-4 shrink-0" /> {msg}
    </p>
  );
}

/** 파일 업로드 — 티켓 발급 → 스토리지 PUT → 검증·등록(3단계, 실패 시 에러 표시·행 미생성). */
function UploadDialog({ defaultCategory, onClose }: { defaultCategory: DocumentCategory; onClose: () => void }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setErr(null);
    // 탐색기 UX — 제목이 비어 있으면 파일명(확장자 제외)으로 자동 채움.
    if (f && titleRef.current && !titleRef.current.value.trim()) {
      titleRef.current.value = f.name.replace(/\.[^.]+$/, "");
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || busy) return;
    setErr(null);
    setBusy(true);
    try {
      const form = new FormData(e.currentTarget);
      const ext = file.name.split(".").pop()?.toLowerCase() || "bin";
      const contentType = file.type || "application/octet-stream";

      const tfd = new FormData();
      tfd.set("ext", ext);
      tfd.set("contentType", contentType);
      tfd.set("size", String(file.size));
      const tk = await issueDocumentUploadTicket(undefined, tfd);
      if (tk?.error || !tk?.ticket) throw new Error(tk?.error ?? "업로드 준비 실패");

      await uploadToTicket(tk.ticket, file, setProgress);

      const rfd = new FormData();
      rfd.set("path", tk.ticket.path);
      rfd.set("title", String(form.get("title") ?? ""));
      rfd.set("category", String(form.get("category") ?? defaultCategory));
      rfd.set("description", String(form.get("description") ?? ""));
      rfd.set("fileName", file.name);
      rfd.set("contentType", contentType);
      rfd.set("size", String(file.size));
      const reg = await registerUploadedDocument(undefined, rfd);
      if (reg?.error || !reg?.ok) throw new Error(reg?.error ?? "등록 실패");

      router.refresh();
      onClose();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "업로드 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogShell title="서식 파일 업로드" onClose={onClose}>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="파일 *">
          <input
            type="file"
            required
            onChange={onPick}
            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.hwp,.hwpx"
            className="text-text-dim file:bg-bg-soft file:text-foreground file:border-line block w-full text-sm file:mr-3 file:cursor-pointer file:rounded-md file:border file:px-3 file:py-1.5 file:text-sm"
          />
          <p className="text-text-faint text-xs">이미지·PDF·Word·Excel·한글(HWP) · 최대 20MB</p>
        </Field>
        <Field label="이름 *">
          <input ref={titleRef} name="title" required className={inputCls} placeholder="예: 입학 등록 신청서 (빈 양식)" />
        </Field>
        <Field label="분류">
          <SearchableSelect name="category" defaultValue={defaultCategory} options={CATEGORY_OPTIONS} placeholder="분류 선택..." />
        </Field>
        <Field label="설명">
          <textarea name="description" rows={2} className={`${inputCls} resize-y`} placeholder="용도 메모 (선택)" />
        </Field>
        <ErrorNote msg={err} />
        <div className="border-line flex items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            취소
          </Button>
          <Button type="submit" disabled={busy || !file}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> {progress > 0 && progress < 100 ? `${progress}%` : "처리 중"}
              </>
            ) : (
              <>
                <Upload className="size-4" /> 업로드
              </>
            )}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function TextSubmitBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />} 저장
    </Button>
  );
}

/** 앱 작성 문서 — 조건부 마운트 다이얼로그(닫히면 언마운트=state 리셋, #67 안전 패턴). */
function TextDocDialog({ defaultCategory, onClose }: { defaultCategory: DocumentCategory; onClose: () => void }) {
  const [state, formAction] = useActionState(createTextDocument, undefined);
  if (state?.ok) queueMicrotask(onClose);

  return (
    <DialogShell title="새 문서 작성" onClose={onClose}>
      <form action={formAction} className="space-y-4">
        <Field label="제목 *">
          <input name="title" required className={inputCls} placeholder="예: 상담 안내 스크립트" />
        </Field>
        <Field label="분류">
          <SearchableSelect name="category" defaultValue={defaultCategory} options={CATEGORY_OPTIONS} placeholder="분류 선택..." />
        </Field>
        <Field label="설명">
          <input name="description" className={inputCls} placeholder="용도 메모 (선택)" />
        </Field>
        <Field label="내용 *">
          <textarea name="body" required rows={8} className={`${inputCls} resize-y`} placeholder="문서 내용을 입력하세요" />
        </Field>
        <ErrorNote msg={state?.error ?? null} />
        <div className="border-line flex items-center justify-end gap-2 border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            취소
          </Button>
          <TextSubmitBtn />
        </div>
      </form>
    </DialogShell>
  );
}
