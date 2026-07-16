"use client";

// 수업 보고서 학생 사진 첨부(P2b) — 자립형 UI + 업로드 오케스트레이션(파일선택→리사이즈→issue→upload→register→썸네일→삭제).
// 강사 원스크린과 admin 직접작성(compose-face)이 공유. 첨부는 **저장된 보고서 행에만** 붙으므로 첫 첨부 전
// ensureSaved()로 행을 보장한다(부모가 강사/admin에 맞는 저장 액션을 넘김). 서버 게이트가 최종 인가·검증.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { EyIcon } from "@/components/icons/eywa-icons";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import { resizeImageForUpload } from "../resize-image";
import { isImageAttachment } from "../attachment-utils";
import {
  issueReportAttachmentUploadTicket,
  registerReportAttachment,
  removeReportAttachment,
  signReportAttachmentUrls,
} from "../server/attachment-actions";

type Attachment = { path: string; name: string };
const MAX = 6;
// 사진 + 문서/오디오(ClassNote 첨부파일 슬롯과 정렬). 서버 allowCT(isReportAttachmentCT)가 최종 검증.
const ACCEPT =
  "image/jpeg,image/png,image/webp,application/pdf,.hwp,.hwpx,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.cell,.show,audio/mpeg,audio/mp4,.mp3,.m4a";

const extFromType = (t: string): string | null =>
  t === "image/png" ? "png" : t === "image/webp" ? "webp" : t === "image/jpeg" ? "jpg" : null;

export function ReportAttachments({
  studentId,
  subject,
  reportDate,
  disabled,
  ensureSaved,
  onChanged,
}: {
  studentId: string;
  subject: string; // 과목키(math/english…)
  reportDate?: string; // 대상 보고서 날짜(생략=오늘)
  disabled?: boolean;
  ensureSaved: () => Promise<boolean>; // 첫 첨부 전 보고서 행 보장(true=저장됨). false면 첨부 중단.
  onChanged?: () => void; // 첨부/삭제 후(서버가 classnote 상태 리셋 → 부모 갱신용)
}) {
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // (student, subject, date) 바뀌면 기존 첨부·썸네일 로드. 행이 없으면 빈 상태(에러 아님).
  // ⚠️ setState는 **항상 await 뒤**에서만(effect 동기 setState 금지, #25) — 미선택 케이스도 resolved promise를 await.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const res = await (studentId && subject
        ? signReportAttachmentUrls({ studentId, subject, reportDate })
        : Promise.resolve({ urls: {}, attachments: [] as Attachment[] }));
      if (cancelled) return;
      setAtts(res.attachments ?? []);
      setUrls(res.urls ?? {});
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, subject, reportDate]);

  async function addFiles(files: File[]) {
    if (disabled || busy || !studentId || !subject) return;
    setBusy(true);
    const base = atts.length;
    let added = 0;
    try {
      // 첨부는 저장된 행에만 — 첫 첨부 시 현재 폼으로 저장(멱등 upsert, attachments 컬럼 미터치라 기존 첨부 보존).
      if (!(await ensureSaved())) return;
      for (const original of files) {
        if (base + added >= MAX) {
          toast.warning(`첨부는 최대 ${MAX}개까지 가능합니다`);
          break;
        }
        // 이미지만 업로드 전 클라 다운스케일(문서/오디오는 원본 그대로).
        const file = original.type.startsWith("image/") ? await resizeImageForUpload(original) : original;
        const ext = extFromType(file.type) ?? file.name.split(".").pop() ?? "jpg";
        const issued = await issueReportAttachmentUploadTicket({
          studentId,
          subject,
          reportDate,
          contentType: file.type,
          size: file.size,
          ext,
        });
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
        const reg = await registerReportAttachment({
          studentId,
          subject,
          reportDate,
          path: issued.ticket.path,
          name: original.name,
          size: file.size,
        });
        if (!reg.ok) {
          toast.error(reg.error ?? "첨부 등록에 실패했습니다");
          break;
        }
        added++;
        setAtts(reg.attachments ?? []);
      }
      if (added) {
        const res = await signReportAttachmentUrls({ studentId, subject, reportDate });
        setUrls(res.urls ?? {});
        if (res.attachments) setAtts(res.attachments);
        toast.success(`${added}개 첨부 — ClassNote는 다시 발송하세요`);
        onChanged?.();
      }
    } finally {
      setBusy(false);
    }
  }

  async function removeOne(path: string) {
    if (busy) return;
    const res = await removeReportAttachment({ studentId, subject, reportDate, path });
    if (!res.ok) {
      toast.error(res.error ?? "첨부 삭제에 실패했습니다");
      return;
    }
    setAtts(res.attachments ?? []);
    setUrls((u) => {
      const next = { ...u };
      delete next[path];
      return next;
    });
    onChanged?.();
  }

  const full = atts.length >= MAX;
  return (
    <div className="border-line bg-bg-soft rounded-md border px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-text-faint text-[11px] font-semibold">
          사진·파일 첨부 <span className="text-text-dim">{atts.length}/{MAX}</span>
        </p>
        <label
          className={`border-line hover:bg-card cursor-pointer rounded-md border px-2 py-1 text-[11px] font-semibold ${
            disabled || busy || full ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {busy ? "업로드 중…" : "사진·파일 추가"}
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
      {atts.length ? (
        <div className="grid grid-cols-3 gap-1.5">
          {atts.map((a) => (
            <div key={a.path} className="group relative">
              {urls[a.path] && isImageAttachment(a.name || a.path) ? (
                // eslint-disable-next-line @next/next/no-img-element -- 세션 내 signed URL 썸네일(최적화 불필요)
                <img src={urls[a.path]} alt={a.name} className="bg-card h-16 w-full rounded object-contain" />
              ) : (
                // 비이미지(문서·오디오) = 파일 칩(아이콘 + 파일명)
                <div className="bg-card text-text-dim flex h-16 w-full flex-col items-center justify-center gap-0.5 rounded px-1 text-center">
                  <EyIcon name="file" size={16} className="text-text-faint" />
                  <span className="w-full truncate text-[10px]">{a.name}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() => void removeOne(a.path)}
                className="bg-danger absolute top-0.5 right-0.5 inline-flex size-4 items-center justify-center rounded text-white opacity-0 transition group-hover:opacity-100"
                aria-label={`${a.name} 삭제`}
              >
                <EyIcon name="close" size={11} strokeWidth={2} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-text-faint text-[11px]">사진·파일을 추가하면 학부모 링크·ClassNote 게시글에 함께 실립니다.</p>
      )}
    </div>
  );
}
