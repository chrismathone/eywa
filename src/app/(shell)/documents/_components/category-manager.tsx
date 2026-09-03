"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, ChevronUp, Loader2, Pencil, Plus, Settings2, Trash2, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  createDocumentCategory,
  deleteDocumentCategory,
  moveDocumentCategory,
  renameDocumentCategory,
} from "@/features/documents/server/category-actions";
import type { DocumentCategoryOption } from "@/features/documents/categories";
import { DialogShell, ErrorNote, inputCls } from "./dialog-parts";

// 서식 분류 관리(0161a) — 학원장/관리자가 폴더를 추가·이름변경·순서변경·삭제한다.
// 내부 키는 화면에 노출하지 않는다(앱이 자동 확정·불변) — 학원장이 다루는 건 "이름과 순서"뿐.

export function CategoryManager({
  categories,
  counts,
}: {
  categories: DocumentCategoryOption[];
  /** 분류별 문서 수 — 삭제 시 "몇 건이 어디로 옮겨지는지"를 미리 보여주기 위함. */
  counts: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-text-faint hover:text-primary hover:bg-bg-soft mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-xs transition-colors"
      >
        <Settings2 className="size-3.5 shrink-0" strokeWidth={1.8} />
        <span>분류 관리</span>
      </button>
      {open ? (
        <CategoryDialog categories={categories} counts={counts} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function CategoryDialog({
  categories,
  counts,
  onClose,
}: {
  categories: DocumentCategoryOption[];
  counts: Record<string, number>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // 이름 변경 중인 분류 키
  const [deleting, setDeleting] = useState<string | null>(null); // 삭제 확인 중인 분류 키

  /** 서버 액션 1회 실행 + 결과 처리 — 성공하면 서버 데이터를 다시 읽어 폴더 팬까지 갱신. */
  function run(fn: () => Promise<{ ok?: boolean; error?: string }>, done?: () => void) {
    if (pending) return;
    setErr(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setErr(res.error);
        return;
      }
      done?.();
      router.refresh();
    });
  }

  function onAdd() {
    const label = newLabel.trim();
    if (!label) {
      setErr("분류 이름을 입력하세요");
      return;
    }
    const fd = new FormData();
    fd.set("label", label);
    run(() => createDocumentCategory(undefined, fd).then((r) => r ?? {}), () => setNewLabel(""));
  }

  function onRename(key: string, label: string) {
    const fd = new FormData();
    fd.set("key", key);
    fd.set("label", label);
    run(() => renameDocumentCategory(undefined, fd).then((r) => r ?? {}), () => setEditing(null));
  }

  function onDelete(key: string, into: string) {
    run(
      () =>
        deleteDocumentCategory(key, into).then((r) => {
          if (r.ok) {
            toast.success(r.moved ? `분류를 삭제하고 문서 ${r.moved}건을 옮겼습니다` : "분류를 삭제했습니다");
          }
          return r;
        }),
      () => setDeleting(null),
    );
  }

  return (
    <DialogShell title="문서 분류 관리" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-text-dim text-xs leading-relaxed">
          왼쪽 폴더 목록에 표시되는 분류입니다. 학원에서 쓰는 분류(예: 기출시험)를 자유롭게 추가하세요.
          <br />
          기본 분류는 이름·순서만 바꿀 수 있습니다 — 이력서·환불요청서가 자동으로 들어가는 자리라 지울 수 없습니다.
        </p>

        <ul className="border-line divide-line divide-y rounded-md border">
          {categories.map((c, i) => (
            <li key={c.key} className="px-2.5 py-2">
              {editing === c.key ? (
                <RenameRow
                  defaultLabel={c.label}
                  pending={pending}
                  onCancel={() => setEditing(null)}
                  onSubmit={(label) => onRename(c.key, label)}
                />
              ) : deleting === c.key ? (
                <DeleteRow
                  category={c}
                  count={counts[c.key] ?? 0}
                  targets={categories.filter((o) => o.key !== c.key)}
                  pending={pending}
                  onCancel={() => setDeleting(null)}
                  onSubmit={(into) => onDelete(c.key, into)}
                />
              ) : (
                <div className="flex items-center gap-1.5">
                  <span className="text-foreground min-w-0 flex-1 truncate text-sm">{c.label}</span>
                  {c.isSystem ? <span className="text-text-faint shrink-0 text-xs">기본</span> : null}
                  <span className="text-text-faint num shrink-0 text-xs">{counts[c.key] ?? 0}</span>
                  <IconBtn
                    label={`${c.label} 위로`}
                    disabled={pending || i === 0}
                    onClick={() => run(() => moveDocumentCategory(c.key, "up"))}
                  >
                    <ChevronUp className="size-3.5" />
                  </IconBtn>
                  <IconBtn
                    label={`${c.label} 아래로`}
                    disabled={pending || i === categories.length - 1}
                    onClick={() => run(() => moveDocumentCategory(c.key, "down"))}
                  >
                    <ChevronDown className="size-3.5" />
                  </IconBtn>
                  <IconBtn label={`${c.label} 이름 변경`} disabled={pending} onClick={() => setEditing(c.key)}>
                    <Pencil className="size-3.5" />
                  </IconBtn>
                  {c.isSystem ? (
                    <span className="w-6" aria-hidden /> // 기본 분류는 삭제 불가 — 자리만 맞춘다
                  ) : (
                    <IconBtn
                      label={`${c.label} 삭제`}
                      disabled={pending}
                      danger
                      onClick={() => setDeleting(c.key)}
                    >
                      <Trash2 className="size-3.5" />
                    </IconBtn>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="space-y-1.5">
          <span className="text-foreground block text-sm font-medium">분류 추가</span>
          <div className="flex items-center gap-2">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAdd();
                }
              }}
              maxLength={20}
              placeholder="예: 기출시험"
              aria-label="새 분류 이름"
              className={`${inputCls} h-9`}
            />
            <Button type="button" onClick={onAdd} disabled={pending || !newLabel.trim()}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} 추가
            </Button>
          </div>
        </div>

        <ErrorNote msg={err} />

        <div className="border-line flex items-center justify-end border-t pt-4">
          <Button type="button" variant="outline" onClick={onClose}>
            닫기
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`shrink-0 rounded p-1 disabled:opacity-30 ${
        danger ? "text-text-faint hover:text-danger" : "text-text-faint hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function RenameRow({
  defaultLabel,
  pending,
  onCancel,
  onSubmit,
}: {
  defaultLabel: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (label: string) => void;
}) {
  const [label, setLabel] = useState(defaultLabel);
  return (
    <div className="flex items-center gap-1.5">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(label.trim());
          }
          if (e.key === "Escape") onCancel();
        }}
        maxLength={20}
        autoFocus
        aria-label="분류 이름"
        className={`${inputCls} h-8 min-w-0 flex-1 py-1`}
      />
      <IconBtn label="확인" disabled={pending || !label.trim()} onClick={() => onSubmit(label.trim())}>
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
      </IconBtn>
      <IconBtn label="취소" disabled={pending} onClick={onCancel}>
        <X className="size-3.5" />
      </IconBtn>
    </div>
  );
}

/** 삭제 확인 — "그냥 삭제"는 없다. 이 분류의 문서를 어디로 옮길지 반드시 고른다(고아 방지). */
function DeleteRow({
  category,
  count,
  targets,
  pending,
  onCancel,
  onSubmit,
}: {
  category: DocumentCategoryOption;
  count: number;
  targets: DocumentCategoryOption[];
  pending: boolean;
  onCancel: () => void;
  onSubmit: (into: string) => void;
}) {
  const [into, setInto] = useState(targets.find((t) => t.key === "other")?.key ?? targets[0]?.key ?? "");
  return (
    <div className="space-y-2 py-1">
      <p className="text-foreground text-xs">
        <span className="font-bold">{category.label}</span> 삭제
        {count > 0 ? <span className="text-text-dim"> — 문서 {count}건을 옮길 분류를 고르세요</span> : null}
      </p>
      {count > 0 ? (
        <SearchableSelect
          value={into}
          onValueChange={setInto}
          options={targets.map((t) => ({ value: t.key, label: t.label }))}
          placeholder="옮길 분류 선택..."
          ariaLabel="문서를 옮길 분류"
          triggerClassName="border-line bg-background text-foreground w-full rounded-md border px-2 py-1 text-xs"
        />
      ) : null}
      <div className="flex items-center justify-end gap-2 text-xs">
        <button
          type="button"
          onClick={() => onSubmit(into)}
          disabled={pending || (count > 0 && !into)}
          className="text-danger font-bold hover:underline disabled:opacity-40"
        >
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : count > 0 ? "옮기고 삭제" : "삭제"}
        </button>
        <button type="button" onClick={onCancel} disabled={pending} className="text-text-dim hover:underline">
          취소
        </button>
      </div>
    </div>
  );
}
