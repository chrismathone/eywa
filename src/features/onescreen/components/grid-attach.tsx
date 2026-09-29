"use client";

/**
 * 표 모드 첨부(행 단위) — 카드 모드에만 있던 사진/파일 첨부를 표에서도 할 수 있게.
 * 표는 한 행이 한 줄이라 첨부 UI를 펼쳐 둘 자리가 없다 → **클립 버튼(개수 배지) + 팝오버**로 접어 둔다.
 * 업로드·삭제 로직은 부모(onescreen-client)의 (학생×과목) 핸들러를 그대로 쓴다(로직 단일 소스).
 *
 * 진입 3경로: ① 클립 버튼 → 팝오버에서 고르기 ② **행에 파일 끌어다 놓기**(가장 빠름) ③ 일괄(툴바).
 */
import { useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { EyIcon } from "@/components/icons/aywa-icons";
import { isImageAttachment } from "../attachment-utils";
import { useSheetT, useSheetTf } from "@/features/teacher-view/lang-context";
import { useClassnoteOn } from "./classnote-on-context";

export type GridAttachment = { path: string; name: string };

/** 첨부 상한 — report-card·서버(attachment-actions)와 같은 값. */
export const MAX_ROW_ATTACHMENTS = 6;
/** 사진 + 문서/오디오(ClassNote 첨부 슬롯과 정렬). 서버 allowCT가 최종 검증. */
export const ATTACH_ACCEPT =
  "image/jpeg,image/png,image/webp,application/pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.cell,.show,audio/mpeg,audio/mp4,.mp3,.m4a";

export function GridAttachButton({
  attachments,
  urls,
  uploading,
  hiddenFromParents,
  disabled,
  disabledReason,
  label,
  onAdd,
  onRemove,
  onOpen,
}: {
  attachments: GridAttachment[];
  urls: Record<string, string>; // path→signed 썸네일 URL(팝오버를 열 때 부모가 채운다)
  uploading: boolean;
  /** 학원설정 '사진/파일 첨부' OFF — 저장은 되지만 학부모에게 안 실린다(카드와 같은 고지). */
  hiddenFromParents?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  label: string; // 스크린리더용 "홍길동 수학"
  onAdd: (files: File[]) => void;
  onRemove: (path: string) => void;
  onOpen: () => void; // 열 때 썸네일 서명 요청(행마다 미리 서명하지 않는다)
}) {
  const t = useSheetT();
  const classnoteOn = useClassnoteOn();
  const tf = useSheetTf();
  const [open, setOpen] = useState(false);
  const count = attachments.length;
  const full = count >= MAX_ROW_ATTACHMENTS;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) onOpen();
      }}
    >
      <Popover.Trigger
        disabled={disabled}
        title={
          disabled
            ? disabledReason
            : count
              ? tf("os.attach.title", { n: count })
              : t("os.attach.empty")
        }
        aria-label={
          count ? tf("os.attach.ariaN", { label, n: count }) : tf("os.attach.aria", { label })
        }
        className={`border-line hover:bg-bg-soft data-[popup-open]:bg-bg-soft inline-flex shrink-0 items-center gap-0.5 rounded-sm border px-1.5 py-1 text-xs font-bold disabled:pointer-events-none disabled:opacity-50 ${
          count ? "text-primary" : "text-text-dim"
        }`}
      >
        {uploading ? (
          "…"
        ) : (
          <>
            <EyIcon name="paperclip" size={11} />
            {count ? <span className="num">{count}</span> : null}
          </>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Popover.Popup className="bg-card border-line shadow-card flex w-[260px] flex-col gap-2 rounded-lg border p-3 text-xs outline-none">
            <div className="flex items-center justify-between gap-2">
              <p className="text-text-faint text-xs font-bold">
                {t("os.attach.empty")}{" "}
                <span className="text-text-dim num">
                  {count}/{MAX_ROW_ATTACHMENTS}
                </span>
              </p>
              <AttachPicker disabled={uploading || full} onFiles={onAdd} compact />
            </div>
            {hiddenFromParents ? (
              <p className="border-amber/40 bg-amber-soft text-amber rounded border px-2 py-1.5 text-xs leading-snug">
                {t("os.attach.offA")}
                <b>{t("os.attach.offB")}</b>
                {t(classnoteOn ? "os.attach.offC" : "os.attach.offCLink")}
              </p>
            ) : null}
            {count ? (
              <div className="grid grid-cols-3 gap-1.5">
                {attachments.map((a) => (
                  <div key={a.path} className="group relative">
                    {urls[a.path] && isImageAttachment(a.name || a.path) ? (
                      // eslint-disable-next-line @next/next/no-img-element -- 세션 내 signed URL 썸네일(최적화 불필요)
                      <img src={urls[a.path]} alt={a.name} className="bg-bg-soft h-14 w-full rounded object-contain" />
                    ) : (
                      <div className="bg-bg-soft text-text-dim flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded px-1 text-center">
                        <EyIcon name="file" size={14} className="text-text-faint" />
                        <span className="w-full truncate text-xs">{a.name}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemove(a.path)}
                      className="bg-danger absolute top-0.5 right-0.5 inline-flex size-4 items-center justify-center rounded text-white opacity-0 transition group-hover:opacity-100"
                      aria-label={tf("os.attach.deleteAria", { name: a.name })}
                    >
                      <EyIcon name="close" size={11} strokeWidth={1.8} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-text-faint text-xs leading-snug">
                {t("os.attach.dropA")}
                <b>{t("os.attach.dropB")}</b>
                {t(classnoteOn ? "os.attach.dropC" : "os.attach.dropCLink")}
              </p>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** 파일 선택 라벨(input[type=file] 래핑) — 팝오버·일괄 바가 공유. */
export function AttachPicker({
  disabled,
  onFiles,
  compact,
  children,
}: {
  disabled?: boolean;
  onFiles: (files: File[]) => void;
  compact?: boolean;
  children?: React.ReactNode;
}) {
  const t = useSheetT();
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <label
      className={`border-line hover:bg-bg-soft cursor-pointer rounded-lg border font-bold ${
        compact ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      {children ?? t("os.attach.pickFile")}
      <input
        ref={inputRef}
        type="file"
        accept={ATTACH_ACCEPT}
        multiple
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ""; // 같은 파일 재선택 허용
          if (files.length) onFiles(files);
        }}
      />
    </label>
  );
}

/**
 * 행 드래그&드롭 — 파일을 행 위에 놓으면 그 행(학생×과목)에 바로 첨부한다.
 * ⚠️ 텍스트 드래그(문구 편집 중 선택 드래그)까지 반응하면 안 되므로 **파일 종류일 때만** 활성화한다.
 */
export function useRowFileDrop(onFiles: (files: File[]) => void, disabled?: boolean) {
  const [over, setOver] = useState(false);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  return {
    over,
    handlers: {
      onDragOver: (e: React.DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault(); // 브라우저 기본 동작(파일 열기) 차단 — 이게 없으면 drop이 안 온다
        e.dataTransfer.dropEffect = "copy";
        if (!over) setOver(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        // 자식으로 이동하는 dragleave는 무시(깜빡임 방지) — 행 밖으로 나갈 때만 해제.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        if (over) setOver(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        setOver(false);
        const files = Array.from(e.dataTransfer.files ?? []);
        if (files.length) onFiles(files);
      },
    },
  };
}
