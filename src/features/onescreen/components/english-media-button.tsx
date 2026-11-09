"use client";

/**
 * 영어 보고서 글 속 **사진·PDF 넣기**(2026-09-11, 사용자 *"이미지 pdf 같은 것도 넣어서 바로 보낼 때 같이 쓸 수 있게 해 줘 —
 * 사진 잘라서 쓰고 싶을 수도 있자나"* → 방식 선택 "글 속 원하는 자리에").
 *
 * 여기는 **파일을 고르고 다듬는 데까지**다 — 사진은 자르기 창(image-crop-dialog.tsx)을 거치고 PDF는 곧바로 넘긴다.
 * 올리기·자리 줄 넣기(커서가 있던 줄)는 부모(onescreen-client `insertEnglishMediaFor`)가 한다.
 * ⚠️ 카드의 멘트 열 fieldset 안에 있으므로 결석·발송 완료·열람 전용이면 버튼이 함께 잠긴다(따로 잠그지 않는다).
 */
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useSheetT } from "@/features/teacher-view/lang-context";
import { toast } from "sonner";
import { INLINE_MEDIA_ACCEPT } from "../attachment-utils";
import { REPORT_VIDEO_ACCEPT, REPORT_VIDEO_MAX_BYTES } from "../report-video";
import { ImageCropDialog } from "./image-crop-dialog";

export function EnglishMediaButton({
  disabled,
  busy,
  onFile,
}: {
  /** 넣을 수 없음(첨부가 가득 참) — 이유는 옆 안내가 적는다. */
  disabled: boolean;
  /** 올리는 중 — 두 번 눌러 같은 파일이 두 번 들어가지 않게. */
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const t = useSheetT();
  const inputRef = useRef<HTMLInputElement>(null);
  // 자를 사진 — 파일마다 새 창(key)이라 네모·미리 보기가 앞 사진을 끌고 오지 않는다.
  const [pending, setPending] = useState<{ file: File; key: number } | null>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
      >
        {busy ? t("os.card.uploading") : t("os.media.add")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={INLINE_MEDIA_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = ""; // 같은 파일 다시 고르기 허용
          if (!picked) return;
          if (picked.type.startsWith("image/")) setPending({ file: picked, key: Date.now() });
          else onFile(picked);
        }}
      />
      {pending ? (
        <ImageCropDialog
          key={pending.key}
          file={pending.file}
          onCancel={() => setPending(null)}
          onDone={(file) => {
            setPending(null);
            onFile(file);
          }}
        />
      ) : null}
    </>
  );
}

/**
 * **영상 넣기**(원장 2026-11-06 — EiE 일일·월간 보고서에 영상 첨부 → ClassNote 글의 영상 칸).
 * 글 속 자리 줄은 넣지 않는다 — 영상은 보고서 그림 안에 그려지지 않고 ClassNote 글에 영상으로 따로 붙는다.
 * 크기(100MB)만 여기서 먼저 알리고 형식·개수·연동 PC 지원 여부는 서버(attachment-actions)가 본다.
 */
export function EnglishVideoButton({
  disabled,
  busy,
  onFile,
}: {
  /** 넣을 수 없음(이미 영상이 있음·첨부가 가득 참) — 이유는 옆 안내가 적는다. */
  disabled: boolean;
  busy: boolean;
  onFile: (file: File) => void;
}) {
  const t = useSheetT();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
        {busy ? t("os.card.uploading") : t("os.video.add")}
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept={REPORT_VIDEO_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0];
          e.target.value = "";
          if (!picked) return;
          if (picked.size > REPORT_VIDEO_MAX_BYTES) {
            toast.error(t("os.video.tooBig"));
            return;
          }
          onFile(picked);
        }}
      />
    </>
  );
}
