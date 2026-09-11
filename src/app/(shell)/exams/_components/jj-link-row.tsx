"use client";

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
  candidates: { id: string; label: string; reason: LinkReason }[];
};

const REASON_TEXT: Record<LinkReason, string> = {
  name: "이름 같음",
  "id-class": "아이디 머리글자 · 반 일치",
  id: "아이디 머리글자",
};

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
              title={REASON_TEXT[c.reason]}
            >
              {c.label}
              <span className={`ml-1 font-medium ${on ? "" : "text-text-faint"}`}>({REASON_TEXT[c.reason]})</span>
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
            연결
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => setPick(null)}>
            취소
          </Button>
        </div>
      ) : null}
    </li>
  );
}
