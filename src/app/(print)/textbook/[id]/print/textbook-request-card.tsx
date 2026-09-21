"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ImageDown, Loader2, Printer, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import type { AccountSetting } from "@/features/owner/settings-types";
import type { TextbookOrderDetail } from "@/features/billing/server/textbook-queries";
import { TextbookRequestCardBody } from "./textbook-request-card-body";
import { downloadCardPng } from "./download-card";

// 교재요청서 뷰어(프린트 라우트) — 버튼(이미지 저장/인쇄/닫기) + 카드 본문. 본문은 목록 '바로 다운로드'와 공유.
export function TextbookRequestCard({
  order,
  academyName,
  logoUrl,
  account,
  embedded,
  autoDownload,
}: {
  order: TextbookOrderDetail;
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
  // 플로팅 창 안이면 window.close() 무효 → 닫기 숨김(창 X로 닫음).
  embedded?: boolean;
  // ?download=1 진입(재다운로드) — 마운트 시 PNG 자동 저장.
  autoDownload?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  const savePng = useCallback(async () => {
    if (!cardRef.current) return;
    setSaving(true);
    try {
      await downloadCardPng(cardRef.current, order.requestDate, order.studentName, order.bookName);
    } finally {
      setSaving(false);
    }
  }, [order.requestDate, order.studentName, order.bookName]);

  // 자동 다운로드(1회) — 로고 등 이미지 로드 후 canvas가 정확하도록 다음 프레임에 실행. 재실행 방지 ref 가드.
  const didAuto = useRef(false);
  useEffect(() => {
    if (!autoDownload || didAuto.current) return;
    didAuto.current = true;
    const t = setTimeout(() => void savePng(), 400);
    return () => clearTimeout(t);
  }, [autoDownload, savePng]);

  return (
    <div className="mx-auto max-w-[800px] px-4 py-6 print:p-0">
      <div className="mb-6 flex justify-end gap-2 print:hidden">
        <Button onClick={savePng} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <ImageDown className="size-4" />}
          이미지 저장
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" /> 인쇄
        </Button>
        {embedded ? null : (
          <Button variant="secondary" onClick={() => window.close()}>
            <X className="size-4" /> 닫기
          </Button>
        )}
      </div>

      <TextbookRequestCardBody data={order} academyName={academyName} logoUrl={logoUrl} account={account} cardRef={cardRef} />
    </div>
  );
}
