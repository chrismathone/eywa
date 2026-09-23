"use client";

import { createContext, useContext, useEffect, useRef, useState, useTransition, type CSSProperties, type DragEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { categoryDescendants, type DocumentCategoryOption } from "@/features/documents/categories";
import { renameDocumentCategory, reparentDocumentCategory } from "@/features/documents/server/category-actions";
import { moveDocumentFile } from "@/features/documents/server/file-actions";
import { InlineRename } from "./inline-rename";

const FOLDER_DRAG_TYPE = "application/x-aywa-document-folder";
const FILE_DRAG_TYPE = "application/x-aywa-document-file";
type FileSource = { kind: "file"; id: string; category: string };
type DragSource = { kind: "folder"; key: string } | FileSource;
type Interactions = {
  canManage: boolean; pending: boolean; source: DragSource | null;
  start: (source: DragSource) => boolean; end: () => void;
  canDrop: (target: string | null) => boolean; drop: (target: string | null) => void;
};
const FolderContext = createContext<Interactions | null>(null);

export function FolderInteractionProvider({ categories, canManage, children }: {
  categories: DocumentCategoryOption[]; canManage: boolean; children: ReactNode;
}) {
  const router = useRouter();
  const [source, setSource] = useState<DragSource | null>(null);
  const sourceRef = useRef<DragSource | null>(null);
  const busy = useRef(false);
  const [pending, startTransition] = useTransition();
  function end() { sourceRef.current = null; setSource(null); }
  function canDrop(target: string | null) {
    const drag = sourceRef.current;
    if (!canManage || busy.current || pending || !drag) return false;
    if (drag.kind === "file") return target !== null && target !== drag.category && categories.some((c) => c.key === target);
    const key = drag.key;
    const folder = categories.find((c) => c.key === key);
    return !!folder && (folder.parentKey ?? null) !== target &&
      (target === null || (categories.some((c) => c.key === target) && !categoryDescendants(categories, key).has(target)));
  }
  function drop(target: string | null) {
    if (!canDrop(target)) { end(); return; }
    const drag = sourceRef.current!;
    end(); busy.current = true;
    startTransition(async () => {
      try {
        const result = drag.kind === "file"
          ? await moveDocumentFile(drag.id, target!, drag.category)
          : await reparentDocumentCategory(drag.key, target);
        if (!result.ok) { toast.error(result.error ?? "폴더를 이동하지 못했습니다."); return; }
        toast.success(drag.kind === "file" ? "파일을 이동했습니다" : target ? "하위 폴더로 이동했습니다" : "최상위로 이동했습니다");
        router.refresh();
      } catch { toast.error("이동 결과를 확인하지 못했습니다. 새로고침 후 확인해 주세요."); }
      finally { busy.current = false; }
    });
  }
  return <FolderContext.Provider value={{ canManage, pending, source, canDrop, drop, end,
    start: (drag) => { if (!canManage || busy.current || pending) return false; sourceRef.current = drag; setSource(drag); return true; } }}>
    {children}
  </FolderContext.Provider>;
}

/** OS 파일 업로드와 구분하며, 현재 화면에서 시작한 폴더·파일만 옮긴다. */
export function FolderDropTarget({ folderKey, children, className = "", style, onHoverExpand }: {
  folderKey: string | null; children: ReactNode; className?: string; style?: CSSProperties; onHoverExpand?: () => void;
}) {
  const actions = useContext(FolderContext);
  const [over, setOver] = useState(false);
  const valid = !!actions?.source && actions.canDrop(folderKey);
  const dragType = actions?.source?.kind === "file" ? FILE_DRAG_TYPE : FOLDER_DRAG_TYPE;
  const highlighted = over && valid;
  useEffect(() => {
    if (!highlighted || !onHoverExpand) return;
    const timer = setTimeout(onHoverExpand, 650);
    return () => clearTimeout(timer);
  }, [highlighted, onHoverExpand]);
  return <div data-folder-key={folderKey ?? "__root"} data-drop-active={highlighted || undefined} style={style}
    className={`${className} ${highlighted ? "bg-primary/10 ring-2 ring-inset ring-primary" : ""} ${actions?.source?.kind === "folder" && actions.source.key === folderKey ? "opacity-50" : ""}`}
    draggable={folderKey !== null && !!actions?.canManage && !actions.pending}
    onDragStart={(e) => {
      if (!folderKey || (e.target as Element).closest("form,input,button") || !actions?.start({ kind: "folder", key: folderKey })) { e.preventDefault(); return; }
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData(FOLDER_DRAG_TYPE, folderKey);
    }}
    onDragEnd={() => { setOver(false); actions?.end(); }}
    onDragOver={(e) => {
      if (!actions?.source || !e.dataTransfer.types.includes(dragType)) return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = valid ? "move" : "none";
      setOver(valid);
    }}
    onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
    onDrop={(e) => {
      if (!actions?.source || !e.dataTransfer.types.includes(dragType)) return;
      e.preventDefault(); e.stopPropagation(); setOver(false); actions.drop(folderKey);
    }}>
    {children}
  </div>;
}

export function useDocumentFileDrag(file: Omit<FileSource, "kind">, enabled: boolean) {
  const actions = useContext(FolderContext);
  const draggable = enabled && !!actions?.canManage && !actions.pending;
  return {
    draggable,
    pending: !!actions?.pending,
    dragging: actions?.source?.kind === "file" && actions.source.id === file.id,
    onDragStart: (event: DragEvent<HTMLTableRowElement>) => {
      if (!draggable || event.currentTarget.querySelector("form") ||
          (event.target as Element).closest("input,textarea,button,select,[contenteditable=true]") ||
          !actions?.start({ kind: "file", ...file })) { event.preventDefault(); return; }
      // 이름 링크의 기본 URL 드래그를 파일 이동으로 대체한다.
      event.dataTransfer.clearData();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(FILE_DRAG_TYPE, file.id);
    },
    onDragEnd: () => actions?.end(),
  };
}

export function FolderName({ folder, href, active, title }: {
  folder: DocumentCategoryOption; href: string; active?: boolean; title?: string;
}) {
  const actions = useContext(FolderContext);
  return <InlineRename enabled={!!actions?.canManage && !actions.pending} name={folder.label} maxLength={20}
    onSave={(name) => { const data = new FormData(); data.set("key", folder.key); data.set("label", name); return renameDocumentCategory(undefined, data); }}>
    <Link href={href} draggable={false} aria-current={active ? "page" : undefined} title={title ?? folder.label}
      className="block min-w-0 truncate py-1.5 text-sm">{folder.label}</Link>
  </InlineRename>;
}
