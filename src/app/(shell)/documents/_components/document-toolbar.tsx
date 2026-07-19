"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { AlertCircle, FilePlus2, Loader2, Search, Upload, UploadCloud, X } from "@/components/icons/eywa-icon-compat";
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

const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes("Files");

export function DocumentToolbar({
  canWrite,
  initialQuery,
  category,
  catParam,
  embed,
}: {
  canWrite: boolean;
  initialQuery: string;
  category: DocumentCategory | null;
  /** 검색 폼이 유지할 현재 폴더 키 — 연동 폴더(교재 요청서 등)는 category가 아니라 이 값으로만 전달. */
  catParam?: string | null;
  /** 플로팅 창(embed) 안이면 검색 GET에도 embed=1 유지(크롬리스 분기 유지). */
  embed?: boolean;
}) {
  const keepCat = catParam !== undefined ? catParam : category;
  const [dialog, setDialog] = useState<"upload" | "text" | null>(null);
  const [droppedFile, setDroppedFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  // dragenter/leave는 자식 요소마다 발화 → 깊이 카운터로 "창 밖으로 나갔을 때만" 오버레이 해제.
  const depth = useRef(0);
  const dialogOpen = useRef(false);
  useEffect(() => {
    dialogOpen.current = dialog !== null;
  }, [dialog]);

  // 페이지 전역 드래그드랍 — 탐색기처럼 파일을 창 아무 데나 끌어다 놓으면 업로드 다이얼로그가 열린다.
  useEffect(() => {
    if (!canWrite) return;
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || dialogOpen.current) return;
      depth.current += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault(); // 기본 동작(브라우저가 파일 열기) 차단 = 드롭 허용
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      if (dialogOpen.current) return; // 다이얼로그 열림 중엔 다이얼로그 자체 드롭존이 처리
      const files = e.dataTransfer?.files;
      if (!files?.length) return;
      if (files.length > 1) toast.info("한 번에 1개 파일만 업로드됩니다 — 첫 번째 파일을 선택했어요");
      setDroppedFile(files[0]);
      setDialog("upload");
    };
    const onEnd = () => {
      depth.current = 0;
      setDragging(false);
    };
    window.addEventListener("dragenter", onEnter);
    window.addEventListener("dragleave", onLeave);
    window.addEventListener("dragover", onOver);
    window.addEventListener("drop", onDrop);
    window.addEventListener("dragend", onEnd);
    return () => {
      window.removeEventListener("dragenter", onEnter);
      window.removeEventListener("dragleave", onLeave);
      window.removeEventListener("dragover", onOver);
      window.removeEventListener("drop", onDrop);
      window.removeEventListener("dragend", onEnd);
    };
  }, [canWrite]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* 검색 — GET 폼(현재 폴더 유지, page 리셋) */}
      <form action="/documents" className="relative">
        {keepCat ? <input type="hidden" name="cat" value={keepCat} /> : null}
        {embed ? <input type="hidden" name="embed" value="1" /> : null}
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
      {/* 드래그 중 전면 오버레이 — 드롭 유도(z-40 = 다이얼로그 z-50 아래) */}
      {dragging ? (
        <div className="bg-background/80 fixed inset-0 z-40 flex items-center justify-center backdrop-blur-sm">
          <div className="border-primary/60 bg-primary/5 text-primary pointer-events-none flex flex-col items-center gap-2 rounded-lg border-2 border-dashed px-14 py-10">
            <UploadCloud className="size-9" strokeWidth={1.8} />
            <p className="text-base font-bold">여기에 놓아 서식 업로드</p>
            <p className="text-text-dim text-xs">이미지 · PDF · Word · Excel · 한글(HWP)</p>
          </div>
        </div>
      ) : null}
      {dialog === "upload" ? (
        <UploadDialog
          defaultCategory={category ?? "other"}
          initialFile={droppedFile}
          onClose={() => {
            setDialog(null);
            setDroppedFile(null);
          }}
        />
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
            <h2 className="text-foreground mt-1 text-lg font-bold">{title}</h2>
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
function UploadDialog({
  defaultCategory,
  initialFile,
  onClose,
}: {
  defaultCategory: DocumentCategory;
  initialFile?: File | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  function applyFile(f: File | null) {
    setFile(f);
    setErr(null);
    // 탐색기 UX — 제목이 비어 있으면 파일명(확장자 제외)으로 자동 채움.
    if (f && titleRef.current && !titleRef.current.value.trim()) {
      titleRef.current.value = f.name.replace(/\.[^.]+$/, "");
    }
  }

  // 전역 드롭으로 열렸을 때 — 마운트 후 제목 자동 채움(titleRef는 마운트 뒤에야 존재).
  useEffect(() => {
    if (initialFile && titleRef.current && !titleRef.current.value.trim()) {
      titleRef.current.value = initialFile.name.replace(/\.[^.]+$/, "");
    }
  }, [initialFile]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    applyFile(e.target.files?.[0] ?? null);
  }

  function onDropFile(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation(); // 전역(window) drop 핸들러로 전파 차단 — 다이얼로그 드롭존이 소유
    setDropHover(false);
    const f = e.dataTransfer.files?.[0];
    if (f) applyFile(f);
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
          {/* 드롭존 — 클릭=파일 선택, 드래그드랍=바로 세팅. input은 sr-only(제출 판정은 file state). */}
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDropHover(true);
            }}
            onDragLeave={() => setDropHover(false)}
            onDrop={onDropFile}
            className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-md border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dropHover
                ? "border-primary/70 bg-primary/5"
                : file
                  ? "border-primary/40 bg-primary/5"
                  : "border-line bg-bg-soft/40 hover:border-primary/40"
            }`}
          >
            <input
              type="file"
              onChange={onPick}
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.hwp,.hwpx"
              className="sr-only"
            />
            <UploadCloud className={`size-6 ${file ? "text-primary" : "text-text-faint"}`} strokeWidth={1.8} />
            {file ? (
              <>
                <span className="text-foreground max-w-full truncate text-sm font-medium">{file.name}</span>
                <span className="text-text-faint text-xs">
                  {(file.size / 1024 / 1024).toFixed(1)}MB · 다른 파일을 끌어다 놓으면 교체
                </span>
              </>
            ) : (
              <>
                <span className="text-foreground text-sm font-medium">파일을 끌어다 놓거나 클릭하여 선택</span>
                <span className="text-text-faint text-xs">이미지·PDF·Word·Excel·한글(HWP) · 최대 20MB</span>
              </>
            )}
          </label>
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
