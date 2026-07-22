"use client";

// 학부모 발송 다이얼로그의 **이미지 영역** — ① 요청서 양식 자동 첨부 진행 상태(+캡처용 숨김 카드)
// ② 교재 표지 수동 첨부(여러 장). 원장이 손으로 올리던 글 = 멘트 + 요청서 그림 + (선택) 표지 그림.

import { useState } from "react";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/eywa-icons";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import type { AccountSetting } from "@/features/owner/settings-types";
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";
import {
  issueTextbookAttachmentTicket,
  registerTextbookAttachment,
} from "@/features/billing/server/textbook-attachment-actions";
import { TextbookRequestCardBody } from "@/app/(print)/textbook/[id]/print/textbook-request-card-body";
import type { FormCapture } from "./_use-form-capture";

const ACCEPT = "image/jpeg,image/png,image/webp"; // 서버 allowCT와 동일(버킷 allowed_mime_types의 부분집합)
const COVER_MAX = 4;

/** ① 요청서 양식 자동 첨부 — 진행 상태 + 화면 밖 캡처 카드(html2canvas 대상). */
export function FormCaptureStatus({
  capture,
  academyName,
  logoUrl,
  account,
}: {
  capture: FormCapture;
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
}) {
  const { head, total, done, error } = capture;
  return (
    <div className="space-y-1">
      <span className="text-text-dim block text-[12px] font-medium">교재 요청서 이미지</span>
      {error ? (
        <p className="border-danger/30 bg-danger-soft text-danger rounded-2xl border px-3 py-2 text-[12px]">
          요청서 이미지를 준비하지 못했습니다 — {error}. 창을 닫고 다시 시도해 주세요.
        </p>
      ) : total === 0 ? (
        <p className="text-text-faint border-line rounded-2xl border border-dashed px-3 py-2 text-[12px]">
          첨부할 요청서가 없습니다.
        </p>
      ) : (
        <p className="border-line bg-bg-soft/60 text-text-dim rounded-2xl border px-3 py-2 text-[12px]">
          {done < total ? (
            <>
              요청서 <span className="num">{done}</span>/<span className="num">{total}</span>장 준비 중…
            </>
          ) : (
            <>
              요청서 <span className="num">{total}</span>장이 학생별로 함께 발송됩니다 (본인 요청서만 각자에게).
            </>
          )}
        </p>
      )}

      {/* 캡처용 숨김 카드 — 큐의 현재 건만 렌더(순차 캡처). 목록의 '요청서' 다운로드와 같은 컴포넌트. */}
      {head ? (
        <div aria-hidden style={{ position: "fixed", left: -99999, top: 0, width: 720, pointerEvents: "none" }}>
          <TextbookRequestCardBody
            key={head.orderId}
            cardRef={capture.hiddenRef}
            data={head.data}
            academyName={academyName}
            logoUrl={logoUrl}
            account={account}
          />
        </div>
      ) : null}
    </div>
  );
}

/** ② 교재 표지 등 전원 공통 이미지 — 선택 즉시 업로드하고 썸네일(로컬 미리보기)로 보여준다. */
export function CoverPicker({
  covers,
  onChange,
  disabled,
}: {
  covers: NoticeAttachment[];
  onChange: (next: NoticeAttachment[]) => void;
  disabled?: boolean;
}) {
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const full = covers.length >= COVER_MAX;

  async function addFiles(files: File[]) {
    if (disabled || busy || full) return;
    setBusy(true);
    const added: NoticeAttachment[] = [];
    const urls: Record<string, string> = {};
    try {
      for (const file of files) {
        if (covers.length + added.length >= COVER_MAX) {
          toast.warning(`표지 이미지는 최대 ${COVER_MAX}장까지 첨부할 수 있습니다`);
          break;
        }
        const issued = await issueTextbookAttachmentTicket({ contentType: file.type, size: file.size });
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
        const reg = await registerTextbookAttachment({
          path: issued.ticket.path,
          name: file.name,
          size: file.size,
        });
        if (reg.error || !reg.attachment) {
          toast.error(reg.error ?? "이미지 등록에 실패했습니다");
          break;
        }
        added.push(reg.attachment);
        urls[reg.attachment.path] = URL.createObjectURL(file);
      }
    } finally {
      setBusy(false);
    }
    if (added.length) {
      setPreviews((p) => ({ ...p, ...urls }));
      onChange([...covers, ...added]);
    }
  }

  function removeOne(path: string) {
    const url = previews[path];
    if (url) URL.revokeObjectURL(url);
    setPreviews((p) => {
      const next = { ...p };
      delete next[path];
      return next;
    });
    onChange(covers.filter((c) => c.path !== path));
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-text-dim text-[12px] font-medium">
          교재 표지 (선택) <span className="text-text-faint">{covers.length}/{COVER_MAX}</span>
        </span>
        <label
          className={`border-line hover:bg-bg-soft inline-flex cursor-pointer items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-bold ${
            disabled || busy || full ? "pointer-events-none opacity-50" : ""
          }`}
        >
          <EyIcon name="image" size={13} />
          {busy ? "올리는 중…" : "표지 사진 추가"}
          <input
            type="file"
            accept={ACCEPT}
            multiple
            className="hidden"
            disabled={disabled || busy || full}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = ""; // 같은 파일 재선택 허용
              if (files.length) void addFiles(files);
            }}
          />
        </label>
      </div>
      {covers.length ? (
        <div className="grid grid-cols-4 gap-1.5">
          {covers.map((c) => (
            <div key={c.path} className="group relative">
              {previews[c.path] ? (
                // eslint-disable-next-line @next/next/no-img-element -- 로컬 blob 미리보기(최적화 대상 아님)
                <img src={previews[c.path]} alt={c.name} className="bg-card h-16 w-full rounded-lg object-contain" />
              ) : (
                <div className="bg-card text-text-faint flex h-16 w-full items-center justify-center rounded-lg">
                  <EyIcon name="image" size={16} />
                </div>
              )}
              <button
                type="button"
                onClick={() => removeOne(c.path)}
                className="bg-danger absolute top-0.5 right-0.5 inline-flex size-4 items-center justify-center rounded text-white opacity-0 transition group-hover:opacity-100"
                aria-label={`${c.name} 첨부 제거`}
              >
                <EyIcon name="close" size={11} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-text-faint text-[11px]">표지 사진을 넣으면 모든 학생 글에 함께 올라갑니다.</p>
      )}
    </div>
  );
}
