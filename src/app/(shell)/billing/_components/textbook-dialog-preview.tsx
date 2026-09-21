"use client";

// 교재신청 다이얼로그 우측 — 강사뷰와 동일한 실시간 요청서 미리보기(타이핑 즉시 종이 서식에 반영).

import { useEffect, useRef, useState } from "react";
import { Eye } from "@/components/icons/aywa-icon-compat";
import { kstToday } from "@/lib/date-kst";
import type { AccountSetting } from "@/features/owner/settings-types";
import { TextbookRequestCardBody } from "@/app/(print)/textbook/[id]/print/textbook-request-card-body";
import type { TextbookDraft } from "./textbook-dialog-fields";

// 요청서 카드는 720px 고정 인쇄 서식이라 좁은 칸에선 잘린다 → 칸 폭에 맞춰 전체를 비례 축소(잘림 없이 온전히 표시).
// 카드를 720px로 렌더 후 transform:scale로 줄이고, 축소된 만큼 래퍼 높이를 맞춘다(빈 공간 방지).
const PREVIEW_BASE_W = 720;
function ScaledPreview({ children }: { children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const box = boxRef.current;
    const card = cardRef.current;
    if (!box || !card) return;
    // ResizeObserver 콜백은 렌더 밖(비동기)이라 setState 안전(#25 무관). 칸 폭·카드 높이 변화(타이핑 등)에 반응.
    const ro = new ResizeObserver(() => {
      const s = Math.min(1, box.clientWidth / PREVIEW_BASE_W);
      setScale(s);
      setHeight(card.offsetHeight * s);
    });
    ro.observe(box);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={boxRef} className="overflow-hidden" style={{ height }}>
      <div ref={cardRef} style={{ width: PREVIEW_BASE_W, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

export function TextbookPreview({
  draft,
  studentName,
  academyName,
  logoUrl,
  account,
}: {
  draft: TextbookDraft;
  studentName: string;
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-text-dim flex items-center gap-1.5 text-xs font-bold">
        <Eye className="size-3.5" />
        미리보기
      </h3>
      <div className="bg-bg-soft/60 border-line rounded-md border p-3 sm:p-4">
        <ScaledPreview>
          <TextbookRequestCardBody
            data={{
              studentName: studentName || null,
              teacherName: draft.teacherName || null,
              // 빈 날짜는 저장 시 오늘로 폴백(서버 규칙)이라 미리보기도 동일 — WYSIWYG 일치.
              requestDate: draft.requestDate || kstToday(),
              bookName: draft.bookName,
              bookDetail: draft.bookDetail || null,
              price: Math.max(0, Number(draft.price) || 0),
            }}
            academyName={academyName}
            logoUrl={logoUrl}
            account={account}
          />
        </ScaledPreview>
      </div>
    </section>
  );
}
