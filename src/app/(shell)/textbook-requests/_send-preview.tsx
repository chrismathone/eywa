"use client";

// 발송 다이얼로그의 미리보기 — **발송과 같은 순수 함수**(composeTextbookNotice)로 조립한다(WYSIWYG:
// 여기 보이는 글자가 그대로 학부모에게 간다). 같은 학생의 요청 여러 건은 서버가 한 글로 이어 붙이므로
// 미리보기는 첫 건만 보여주고 그 사실을 명시한다.

import { composeTextbookNotice } from "@/features/billing/textbook-notice";
import type { SendTarget } from "./_send-targets";

export function NoticePreview({
  ment,
  target,
  account,
  imageCount,
}: {
  ment: string;
  /** 미리보기 기준 학생(발송 가능한 첫 명). null이면 보낼 대상이 없다. */
  target: SendTarget | null;
  account?: { bank: string; holder: string; number: string };
  /** 이 학생 글에 함께 올라갈 이미지 수(요청서 + 공통 표지) — 글자만 보고 오해하지 않도록. */
  imageCount: number;
}) {
  const order = target?.orders[0] ?? null;
  const text =
    target && order
      ? composeTextbookNotice(ment, {
          studentName: target.name,
          bookName: order.bookName,
          bookDetail: order.bookDetail,
          price: order.price,
          requestDate: order.requestDate,
          account,
        }).full
      : "";

  return (
    <div className="space-y-1">
      <span className="text-text-dim block text-xs font-medium">
        미리보기{target ? ` · ${target.name} 기준` : ""}
        {target && target.orders.length > 1
          ? ` (요청 ${target.orders.length}건이 한 글로 이어집니다 — 첫 건만 표시)`
          : ""}
      </span>
      {text ? (
        <div className="border-line bg-bg-soft/60 space-y-2 rounded-2xl border p-3">
          <p className="text-foreground text-sm whitespace-pre-wrap">{text}</p>
          {imageCount > 0 ? (
            <p className="text-text-faint border-line border-t pt-2 text-xs">
              + 이미지 <span className="num">{imageCount}</span>장이 이 글에 함께 올라갑니다
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-text-faint border-line rounded-2xl border border-dashed p-3 text-xs">
          보낼 수 있는 학생이 없습니다.
        </p>
      )}
    </div>
  );
}
