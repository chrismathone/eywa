"use client";

import * as React from "react";
import { Paperclip } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 파일 선택 — 네이티브 `<input type="file">`은 브라우저 기본 렌더가 "파일 선택 / 선택된 파일 없음"
 * 밋밋한 텍스트라 버튼으로 안 보인다(누를 수 있는지 헷갈림). 입력은 숨기고 공용 `<Button>`으로 연다
 * (등록상담 `audio-recorder-field` · 회의록 `new-meeting-form`이 쓰던 hidden input + click 패턴의 공용화).
 * 선택된 파일명은 버튼 옆에 표시하므로 소비처가 따로 그리지 않아도 된다.
 */
export function FilePickerButton({
  accept,
  file,
  onSelect,
  label = "파일 선택",
  disabled,
  className,
}: {
  accept?: string;
  /** 선택된 파일(버튼 옆 파일명 표시용). 녹음 등 외부 경로로 채워진 파일도 그대로 표시된다. */
  file: File | null;
  onSelect: (file: File | null) => void;
  /** 파일 미선택 시 버튼 문구. 선택 후에는 "파일 변경"으로 바뀐다. */
  label?: string;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => {
          onSelect(e.target.files?.[0] ?? null);
          e.target.value = ""; // 같은 파일 재선택 허용
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip className="size-4" />
        {file ? "파일 변경" : label}
      </Button>
      <span
        className={cn("min-w-0 truncate text-xs", file ? "text-foreground" : "text-text-faint")}
        title={file?.name}
      >
        {file ? file.name : "선택된 파일 없음"}
      </span>
    </div>
  );
}
