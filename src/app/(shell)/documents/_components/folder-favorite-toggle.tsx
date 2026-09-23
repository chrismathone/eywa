"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/aywa-icons";
import { setDocumentFolderFavorite } from "@/features/documents/server/favorite-actions";

export function FolderFavoriteToggle({ folderKey, pathLabel, favorite, atLimit }: {
  folderKey: string; pathLabel: string; favorite: boolean; atLimit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const disabled = pending || (!favorite && atLimit);
  return <button type="button" aria-label={`${pathLabel} 즐겨찾기 ${favorite ? "해제" : "추가"}`}
    aria-pressed={favorite} disabled={disabled}
    title={!favorite && atLimit ? "즐겨찾기는 최대 10개까지 가능합니다" : favorite ? "즐겨찾기 해제" : "즐겨찾기 추가"}
    className={`flex size-6 shrink-0 items-center justify-center rounded transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40 ${favorite ? "text-amber" : "text-text-faint"}`}
    onClick={() => startTransition(async () => {
      const result = await setDocumentFolderFavorite(folderKey, !favorite);
      if (!result.ok) { toast.error(result.error ?? "즐겨찾기를 저장하지 못했습니다."); return; }
      router.refresh();
    })}>
    <EyIcon name="star" className="size-3.5" fill={favorite ? "currentColor" : "none"} />
  </button>;
}
