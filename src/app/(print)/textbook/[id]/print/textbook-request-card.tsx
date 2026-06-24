"use client";

import { useRef, useState } from "react";
import { ImageDown, Loader2, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AccountSetting } from "@/features/owner/settings-types";
import type { TextbookOrderDetail } from "@/features/billing/server/textbook-queries";

const KRW = new Intl.NumberFormat("ko-KR");

// "YYYY-MM-DD" → "YYYY. M. D"(0 제거). null이면 빈 문자열.
function formatRequestDate(ymd: string | null): string {
  if (!ymd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}`;
}

// html2canvas 1.4.1은 oklch 색을 못 읽어 크래시 → 카드는 전부 inline hex 스타일로 그린다.
// (Tailwind v4 색 유틸은 oklch로 컴파일되므로 카드 내부엔 색 유틸을 쓰지 않음.)
const INK = "#111111";
const LABEL_BG = "#f7f7f5";
const SUB = "#6b7280";
const BORDER = "2px solid #111111";

export function TextbookRequestCard({
  order,
  academyName,
  logoUrl,
  account,
}: {
  order: TextbookOrderDetail;
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);

  const studentSub = [order.studentGrade, order.studentSchool].filter(Boolean).join(" · ");
  const dateText = formatRequestDate(order.requestDate);
  const hasAccount = !!(account.bank || account.holder || account.number);

  async function savePng() {
    if (!cardRef.current) return;
    setSaving(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(cardRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      const fname = `${order.requestDate ?? "교재요청"}_${order.studentName ?? "학생"}_${order.bookName}`
        .replace(/[\\/:*?"<>|]/g, " ")
        .trim();
      a.download = `${fname}.png`;
      a.href = url;
      a.click();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-[760px] px-4 py-6 print:p-0">
      <div className="mb-6 flex justify-end gap-2 print:hidden">
        <Button onClick={savePng} disabled={saving}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <ImageDown className="size-4" />}
          이미지 저장
        </Button>
        <Button variant="outline" onClick={() => window.print()}>
          <Printer className="size-4" /> 인쇄
        </Button>
        <Button variant="secondary" onClick={() => window.close()}>
          <X className="size-4" /> 닫기
        </Button>
      </div>

      {/* 카드 본체 — 720px, 모든 색/테두리 inline hex(html2canvas oklch 회피) */}
      <div
        ref={cardRef}
        style={{
          width: 720,
          margin: "0 auto",
          background: "#ffffff",
          color: INK,
          padding: 48,
          fontFamily: '"Pretendard Variable", Pretendard, system-ui, sans-serif',
          boxSizing: "border-box",
        }}
      >
        {/* 헤더 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 56,
          }}
        >
          <div style={{ minWidth: 0 }}>
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- 인쇄물 외부 이미지(최적화 불필요)
              <img src={logoUrl} alt={academyName} style={{ height: 48, width: "auto", objectFit: "contain" }} />
            ) : (
              <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "0.02em" }}>{academyName}</span>
            )}
          </div>
          <h1 style={{ fontSize: 38, fontWeight: 800, letterSpacing: "0.22em", margin: 0 }}>교재 요청서</h1>
        </div>

        {/* 학생정보 */}
        <InfoBlock title="학생정보">
          <InfoRow label="이 름" last={false}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{order.studentName ?? "—"}</span>
            {studentSub ? (
              <span style={{ marginLeft: 8, fontSize: 13, color: SUB }}>{studentSub}</span>
            ) : null}
          </InfoRow>
          <InfoRow label="담임선생님" last={false}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{order.teacherName ?? "—"}</span>
            <span style={{ marginLeft: 8, color: SUB }}>(인)</span>
          </InfoRow>
          <InfoRow label="요청일자" last>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{dateText || "—"}</span>
          </InfoRow>
        </InfoBlock>

        {/* 요청내용 */}
        <div style={{ marginTop: 16 }}>
          <InfoBlock title="요청내용">
            <InfoRow label="교재명" last={false}>
              <span style={{ fontSize: 18, fontWeight: 600 }}>{order.bookName}</span>
              {order.bookDetail ? (
                <div style={{ marginTop: 2, fontSize: 15 }}>{order.bookDetail}</div>
              ) : null}
            </InfoRow>
            <InfoRow label="금액" last={!hasAccount}>
              <span style={{ fontSize: 20, fontWeight: 600 }}>{KRW.format(order.price)}원</span>
            </InfoRow>
            {hasAccount ? (
              <InfoRow label="입금 계좌" last>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {account.bank}
                  {account.holder ? (
                    <span style={{ fontWeight: 400, color: SUB }}> (예금주: {account.holder})</span>
                  ) : null}
                </div>
                {account.number ? (
                  <div style={{ marginTop: 2, fontSize: 16, fontWeight: 600 }}>{account.number}</div>
                ) : null}
              </InfoRow>
            ) : null}
          </InfoBlock>
        </div>
      </div>
    </div>
  );
}

function InfoBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", border: BORDER }}>
      <div
        style={{
          width: 80,
          flexShrink: 0,
          background: LABEL_BG,
          borderRight: BORDER,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          fontWeight: 700,
          textAlign: "center",
          padding: "0 6px",
        }}
      >
        {title}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function InfoRow({
  label,
  last,
  children,
}: {
  label: string;
  last: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", borderBottom: last ? "none" : BORDER, minHeight: 52 }}>
      <div
        style={{
          width: 104,
          flexShrink: 0,
          background: LABEL_BG,
          borderRight: BORDER,
          display: "flex",
          alignItems: "center",
          padding: "10px 12px",
          fontSize: 14,
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "10px 16px" }}>
        {children}
      </div>
    </div>
  );
}
