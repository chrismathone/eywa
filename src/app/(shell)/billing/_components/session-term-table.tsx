"use client";
import { Button } from "@/components/ui/button";

import { Fragment, useActionState, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "@/components/icons/aywa-icon-compat";
import {
  confirmSessionTerm,
  unconfirmSessionTerm,
  confirmClassTerms,
  refreshPlannedTerms,
  type SessionTermActionState,
} from "@/features/billing/session-terms/server/actions";
import type { SessionTermRow } from "@/features/billing/session-terms/server/queries";
import { canMaterializeTerm, isVirtualTermId, monthRosterKey, NO_LESSON_LABEL, TERM_STATE_LABEL, type TermRowState } from "@/features/billing/session-terms/month-roster";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { validSessionQuantity, sessionPricingAmount, type SessionPrice } from "@/features/billing/session-pricing";
import { tipProps } from "@/components/hover-tip/tip";
import { TONE_SOFT, TONE_TEXT } from "@/lib/design/semantic-color";
import { netAllocatedAmount } from "@/features/billing/session-terms/money-carryover";
import { MoneyCarryButton, MoneyCarryTags } from "./money-carry-cell";
import { useSessionTermsState } from "./session-terms-state";
import { ReceiptAllocationButton } from "./receipt-allocation-dialog";
import { MonthlySessionEditor } from "./monthly-session-editor";
import { TermNoteCell } from "./term-note-cell";
import { SelectedConfirmButton, scaledConfirmText, type TermDraft } from "./selected-confirm-button";
import { ClassUnconfirmButton } from "./class-unconfirm-button";
import { TermDeleteButton } from "./term-delete-button";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { formatTermDays } from "@/features/billing/session-terms/term-days";
import { isUntouchedScaledSessions } from "@/features/billing/session-terms/last-month-suggestion";
import { WindowLink } from "@/components/workspace/window-link";
import { writeLockedPlaceholder } from "@/lib/write-lock";

import type { SeatShareSummary } from "@/features/attendance/server/seat-share-summary";
import { SeatShareRow } from "./seat-share-row";

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;

type Row = SessionTermRow & { subjectLabel: string };
type Catalog = SessionPrice[];
export type ClassGroup = { classId: string; className: string; subjectLabel: string; students: Row[] };

/**
 * 확정할 수 있는 줄 — 회차 행이 있거나(`term`), 청구서가 있어 확정하는 순간 행을 만들 수 있는 줄(`missing`).
 * 청구서가 없거나 취소된 줄(`no_invoice`·`void_invoice`)은 잠긴다(같은 판정을 `session-terms-face.tsx`가 카운트에 쓴다).
 */
const confirmableRow = (r: Pick<SessionTermRow, "termState">) => r.termState === "term" || canMaterializeTerm(r.termState);

/**
 * 반 일괄('이 반 일괄 확정'·'월 금액 일괄 확정')의 대상 — 확정할 수 있고 **예정이 있는** 줄. 서버(`confirmClassTerms`)도 같은 규칙으로
 * 예정이 없는 줄(수강행 없는 보강 방문·월초에 끝난 수강 = 예정 0)을 빼고 `skippedUnplanned`로 센다 — 그 줄은 실제 시수를 보고 개별로 확정한다.
 */
const batchEligible = (r: Pick<SessionTermRow, "termState" | "plannedSessions">) => confirmableRow(r) && (r.plannedSessions ?? 0) > 0;

/** 계획 갱신 — 확정값은 보존하고 계획 N만 재산출(서버 액션이 보장). */
export function RefreshPlanButton({ period }: { period: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    // 회차 확정 면의 Primary(창당 하나, 지시서 §10) — 옛 회색 칩 모양에서 공용 Button 기본형으로(치수는 control-scale).
    <Button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await refreshPlannedTerms(period);
          if (res?.error) alert(res.error);
          else router.refresh();
        })
      }
      title="시간표·수강 기간·공휴일 기준으로 반별 계획 회차를 다시 계산합니다 (확정된 값은 유지)"
    >
      {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      계획 갱신
    </Button>
  );
}

/** 반 머리 줄 둘째 줄의 문구 — `notice` = 안내(무채색) · `selection` = 선택 일괄 확정 결과(붉은색). */
type BandNote = { notice: string | null; selection: string | null };

/** 체크한 미확정 학생 — '선택 일괄 확정'의 대상(원장 2026-09-17). `onAwait` = 실 행으로 바뀔 가상 줄을 새 데이터가 올 때까지 잠근다. */
type Selection = { rows: Row[]; draftOf: (row: SessionTermRow) => TermDraft; onConfirmed: (ids: string[]) => void; onAwait: (ids: string[]) => void };

/** 회차 없이 단가만 입력하면 미확정 학생의 입력칸만 채운다. */
/** `visibleOnly` = 필터(보기 필터의 미확정·미배분 · 검색)로 이 반의 일부만 보이는 중 — 반 일괄 확정도 보이는 학생에게만 보낸다. */
/** `onAwait` = 반 일괄이 가상 줄을 실 행으로 바꿨을 때 그 줄들을 새 데이터가 올 때까지 잠근다(부모가 새 groups에서 푼다). */
/**
 * `onBandNote` = 안내·선택 확정 문구는 **반 머리 줄(부모)**이 들고 그린다 — 반 일괄이 끝나 이 폼이 '전체 확정 해제'로 바뀌어도
 * ("예정이 없는 1명은 빠졌습니다") 문구가 함께 사라지지 않게(재리뷰 2026-09-18). 오류(`err`)는 폼이 남는 경우라 여기 둔다.
 */
function ClassBatch({ period, group, listId, onPrice, visibleOnly, selection, onAwait, onBandNote }: { period: string; group: ClassGroup; listId: string; onPrice: (price: string) => void; visibleOnly?: boolean; selection?: Selection; onAwait: (ids: string[]) => void; onBandNote: (patch: Partial<BandNote>) => void }) {
  const monthlyPrice = group.students[0]?.monthlyPrice ?? null;
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const { apply } = useSessionTermsState();
  const router = useRouter();
  const [sessionsInput, setSessionsInput] = useState("");
  const setNotice = (notice: string | null) => onBandNote({ notice });

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const priceRaw = String(fd.get("unitPrice") ?? "").replace(/[,\s]/g, "");
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) {
      setErr("회당 단가를 입력하세요");
      return;
    }
    const sRaw = String(fd.get("sessions") ?? "").trim();
    const sessions = sRaw === "" ? null : Number(sRaw);
    if (sessions != null && !validSessionQuantity(sessions)) {
      setErr("시수는 0~99, 소수 한 자리까지");
      return;
    }
    setErr(null);
    if (monthlyPrice === null && sessions === null) {
      if (!group.students.some((row) => row.confirmedSessions === null && confirmableRow(row))) {
        setErr("단가를 입력할 미확정 학생이 없습니다");
        return;
      }
      onPrice(String(price));
      setNotice(selection ? "단가 입력 완료 · 예상금액 확인 후 개별 확정하거나 학생을 골라 선택 일괄 확정하세요" : "단가 입력 완료 · 예상금액 확인 후 개별 확정하세요");
      return;
    }
    setNotice(null);
    start(async () => {
      try {
        const res = visibleOnly ? await confirmClassTerms(period, group.classId, price, sessions, group.students.map((r) => r.id)) : await confirmClassTerms(period, group.classId, price, sessions);
        if (res.error) setErr(res.error);
        else if (res.terms) {
          selection?.onConfirmed(res.terms.map((t) => t.id));
          apply(res.terms);
        }
        // 예정이 없는 줄(수강행 없는 보강 방문·월초 종료)은 반 일괄에서 빠진다(서버) — 빠진 사실을 말한다(조용히 미확정으로 남기지 않는다).
        if (!res.error && res.skippedUnplanned) setNotice(`예정이 없는 ${res.skippedUnplanned}명(보강 방문 등)은 반 일괄에서 빠졌습니다 — 실제 시수를 보고 개별로 확정하세요`);
        // 가상 줄이 실 행으로 바뀌었다(`materialized` — 다른 창이 먼저 만든 행까지 센다) — 응답의 실 id는 화면의 가상 행에 안 붙으므로
        // 새로 읽어 갈아끼운다. 그동안 그 가상 줄은 잠근다(안 잠그면 '확정' 버튼이 그대로 보여 한 번 더 누른다).
        // 🔴 가상 줄이 섞였다는 것만으로는 새로 읽지 않는다 — 예정 없는 줄은 반 일괄 대상이 아니라 그대로 가상 줄이다.
        const materialized = res.materialized ?? 0;
        if (materialized > 0) onAwait(group.students.filter((s) => isVirtualTermId(s.id) && batchEligible(s)).map((s) => s.id));
        if (materialized > 0 || (res.created ?? 0) > 0) router.refresh();
      } catch { setErr("확정하지 못했습니다. 다시 시도해 주세요"); }
    });
  }

  return (
    // 알림 문구는 둘째 줄 — 버튼 줄 옆에 붙이면 보이는 오른쪽 끝에 고정된 이 영역이 넓어져 반 정보를 덮는다(적대적 리뷰 2026-09-17).
    <div className="flex flex-col items-end gap-1">
      <form onSubmit={submit} className="flex items-center gap-1.5">
        {monthlyPrice === null ? (
          <>
            <input
              name="sessions"
              type="number"
              step="any"
              min={0}
              max={99}
              disabled={pending}
              placeholder="시수"
              value={sessionsInput}
              onChange={(e) => { setSessionsInput(e.target.value); setNotice(null); }}
              aria-label={`${group.className} 반 회차`}
              title="비우면 단가만 입력하고 미확정 상태로 유지"
              className="border-input bg-background num w-14 rounded-md border px-2 py-1 text-center text-xs"
            />
            <span className="text-text-faint text-xs">시수 ×</span>
            <input
              name="unitPrice"
              type="text"
              inputMode="numeric"
              list={listId}
              disabled={pending}
              placeholder="단가"
              aria-label={`${group.className} 회당 단가`}
              className="border-input bg-background num w-24 rounded-md border px-2 py-1 text-right text-xs"
            />
          </>
        ) : (
          <>
            <input type="hidden" name="unitPrice" value={monthlyPrice} />
            <input name="sessions" type="number" min={0} max={99} step="0.1" disabled={pending} value={sessionsInput} onChange={(e) => setSessionsInput(e.target.value)} placeholder="계획" aria-label={`${group.className} 반 회차`} title="비우면 학생별 최신 계획 시수로 확정하며 월 금액은 유지합니다" className="border-input bg-background num w-14 rounded-md border px-2 py-1 text-center text-xs" />
            <span className="text-text-faint text-xs">시수 ·</span>
            <span className="text-primary text-sm font-bold">EiE 월 {won(monthlyPrice)}</span>
          </>
        )}
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : null}{monthlyPrice !== null ? "월 금액 일괄 확정" : sessionsInput.trim() === "" ? "단가 일괄 입력" : "이 반 일괄 확정"}
        </button>
        {/* '선택 일괄 확정' — 이 버튼의 오른쪽(원장 2026-09-17). */}
        {selection ? (
          <SelectedConfirmButton period={period} classId={group.classId} rows={selection.rows} draftOf={selection.draftOf} onConfirmed={selection.onConfirmed} onAwait={selection.onAwait} onMessage={(selection) => onBandNote({ selection })} />
        ) : null}
      </form>
      {err ? (
        <p className="max-w-[36rem] text-right text-xs whitespace-normal">
          <span className="text-danger block">{err}</span>
        </p>
      ) : null}
    </div>
  );
}

/** 🔴 배경색은 여기 두지 않는다 — 제안 칸이 `bg-blue-soft`·`bg-amber-soft`를 덧붙이면 승자를 CSS 생성 순서가 정한다([[#116]]). */
const NUM_INPUT = "border-input num rounded-md border px-2 py-1 text-xs";

/**
 * 일수 기준 확정값 — 숫자를 붉게 칠하고 사유는 마우스 오버 카드로(원장 2026-09-16 *"일수 기준, 재확정 필요의 경우 색상을
 * 붉은색으로 바꾸고 마우스 오버시 툴팁으로"*). 칸 안에 문장을 두 줄로 세우면 행이 두 배로 부푼다.
 */
const DAYS_BASIS_TIP = tipProps({
  title: "일수 기준 확정",
  lines: ["출석 일수로 확정한 값입니다(시수 기준 도입 전).", "해제한 뒤 시수를 확인해 다시 확정하세요."],
});

/**
 * 배분 재확인 — 이 학생의 수납 배분이 있는데 이 반 몫이 빠져 있다(`allocationStale`). 꼬리표('청구액 배분'·'이름 매칭 참고')
 * 자리에 앰버로 서고 사유는 마우스 오버 카드로 — 옛 모양은 셋째 줄이었다.
 */
const staleTip = (hasReferenceAmount: boolean, extra: readonly string[] = []) =>
  tipProps({
    title: "배분 재확인 필요",
    lines: [
      "이 학생의 수납 배분에서 이 반 몫이 빠져 있습니다.",
      // 금액이 `—`인 행엔 이 문장을 싣지 않는다(없는 금액을 가리키게 된다 — 재리뷰 2026-09-16).
      hasReferenceAmount ? "옆의 금액은 배분액이 아니라 이름 매칭 참고값입니다." : null,
      "‘배분’을 눌러 다시 배분하세요.",
      ...extra,
    ],
  });
const ALLOCATION_STALE_TIP = staleTip(true);
const ALLOCATION_STALE_TIP_NO_AMOUNT = staleTip(false);

/**
 * 청구서 중복 — 같은 학생·반의 회차 행이 이 달 살아 있는 청구서 여러 장에 있다(`duplicateInvoice`). 출석부는 1줄인데 여기선 청구서마다
 * 1줄이라 줄 수 차이를 표식으로 밝힌다(감추지 않는다 — 돈이 걸려 있다).
 */
const DUPLICATE_INVOICE_LABEL = "청구서 중복";
const DUPLICATE_INVOICE_LINES = [
  "이 학생의 이 반이 이번 달 살아 있는 청구서 2장 이상에 있습니다.",
  "청구서마다 한 줄이라 출석부(한 줄)와 줄 수가 다릅니다 — 중복 청구서인지 확인하세요.",
] as const;

/**
 * 줄 상태 표식(원장 2026-09-18 "출석부 행 개수 = 회차 확정 행 개수") — 문구는 전부 `TERM_STATE_LABEL`·`NO_LESSON_LABEL`에서 읽고
 * (raw 코드 `missing` 등을 DOM에 내보내지 않는다), 색은 의미색 캐논(caution=손댈 것, inert=해당 없음). 사유는 마우스 오버 카드.
 */
const stateTip = (state: Exclude<TermRowState, "term">) => tipProps({ title: TERM_STATE_LABEL[state].label, lines: [TERM_STATE_LABEL[state].tip] });
/** 수강행이 없는 보강 방문 — 예정 시수는 없고 그 달 찍힌 시수만 있다(칸엔 `실 N`만, 뜻은 카드로). */
const recordedOnlyTip = (units: number) =>
  tipProps({
    title: "실제 시수",
    lines: [`이번 달 출석부에 찍힌 시수 ${units}시수`, "수강행이 없는 보강 방문 — 예정 시수는 없습니다.", "확정 시수는 이 값을 참고해 적으세요(반 일괄에선 빠집니다)."],
  });
/** 보강 예약만 있고 아직 수업 기록이 없는 줄. */
const RESERVED_ONLY_TIP = tipProps({
  title: "보강 예약",
  lines: ["그 달 이 반에 보강 예약만 있고 아직 수업 기록이 없습니다.", "보강일 출결이 찍히면 실제 시수가 여기 섭니다."],
});
const NO_ROW_NOTE_TIP = tipProps({ title: "메모", lines: ["회차 행이 아직 없는 줄입니다 — 시수를 확정하거나 수납을 배분해 행이 생기면 메모를 적을 수 있습니다."] });

/**
 * 확정 ≠ 예정 — 확정 시수는 사람이 확정한 값이라 수강 기간·시간표가 바뀌어도 그대로다(N1). 예정(조회 때마다 새로 계산)과
 * 달라지면 확정 숫자를 앰버로 칠하고 사유는 마우스 오버 카드로(원장 2026-09-17 *"반스케줄 조정에 따라 같이 반영되나"* →
 * "다시 확정할 행이 보이게"). 🔴 표시만 한다 — 자동으로 고치지 않는다(차이가 곧 점검 신호, N2와 같은 결).
 * EiE 월 정액은 금액이 시수와 무관해 칠하지 않는다. 기록만 있는 줄(예정 null)도 칠하지 않는다.
 */
function planDiffers(r: Row): boolean {
  return (
    r.confirmedSessions !== null &&
    r.pricingMode !== "monthly" &&
    r.plannedSessions !== null &&
    // 휴원·반 비활성으로 예정이 줄었을 수 있는 행은 칠하지 않는다(시간 축이 없어 지난 달 확정을 0으로 고치게 유도한다).
    !r.planUncertain &&
    Math.abs(r.confirmedSessions - r.plannedSessions) > 1e-9
  );
}
const planDiffLine = (r: Row) => `예정 ${r.plannedSessions}시수 · 확정 ${r.confirmedSessions}시수`;
const planDiffTip = (r: Row) =>
  tipProps({ title: "예정과 다름", lines: [planDiffLine(r), "수강 기간·시간표가 바뀌었다면 해제한 뒤 다시 확정하세요."] });

/**
 * 오른쪽 끝 '기타'(확정·해제) 열 고정 — 표가 창보다 넓어도(최소 폭 > 수납 창 기본 1,160) 버튼이 늘 보이게(원장 2026-09-17).
 * 불투명 바탕(마우스 오버 색은 바탕색 위에 그림으로 겹친다 — 반투명 색으로 칠하면 밀린 칸 글자가 비친다, [[#74]]) + 위 행 구분선은 가상 요소로 — 접힌 테두리 표에서 sticky 칸은 셀 테두리를 안 끌고 간다([[#71]]).
 * 🔴 왼쪽 세로 구분선은 없다(원장 2026-09-17 *"해제 옆에 세로선은 왜 있지? 제거"*) — 되살리지 말 것.
 */
const STICKY_END = "sticky right-0 z-[1]";
const STICKY_END_ROW = `${STICKY_END} bg-card group-hover:bg-[linear-gradient(color-mix(in_oklab,var(--color-accent)_30%,transparent),color-mix(in_oklab,var(--color-accent)_30%,transparent))] after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-border`;

/**
 * 예정 시수 칸 — 숫자 / 실 N(기록만) / 예약(예약만) / —. '출석부에 없음'은 예정을 가리지 않게 실납 칸 꼬리표로 선다. 🔴 칸이 약 75px라 한 줄에 들어가는 짧은 표기만 세우고
 * (`whitespace-nowrap` 행이라 길면 옆 칸으로 흘러넘친다) 긴 설명은 마우스 오버 카드로.
 */
const PLANNED_NOTE = "text-text-dim cursor-help text-xs";
function PlannedCell({ r }: { r: Row }) {
  if (r.plannedSessions !== null) return <span className="text-text-dim">{r.plannedSessions}</span>;
  if (r.recordedUnits !== null && r.recordedUnits !== undefined) return <span className={PLANNED_NOTE} {...recordedOnlyTip(r.recordedUnits)}>실 {r.recordedUnits}</span>;
  if (r.rosterSources?.includes("reserved")) return <span className={PLANNED_NOTE} {...RESERVED_ONLY_TIP}>예약</span>;
  return <span className="text-text-dim">—</span>;
}

/**
 * 실납 칸의 꼬리표 **하나** — 배분 상태(재확인 필요·배분 완료·전액 환불)가 먼저 서고, 줄 상태(회차 없음·청구서 중복)는 그 꼬리표의 카드에
 * 접어 넣는다(둘을 나란히 세우면 한 줄이 넘친다 — 원장 2026-09-16 "한 행 = 한 줄"). 배분 꼬리표가 없을 때만 줄 상태 알약이 선다
 * (옛 모양은 '회차 없음'이 배분 표식을 가려, 배분을 저장한 뒤에도 '배분 완료'가 안 보였다).
 */
function ReceiptTag({ r }: { r: Row }) {
  const missing = r.termState === "missing";
  const extra: string[] = [
    ...(missing ? [TERM_STATE_LABEL.missing.tip] : []),
    ...(r.duplicateInvoice ? DUPLICATE_INVOICE_LINES : []),
    ...(r.noLesson ? [NO_LESSON_LABEL.tip] : []),
  ];
  // 옆 금액이 배분액이 아니라 이름 매칭 참고값이라는 사실 — '이름 매칭 참고' 글자 자리를 알약이 대신할 때 카드로 옮긴다.
  const referenceLine = r.classAmount !== null ? "옆의 금액은 배분액이 아니라 이름 매칭 참고값입니다." : null;
  if (r.allocationStale) {
    const tip = extra.length ? staleTip(r.classAmount !== null, extra) : r.classAmount !== null ? ALLOCATION_STALE_TIP : ALLOCATION_STALE_TIP_NO_AMOUNT;
    return <span className="text-amber cursor-help" {...tip}>배분 재확인 필요</span>;
  }
  if (r.allocatedAmount != null) {
    const label = r.refundState === "full" ? "전액 환불" : "배분 완료";
    return (
      <span className={`text-green bg-green-soft rounded-sm px-1.5 py-0.5 text-xs font-medium${extra.length ? " cursor-help" : ""}`} {...(extra.length ? tipProps({ title: label, lines: extra }) : {})}>
        {label}
      </span>
    );
  }
  const pill = "cursor-help rounded-sm px-1.5 py-0.5 text-xs font-medium";
  if (missing) {
    return (
      <span className={`${TONE_SOFT[TERM_STATE_LABEL.missing.tone]} ${pill}`} {...tipProps({ title: TERM_STATE_LABEL.missing.label, lines: [TERM_STATE_LABEL.missing.tip, referenceLine] })}>
        {TERM_STATE_LABEL.missing.label}
      </span>
    );
  }
  if (r.duplicateInvoice) {
    // '이름 매칭 참고' 자리를 대신한다 — 옆 금액이 참고값이라는 사실은 카드로 옮긴다.
    const lines = [...DUPLICATE_INVOICE_LINES, referenceLine];
    return <span className={`${TONE_SOFT.caution} ${pill}`} {...tipProps({ title: DUPLICATE_INVOICE_LABEL, lines })}>{DUPLICATE_INVOICE_LABEL}</span>;
  }
  // 회차 행은 있는데 이 달 출석부(세션 기간)엔 없는 줄 — 예정 칸은 계획 숫자를 그대로 보이고 사유는 여기(무채색 — 해당 없음 표식).
  if (r.noLesson) {
    return (
      <span className={`${TONE_SOFT.inert} ${pill}`} {...tipProps({ title: NO_LESSON_LABEL.label, lines: [NO_LESSON_LABEL.tip, referenceLine] })}>
        {NO_LESSON_LABEL.label}
      </span>
    );
  }
  return r.classAmount !== null ? <span>이름 매칭 참고</span> : null;
}

/**
 * 학생 1명 행 — 개인 보정(반 일괄과 다른 회차/단가). 확정 여부와 무관하게 **같은 11열** 구조로 렌더해
 * 헤더와 정렬을 맞춘다(colSpan 금지 — 미확정 입력칸이 헤더 밖으로 밀리던 정렬버그). 미확정 행의 회차·단가
 * 입력과 확정 버튼은 서로 다른 `<td>`에 있지만 `form` 속성으로 한 폼에 묶인다(HTML5 폼 연결).
 * 회차 행이 없는 줄(가상 id)은 상태로 갈린다 — `missing`은 확정·배분할 수 있고(저장하는 순간 행이 생긴다), 청구서가 없거나
 * 취소된 줄은 입력 대신 사유 라벨이 서고 체크·버튼·메모가 잠긴다(원장 2026-09-18).
 */
type Draft = TermDraft;
/**
 * `awaiting` = 이 가상 줄은 확정돼 실 행으로 바뀌는 중 — 새 데이터가 올 때까지 잠근다(응답의 실 id는 이 가상 행에 안 붙어 '확정' 버튼이
 * 그대로 보인다). 상태는 부모(`SessionTermGroups`)가 들고 새 groups가 오면 푼다 — 개별 확정·반 일괄·선택 일괄이 같은 자리를 쓴다.
 */
/** `selectable` = 이 반에 선택 일괄 확정 버튼이 서 있는가 — '전체 확정 해제' 상태엔 버튼이 없어 체크를 잠근다(남은 줄은 행의 '확정'으로). */
/**
 * `canWrite` = 수납관리 쓰기 권한(서버 액션과 같은 canWriteTenant billing) — 읽기 권한이면 선택 체크·확정/해제/삭제·배분·이월·
 * 메모 편집·월정액 시수 편집을 그리지 않고, 미확정 줄의 시수·단가 칸은 비활성으로 값만 보여 준다(원장 2026-11-05).
 */
function TermRow({ r, period, listId, draft, onDraft, selected, onSelect, awaiting, onAwait, selectable, canWrite }: { r: Row; period: string; listId: string; draft: Draft; onDraft: (draft: Draft) => void; selected: boolean; onSelect: (checked: boolean) => void; awaiting: boolean; onAwait: () => void; selectable: boolean; canWrite: boolean }) {
  const { apply } = useSessionTermsState();
  const router = useRouter();
  const [state, confirmAction, confirming] = useActionState<SessionTermActionState, FormData>(async (prev, data) => {
    try {
      const result = await confirmSessionTerm(prev, data);
      if (result?.terms) {
        // 확정된 행의 체크는 버린다 — 남겨 두면 나중에 해제될 때 옛 입력값과 함께 되살아난다(리뷰 2026-09-17).
        onSelect(false);
        apply(result.terms);
      }
      // 가상 줄(회차 행이 없던 학생)을 확정했다 — 응답의 실 id는 이 줄에 안 붙으므로 새로 읽어 실 행으로 갈아끼운다.
      if (result?.ok && isVirtualTermId(r.id)) {
        onAwait();
        router.refresh();
      }
      return result;
    } catch { return { error: "확정하지 못했습니다. 다시 시도해 주세요" }; }
  }, undefined);
  const [unState, unconfirmAction, unconfirming] = useActionState<SessionTermActionState, FormData>(async (prev, data) => {
    try {
      const result = await unconfirmSessionTerm(prev, data);
      if (result?.terms) {
        onDraft({ sessions: String(r.confirmedSessions ?? r.plannedSessions ?? ""), price: String(r.unitPrice ?? "") });
        // 확정 전에 걸어 둔 체크가 해제와 함께 되살아나지 않게(되살아나면 옛 입력값으로 한 번에 확정된다 — 리뷰 2026-09-17).
        onSelect(false);
        apply(result.terms);
      }
      return result;
    } catch { return { error: "해제하지 못했습니다. 다시 시도해 주세요" }; }
  }, undefined);
  const pending = confirming || unconfirming || awaiting;
  const confirmed = r.confirmedSessions !== null;
  const locked = !confirmableRow(r);
  const stateMeta = r.termState === "term" ? null : TERM_STATE_LABEL[r.termState];
  const monthly = confirmed ? r.pricingMode === "monthly" : r.monthlyPrice !== null;
  const err = confirmed ? unState?.error : state?.error;
  const fid = `stf-${r.id}`;
  // 칸이 지난 달 기준 제안 그대로일 때만 칠한다(사람이 고치거나 단가 일괄 입력으로 바뀌면 사라진다).
  // 시수 칸은 **주황**(예정과 다르게 채웠다 — 확정 행의 '확정 ≠ 예정' 주황과 같은 뜻), 단가 칸은 파랑(지난 달 값을 옮겼다).
  const suggestedPrice = !confirmed && r.lastMonth != null && draft.price === String(r.lastMonth.price);
  const suggestedSessions = isUntouchedScaledSessions(r, draft.sessions);
  const n = draft.sessions.trim() === "" ? NaN : Number(draft.sessions);
  const priceText = draft.price.replace(/[,\s]/g, "");
  const price = priceText === "" ? NaN : Number(priceText);
  const schoolGrade = schoolGradeLabel(r.studentSchool, r.studentGrade);
  const preview = locked ? null : monthly ? r.monthlyPrice : validSessionQuantity(n) && Number.isFinite(price) && price >= 0 ? sessionPricingAmount("per_session", n, Math.round(price)) : null;

  return (
    // 🔴 한 행 = 한 줄(원장 2026-09-16 *"행이 너무 폭 넓어졌거든? 하나의 행이 줄바꿈 되지 않게 남은 여백들 잘 활용해서"*) —
    //    칸마다 값·꼬리표·버튼을 가로로 늘어놓고 줄바꿈을 막는다. 들어갈 폭은 표의 최소 폭(colgroup 위)이 보장하고, 창이 그보다
    //    좁으면 끌어서 가로로 민다(넘치는 표 규약). 오류 문구만 예외로 아래에 선다(잠깐 뜨는 알림).
    <tr aria-busy={pending} className="group border-border hover:bg-accent/30 border-t transition-colors [&>td]:whitespace-nowrap">
      {/* 선택(원장 2026-09-17) — 미확정 행만 고를 수 있다('선택 일괄 확정'의 대상). 확정된 행은 해제 후 선택. 청구서 없는 줄은 잠긴다. */}
      <td className="px-2 py-2 text-center">
        {/* 선택은 '선택 일괄 확정'의 대상 고르기라 읽기 권한이면 세우지 않는다. */}
        {canWrite ? (
          <input
            type="checkbox"
            checked={selected && !confirmed && !locked && selectable}
            disabled={confirmed || pending || !r.classId || locked || !selectable}
            onChange={(e) => onSelect(e.target.checked)}
            aria-label={`${r.studentName} 선택`}
            title={confirmed ? "이미 확정됨 — 해제한 뒤 고를 수 있습니다" : undefined}
            {...(locked && stateMeta ? stateTip(r.termState as Exclude<TermRowState, "term">) : {})}
            className="accent-primary size-4 cursor-pointer align-middle disabled:cursor-default"
          />
        ) : null}
      </td>
      <td className="text-foreground px-3 py-2 font-medium">
        {/* 누르면 원생 상세를 **새 창**으로(원장 2026-09-17) — 회차 확정 창은 그대로 둔다. */}
        {/* 반 요일과 다른 개별 등원 요일은 이름 옆에(원장 2026-09-17). 한 줄 flex — 인라인 링크의 말줄임은 안 먹는다([[#111]]). */}
        <div className="flex min-w-0 items-center justify-center gap-1">
          <WindowLink href={`/students/${r.studentId}`} title={r.studentName} frameTarget="window" className="min-w-0 truncate hover:underline">
            {/* WindowLink의 title은 창 제목이라 속성으로 안 나간다 — 잘린 이름은 이 title로 끝까지 본다. */}
            <span title={r.studentName}>{r.studentName}</span>
          </WindowLink>
          {r.attendDays?.length ? (
            <span
              className="text-amber shrink-0 text-xs font-bold"
              {...tipProps({ title: "개별 등원 요일", lines: [`${formatTermDays(r.attendDays)} 등원`, r.classDays?.length ? `수업 요일 ${formatTermDays(r.classDays)}` : null] })}
            >
              {formatTermDays(r.attendDays)}
            </span>
          ) : null}
        </div>
        {/* 미확정 행의 확정 폼(빈 폼) — 회차/단가 입력·확정 버튼이 form 속성으로 여기에 묶인다. 청구월은 가상 id(회차 행 없음)를 서버가 풀 때 쓴다. */}
        {canWrite && !confirmed && !locked ? (
          <form
            id={fid}
            action={confirmAction}
            // 개별 확정(버튼·Enter)도 선택 일괄 확정과 같은 확인을 거친다 — 한쪽만 물으면 한 명씩 확정하는 흐름으로 샌다(리뷰 2026-09-17).
            onSubmit={(e) => {
              if (isUntouchedScaledSessions(r, draft.sessions) && !window.confirm(scaledConfirmText([r]))) e.preventDefault();
            }}
            className="hidden"
          >
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="period" value={period} />
            {monthly ? <>
              <input type="hidden" name="unitPrice" value={r.monthlyPrice!} />
            </> : null}
          </form>
        ) : null}
      </td>
      {/* 학교·학년 — "칠성초6"(schoolGradeLabel 한 벌, 공백 join 금지). 긴 학교명은 말줄임 + 전문 title. */}
      <td className="text-text-dim truncate px-3 py-2 text-center text-xs" title={schoolGrade || undefined}>
        {schoolGrade || "—"}
      </td>
      <td className="text-text-dim truncate px-3 py-2 text-center text-xs" title={r.homeroomTeacherName ?? undefined}>
        {r.homeroomTeacherName ?? "—"}
      </td>
      <td className="num px-3 py-2 text-center">
        <PlannedCell r={r} />
      </td>
      {/* 확정 회차 — 청구서 없는 줄은 입력 대신 사유 라벨(마우스 오버 카드). */}
      <td className="num relative px-3 py-2 text-center">
        {locked && stateMeta ? (
          <span className={`${TONE_TEXT[stateMeta.tone]} cursor-help`} {...stateTip(r.termState as Exclude<TermRowState, "term">)}>
            {stateMeta.label}
          </span>
        ) : confirmed ? (
          !monthly && r.quantityBasis === "days" ? (
            <span
              className="text-danger cursor-help font-bold underline decoration-dotted underline-offset-4"
              {...(planDiffers(r)
                ? tipProps({ title: "일수 기준 확정", lines: ["출석 일수로 확정한 값입니다(시수 기준 도입 전).", planDiffLine(r), "해제한 뒤 시수를 확인해 다시 확정하세요."] })
                : DAYS_BASIS_TIP)}
            >
              {r.confirmedSessions}
              <span className="sr-only"> · 일수 기준 · 재확정 필요</span>
            </span>
          ) : monthly ? (
            canWrite ? (
              <MonthlySessionEditor id={r.id} sessions={r.confirmedSessions!} confirmedAt={r.confirmedAt} studentName={r.studentName} />
            ) : (
              <span className="text-foreground font-bold">{r.confirmedSessions}</span>
            )
          ) : planDiffers(r) ? (
            <span className="text-amber cursor-help font-bold underline decoration-dotted underline-offset-4" {...planDiffTip(r)}>
              {r.confirmedSessions}
              <span className="sr-only"> · 예정 {r.plannedSessions}시수와 다름</span>
            </span>
          ) : (
            <span className="text-foreground font-bold">{r.confirmedSessions}</span>
          )
        ) : (
          <input
            form={canWrite ? fid : undefined}
            name="sessions"
            type="number"
            step="any"
            min={0}
            max={99}
            value={draft.sessions}
            onChange={(e) => onDraft({ ...draft, sessions: e.target.value })}
            // 읽기 권한 — 값(예정·지난 달 기준)은 보이되 잠근다. 칸이 좁아 안내는 title로, 표 위에 writeLockedNote 한 줄.
            disabled={pending || !canWrite}
            title={canWrite ? undefined : writeLockedPlaceholder("billing")}
            placeholder={canWrite ? undefined : writeLockedPlaceholder("billing")}
            aria-label={`${r.studentName} 확정 회차`}
            className={`${NUM_INPUT} w-14 text-center ${suggestedSessions ? "bg-amber-soft" : "bg-background"}`}
            {...(suggestedSessions ? lastMonthTip(r) : {})}
          />
        )}
      </td>
      {/* 회당 단가 */}
      <td className="num px-3 py-2 text-right">
        {locked ? (
          "—"
        ) : confirmed ? (
          r.unitPrice !== null ? (
            `${monthly ? "월 " : ""}${won(r.unitPrice)}`
          ) : (
            "—"
          )
        ) : monthly ? (
          <span title="회차를 곱하지 않는 월 수강료">월 {won(r.monthlyPrice!)}</span>
        ) : (
          <>
            <input
              form={canWrite ? fid : undefined}
              name="unitPrice"
              type="text"
              inputMode="numeric"
              list={listId}
              placeholder={canWrite ? "단가" : writeLockedPlaceholder("billing")}
              value={draft.price}
              onChange={(e) => onDraft({ ...draft, price: e.target.value })}
              disabled={pending || !canWrite}
              title={canWrite ? undefined : writeLockedPlaceholder("billing")}
              aria-label={`${r.studentName} 회당 단가`}
              className={`${NUM_INPUT} w-24 text-right ${suggestedPrice ? "bg-blue-soft" : "bg-background"}`}
              {...(suggestedPrice ? lastMonthTip(r) : {})}
            />
          </>
        )}
      </td>
      {/* 확정 금액 */}
      <td className="num text-foreground px-3 py-2 text-right font-bold">
        {confirmed && r.amount !== null ? won(r.amount) : preview !== null ? (
          <div aria-label={`${r.studentName} 예상금액`} className="inline-flex items-baseline gap-1.5">
            <span className="text-primary">{won(preview)}</span>
            <span className="text-text-dim text-xs font-normal">예상 · {monthly ? "월 정액" : `${n}시수 × ${won(Math.round(price))}`}</span>
          </div>
        ) : "—"}
      </td>
      {/* 실납 청구액(옛 '이 반 청구액') — `금액 꼬리표 · 배분 · 이월`을 한 줄로. 꼬리표는 `ReceiptTag` 하나(배분 재확인·완료 → 회차 없음 →
          청구서 중복 → 이름 매칭 참고). 회차 행이 없는 줄(missing)도 배분 버튼은 그대로(저장하는 순간 행이 생긴다). 청구서 없는 줄은 —. */}
      <td className="num text-muted-foreground px-3 py-2 text-right text-xs">
        {locked ? (
          // 청구서가 없거나 취소된 줄 — 금액은 없지만 받을 반이 없어 여기 붙은 금액 이월은 보인다(조용히 사라지면 안 된다).
          <span className="inline-flex items-baseline gap-x-2">—<MoneyCarryTags r={r} /></span>
        ) : (
          // 오류 문구(수납 연결 불러오기 실패)만 아래로 꺾인다 — `flex-wrap` + 버튼 쪽 `basis-full`. 평소엔 한 줄.
          <div className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-1">
            {/* 실납 = 배분액 − 보낸 이월 + 받은 이월(0278a) — 분배와 같은 값(`netAllocatedAmount`). 이월 표식이 차이를 말한다. */}
            {r.allocatedAmount != null ? <b>{won(netAllocatedAmount(r) ?? r.allocatedAmount)}</b> : <span>{r.classAmount !== null ? won(r.classAmount) : "—"}</span>}
            <ReceiptTag r={r} />
            <MoneyCarryTags r={r} />
            {/* 배분·이월은 조회부터 쓰기 게이트(canWriteTenant billing)라 읽기 권한이면 세우지 않는다. */}
            {canWrite && r.invoiceId !== null ? <ReceiptAllocationButton invoiceId={r.invoiceId} studentName={r.studentName} /> : null}
            {canWrite ? <MoneyCarryButton r={r} /> : null}
          </div>
        )}
      </td>
      {/* 메모(특이사항) — 누르면 그 자리에서 고친다. 회차 행이 없는 줄은 적을 자리(행)가 아직 없다. */}
      <td className="px-3 py-2">
        {r.termState === "term" ? (
          canWrite ? (
            <TermNoteCell id={r.id} note={r.note} studentName={r.studentName} />
          ) : r.note ? (
            // 읽기 권한 — 글만(한 줄 말줄임 + 전문은 마우스 오버 카드). 눌러서 고치는 문은 세우지 않는다.
            <span className="block w-full truncate text-left text-sm" {...tipProps({ title: "메모", lines: [r.note] })}>
              {r.note}
            </span>
          ) : null
        ) : (
          <span className="text-text-dim cursor-help text-xs" {...NO_ROW_NOTE_TIP}>—</span>
        )}
      </td>
      {/* 기타 — 확정·해제·삭제. 삭제는 저장된 회차 행에만 제공한다. */}
      <td className={`${STICKY_END_ROW} px-3 py-2 text-center`}>
        {locked || !canWrite ? (
          <span className="text-text-dim">—</span>
        ) : confirmed ? (
          <form action={unconfirmAction} className="inline">
            <input type="hidden" name="id" value={r.id} />
            <button type="submit" disabled={pending} className="text-text-dim hover:text-foreground text-xs underline-offset-2 hover:underline disabled:opacity-50">
              {unconfirming ? "해제 중…" : "해제"}
            </button>
          </form>
        ) : (
          <button
            type="submit"
            form={fid}
            disabled={pending}
            className="border-line text-primary hover:bg-primary-soft inline-flex h-(--control-h) items-center rounded-md border px-2 text-sm font-bold disabled:opacity-50"
          >
            {confirming || awaiting ? "확정 중…" : monthly ? "월 금액 확정" : "확정"}
          </button>
        )}
        {canWrite && r.termState === "term" ? <TermDeleteButton id={r.id} period={period} studentName={r.studentName} className={r.className} disabled={pending} onDeleted={() => { onSelect(false); onAwait(); }} /> : null}
        {err ? <p className="text-danger mt-1 text-xs whitespace-normal">{err}</p> : null}
      </td>
    </tr>
  );
}

/** 미확정 행 입력칸의 처음 값 — 지난 달 확정 기준 제안이 있으면 그 값, 없으면 예정 시수 · 빈 단가. */
function defaultDraft(row: SessionTermRow): TermDraft {
  const s = row.lastMonth;
  return { sessions: String(s?.sessions ?? row.plannedSessions ?? ""), price: s ? String(s.price) : "" };
}

/** 입력칸이 아직 지난 달 기준 제안 그대로인가 — 칸을 옅게 칠하고 근거 카드를 단다(고치면 사라진다). */
function lastMonthTip(r: Row): ReturnType<typeof tipProps> {
  const s = r.lastMonth!;
  return tipProps({
    title: "지난 달 확정 기준",
    lines: [
      `지난 달 ${s.last.sessions}시수 × ${won(s.last.price)}`,
      s.sessions !== null && s.last.planned !== null ? `지난 달 예정 ${s.last.planned}시수 대비 비율로 이번 달 예정 ${r.plannedSessions}시수 → ${s.sessions}시수` : null,
      s.sessions !== null ? "지난 달만 휴원·결석으로 줄였거나 이번 달 등원 요일을 늘린 학생이면 예정 시수로 고치세요." : null,
      "확인한 뒤 확정하세요(자동 저장되지 않습니다).",
    ],
  });
}

/** 반 머리 줄의 수업 요일 — 같은 반이라 행마다 같다(첫 값). */
const classDaysText = (students: Row[]) => formatTermDays(students.find((s) => s.classDays?.length)?.classDays);

/** 계획 회차 요약 — 반 전원 같으면 "N회", 다르면 "min~max회"(월중 등록/퇴원). */
function plannedSummary(students: Row[]): string {
  const vals = students.map((s) => s.plannedSessions).filter((n): n is number => n !== null);
  if (vals.length === 0) return "—";
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  return min === max ? `${min}시수` : `${min}~${max}시수`;
}

type TableMemory = { source: ClassGroup[]; drafts: Record<string, Draft>; ids: ReadonlySet<string>; awaiting: ReadonlySet<string> };

/**
 * 새 데이터에서 사라진 가상 줄 id → 같은 학생·반의 새 줄 id. 확정·배분을 저장하면 가상 줄(`v:학생:반`)이 실 행(uuid)으로 바뀌는데,
 * 초안·체크가 `row.id` 키라 옮기지 않으면 입력이 사라진다. 🔴 새 줄이 **딱 하나**일 때만 옮긴다(청구서 중복으로 둘이면 어느 쪽인지
 * 모른다 — 모르는 것을 한쪽에 붙이지 않는다). id 모양이 아니라 이전 데이터의 학생·반으로 되짚는다(가상 id를 파싱하지 않는다).
 */
function carryVirtualKeys(prev: ClassGroup[], next: ClassGroup[]): Map<string, string> {
  const nextIds = new Set<string>();
  const byPair = new Map<string, string[]>();
  for (const g of next)
    for (const row of g.students) {
      nextIds.add(row.id);
      if (!row.classId) continue;
      const key = monthRosterKey(row.studentId, row.classId);
      (byPair.get(key) ?? byPair.set(key, []).get(key)!).push(row.id);
    }
  const moved = new Map<string, string>();
  for (const g of prev)
    for (const row of g.students) {
      if (!isVirtualTermId(row.id) || nextIds.has(row.id) || !row.classId) continue;
      const candidates = byPair.get(monthRosterKey(row.studentId, row.classId));
      if (candidates?.length === 1) moved.set(row.id, candidates[0]!);
    }
  return moved;
}

/**
 * 회차 확정 표 — **단일 `<table>`**에 반 헤더를 밴드 행(colSpan)으로 끼워 넣는다. 반마다 별도 표를 쓰면
 * 표가 각자 열 너비를 계산해 카드끼리 열이 어긋난다("수업끼리 제각각") → 한 표로 합쳐 전 반이 같은 11열 공유.
 * table-fixed + colgroup으로 열 너비를 고정해 확정/미확정·반 무관하게 정렬을 못박는다.
 */
export function SessionTermGroups({
  groups,
  catalog,
  period,
  visibleOnly = false,
  seatShare = null,
  canWrite,
  eieEnabled = true,
}: {
  groups: ClassGroup[];
  catalog: Catalog;
  period: string;
  /**
   * 수납관리 쓰기 권한 — 서버(SessionTermsFace)가 회차 액션과 **같은 함수**(canWriteTenant billing)로 정한 값.
   * 읽기 권한이면 반 일괄 입력·확정·전체 해제·선택 체크, 행의 확정·해제·삭제·배분·이월·메모 편집을 그리지 않는다(원장 2026-11-05).
   */
  canWrite: boolean;
  /** 꺼진 지점에 과거 EiE 반이 남았는지 진단하는 표시용 값. 돈 산식(`monthlyPrice`)은 바꾸지 않는다. */
  eieEnabled?: boolean;
  /** 필터(보기 필터의 미확정·미배분 · 검색)로 좁혀 보는 중 — 반 일괄 확정을 보이는 학생에게만. */
  visibleOnly?: boolean;
  /**
   * 자리 몫 줄 재료(원장 2026-10-07 *"어떤반의 수업/JJ 비율을 19/5를 20/4로"*) — 그 달 자리(JJ실·랩실) 교시가 있는 영어 반과 이미 돌린 시수.
   * 급여 비율을 고칠 수 있는 사람의 화면에만 온다(없으면 줄을 세우지 않는다).
   */
  seatShare?: SeatShareSummary | null;
}) {
  const listId = useId();
  const seatShareClasses = new Set(seatShare?.classIds ?? []);
  const { patches } = useSessionTermsState();
  // 화면 메모리 셋 — 입력칸 초안(drafts) · 체크 선택(ids) · 새 데이터를 기다리는 가상 줄(awaiting). 전부 `row.id` 키다.
  // 새 데이터(다른 창의 확정·새로고침)가 오면 렌더 중 파생으로 맞춘다(SessionTermsState와 같은 방식 — effect로 setState 금지):
  //  · 가상 줄(`v:학생:반`)이 실 행으로 바뀌었으면 그 줄의 초안·체크를 같은 학생·반의 새 줄로 옮긴다(`carryVirtualKeys` — 키가 row.id라
  //    그대로 두면 배분 저장·확정 뒤 새로고침에 입력이 사라진다).
  //  · 그사이 확정된 행의 선택은 버린다 — 남겨 두면 나중에 해제될 때 체크가 옛 입력값과 함께 되살아난다(재리뷰 2026-09-17).
  //  · 기다리던 가상 줄은 푼다(새 데이터가 왔다).
  const [memory, setMemory] = useState<TableMemory>(() => ({ source: groups, drafts: {}, ids: new Set(), awaiting: new Set() }));
  /** 반 → 머리 줄 문구. 새 데이터가 와도 남긴다(반 일괄 직후 새로고침이 안내를 지우면 안 된다) — 그 반의 다음 동작이 덮는다. */
  const [bandNotes, setBandNotes] = useState<Record<string, BandNote>>({});
  const patchBandNote = (classId: string, patch: Partial<BandNote>) =>
    setBandNotes((current) => {
      const base: BandNote = current[classId] ?? { notice: null, selection: null };
      return { ...current, [classId]: { ...base, ...patch } };
    });
  let { drafts, ids: selected, awaiting } = memory;
  if (memory.source !== groups) {
    const moved = carryVirtualKeys(memory.source, groups);
    drafts = { ...memory.drafts };
    for (const [from, to] of moved) {
      if (drafts[from] && !drafts[to]) drafts[to] = drafts[from]!;
      delete drafts[from];
    }
    const open = new Set(groups.flatMap((g) => g.students).filter((row) => row.confirmedSessions === null && confirmableRow(row)).map((row) => row.id));
    selected = new Set([...memory.ids].map((id) => moved.get(id) ?? id).filter((id) => open.has(id)));
    awaiting = new Set();
    setMemory({ source: groups, drafts, ids: selected, awaiting });
  }
  // 손대지 않은 칸의 기본값 = 지난 달 확정 기준(있으면) → 없으면 예정 시수·빈 단가(원장 2026-09-17 "입력칸만 미리 채움").
  const draftOf = (row: SessionTermRow): Draft => drafts[row.id] ?? defaultDraft(row);
  const setDrafts = (update: (current: Record<string, Draft>) => Record<string, Draft>) => setMemory((current) => ({ ...current, drafts: update(current.drafts) }));
  // 체크박스 선택(원장 2026-09-17) — 확정되면 대상에서 빠진다(체크박스가 잠긴다).
  const setMany = (ids: string[], on: boolean) =>
    setMemory((current) => {
      const next = new Set(current.ids);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return { ...current, ids: next };
    });
  const addAwaiting = (ids: string[]) => {
    if (ids.length) setMemory((current) => ({ ...current, awaiting: new Set([...current.awaiting, ...ids]) }));
  };
  return (
    <DragScrollArea className="bg-card border-border rounded-2xl border">
      <datalist id={listId}>
        {catalog.map((c) => (
          <option key={c.price} value={c.price} label={`${won(c.price)}${c.label ? ` · ${c.label}` : ""}`} />
        ))}
      </datalist>
      {/* 선택 포함 11열 · 한 행은 한 줄. 기타 열은 최소 180px로 월 금액 확정과 삭제를 함께 담는다.
          이름·개별 등원 요일, 실납 금액·배분 표식·연결 버튼, 메모의 폭도 유지한다.
          좁은 수납 창에서는 가로로 끌어 이동하며, 기타 열과 반 일괄 버튼은 오른쪽 끝에 고정한다. */}
      <table className="w-full min-w-[1640px] table-fixed text-sm">
        <colgroup>
          <col className="w-[2.5%]" />
          <col className="w-[9%]" />
          <col className="w-[7%]" />
          <col className="w-[5%]" />
          <col className="w-[6.25%]" />
          <col className="w-[6.25%]" />
          <col className="w-[7.75%]" />
          <col className="w-[17%]" />
          <col className="w-[19.75%]" />
          <col className="w-[8.5%]" />
          <col className="w-[11%]" />
        </colgroup>
        <thead>
          <tr className="bg-bg-soft text-text-dim text-sm [&>th]:whitespace-nowrap">
            <th className="px-2 py-2 text-center font-bold">
              <span className="sr-only">선택</span>
            </th>
            {/* 열 제목과 값은 같은 축(원장 2026-09-18) — 기본 가운데, 금액 열은 오른쪽, 메모는 왼쪽. */}
            <th className="px-3 py-2 text-center font-bold">이름</th>
            <th className="px-3 py-2 text-center font-bold">학교학년</th>
            <th className="px-3 py-2 text-center font-bold" title="반의 현재 담임 — 지난 달을 열어도 지금 담임이 보입니다">
              담임
            </th>
            <th className="px-3 py-2 text-center font-bold">예정 시수</th>
            <th className="px-3 py-2 text-center font-bold">확정 시수</th>
            <th className="px-3 py-2 text-right font-bold">단가 및 수강료</th>
            <th className="px-3 py-2 text-right font-bold">예상 및 확정 청구액</th>
            {/* 실납 청구액은 금액 + 배분 표식 + 수납 연결이 한 칸에 서는 묶음이라 가운데 그대로 — 오른쪽에 붙이면 오른쪽 고정 '기타' 열에
                가려 "실납 청"만 보인다(원장 2026-09-18 실측). */}
            <th className="px-3 py-2 text-center font-bold">실납 청구액</th>
            <th className="px-3 py-2 text-left font-bold">메모(특이사항)</th>
            <th className={`${STICKY_END} bg-bg-soft px-3 py-2 text-center font-bold`}>기타</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const g = { ...group, students: group.students.map((row) => ({ ...row, ...patches[row.id] })) };
            const monthlyPrice = g.students[0]?.monthlyPrice ?? null;
            // 확정 가능한 줄(회차 행 + 회차 없음)만 분모 — 청구서 없는 줄은 '· 청구서 없음 k'로 따로 적는다(원장 2026-09-18).
            const confirmable = g.students.filter(confirmableRow);
            const lockedCount = g.students.length - confirmable.length;
            const confirmed = confirmable.filter((s) => s.confirmedSessions !== null).length;
            const allDone = confirmable.length > 0 && confirmed === confirmable.length;
            // 반 일괄 대상(예정 있는 줄)이 전부 확정이면 '전체 확정 해제' — 예정 없는 줄(보강 방문·월초 종료)이 미확정으로 남아도 그렇다.
            // 🔴 그 줄 때문에 입력칸·일괄 버튼을 되살리면 '이 반 일괄 확정'이 이미 확정된 줄을 다시 확정해 덮어쓴다. 그 줄은 행의 '확정'으로.
            //    대상이 하나도 없는 반(방문자만)은 확정할 수 있는 줄이 전부 확정일 때.
            const eligible = confirmable.filter(batchEligible);
            const batchDone = eligible.length > 0 ? eligible.every((s) => s.confirmedSessions !== null) : allDone;
            const open = confirmable.filter((s) => s.confirmedSessions === null);
            const openSelected = open.filter((s) => selected.has(s.id));
            const allSelected = open.length > 0 && openSelected.length === open.length;
            // 반이 없는 묶음(`noclass:…`)엔 반 상세가 없다.
            const hasClass = g.students.some((s) => s.classId === g.classId);
            return (
              <Fragment key={g.classId}>
                <tr className="bg-accent/40 border-border border-t-2">
                  <td className="px-2 py-2 text-center">
                    {/* 이 반의 미확정 학생 전체 선택 — 반이 없는 묶음엔 선택 확정이 없다 */}
                    {canWrite && hasClass ? <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = openSelected.length > 0 && !allSelected;
                      }}
                      // '전체 확정 해제' 상태(반 일괄 대상이 다 확정)엔 선택 일괄 확정 버튼이 없다 — 고를 곳이 없으니 잠근다.
                      disabled={open.length === 0 || (batchDone && hasClass)}
                      onChange={(e) => setMany(open.map((s) => s.id), e.target.checked)}
                      aria-label={`${g.className} 미확정 학생 전체 선택`}
                      className="accent-primary size-4 cursor-pointer align-middle disabled:cursor-default"
                    /> : null}
                  </td>
                  <td colSpan={10} className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      {/* 표가 창보다 넓을 때 — 반 정보는 보이는 왼쪽 끝, 일괄 버튼은 보이는 오른쪽 끝에 붙는다(sticky). */}
                      <div className="sticky left-3 flex flex-wrap items-center gap-2">
                        {hasClass ? (
                          // 누르면 반 상세를 **새 창**으로(원장 2026-09-17).
                          <WindowLink href={`/classes/${g.classId}`} title={g.className} frameTarget="window" className="text-foreground text-sm font-bold hover:underline">
                            {g.className}
                          </WindowLink>
                        ) : (
                          <span className="text-foreground text-sm font-bold">{g.className}</span>
                        )}
                        {/* 이 반의 그 달 수업 요일(원장 2026-09-17) — 학생마다 다르면 학생 이름 옆에 따로 선다. */}
                        {classDaysText(g.students) ? <span className="text-foreground text-xs font-medium">{classDaysText(g.students)}</span> : null}
                        <span className="text-text-dim text-xs">{g.subjectLabel}</span>
                        <span className="text-text-faint text-xs">
                          · {g.students.length}명 · 예정 {plannedSummary(g.students)}
                          {/* 확정할 줄이 없는 반(청구서 없음·취소뿐)은 재촉할 것이 없다 — 앰버 대신 무채색 0/0. */}
                          {monthlyPrice !== null ? " · 월 수강료" : ""} · 확정{" "}<span className={allDone ? "text-chart-2" : confirmable.length === 0 ? "text-text-dim" : "text-amber"}>{confirmed}/{confirmable.length}</span>
                          {lockedCount > 0 ? ` · 청구서 없음 ${lockedCount}` : ""}
                        </span>
                        {!eieEnabled && monthlyPrice !== null ? (
                          <span role="status" className="text-amber text-xs font-bold">이 반은 월정액으로 확정됩니다</span>
                        ) : null}
                      </div>
                      {/* 불투명(반 머리 줄과 같은 색) — 좁은 창에서 왼쪽 반 정보 위로 겹칠 때 글자가 섞이지 않게.
                          확정할 수 있는 줄이 하나도 없는 반(청구서 없음·취소뿐)엔 일괄 입력·확정 자체가 없다. */}
                      {/* 읽기 권한이면 일괄 입력·확정·해제 묶음 자체를 세우지 않는다(입력칸도 그 단추에 넣을 값이라 함께). */}
                      {canWrite && confirmable.length > 0 ? (
                      <div className="bg-card bg-[linear-gradient(color-mix(in_oklab,var(--color-accent)_40%,transparent),color-mix(in_oklab,var(--color-accent)_40%,transparent))] sticky right-3 z-[1] rounded-md pl-2">
                        {/* 반 일괄 대상이 전부 확정 → 입력칸·일괄 버튼 대신 '전체 확정 해제' 하나(원장 2026-09-17). 판정은 화면에 반영된
                            확정 상태(patches)라 한 명만 해제해도 곧바로 입력칸이 돌아온다. 반이 없는 묶음은 서버가 반을 못 가려 종전대로.
                            전체 해제는 **확정된 실 행만**(가상 id는 확정될 수 없고, 미확정 줄은 해제할 것이 없다). */}
                        {batchDone && hasClass ? (
                          <ClassUnconfirmButton
                            period={period}
                            classId={g.classId}
                            className={g.className}
                            rows={confirmable.filter((s) => s.confirmedSessions !== null && !isVirtualTermId(s.id))}
                            monthlyPrice={monthlyPrice}
                            onReleased={(released) => {
                              setDrafts((current) => {
                                const next = { ...current };
                                for (const row of released) next[row.id] = { sessions: String(row.confirmedSessions ?? row.plannedSessions ?? ""), price: String(row.unitPrice ?? "") };
                                return next;
                              });
                              setMany(released.map((row) => row.id), false);
                            }}
                          />
                        ) : (
                        <ClassBatch
                          period={period}
                          group={g}
                          listId={listId}
                          visibleOnly={visibleOnly}
                          onPrice={(price) =>
                            setDrafts((current) => {
                              const next = { ...current };
                              // 시수는 손대지 않은 칸의 기본값(지난 달 기준 → 예정)을 그대로 둔다 — 예정으로 되돌리면 2시간만 듣는 학생의 비율이 사라진다.
                              for (const row of g.students) if (row.confirmedSessions === null && confirmableRow(row)) next[row.id] = { ...(current[row.id] ?? defaultDraft(row)), price };
                              return next;
                            })
                          }
                          selection={hasClass ? { rows: openSelected, draftOf, onConfirmed: (ids) => setMany(ids, false), onAwait: addAwaiting } : undefined}
                          onAwait={addAwaiting}
                          onBandNote={(patch) => patchBandNote(g.classId, patch)}
                        />
                        )}
                        {bandNotes[g.classId]?.notice || bandNotes[g.classId]?.selection ? (
                          <p className="mt-1 max-w-[36rem] text-right text-xs whitespace-normal">
                            {bandNotes[g.classId]?.notice ? <span role="status" className="text-text-dim block">{bandNotes[g.classId]!.notice}</span> : null}
                            {bandNotes[g.classId]?.selection ? <span role="alert" className="text-danger block">{bandNotes[g.classId]!.selection}</span> : null}
                          </p>
                        ) : null}
                      </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {g.students.map((r) => (
                  <TermRow
                    key={r.id}
                    r={r}
                    period={period}
                    listId={listId}
                    draft={draftOf(r)}
                    onDraft={(draft) => setDrafts((current) => ({ ...current, [r.id]: draft }))}
                    selected={selected.has(r.id)}
                    onSelect={(on) => setMany([r.id], on)}
                    awaiting={awaiting.has(r.id)}
                    onAwait={() => addAwaiting([r.id])}
                    selectable={!(batchDone && hasClass)}
                    canWrite={canWrite}
                  />
                ))}
                {/* 자리 몫 줄 — 이 반의 그 달 자리(JJ실·랩실) 몫을 숫자로 선생님 몫에 돌린다(반마다 한 줄 · 학생별 값은 창 안에서 · 날짜는 고르지 않는다). */}
                {hasClass && seatShareClasses.has(g.classId) ? (
                  <SeatShareRow classId={g.classId} className={g.className} period={period} adjusted={seatShare?.adjusted[g.classId] ?? []} />
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
