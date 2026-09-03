"use client";

/**
 * 학부모 공지 **공통 이미지 첨부** 입력 — 강사 원스크린 공지와 관리자 반 공지가 **같은 컴포넌트**를 쓴다.
 *
 * 업로드는 서버와 같은 2단계(티켓 발급 → PUT → 재검증)라 목록에 들어온 항목은 **이미 서버가 검증한 것**이고,
 * 발송 액션이 그 `{path,name,size}`를 큐 행에 싣는다.
 *
 * ⚠️ '삭제'는 **발송 목록에서만** 뺀다(스토리지 객체는 남는다) — 같은 버킷에 수업보고서 첨부가 함께 살아
 *    path만으로 임의 객체를 지우는 표면을 열지 않기 때문. 상세는 notice-image-upload.ts 헤더.
 */

import { toast } from "sonner";
import { issueNoticeAttachmentTicket, registerNoticeAttachment } from "../server/notice-attachment-actions";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { resizeImageForUpload } from "../resize-image";
import { NOTICE_ATTACHMENT_MAX, type NoticeAttachment } from "../notice-attachments";

export function NoticeAttachmentPicker({
  attachments,
  onChange,
  uploading,
  onUploadingChange,
  disabled,
  label = "이미지 첨부 (선택 학생 모두에게)",
}: {
  attachments: NoticeAttachment[];
  onChange: (next: NoticeAttachment[]) => void;
  uploading: boolean;
  onUploadingChange: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const full = attachments.length >= NOTICE_ATTACHMENT_MAX;

  /**
   * 순차 업로드 — 티켓 발급이 실패하면 그 자리에서 멈춰 원인을 보여준다(조용히 건너뛰지 않음).
   *
   * 🔴 **`FileList`가 아니라 `File[]`을 받는다.** `e.target.files`는 입력 요소에 매인 **라이브
   *    FileList**라, 호출부가 `value=""`로 입력을 비우는 순간 그 참조도 **함께 비어 버린다**.
   *    그래서 예전엔 여기 첫 줄에서 빈 배열을 받아 **아무 말도 없이 끝났다**(토스트도 네트워크 요청도 0건 —
   *    2026-09-01 실브라우저 재현). 배열 복사는 **호출부가 value를 비우기 전에** 해야 한다.
   */
  async function addFiles(picked: File[]) {
    if (!picked.length) return;
    const room = NOTICE_ATTACHMENT_MAX - attachments.length;
    if (room <= 0) {
      toast.error(`이미지는 한 글에 최대 ${NOTICE_ATTACHMENT_MAX}장까지 첨부할 수 있습니다`);
      return;
    }
    if (picked.length > room) toast.message(`${room}장만 첨부합니다 — 한 글에 최대 ${NOTICE_ATTACHMENT_MAX}장`);
    onUploadingChange(true);
    const added: NoticeAttachment[] = [];
    try {
      for (const original of picked.slice(0, room)) {
        if (!original.type.startsWith("image/")) {
          toast.error(`${original.name} — 이미지(JPG·PNG·WebP)만 첨부할 수 있습니다`);
          continue;
        }
        const file = await resizeImageForUpload(original);
        const issued = await issueNoticeAttachmentTicket({ contentType: file.type, size: file.size });
        if (issued.error || !issued.ticket) {
          toast.error(issued.error ?? "업로드 준비에 실패했습니다");
          break;
        }
        try {
          await uploadToTicket(issued.ticket, file);
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "업로드에 실패했습니다");
          break;
        }
        const reg = await registerNoticeAttachment({
          path: issued.ticket.path,
          name: original.name,
          size: file.size,
        });
        if (reg.error || !reg.attachment) {
          toast.error(reg.error ?? "첨부 등록에 실패했습니다");
          break;
        }
        added.push(reg.attachment);
      }
    } finally {
      onUploadingChange(false);
    }
    if (added.length) {
      onChange([...attachments, ...added]);
      toast.success(`이미지 ${added.length}장 첨부`);
    }
  }

  return (
    <div className="border-line rounded-md border px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-text-dim text-xs font-medium">
          {label}
          {attachments.length ? ` · ${attachments.length}장` : ""}
        </p>
        <label
          className={`border-line text-text-dim rounded-md border px-2 py-1 text-xs ${
            uploading || full || disabled ? "text-text-faint cursor-not-allowed" : "hover:bg-bg-soft cursor-pointer"
          }`}
        >
          {uploading ? "업로드 중…" : "이미지 추가"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            disabled={uploading || full || disabled}
            onChange={(e) => {
              // 🔴 **복사 먼저, 비우기 나중** — 순서를 바꾸면 첨부가 통째로 죽는다(위 addFiles 주석).
              //    수업보고서 첨부(report-attachments.tsx)가 원래 이 순서였고, 공지 쪽만 반대였다.
              const files = Array.from(e.target.files ?? []);
              e.target.value = ""; // 같은 파일 다시 고를 수 있게 초기화
              if (files.length) void addFiles(files);
            }}
          />
        </label>
      </div>
      {attachments.length ? (
        <ul className="mt-1.5 space-y-1">
          {attachments.map((a) => (
            <li key={a.path} className="flex items-center gap-2 text-xs">
              <span className="text-foreground min-w-0 flex-1 truncate" title={a.name}>
                {a.name}
              </span>
              <button
                type="button"
                onClick={() => onChange(attachments.filter((x) => x.path !== a.path))}
                className="text-text-faint hover:text-danger shrink-0"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-text-faint mt-1 text-xs">사진(JPG·PNG·WebP) · 한 글에 최대 {NOTICE_ATTACHMENT_MAX}장</p>
      )}
    </div>
  );
}
