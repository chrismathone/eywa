"use client";

import type { RefObject } from "react";
import type { AccountSetting } from "@/features/owner/settings-types";

// 교재요청서 카드 "본문"(버튼 없는 순수 카드) — 프린트 뷰어와 목록의 '바로 다운로드'(숨김 렌더 → html2canvas)가 공유.
// ⚠️ html2canvas 1.4.1은 oklch(Tailwind v4 색)를 못 읽어 크래시 → 카드 내부는 전부 inline hex.
const KRW = new Intl.NumberFormat("ko-KR");

// "YYYY-MM-DD" → "YYYY. M. D"(0 제거). null이면 빈 문자열.
function formatRequestDate(ymd: string | null): string {
  if (!ymd) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  return `${m[1]}. ${Number(m[2])}. ${Number(m[3])}`;
}

const BLACK = "#000000";
const GRAY_50 = "#f9fafb";
const GRAY_300 = "#d1d5db";
const GRAY_500 = "#6b7280";
const OUTER = `2px solid ${BLACK}`;
const INNER = `1px solid ${BLACK}`;
// ijw는 font-serif → 한글은 OS 기본 명조(Windows 바탕)로 떨어진다. 동일 톤을 위해 명조 계열 우선.
const SERIF = '"Batang", "Nanum Myeongjo", Georgia, "Times New Roman", serif';

export type TextbookCardData = {
  studentName: string | null;
  teacherName: string | null;
  requestDate: string | null;
  bookName: string;
  bookDetail: string | null;
  price: number;
};

/** 교재요청서 카드 본문 — cardRef를 붙여 html2canvas 대상으로 쓴다(프린트 뷰어=savePng, 목록=바로 다운로드). */
export function TextbookRequestCardBody({
  data,
  academyName,
  logoUrl,
  account,
  cardRef,
}: {
  data: TextbookCardData;
  academyName: string;
  logoUrl: string | null;
  account: AccountSetting;
  cardRef?: RefObject<HTMLDivElement | null>;
}) {
  const dateText = formatRequestDate(data.requestDate);
  const hasAccount = !!(account.bank || account.holder || account.number);

  return (
    <div
      ref={cardRef}
      className="print-portrait"
      style={{
        width: "100%",
        maxWidth: 720,
        margin: "0 auto",
        background: "#ffffff",
        color: BLACK,
        padding: 48,
        fontFamily: SERIF,
        boxSizing: "border-box",
      }}
    >
      {/* 헤더 — 좌: 로고 박스 / 우: 교재 요청서 */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 32,
          marginBottom: 64,
          paddingBottom: 16,
        }}
      >
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- 인쇄물 외부 이미지(최적화 불필요)
          <img src={logoUrl} alt={academyName} style={{ height: 56, width: "auto", objectFit: "contain", flexShrink: 0 }} />
        ) : (
          <div
            style={{
              flexShrink: 0,
              height: 56,
              padding: "0 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${GRAY_300}`,
              borderRadius: 6,
              fontSize: 15,
              fontWeight: 700,
              letterSpacing: "0.12em",
              whiteSpace: "nowrap",
            }}
          >
            {academyName}
          </div>
        )}
        <h1
          style={{
            fontSize: 48,
            fontWeight: 700,
            letterSpacing: "0.18em",
            whiteSpace: "nowrap",
            flexShrink: 0,
            margin: 0,
            marginBottom: 8,
          }}
        >
          교재 요청서
        </h1>
      </div>

      {/* 학생정보 */}
      <Block title="학생정보">
        <Row label="이 름" height={48} last={false}>
          <span style={{ fontSize: 18, fontWeight: 500 }}>{data.studentName ?? "—"}</span>
        </Row>
        <Row label="담임선생님" height={48} last={false}>
          <span style={{ fontSize: 18, fontWeight: 500 }}>{data.teacherName ?? "—"}</span>
          <span style={{ marginLeft: 12, fontSize: 14, color: GRAY_500 }}>(인)</span>
        </Row>
        <Row label="요청일자" height={48} last>
          <span style={{ fontSize: 18, fontWeight: 500, letterSpacing: "0.04em" }}>{dateText || "—"}</span>
        </Row>
      </Block>

      {/* 요청내용 */}
      <div style={{ marginTop: 40 }}>
        <Block title="요청내용">
          <Row label="교재명" minHeight={48} last={false} column>
            <div style={{ fontSize: 18, fontWeight: 500 }}>{data.bookName}</div>
            {data.bookDetail ? (
              <div style={{ marginTop: 4, fontSize: 16, fontWeight: 400 }}>{data.bookDetail}</div>
            ) : null}
          </Row>
          <Row label="금액" height={48} last={!hasAccount}>
            <span style={{ fontSize: 20, fontWeight: 500, letterSpacing: "0.02em" }}>
              {KRW.format(data.price)}원
            </span>
          </Row>
          {hasAccount ? (
            <Row label="계좌" height={64} last column>
              <div style={{ fontSize: 16, fontWeight: 500 }}>
                {account.bank}
                {account.holder ? ` (예금주: ${account.holder})` : ""}
              </div>
              {account.number ? (
                <div style={{ marginTop: 4, fontSize: 16, fontWeight: 500 }}>{account.number}</div>
              ) : null}
            </Row>
          ) : null}
        </Block>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", border: OUTER }}>
      <div
        style={{
          width: 80,
          flexShrink: 0,
          background: GRAY_50,
          borderRight: INNER,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          textAlign: "center",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>{children}</div>
    </div>
  );
}

function Row({
  label,
  height,
  minHeight,
  last,
  column,
  children,
}: {
  label: string;
  height?: number;
  minHeight?: number;
  last: boolean;
  column?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        borderBottom: last ? "none" : INNER,
        height,
        minHeight,
        alignItems: "stretch",
      }}
    >
      <div
        style={{
          width: 96,
          flexShrink: 0,
          borderRight: INNER,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
        }}
      >
        {label}
      </div>
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: column ? "column" : "row",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: column ? "8px" : "0 8px",
        }}
      >
        {children}
      </div>
    </div>
  );
}
