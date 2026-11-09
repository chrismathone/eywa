"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { tipProps } from "@/components/hover-tip/tip";
import { TONE_SOFT } from "@/lib/design/semantic-color";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { publishRecordSaved } from "@/lib/realtime/record-channel";
import { carryOutValid, carrySurplus, MONEY_CARRY_NOTE_MAX, receivedCarry } from "@/features/billing/session-terms/money-carryover";
import { carryUnreflectable } from "@/features/billing/session-terms/carry-session-sync";
import { getMoneyCarryoverOptions, saveMoneyCarryover, type MoneyCarryOptions } from "@/features/billing/session-terms/server/money-carryover-actions";
import type { SessionTermRow } from "@/features/billing/session-terms/server/queries";
import { CELL_ACTION_BUTTON } from "./cell-action-button";
import { toast } from "sonner";

// 회차 확정 '실납 청구액' 칸의 **금액 이월** 표식·버튼·창(0278a, 원장 2026-09-21 "'이월' 기능 추가").
// 옆 금액은 부모가 `netAllocatedAmount`로 보인다(배분액 − 보낸 이월 + 받은 이월). 여기는 그 차이를 말한다.

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;
const monthKo = (period: string) => `${Number(period.slice(5, 7))}월`;
const pill = "cursor-help rounded-sm px-1.5 py-0.5 text-xs font-medium";

/** 보낸 이월·받은 이월 표식 — 유효하지 않은 이월은 숫자에 안 실린다는 사실을 함께 말한다. */
export function MoneyCarryTags({ r }: { r: SessionTermRow }) {
  const out = r.carryOut;
  const ins = r.carryIns ?? [];
  if (!out && ins.length === 0) return null;
  const received = receivedCarry(r);
  return (
    <>
      {out ? (carryOutValid(r, out.amount) ? (
        <span className={`${out.landing === "orphan" ? TONE_SOFT.caution : TONE_SOFT.info} ${pill}`} {...tipProps({ title: `${monthKo(out.toPeriod)}로 이월`, lines: [
          `확정액보다 더 받은 몫 중 ${won(out.amount)}을 ${monthKo(out.toPeriod)} ${out.toClassName ?? "받을 반"}으로 넘겼습니다.`,
          received > 0
            ? `옆의 실납은 배분액 ${won(r.allocatedAmount ?? 0)}에 받은 이월 ${won(received)}을 더하고 이 이월을 뺀 금액입니다(수납액 분배도 이 금액 기준).`
            : `옆의 실납은 배분액 ${won(r.allocatedAmount ?? 0)}에서 이월을 뺀 금액입니다(수납액 분배도 이 금액 기준).`,
          out.landing === "landed" ? `${monthKo(out.toPeriod)} 그 반 실납에 더해졌습니다.`
            : out.landing === "waiting" ? `${monthKo(out.toPeriod)} 그 반 수납 배분을 저장하면 더해집니다(아직 가는 중).`
            : out.landing === "orphan" ? `${monthKo(out.toPeriod)}에 그 반 줄이 없거나 전액 환불이라 어디에도 분배되지 않습니다 — 이월을 취소하거나 받을 반을 다시 고르세요(분배 저장이 막힙니다).`
            : null,
          out.note ? `메모: ${out.note}` : null,
        ] })}>{monthKo(out.toPeriod)} 이월 −{won(out.amount)}{out.landing === "orphan" ? " · 받을 반 없음" : ""}</span>
      ) : (
        <span className={`${TONE_SOFT.caution} ${pill}`} {...tipProps({ title: "이월 재확인 필요", lines: [
          `${won(out.amount)}을 ${monthKo(out.toPeriod)} ${out.toClassName ?? "받을 반"}으로 넘겨 두었는데, 지금은 확정액보다 더 받은 몫이 그만큼 없습니다(배분·확정·받은 이월이 바뀜).`,
          "이 이월은 실납·분배에 반영하지 않습니다. '이월'을 눌러 금액을 고치거나 취소하세요.",
        ] })}>이월 재확인</span>
      )) : null}
      {ins.map((c, i) => (
        <span key={i} className={`${c.valid && !c.orphan ? TONE_SOFT.info : TONE_SOFT.caution} ${pill}`} {...tipProps({ title: `${monthKo(c.fromPeriod)}에서 받은 이월`, lines: [
          `${monthKo(c.fromPeriod)} ${c.fromClassName ?? "반"}에서 넘어온 ${won(c.amount)}입니다.`,
          c.orphan && c.refunded ? "받을 반이 전액 환불이라 이월을 실을 수 없습니다 — 지난 달에서 이월을 취소하거나 받을 반을 다시 고르세요(분배 저장이 막힙니다)."
            : c.orphan ? "받을 반 줄이 이 달에 없어 여기 표시만 합니다 — 실납·분배에는 넣지 않습니다. 지난 달에서 이월을 취소하거나 받을 반을 다시 고르세요(분배 저장이 막힙니다)."
            : !c.valid ? "보낸 달의 배분·확정이 바뀌어 지금은 넘길 몫이 없습니다 — 실납·분배에 넣지 않습니다."
            : r.refundState === "full" || r.refundedAllocation ? "이 반은 전액 환불이라 이월을 싣지 않습니다."
            : r.allocatedAmount == null ? "이 반 수납 배분을 저장하면 실납에 더해집니다." : "옆의 실납에 더해져 있습니다(수납액 분배도 이 금액 기준).",
          c.note ? `메모: ${c.note}` : null,
        ] })}>{c.orphan ? (c.refunded ? "이월 받을 수 없음(환불)" : "이월 받을 반 없음") : `${monthKo(c.fromPeriod)} 이월 +${won(c.amount)}`}</span>
      ))}
    </>
  );
}

/** '이월' — 확정액보다 더 받은 몫이 있거나 이미 넘긴 이월이 있는 회차 행에만 선다. */
export function MoneyCarryButton({ r }: { r: SessionTermRow }) {
  const [data, setData] = useState<MoneyCarryOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // 확정 시수에 반영된 받은 이월도 넘길 수 있다(시수를 함께 낮춤 — 2026-11-09) — 더 받은 몫이 0이어도 그 몫이 있으면 선다.
  if (r.termState !== "term" || (carrySurplus(r) <= 0 && carryUnreflectable(r) <= 0 && !r.carryOut)) return null;
  return (
    <>
      <button type="button" disabled={pending} aria-busy={pending} className={CELL_ACTION_BUTTON} onClick={() => start(async () => {
        setError(null);
        try {
          const result = await getMoneyCarryoverOptions(r.id);
          if (result.error) setError(result.error);
          else if (result.data) setData(result.data);
        } catch {
          setError("이월 정보를 불러오지 못했습니다");
        }
      })}>이월</button>
      {error ? <p role="alert" className="text-danger basis-full text-xs whitespace-normal">{error}</p> : null}
      {data ? <MoneyCarryDialog data={data} onClose={() => setData(null)} /> : null}
    </>
  );
}

function MoneyCarryDialog({ data, onClose }: { data: MoneyCarryOptions; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const sameClass = data.classes.find((c) => c.className === data.className)?.classId;
  // 기본값은 더 받은 몫까지만 — 확정 시수를 낮추는 금액은 사람이 직접 올려 적는다(실수로 시수가 낮아지지 않게).
  const [amount, setAmount] = useState(String(data.current?.amount ?? (data.surplus > 0 ? data.surplus : "")));
  const [belowOk, setBelowOk] = useState(false);
  const [classId, setClassId] = useState(data.current?.toClassId && data.classes.some((c) => c.classId === data.current?.toClassId) ? data.current.toClassId : sameClass ?? data.classes[0]?.classId ?? "");
  const [note, setNote] = useState(data.current?.note ?? "");
  useEffect(() => { ref.current?.showModal(); }, []);
  const value = Number(amount);
  // 더 받은 몫을 넘는 금액 = 확정 시수를 낮춰 넘긴다(0.5시수 단위 · 서버 `planCarryUnreflect`가 다시 본다) — 낮출 시수를 미리 보인다.
  const max = data.surplus + data.unreflectable;
  const lowerBy = value > data.surplus && data.unitPrice ? (value - data.surplus) / data.unitPrice : 0;
  const lowerStepOk = lowerBy === 0 || Math.abs(lowerBy * 2 - Math.round(lowerBy * 2)) < 1e-8;
  const sessionsAfter = lowerBy > 0 && lowerStepOk && data.confirmedSessions != null ? Math.round((data.confirmedSessions - lowerBy) * 10) / 10 : null;
  // 낮춘 시수가 출석부 실제 시수보다 작거나 실제 시수를 모르면 확인을 받는다(이미 한 수업의 수업료가 다음 달로 간다 — 서버도 다시 본다).
  const needsBelowOk = sessionsAfter != null && (data.actualSessions == null || sessionsAfter < data.actualSessions);
  const valid = Number.isSafeInteger(value) && value > 0 && value <= max && lowerStepOk && !!classId && (!needsBelowOk || belowOk);

  function run(nextAmount: number) {
    setError(null);
    start(async () => {
      try {
        const result = await saveMoneyCarryover({ termId: data.termId, amount: nextAmount, classId: nextAmount > 0 ? classId : null, note: nextAmount > 0 ? note : null, expectedAllocation: data.allocatedAmount, ...(sessionsAfter != null && nextAmount === value ? { expectedSessions: sessionsAfter, confirmBelowActual: needsBelowOk && belowOk } : {}) });
        if (result.error) { setError(result.error); return; }
        // 받는 달 확정 시수를 이월만큼 자동으로 맞췄으면 알린다(원장 2026-10-07) — 말없이 바뀌면 "누가 고쳤지"가 된다.
        if (result.notice) toast.success(result.notice);
        if (result.warning) alert(result.warning);
        publishRecordSaved("billing:session-terms");
        router.refresh();
        onClose();
      } catch {
        setError("저장하지 못했습니다. 다시 시도해 주세요");
      }
    });
  }

  return (
    <dialog ref={ref} data-no-drag-scroll aria-label={`${data.studentName} 금액 이월`} onCancel={(e) => { e.preventDefault(); if (!pending) onClose(); }}
      className="bg-card text-foreground fixed inset-0 m-auto w-[min(520px,95vw)] rounded-xl border border-line p-5 whitespace-normal shadow-xl backdrop:bg-black/40">
      <header className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold">{data.studentName} · 금액 이월</h2>
          <p className="text-text-dim mt-1 text-sm">{monthKo(data.period)} {data.className ?? "반"}에서 확정액보다 더 받은 몫을 {monthKo(data.nextPeriod)} 반으로 넘깁니다.</p>
        </div>
        <button type="button" disabled={pending} onClick={onClose} className="shrink-0 text-sm whitespace-nowrap">닫기</button>
      </header>
      {/* 받은 이월이 있으면 그것도 더 받은 몫에 든다(연쇄 이월 — `carrySurplus`). 숫자 셋이 안 맞아 보이지 않게 칸을 보인다. */}
      <dl className={`bg-bg-soft mb-4 grid gap-2 rounded-lg p-3 text-sm ${data.carriedIn > 0 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
        <div><dt className="text-text-dim text-xs">배분액</dt><dd className="num font-bold">{data.allocatedAmount == null ? "—" : won(data.allocatedAmount)}</dd></div>
        {data.carriedIn > 0 ? <div><dt className="text-text-dim text-xs">받은 이월</dt><dd className="num font-bold">+{won(data.carriedIn)}</dd></div> : null}
        <div><dt className="text-text-dim text-xs">확정액</dt><dd className="num font-bold">{data.amount == null ? "—" : won(data.amount)}</dd></div>
        <div><dt className="text-text-dim text-xs">{data.unreflectable > 0 ? "더 받은 몫" : "더 받은 몫(최대)"}</dt><dd className="num font-bold">{won(data.surplus)}</dd></div>
      </dl>
      {data.degraded ? <p role="status" className="text-amber mb-3 text-sm">앞 달 이월 정보를 불러오지 못해 지금은 새로 넘길 수 없습니다. 넘겨 둔 이월은 취소할 수 있습니다.</p>
        : max <= 0 ? <p role="status" className="text-amber mb-3 text-sm">지금은 확정액보다 더 받은 몫이 없어 새로 넘길 수 없습니다. 넘겨 둔 이월은 취소할 수 있습니다.</p> : null}
      {!data.degraded && data.unreflectable > 0 && data.unitPrice ? (
        <p className="text-text-dim mb-3 text-sm">
          확정 시수에 반영된 받은 이월 {won(data.unreflectable)}도 넘길 수 있습니다(최대 {won(max)}) — 더 받은 몫({won(data.surplus)})을 넘는 금액은 확정 시수를 그만큼 낮추고 넘깁니다(0.5시수 = {won(data.unitPrice / 2)} 단위).
          {" "}지금 확정 {data.confirmedSessions ?? "—"}시수 · 출석부 {data.actualSessions ?? "확인 못 함"}{data.actualSessions != null ? "시수" : ""}.
        </p>
      ) : null}
      {data.classes.length === 0 ? <p role="status" className="text-amber mb-3 text-sm">{monthKo(data.nextPeriod)} 출석부에 이 학생의 반이 아직 없습니다. 다음 달 반이 정해지면 넘길 수 있습니다.</p> : null}
      <div className="grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="font-medium">넘길 금액</span>
          <input type="number" inputMode="numeric" min={1} max={max} step={1} value={amount} disabled={pending || max <= 0}
            onChange={(e) => { setAmount(e.target.value); setBelowOk(false); }} aria-label="넘길 금액" className="border-line num rounded-md border bg-card px-2 py-1.5" />
          {sessionsAfter != null ? (
            <span role="status" className="text-amber text-xs">확정 시수를 {data.confirmedSessions}에서 {sessionsAfter}시수로 낮추고 넘깁니다(그중 시수에 반영됐던 받은 이월 {won(value - data.surplus)}).</span>
          ) : !lowerStepOk ? (
            <span role="alert" className="text-danger text-xs">더 받은 몫({won(data.surplus)})을 넘는 금액은 0.5시수({won((data.unitPrice ?? 0) / 2)}) 단위로 맞춰 주세요.</span>
          ) : null}
        </label>
        {/* 확인란은 금액 label 밖에(중첩 label 금지). */}
        {needsBelowOk ? (
          <label className="text-danger flex items-start gap-2 text-xs">
            <input type="checkbox" checked={belowOk} disabled={pending} onChange={(e) => setBelowOk(e.target.checked)} className="mt-0.5" />
            <span>
              {data.actualSessions == null
                ? `출석부 시수를 확인하지 못했습니다 — 확인하고 그래도 ${sessionsAfter}시수로 낮춥니다`
                : `출석부 시수(${data.actualSessions})보다 낮아집니다 — 이미 한 수업의 수업료가 다음 달로 가고 이 달 강사 실급여 상한이 줄 수 있습니다. 확인하고 그래도 ${sessionsAfter}시수로 낮춥니다`}
            </span>
          </label>
        ) : null}
        <div className="grid gap-1 text-sm">
          <span className="font-medium">받을 반({monthKo(data.nextPeriod)})</span>
          {data.classes.length === 0 ? <span className="text-text-dim text-sm">다음 달 반 없음</span> : (
            <SearchableSelect options={data.classes.map((c) => ({ value: c.classId, label: c.className }))} value={classId}
              onValueChange={(v) => { if (!pending) setClassId(v); }} ariaLabel="받을 반" placeholder="받을 반 고르기" />
          )}
        </div>
        <label className="grid gap-1 text-sm">
          <span className="font-medium">메모(선택)</span>
          <input value={note} maxLength={MONEY_CARRY_NOTE_MAX} onChange={(e) => setNote(e.target.value)} disabled={pending} aria-label="이월 메모" className="border-line rounded-md border bg-card px-2 py-1.5" />
        </label>
      </div>
      <p className="text-text-dim mt-3 text-xs">{monthKo(data.period)} 실납은 넘긴 만큼 줄고, {monthKo(data.nextPeriod)} 받을 반 실납에 더해집니다. 수납액 분배도 이 금액을 기준으로 합니다. 수납 배분 원본은 그대로입니다.</p>
      <footer className="mt-4 flex items-center justify-between gap-3">
        <div className="text-sm">{error ? <p role="alert" className="text-danger">{error}</p> : null}</div>
        <div className="flex shrink-0 gap-2">
          {data.current ? <button type="button" disabled={pending} onClick={() => { if (confirm(`${won(data.current!.amount)} 이월을 취소할까요?`)) run(0); }} className="border-line rounded-md border px-3 py-2 text-sm">이월 취소</button> : null}
          <button type="button" disabled={pending || !valid} onClick={() => run(value)} className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-bold disabled:opacity-40">{pending ? "저장 중…" : data.current ? "이월 고치기" : "이월 저장"}</button>
        </div>
      </footer>
    </dialog>
  );
}
