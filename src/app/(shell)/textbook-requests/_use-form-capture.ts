"use client";

// 교재요청서 양식(카드 DOM) → PNG → 스토리지 업로드 큐. 학부모 발송 다이얼로그가 열릴 때 학생별 요청서
// 이미지를 만들어 둔다(원장이 손으로 올리던 그림 = 목록의 '요청서' 다운로드와 **같은 카드·같은 렌더 설정**).
//
// ⚠️ 한 장씩 순차로 만든다 — 숨김 렌더 노드는 하나뿐이라 동시 캡처가 서로를 덮어쓴다(_client.tsx 다운로드 큐와 동일).
// ⚠️ 한 장이라도 실패하면 error로 멈춘다 — 이미지 없이 조용히 발송되면 안 되므로 화면이 발송을 막는다.
// ⚠️ setState는 전부 setTimeout 콜백(=effect 동기 setState 금지, #25) 안에서만 호출한다.

import { useEffect, useRef, useState, type RefObject } from "react";
import { cardToPngBlob } from "@/app/(print)/textbook/[id]/print/download-card";
import type { TextbookCardData } from "@/app/(print)/textbook/[id]/print/textbook-request-card-body";
import { uploadToTicket } from "@/lib/storage/upload-to-ticket";
import {
  issueTextbookAttachmentTicket,
  registerTextbookAttachment,
} from "@/features/billing/server/textbook-attachment-actions";
import type { NoticeAttachment } from "@/features/onescreen/notice-attachments";

/** 캡처 대상 1건 = 교재요청 1건(학생 1명의 요청서 1장). */
export type CaptureJob = {
  orderId: string;
  studentId: string;
  /** 첨부 파일명(확장자 제외) — 다운로드 파일명과 같은 규칙. */
  fileName: string;
  data: TextbookCardData;
};

export type FormCapture = {
  /** 숨김 렌더 카드에 붙일 ref(캡처 대상). */
  hiddenRef: RefObject<HTMLDivElement | null>;
  /** 지금 캡처 중인 건(없으면 null = 전부 끝났거나 아직 없음). */
  head: CaptureJob | null;
  total: number;
  done: number;
  error: string | null;
  /** studentId → 그 학생 요청서 첨부(같은 학생 요청 여러 건이면 여러 장). */
  byStudent: Record<string, NoticeAttachment[]>;
  /** 발송해도 되는가 = 만들 게 있고, 전부 끝났고, 실패가 없다. */
  ready: boolean;
};

/** 로고 이미지 로드 후 캡처하도록 짧게 지연(_client.tsx 다운로드 큐와 동일 값). */
const RENDER_DELAY = 350;

export function useFormCapture(jobs: CaptureJob[]): FormCapture {
  const [idx, setIdx] = useState(0);
  const [byStudent, setByStudent] = useState<Record<string, NoticeAttachment[]>>({});
  const [error, setError] = useState<string | null>(null);
  const hiddenRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const head = jobs[idx];
    if (!head || error) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        const el = hiddenRef.current;
        if (!el) {
          setError("요청서 이미지를 만들지 못했습니다 — 다시 열어주세요");
          return;
        }
        const name = `${head.fileName}.png`;
        try {
          const blob = await cardToPngBlob(el);
          // key=요청 id → **같은 객체를 덮어쓴다**. 다이얼로그를 다시 열 때마다 새 파일이 쌓이면
          // (삭제 경로가 없어) 스토리지에 영구 누적된다 — 30명 × 여러 번 = 수백 개.
          const issued = await issueTextbookAttachmentTicket({
            contentType: "image/png",
            size: blob.size,
            key: head.orderId,
          });
          if (issued.error || !issued.ticket) throw new Error(issued.error ?? "업로드 준비에 실패했습니다");
          await uploadToTicket(issued.ticket, new File([blob], name, { type: "image/png" }));
          const reg = await registerTextbookAttachment({
            path: issued.ticket.path,
            name,
            size: blob.size,
          });
          if (reg.error || !reg.attachment) throw new Error(reg.error ?? "이미지 등록에 실패했습니다");
          if (cancelled) return;
          const att = reg.attachment;
          setByStudent((m) => ({ ...m, [head.studentId]: [...(m[head.studentId] ?? []), att] }));
          setIdx((i) => i + 1);
        } catch (e) {
          if (cancelled) return;
          setError(e instanceof Error ? e.message : "요청서 이미지 업로드에 실패했습니다");
        }
      })();
    }, RENDER_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobs, idx, error]);

  const done = Math.min(idx, jobs.length);
  return {
    hiddenRef,
    head: jobs[idx] ?? null,
    total: jobs.length,
    done,
    error,
    byStudent,
    ready: jobs.length > 0 && done === jobs.length && !error,
  };
}
