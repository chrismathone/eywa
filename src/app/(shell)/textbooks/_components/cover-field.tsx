"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  issueTextbookCoverTicket,
  registerTextbookCover,
  removeTextbookCover,
} from "@/features/textbooks/server/cover-actions";
import { CoverThumb } from "./cover-thumb";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * 표지 사진 — 티켓 발급 → 업로드 → 등록. 지출 영수증·보고서 첨부와 **같은 흐름**이다.
 * 🔴 경로는 **서버가 만든다**(클라 입력 불신) · 등록 때 서버가 객체 존재를 다시 확인한다.
 * ⚠️ 재진입 잠금(`busyRef`) — 빠르게 두 번 고르면 티켓이 둘 나가고 하나가 고아로 남는다.
 */
export function CoverField({
  textbookId,
  initialUrl,
  canWrite,
  onChanged,
}: {
  textbookId: string;
  initialUrl: string | null;
  canWrite: boolean;
  /** 표지가 바뀌면 부모가 목록을 새로 읽는다. */
  onChanged: () => void;
}) {
  const [url, setUrl] = useState<string | null>(initialUrl);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function pick(file: File) {
    if (busyRef.current) return;
    if (file.size > MAX_BYTES) {
      toast.error("사진이 너무 큽니다 (최대 5MB)");
      return;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      const ext = file.name.includes(".") ? file.name.split(".").pop()! : (file.type.split("/")[1] ?? "jpg");
      const tk = await issueTextbookCoverTicket({
        textbookId,
        contentType: file.type || "image/jpeg",
        size: file.size,
        ext,
      });
      if (!tk.ok) {
        toast.error(tk.error);
        return;
      }
      await uploadToTicket(tk.ticket, file);
      const res = await registerTextbookCover({ textbookId, path: tk.ticket.path });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      // 서명 URL은 서버가 목록을 다시 그릴 때 온다 — 여기선 즉시 미리보기를 위해 로컬 blob을 쓴다.
      setUrl(URL.createObjectURL(file));
      toast.success("표지를 등록했습니다");
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "표지를 올리지 못했습니다");
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function clear() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const res = await removeTextbookCover(textbookId);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setUrl(null);
      toast.success("표지를 지웠습니다");
      onChanged();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="flex items-start gap-3">
      <CoverThumb src={url} alt="교재 표지" size="lg" />
      {canWrite ? (
        <div className="flex flex-col gap-1.5">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void pick(f);
            }}
          />
          <Button type="button" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
            {busy ? "올리는 중…" : url ? "사진 교체" : "사진 올리기"}
          </Button>
          {url ? (
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void clear()}>
              사진 지우기
            </Button>
          ) : null}
          <span className="text-text-faint text-xs">JPG·PNG·WEBP · 최대 5MB</span>
        </div>
      ) : null}
    </div>
  );
}
