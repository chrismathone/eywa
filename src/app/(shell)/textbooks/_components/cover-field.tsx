"use client";

import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CoverThumb } from "./cover-thumb";

export const COVER_MAX_BYTES = 5 * 1024 * 1024;

/**
 * 표지 사진 고르기 — **표시만 한다**(올리기는 저장할 때 부모가 한 번에 한다).
 *
 * 🔴 원장 2026-09-16: *"등록하고 그러면 차수랑 이미지 넣는 부분까지하면 2단계를 쓸대없이 거쳐야함 —
 *    바로 표지사진 넣을수있고"*. 그전엔 `textbook_id`가 있어야 업로드 경로를 만들 수 있다는 **구현 사정**이
 *    화면에 새어 나와 "저장한 뒤에 올릴 수 있습니다"라고 적혀 있었다. 이제 파일을 들고만 있다가
 *    저장 직후에 올린다 — 사람은 한 번만 누른다.
 * ⚠️ 미리보기는 `URL.createObjectURL`이라 **언마운트 때 해제**한다(안 하면 다이얼로그를 여닫을수록 샌다).
 */
export function CoverField({
  initialUrl,
  file,
  cleared,
  canWrite,
  onPick,
  onClear,
}: {
  /** 이미 저장된 표지(서명 URL). 새 교재면 null. */
  initialUrl: string | null;
  /** 아직 안 올린, 방금 고른 파일. */
  file: File | null;
  /** '사진 지우기'를 눌렀나 — 저장할 때 반영된다. */
  cleared: boolean;
  canWrite: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // ⚠️ React 19는 **effect 안의 setState를 금지**한다([[#25]]) — 미리보기 주소는 파생값(useMemo)으로 만들고,
  //    effect는 해제만 한다(안 하면 다이얼로그를 여닫을수록 blob이 샌다).
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const shown = preview ?? (cleared ? null : initialUrl);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <CoverThumb src={shown} alt="교재 표지" size="lg" />
      {canWrite ? (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (!f) return;
              if (f.size > COVER_MAX_BYTES) {
                toast.error("사진이 너무 큽니다 (최대 5MB)");
                return;
              }
              onPick(f);
            }}
          />
          <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            {shown ? "사진 교체" : "사진 올리기"}
          </Button>
          {shown ? (
            <Button type="button" size="sm" variant="ghost" onClick={onClear}>
              사진 지우기
            </Button>
          ) : null}
          <span className="text-text-faint text-xs">JPG·PNG·WEBP · 5MB</span>
        </>
      ) : null}
    </div>
  );
}
