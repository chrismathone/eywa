"use client";

import { useState } from "react";
import { useSubjectMaps } from "@/features/owner/operations-context";
import {
  encodeLinkPick,
  linkOptionsOf,
  suggestLinkItem,
  suggestSubjectRow,
  type NewcomerLinkTarget,
} from "@/features/newcomers/consult-link";

/** `2026-09-03` → `9/3`. */
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;

/**
 * 상담 폼의 **신규생 관리** 칸(0294a 반자동) — 고른 학생이 90일 관리 대상일 때만 그린다.
 *
 * 🔑 새 상담이면 날짜 규칙으로 한 칸을 미리 잡아 둔다(`suggestLinkItem`) — 사람은 확인하거나 바꾸거나
 *    '해당 없음'(통화가 안 됐으면)을 고른다. 수정이면 이 상담으로 이미 한 칸만 잡혀 있다(오타만 고치러 온 사람이
 *    모르는 새 체크를 만들지 않게).
 * 🔑 과목이 여럿이면 과목마다 한 줄 — 제안은 상담 과목·상담자 담당 과목으로 좁혀지는 줄에만 건다.
 * ⚠️ 부모가 `key={학생id}`로 다시 마운트한다 — 학생을 바꾸면 사람이 고른 값도 같이 비운다.
 */
export function NewcomerLinkField({
  target,
  consultedOn,
  consultSubjectKey,
  counselorSubjects,
  suggest,
}: {
  target: NewcomerLinkTarget;
  /** 폼의 상담일(KST `YYYY-MM-DD`). */
  consultedOn: string;
  consultSubjectKey: string | null;
  counselorSubjects: readonly string[];
  /** 새 상담이면 true(제안), 수정이면 false(이미 연결된 것만). */
  suggest: boolean;
}) {
  const { labelOf } = useSubjectMaps();
  const [manual, setManual] = useState<Record<number, string>>({});
  const suggestRow = suggest ? suggestSubjectRow(target.rows, consultSubjectKey, counselorSubjects) : null;

  return (
    <div className="border-border space-y-2 rounded-md border px-3 py-2.5">
      <p className="text-foreground text-sm font-medium break-keep">신규생 관리</p>
      {target.rows.map((row, i) => {
        const linked = row.linked?.[0] ?? "";
        const fallback = row === suggestRow ? suggestLinkItem(row, consultedOn) : linked;
        const value = manual[i] ?? (fallback ? encodeLinkPick(row.subject, fallback) : "");
        const subjectLabel = row.subject ? labelOf(row.subject) : null;
        return (
          <label key={row.subject ?? ""} className="block space-y-1">
            {/* 이 줄을 그렸다는 표식 — 서버는 그린 줄의 연결만 풀고 고친다. */}
            <input type="hidden" name="newcomerLinkRow" value={row.subject ?? ""} />
            {target.rows.length > 1 && subjectLabel ? (
              <span className="text-muted-foreground block text-xs break-keep">{subjectLabel}</span>
            ) : null}
            <select
              name="newcomerLink"
              value={value}
              onChange={(e) => setManual((m) => ({ ...m, [i]: e.target.value }))}
              className="border-input bg-background w-full rounded-md border px-3 py-2 text-sm focus:ring-1 focus:ring-ring focus:outline-none"
            >
              <option value="">해당 없음</option>
              {linkOptionsOf(row).map((o) => (
                <option key={o.key} value={encodeLinkPick(row.subject, o.key)} disabled={!!o.doneElsewhere}>
                  {o.label}
                  {o.doneElsewhere ? ` · 완료 ${md(o.doneElsewhere)}` : o.due ? ` · 기한 ${md(o.due)}` : ""}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <p className="text-muted-foreground text-xs break-keep">
        90일 관리 학생입니다. 저장하면 고른 칸이 상담 날짜로 완료됩니다. 통화가 안 됐으면 ‘해당 없음’.
      </p>
    </div>
  );
}
