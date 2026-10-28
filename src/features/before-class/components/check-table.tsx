"use client";

import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  BEFORE_CLASS_CARDS, BEFORE_CLASS_ITEMS, completionRate, needsSupplement, normalizeMissed, percentLabel,
  type BeforeClassCard, type BeforeClassCheck,
} from "../items";
import type { RosterStudent } from "../types";
import { CardBadge, VerdictBadge } from "./badges";

const EMPTY: BeforeClassCheck = { missed: [], absent: false, card: null };
const CARD_OPTIONS = [{ value: "", label: "선택 안 함" }, ...BEFORE_CLASS_CARDS.map((c) => ({ value: c.key, label: c.label }))];

/**
 * 하루 체크 표 — 학생 줄 × 미흡 10항목(체크 = 미흡, 시트 그대로) + 결석 + 카드 + 완료율·판정.
 * 읽기 권한이면 칸이 잠긴다(보기 전용). 저장은 부모가 칸마다 즉시 한다.
 */
export function CheckTable({
  students, checks, canEdit, onChange,
}: {
  students: RosterStudent[];
  checks: Record<string, BeforeClassCheck | undefined>;
  canEdit: boolean;
  onChange: (studentId: string, next: BeforeClassCheck) => void;
}) {
  if (students.length === 0) {
    return <p className="text-text-dim px-1 py-6 text-sm">이날 이 반 명단에 학생이 없습니다.</p>;
  }
  return (
    <div className="overflow-x-auto px-1">
      <table className="w-full min-w-[1100px] border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
        <thead>
          <tr className="border-line border-b">
            <th className="bg-background sticky left-0 z-10 px-2 py-2 text-left font-semibold">이름</th>
            {BEFORE_CLASS_ITEMS.map((i) => (
              <th key={i.key} className="px-1 py-2 text-center text-xs font-semibold break-keep" title={i.label}>{i.short}</th>
            ))}
            <th className="px-1 py-2 text-center text-xs font-semibold">결석</th>
            <th className="px-1 py-2 text-center text-xs font-semibold">카드</th>
            <th className="px-1 py-2 text-center text-xs font-semibold">완료율</th>
            <th className="px-1 py-2 text-center text-xs font-semibold">판정</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const check = checks[s.id] ?? EMPTY;
            const missed = new Set<string>(normalizeMissed(check.missed));
            const toggle = (key: string) => {
              const next = new Set(missed);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              onChange(s.id, { ...check, missed: [...next] });
            };
            return (
              <tr key={s.id} className="border-line-faint border-b">
                <td className="bg-background sticky left-0 z-10 px-2 py-1.5">
                  <div className="flex items-baseline gap-1.5 whitespace-nowrap">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-text-dim text-xs">{s.schoolGrade}</span>
                    {s.onHold ? <span className="text-amber text-xs">휴원</span> : null}
                  </div>
                </td>
                {BEFORE_CLASS_ITEMS.map((i) => (
                  <td key={i.key} className={`px-1 py-1.5 text-center ${missed.has(i.key) ? "bg-rose-soft" : ""}`}>
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-[var(--color-rose)] disabled:cursor-default"
                      aria-label={`${s.name} ${i.label}`}
                      checked={missed.has(i.key)}
                      disabled={!canEdit}
                      onChange={() => toggle(i.key)}
                    />
                  </td>
                ))}
                <td className={`px-1 py-1.5 text-center ${check.absent ? "bg-danger-soft" : ""}`}>
                  <input
                    type="checkbox"
                    className="size-4 cursor-pointer accent-[var(--color-danger)] disabled:cursor-default"
                    aria-label={`${s.name} 결석`}
                    checked={check.absent}
                    disabled={!canEdit}
                    onChange={() => onChange(s.id, { ...check, absent: !check.absent })}
                  />
                </td>
                <td className="px-1 py-1 text-center">
                  {canEdit ? (
                    <SearchableSelect
                      options={CARD_OPTIONS}
                      value={check.card ?? ""}
                      onValueChange={(v) => onChange(s.id, { ...check, card: (v || null) as BeforeClassCard | null })}
                      ariaLabel={`${s.name} 카드`}
                      compact
                      portal
                      className="w-28"
                    />
                  ) : (
                    <CardBadge card={check.card} />
                  )}
                </td>
                <td className="px-1 py-1.5 text-center tabular-nums">{check.absent ? "결석" : percentLabel(completionRate(check))}</td>
                <td className="px-1 py-1.5 text-center"><VerdictBadge absent={check.absent} supplement={needsSupplement(check)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
