"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, ChevronDown, ChevronUp, Folder, Pencil, Plus, Settings2, Trash2 } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  createDocumentCategory, deleteDocumentCategory, moveDocumentCategory,
  renameDocumentCategory, reparentDocumentCategory, type CategoryActionState,
} from "@/features/documents/server/category-actions";
import { categoryDescendants, categorySelectOptions, flattenCategories, type DocumentCategoryOption } from "@/features/documents/categories";
import { ErrorNote, inputCls } from "./dialog-parts";

type FolderProps = { categories: DocumentCategoryOption[] };

function useFolderMutation() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  function run(fn: () => Promise<CategoryActionState>, done?: () => void) {
    if (busy.current) return;
    busy.current = true;
    setError(null);
    startTransition(async () => {
      try {
        const result = await fn();
        if (!result?.ok) { setError(result?.error ?? "저장 결과를 확인하지 못했습니다. 다시 시도해 주세요."); return; }
        router.refresh();
        done?.();
      } catch {
        setError("저장 중 연결이 끊겼습니다. 목록을 새로고침해 결과를 확인해 주세요.");
      } finally { busy.current = false; }
    });
  }
  return { pending, error, run };
}

function ParentSelect({ categories, value, onChange, disabled, exclude, label = "상위 폴더" }: FolderProps & {
  value: string; onChange: (key: string) => void; disabled?: boolean; exclude?: Set<string>; label?: string;
}) {
  return (
    <label className="block space-y-1 text-xs text-text-dim">
      <span>{label}</span>
      <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        <option value="">최상위</option>
        {categorySelectOptions(categories).filter((o) => !exclude?.has(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function CreateFolderForm({ categories, initialParent, pending, onSubmit }: FolderProps & {
  initialParent: string | null; pending: boolean; onSubmit: (data: FormData, done: () => void) => void;
}) {
  const [label, setLabel] = useState("");
  const [parent, setParent] = useState(initialParent ?? "");
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault();
      const data = new FormData(); data.set("label", label); data.set("parentKey", parent);
      onSubmit(data, () => setLabel(""));
    }}>
      <ParentSelect categories={categories} value={parent} onChange={setParent} disabled={pending} />
      <label className="block space-y-1 text-xs text-text-dim">
        <span>새 폴더 이름</span>
        <input className={inputCls} autoFocus maxLength={20} required value={label} disabled={pending}
          onChange={(e) => setLabel(e.target.value)} placeholder="예: 중등 시험지" />
      </label>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || !label.trim()}><Plus className="size-4" />{pending ? "저장 중…" : "폴더 만들기"}</Button>
      </div>
    </form>
  );
}

export function NewFolderButton({ categories, parentKey }: FolderProps & { parentKey: string | null }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
      <Plus className="size-3.5" />{parentKey ? "하위 폴더 만들기" : "새 폴더"}
    </Button>
    {open ? <NewFolderDialog categories={categories} parentKey={parentKey} onClose={() => setOpen(false)} /> : null}
  </>;
}

function NewFolderDialog({ categories, parentKey, onClose }: FolderProps & { parentKey: string | null; onClose: () => void }) {
  const { pending, error, run } = useFolderMutation();
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent showCloseButton={!pending}>
      <DialogHeader><DialogTitle>새 폴더</DialogTitle><DialogDescription>상위 폴더를 선택해 원하는 위치에 만드세요.</DialogDescription></DialogHeader>
      <CreateFolderForm categories={categories} initialParent={parentKey} pending={pending}
        onSubmit={(data) => run(() => createDocumentCategory(undefined, data), () => { toast.success("폴더를 만들었습니다"); onClose(); })} />
      <ErrorNote msg={error} />
    </DialogContent>
  </Dialog>;
}

export function CategoryManager({ categories, counts }: FolderProps & { counts: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setOpen(true)}
      className="text-text-faint hover:text-primary hover:bg-bg-soft flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs">
      <Settings2 className="size-3.5" /><span>폴더 관리</span>
    </button>
    {open ? <CategoryDialog categories={categories} counts={counts} onClose={() => setOpen(false)} /> : null}
  </>;
}

function CategoryDialog({ categories, counts, onClose }: FolderProps & { counts: Record<string, number>; onClose: () => void }) {
  const { pending, error, run } = useFolderMutation();
  const [editing, setEditing] = useState<{ key: string; mode: "rename" | "move" | "delete" } | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = flattenCategories(categories);
  return <Dialog open onOpenChange={(open) => { if (!open && !pending) onClose(); }}>
    <DialogContent className="sm:max-w-2xl" showCloseButton={!pending}>
      <DialogHeader>
        <DialogTitle>폴더 관리</DialogTitle>
        <DialogDescription>폴더 안에 하위 폴더를 만들고, 하위 폴더와 문서를 함께 이동할 수 있습니다. 기본 폴더는 삭제할 수 없습니다.</DialogDescription>
      </DialogHeader>
      <ul className="max-h-[50vh] overflow-y-auto rounded-md border border-line divide-y divide-line">
        {rows.map(({ category: c, path }) => {
          const siblings = categories.filter((o) => (o.parentKey ?? null) === (c.parentKey ?? null));
          const position = siblings.findIndex((o) => o.key === c.key);
          const hasChildren = categories.some((o) => o.parentKey === c.key);
          const pathLabel = path.map((p) => p.label).join(" / ");
          return <li key={c.key} className="space-y-2 px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              <span className="flex min-w-0 items-center gap-2 text-sm" title={pathLabel}>
                <Folder className="size-4 shrink-0 text-amber" />
                <span className="break-words">{pathLabel}</span>
              </span>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                {c.isSystem ? <span className="mr-1 text-xs text-text-faint">기본</span> : null}
                <span className="num mr-1 text-xs text-text-faint" title="이 폴더에 직접 저장된 문서">{counts[c.key] ?? 0}건</span>
                <IconBtn label={`${pathLabel} 위로`} disabled={pending || position === 0} onClick={() => run(() => moveDocumentCategory(c.key, "up"))}><ChevronUp className="size-3.5" /></IconBtn>
                <IconBtn label={`${pathLabel} 아래로`} disabled={pending || position === siblings.length - 1} onClick={() => run(() => moveDocumentCategory(c.key, "down"))}><ChevronDown className="size-3.5" /></IconBtn>
                <IconBtn label={`${pathLabel} 이름 변경`} disabled={pending} onClick={() => setEditing({ key: c.key, mode: "rename" })}><Pencil className="size-3.5" /></IconBtn>
                <IconBtn label={`${pathLabel} 이동`} disabled={pending} onClick={() => setEditing({ key: c.key, mode: "move" })}><ArrowRight className="size-3.5" /></IconBtn>
                <IconBtn label={c.isSystem ? "기본 폴더는 삭제할 수 없습니다" : hasChildren ? `${pathLabel}: 하위 폴더를 먼저 옮겨 주세요` : `${pathLabel} 삭제`}
                  disabled={pending || c.isSystem || hasChildren} onClick={() => setEditing({ key: c.key, mode: "delete" })}><Trash2 className="size-3.5" /></IconBtn>
              </div>
            </div>
            {editing?.key === c.key ? <EditFolder key={`${c.key}-${editing.mode}`} category={c} mode={editing.mode} categories={categories}
              count={counts[c.key] ?? 0} pending={pending} onCancel={() => setEditing(null)}
              onSave={(fn) => run(fn, () => { setEditing(null); toast.success("폴더를 변경했습니다"); })} /> : null}
          </li>;
        })}
      </ul>
      {creating ? <CreateFolderForm categories={categories} initialParent={null} pending={pending}
        onSubmit={(data, done) => run(() => createDocumentCategory(undefined, data), () => { done(); setCreating(false); toast.success("폴더를 만들었습니다"); })} />
        : <Button type="button" variant="outline" disabled={pending} onClick={() => setCreating(true)}><Plus className="size-4" />새 폴더</Button>}
      <ErrorNote msg={error} />
      <div className="flex justify-end"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>닫기</Button></div>
    </DialogContent>
  </Dialog>;
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick}
    className="rounded p-1.5 text-text-faint hover:bg-bg-soft hover:text-primary disabled:opacity-30">{children}</button>;
}

function EditFolder({ category, categories, mode, count, pending, onCancel, onSave }: FolderProps & {
  category: DocumentCategoryOption; mode: "rename" | "move" | "delete"; count: number; pending: boolean;
  onCancel: () => void; onSave: (fn: () => Promise<CategoryActionState>) => void;
}) {
  const [label, setLabel] = useState(category.label);
  const [parent, setParent] = useState(category.parentKey ?? "");
  const [into, setInto] = useState("other");
  const excluded = categoryDescendants(categories, category.key);
  return <form className="space-y-2 rounded-md bg-bg-soft p-3" onSubmit={(e) => {
    e.preventDefault();
    if (pending) return;
    if (mode === "move") onSave(() => reparentDocumentCategory(category.key, parent || null));
    else if (mode === "delete") onSave(() => deleteDocumentCategory(category.key, into));
    else {
      const data = new FormData(); data.set("key", category.key); data.set("label", label);
      onSave(() => renameDocumentCategory(undefined, data));
    }
  }}>
    {mode === "rename" ? <label className="block space-y-1 text-xs text-text-dim"><span>폴더 이름</span>
      <input className={inputCls} value={label} maxLength={20} autoFocus required disabled={pending} onChange={(e) => setLabel(e.target.value)} />
    </label> : mode === "move" ? <>
      <ParentSelect categories={categories} value={parent} onChange={setParent} disabled={pending} exclude={excluded} label="이동할 상위 폴더" />
      <p className="text-xs text-text-dim">하위 폴더와 문서도 함께 이동합니다.</p>
    </> : <>
      <p className="text-xs text-text-dim">이 폴더를 삭제하고, 안의 문서 {count}건을 아래 폴더로 옮깁니다. 다른 화면에서 추가된 문서도 함께 옮겨집니다.</p>
      <label className="block space-y-1 text-xs text-text-dim"><span>문서를 옮길 폴더</span>
        <select value={into} className={inputCls} disabled={pending} onChange={(e) => setInto(e.target.value)}>
          {categorySelectOptions(categories).filter((o) => !excluded.has(o.value)).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    </>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={onCancel}>취소</Button>
      <Button type="submit" size="sm" disabled={pending || (mode === "rename" && !label.trim()) || (mode === "move" && parent === (category.parentKey ?? ""))}>
        {pending ? "저장 중…" : mode === "delete" ? "옮기고 삭제" : mode === "move" ? "폴더 이동" : "저장"}
      </Button>
    </div>
  </form>;
}
