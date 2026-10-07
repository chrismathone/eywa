"use client";

import { SheetText } from "@/features/teacher-view/interface-label";

/**
 * 짝 잇기 한 줄 — 후보 버튼·검색 목록은 **고르기만** 하고, 확인 줄의 [연결]이 잇는다(적대 리뷰 2026-09-10).
 * 확인 줄은 양쪽을 다 적는다: `ijwgsy (중등E_중2 정규 C) ↔ 공서연 · 경명여중1 · 중등E_중2 정규 C`.
 * 검색 목록의 Enter는 목록 첫 줄을 고르므로, 고른 것이 확인 줄에 보이기 전엔 아무것도 저장되지 않는다.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SearchableSelect, type ComboOption } from "@/components/ui/searchable-select";
import type { LinkReason } from "@/features/ijw/match";

export type JjLinkRow = {
  ijwId: string;
  ijwName: string;
  className: string | null;
  /** 이름이 양쪽 전체에서 유일한 후보(한 번에 연결 대상)와 그 표시. */
  uniqueId: string | null;
  uniqueLabel: string | null;
  candidates: { id: string; label: string; reason: LinkReason; sameClass: boolean }[];
};

const REASON_TEXT: Record<LinkReason, string> = {
  name: "이름 같음",
  "id-class": "아이디 머리글자 · 반 일치",
  id: "아이디 머리글자",
};

/**
 * 후보 칩에 적는 근거. 🔴 **이름이 같은 후보끼리는 '반 일치'가 유일한 구분선**이라 반드시 적는다
 * (원장 제보 2026-09-29: 근거가 둘 다 '이름 같음'이라 반이 다른 동명이인에 잘못 이었다).
 * ⚠️ `id-class`는 문구에 이미 '반 일치'가 들어 있어 덧붙이지 않는다(같은 말을 두 번 적지 않는다).
 */
function reasonText(c: { reason: LinkReason; sameClass: boolean }): string {
  return c.sameClass && c.reason !== "id-class"
    ? `${REASON_TEXT[c.reason]} · 반 일치`
    : REASON_TEXT[c.reason];
}

/** 인재원 쪽 표기 — 이름(반). 확인 줄·토스트·일괄 목록이 같은 문자열을 쓴다. */
export function ijwSideLabel(row: Pick<JjLinkRow, "ijwName" | "className">): string {
  return row.className ? `${row.ijwName} (${row.className})` : row.ijwName;
}

export function JjLinkRowItem({
  row,
  poolOptions,
  pending,
  onLink,
}: {
  row: JjLinkRow;
  poolOptions: ComboOption[];
  pending: boolean;
  onLink: (studentId: string, studentLabel: string, done: () => void) => void;
}) {
  const [pick, setPick] = useState<{ id: string; label: string } | null>(null);
  const pickedFromPool = !!pick && !row.candidates.some((c) => c.id === pick.id);
  return (
    <li className="space-y-1.5 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-foreground text-sm font-bold">{row.ijwName}</span>
        <span className="text-text-faint text-xs">{row.className ?? "반 없음"}</span>
        <span className="text-text-faint text-xs">→</span>
        {row.candidates.map((c) => {
          const on = pick?.id === c.id;
          return (
            <Button
              key={c.id}
              variant={on ? "default" : "outline"}
              size="sm"
              disabled={pending}
              aria-pressed={on}
              onClick={() => setPick(on ? null : { id: c.id, label: c.label })}
              title={reasonText(c)}
            >
              {c.label}
              {/* 🔴 반이 같은 후보는 근거를 **흐리게 적지 않는다** — 동명이인 중 하나를 고르는 자리에서
                  이 한 줄이 유일한 단서다(원장 제보 2026-09-29). 고른 칩은 배경이 이미 진해 그대로 둔다. */}
              <span
                className={`ml-1 ${on ? "font-medium" : c.sameClass ? "text-foreground font-bold" : "text-text-faint font-medium"}`}
              >
                ({reasonText(c)})
              </span>
            </Button>
          );
        })}
        {/* 후보가 없거나 틀리면 직접 찾아서 — 지금 영어 반을 다니는 짝 없는 학생 목록. 여기서도 고르기만 한다. */}
        <SearchableSelect
          options={poolOptions}
          value={pickedFromPool ? (pick?.id ?? "") : ""}
          onValueChange={(v) => {
            const o = poolOptions.find((p) => p.value === v);
            if (o) setPick({ id: o.value, label: o.label });
          }}
          placeholder="다른 학생 찾아서 고르기"
          searchPlaceholder="이름으로 찾기"
          ariaLabel={`${row.ijwName} 연결할 학생 찾기`}
          className="min-w-[220px]"
          triggerClassName="border-line bg-card text-foreground focus:border-primary h-8 w-full rounded-lg border px-2 text-xs outline-none"
        />
      </div>
      {pick ? (
        <div
          role="group"
          aria-label="연결 확인"
          className="border-amber/60 bg-card flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2"
        >
          <span className="text-foreground text-sm">
            <b>{ijwSideLabel(row)}</b>
            <span className="text-text-faint"> ↔ </span>
            <b>{pick.label}</b>
          </span>
          <Button size="sm" disabled={pending} onClick={() => onLink(pick.id, pick.label, () => setPick(null))}>
            <SheetText value={"연결"} /></Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPick(null)}>
            <SheetText value={"취소"} /></Button>
        </div>
      ) : null}
    </li>
  );
}
