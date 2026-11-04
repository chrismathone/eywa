"use client";

import { useState, type ReactNode } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
  BEFORE_CLASS_CARDS, BEFORE_CLASS_ITEMS, EXCUSE_NOTE_MAX, EXCUSE_REASONS, autoCard, completionRate, effectiveCard, excuseReasonOf,
  excuseText, isExcused, needsSupplement, normalizeMissed, percentLabel,
  type BeforeClassCard, type BeforeClassCheck, type ExcuseReason,
} from "../items";
import type { RosterStudent } from "../types";
import { CardBadge, VerdictBadge } from "./badges";

const EMPTY: BeforeClassCheck = { missed: [], absent: false, card: null };
const CARD_CHOICES = BEFORE_CLASS_CARDS.map((c) => ({ value: c.key, label: c.label }));
/**
 * 카드 칸 = 지금 카드 그대로(완료율 자동 카드 · "자동" 문구 없음, 원장 2026-11-02 *"체크될때마다 그냥 온체인지로 바뀌는건데 자동이라는 멘트는 없애"*).
 * 자동 카드와 같은 카드를 고르면 저장하지 않는다(null) — 계속 완료율을 따라간다. 다른 카드를 고르면 그 카드가 이긴다.
 * 자동 카드가 없을 때(결석)만 "선택 안 함"을 둔다.
 */
const cardOptions = (check: BeforeClassCheck) => (autoCard(check) ? CARD_CHOICES : [{ value: "", label: "선택 안 함" }, ...CARD_CHOICES]);

/**
 * 하루 체크 표 — 학생 줄 × 미흡 10항목(체크 = 미흡, 시트 그대로) + 결석 + 카드 + 완료율·판정.
 * 읽기 권한이면 칸이 잠긴다(보기 전용). 저장은 부모가 칸마다 즉시 한다.
 * 체크 칸은 **칸 전체가 누르는 자리**다(원장 2026-10-28) — 상자 대신 칸을 채운 label이 입력을 감싼다.
 * 결석인 학생은 줄 전체를 노랗게 칠한다(원장 2026-10-28). 이름 칸은 sticky라 같은 색을 따로 준다(불투명 색, [[#74]]).
 * **체크 제외**(원장 2026-11-02) — 지난 수업 결석이면 자동으로 켜지고(저장 없이 판정), '제외' 칸으로 직접 켜고 끈다.
 * 제외인 줄은 미흡 10칸 자리가 **사유 칸**(사유 셋 · 기타는 글)으로 바뀌고 카드는 '카드 X'로 고정된다.
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
      {/* 체크 칸(미흡 10 + 결석)은 폭을 똑같이 나눈다(원장 2026-10-28 *"칸마다 간격 동일하게"*) — 고정 표 + 나머지 열만 폭을 정한다.
          자동 폭이면 머리 글자 길이('본교재 오답' vs '과제')만큼 칸이 들쭉날쭉해진다([[#97]]). */}
      <table className="w-full min-w-[1100px] table-fixed border-collapse text-sm [&_tr>*:not(:first-child)]:border-l [&_tr>*:not(:first-child)]:border-line-faint">
        <colgroup>
          <col className="w-44" />
          {BEFORE_CLASS_ITEMS.map((i) => <col key={i.key} />)}
          <col />
          <col />
          <col className="w-32" />
          <col className="w-18" />
          <col className="w-24" />
        </colgroup>
        <thead>
          <tr className="border-line border-b">
            <th className="bg-background sticky left-0 z-10 px-2 py-2 text-left font-semibold">이름</th>
            {BEFORE_CLASS_ITEMS.map((i) => (
              <th key={i.key} className="px-1 py-2 text-center text-xs font-semibold break-keep" title={i.label}>{i.short}</th>
            ))}
            <th className="px-1 py-2 text-center text-xs font-semibold">결석</th>
            <th className="px-1 py-2 text-center text-xs font-semibold" title="지난 수업에 결석했던 학생은 자동으로 제외됩니다">제외</th>
            <th className="px-1 py-2 text-center text-xs font-semibold">카드</th>
            <th className="px-1 py-2 text-center text-xs font-semibold">완료율</th>
            <th className="px-1 py-2 text-center text-xs font-semibold">판정</th>
          </tr>
        </thead>
        <tbody>
          {students.map((s) => {
            const check = checks[s.id] ?? EMPTY;
            const excused = isExcused(check);
            // 자동 판정과 같은 값이면 저장하지 않는다(null = 자동) — 끄면 사유도 지운다.
            const setExcused = (on: boolean) => onChange(s.id, {
              ...check,
              excused: on === !!check.autoExcused ? null : on,
              ...(on ? {} : { excuseReason: null, excuseNote: null }),
            });
            const missed = new Set<string>(normalizeMissed(check.missed));
            const toggle = (key: string) => {
              const next = new Set(missed);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              onChange(s.id, { ...check, missed: [...next] });
            };
            return (
              <tr key={s.id} className={`border-line-faint border-b ${check.absent ? "bg-report-accent-soft" : ""}`}>
                <td className={`sticky left-0 z-10 px-2 py-1.5 ${check.absent ? "bg-report-accent-soft" : "bg-background"}`}>
                  <div className="flex items-baseline gap-1.5 overflow-hidden whitespace-nowrap">
                    <span className="font-medium">{s.name}</span>
                    <span className="text-text-dim text-xs">{s.schoolGrade}</span>
                    {s.onHold ? <span className="text-amber text-xs">휴원</span> : null}
                  </div>
                </td>
                {excused ? (
                  <td colSpan={BEFORE_CLASS_ITEMS.length} className="bg-bg-soft px-2 py-1">
                    <ExcuseCell check={check} canEdit={canEdit} name={s.name} onChange={(next) => onChange(s.id, next)} />
                  </td>
                ) : BEFORE_CLASS_ITEMS.map((i) => (
                  <td key={i.key} className={`p-0 text-center ${missed.has(i.key) ? "bg-rose-soft" : ""}`}>
                    <CellBox canEdit={canEdit}>
                      <input
                        type="checkbox"
                        className="size-4 cursor-pointer accent-[var(--color-rose)] disabled:cursor-default"
                        aria-label={`${s.name} ${i.label}`}
                        checked={missed.has(i.key)}
                        disabled={!canEdit}
                        onChange={() => toggle(i.key)}
                      />
                    </CellBox>
                  </td>
                ))}
                <td className="p-0 text-center">
                  <CellBox canEdit={canEdit}>
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-[var(--color-amber)] disabled:cursor-default"
                      aria-label={`${s.name} 결석`}
                      checked={check.absent}
                      disabled={!canEdit}
                      onChange={() => onChange(s.id, { ...check, absent: !check.absent })}
                    />
                  </CellBox>
                </td>
                <td className="p-0 text-center">
                  <CellBox canEdit={canEdit && !check.absent}>
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer disabled:cursor-default"
                      aria-label={`${s.name} 체크 제외`}
                      checked={excused}
                      disabled={!canEdit || check.absent}
                      onChange={() => setExcused(!excused)}
                    />
                  </CellBox>
                </td>
                <td className="px-2 py-1 text-center">
                  {canEdit && !excused ? (
                    <SearchableSelect
                      options={cardOptions(check)}
                      value={check.card ?? autoCard(check) ?? ""}
                      onValueChange={(v) => onChange(s.id, { ...check, card: (!v || v === autoCard(check) ? null : v) as BeforeClassCard | null })}
                      ariaLabel={`${s.name} 카드`}
                      compact
                      portal
                      className="w-full"
                      triggerClassName="border-line bg-card h-(--control-h) rounded-lg border px-2 text-sm"
                    />
                  ) : (
                    <CardBadge card={effectiveCard(check)} />
                  )}
                </td>
                <td className="px-1 py-1.5 text-center tabular-nums">{check.absent ? "결석" : excused ? "제외" : percentLabel(completionRate(check))}</td>
                <td className="px-1 py-1.5 text-center"><VerdictBadge absent={check.absent} excused={excused} supplement={needsSupplement(check)} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const REASON_OPTIONS = EXCUSE_REASONS.map((r) => ({ value: r.key, label: r.label }));

/**
 * 체크 제외 사유 칸 — 사유 셋 중 고르기, '기타'면 글 상자(칸을 떠날 때 저장 — 글자마다 저장하지 않는다).
 * 자동 제외는 '지난 수업 결석'이 미리 골라져 있다(저장 전에도 그렇게 보인다). 보기 전용이면 글로만.
 */
function ExcuseCell({ check, canEdit, name, onChange }: {
  check: BeforeClassCheck;
  canEdit: boolean;
  name: string;
  onChange: (next: BeforeClassCheck) => void;
}) {
  const reason = excuseReasonOf(check);
  const auto = check.excused == null && !!check.autoExcused;
  const [note, setNote] = useState(check.excuseNote ?? "");
  if (!canEdit) {
    return (
      <span className="text-sm">
        <span className="text-text-dim mr-1.5 text-xs">{auto ? "자동 제외" : "체크 제외"}</span>
        {excuseText(check) || "사유 없음"}
      </span>
    );
  }
  const commitNote = () => {
    const v = note.trim();
    if (v === (check.excuseNote ?? "").trim()) return;
    onChange({ ...check, excused: true, excuseReason: "other", excuseNote: v || null });
  };
  return (
    <div className="flex items-start gap-2">
      <span className="text-text-dim shrink-0 pt-1.5 text-xs whitespace-nowrap">{auto ? "자동 제외 · 사유" : "제외 사유"}</span>
      <SearchableSelect
        options={REASON_OPTIONS}
        value={reason ?? ""}
        placeholder="사유 고르기"
        onValueChange={(v) => {
          const next = (v || null) as ExcuseReason | null;
          onChange({ ...check, excused: true, excuseReason: next, excuseNote: next === "other" ? check.excuseNote ?? null : null });
        }}
        ariaLabel={`${name} 제외 사유`}
        compact
        portal
        className="w-44 shrink-0"
        triggerClassName="border-line bg-card h-(--control-h) rounded-lg border px-2 text-sm"
      />
      {reason === "other" ? (
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={commitNote}
          maxLength={EXCUSE_NOTE_MAX}
          rows={2}
          placeholder="사유를 적어 주세요"
          aria-label={`${name} 기타 사유`}
          className="border-line bg-card min-w-0 flex-1 resize-y rounded-lg border px-2 py-1 text-sm"
        />
      ) : null}
    </div>
  );
}

/** 칸을 꽉 채운 누르는 자리 — label이라 칸 어디를 눌러도 안의 체크 상자가 바뀐다([[#66]] 셀을 채우는 것은 칸 자신의 자식). */
function CellBox({ canEdit, children }: { canEdit: boolean; children: ReactNode }) {
  return (
    <label className={`flex min-h-9 w-full items-center justify-center px-1 ${canEdit ? "hover:bg-bg-soft cursor-pointer" : ""}`}>
      {children}
    </label>
  );
}
