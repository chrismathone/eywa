"use client";
import { Button } from "@/components/ui/button";

import { Fragment, useActionState, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "@/components/icons/eywa-icon-compat";
import {
  confirmSessionTerm,
  unconfirmSessionTerm,
  confirmClassTerms,
  refreshPlannedTerms,
  type SessionTermActionState,
} from "@/features/billing/session-terms/server/actions";
import type { SessionTermRow } from "@/features/billing/session-terms/server/queries";
import { DragScrollArea } from "@/components/ui/drag-scroll-area";
import { validSessionQuantity, sessionPricingAmount, type SessionPrice } from "@/features/billing/session-pricing";
import { tipProps } from "@/components/hover-tip/tip";
import { useSessionTermsState } from "./session-terms-state";
import { ReceiptAllocationButton } from "./receipt-allocation-dialog";
import { MonthlySessionEditor } from "./monthly-session-editor";
import { TermNoteCell } from "./term-note-cell";
import { SelectedConfirmButton, scaledConfirmText, type TermDraft } from "./selected-confirm-button";
import { ClassUnconfirmButton } from "./class-unconfirm-button";
import { schoolGradeLabel } from "@/lib/format/school-grade";
import { formatTermDays } from "@/features/billing/session-terms/term-days";
import { isUntouchedScaledSessions } from "@/features/billing/session-terms/last-month-suggestion";
import { WindowLink } from "@/components/workspace/window-link";

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;

type Row = SessionTermRow & { subjectLabel: string };
type Catalog = SessionPrice[];
export type ClassGroup = { classId: string; className: string; subjectLabel: string; students: Row[] };

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

/** 체크한 미확정 학생 — '선택 일괄 확정'의 대상(원장 2026-09-17). */
type Selection = { rows: Row[]; draftOf: (row: SessionTermRow) => TermDraft; onConfirmed: (ids: string[]) => void };

/** 회차 없이 단가만 입력하면 미확정 학생의 입력칸만 채운다. */
/** `visibleOnly` = 필터(미배분만 보기·검색)로 이 반의 일부만 보이는 중 — 반 일괄 확정도 보이는 학생에게만 보낸다. */
function ClassBatch({ period, group, listId, onPrice, visibleOnly, selection }: { period: string; group: ClassGroup; listId: string; onPrice: (price: string) => void; visibleOnly?: boolean; selection?: Selection }) {
  const monthlyPrice = group.students[0]?.monthlyPrice ?? null;
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const { apply } = useSessionTermsState();
  const [sessionsInput, setSessionsInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [selectionMessage, setSelectionMessage] = useState<string | null>(null);

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
      if (!group.students.some((row) => row.confirmedSessions === null)) {
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
          <SelectedConfirmButton period={period} classId={group.classId} rows={selection.rows} draftOf={selection.draftOf} onConfirmed={selection.onConfirmed} onMessage={setSelectionMessage} />
        ) : null}
      </form>
      {err || notice || selectionMessage ? (
        <p className="max-w-[36rem] text-right text-xs whitespace-normal">
          {err ? <span className="text-danger block">{err}</span> : null}
          {notice ? <span role="status" className="text-text-dim block">{notice}</span> : null}
          {selectionMessage ? <span role="alert" className="text-danger block">{selectionMessage}</span> : null}
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
const staleTip = (hasReferenceAmount: boolean) =>
  tipProps({
    title: "배분 재확인 필요",
    lines: [
      "이 학생의 수납 배분에서 이 반 몫이 빠져 있습니다.",
      // 금액이 `—`인 행엔 이 문장을 싣지 않는다(없는 금액을 가리키게 된다 — 재리뷰 2026-09-16).
      hasReferenceAmount ? "옆의 금액은 배분액이 아니라 이름 매칭 참고값입니다." : null,
      "수납 연결·배분에서 다시 배분하세요.",
    ],
  });
const ALLOCATION_STALE_TIP = staleTip(true);
const ALLOCATION_STALE_TIP_NO_AMOUNT = staleTip(false);

/**
 * 확정 ≠ 예정 — 확정 시수는 사람이 확정한 값이라 수강 기간·시간표가 바뀌어도 그대로다(N1). 예정(조회 때마다 새로 계산)과
 * 달라지면 확정 숫자를 앰버로 칠하고 사유는 마우스 오버 카드로(원장 2026-09-17 *"반스케줄 조정에 따라 같이 반영되나"* →
 * "다시 확정할 행이 보이게"). 🔴 표시만 한다 — 자동으로 고치지 않는다(차이가 곧 점검 신호, N2와 같은 결).
 * EiE 월 정액은 금액이 시수와 무관해 칠하지 않는다.
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
 * 학생 1명 행 — 개인 보정(반 일괄과 다른 회차/단가). 확정 여부와 무관하게 **같은 11열** 구조로 렌더해
 * 헤더와 정렬을 맞춘다(colSpan 금지 — 미확정 입력칸이 헤더 밖으로 밀리던 정렬버그). 미확정 행의 회차·단가
 * 입력과 확정 버튼은 서로 다른 `<td>`에 있지만 `form` 속성으로 한 폼에 묶인다(HTML5 폼 연결).
 */
type Draft = TermDraft;
function TermRow({ r, listId, draft, onDraft, selected, onSelect }: { r: Row; listId: string; draft: Draft; onDraft: (draft: Draft) => void; selected: boolean; onSelect: (checked: boolean) => void }) {
  const { apply } = useSessionTermsState();
  const [state, confirmAction, confirming] = useActionState<SessionTermActionState, FormData>(async (prev, data) => {
    try {
      const result = await confirmSessionTerm(prev, data);
      if (result?.terms) {
        // 확정된 행의 체크는 버린다 — 남겨 두면 나중에 해제될 때 옛 입력값과 함께 되살아난다(리뷰 2026-09-17).
        onSelect(false);
        apply(result.terms);
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
  const pending = confirming || unconfirming;
  const confirmed = r.confirmedSessions !== null;
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
  const preview = monthly ? r.monthlyPrice : validSessionQuantity(n) && Number.isFinite(price) && price >= 0 ? sessionPricingAmount("per_session", n, Math.round(price)) : null;

  return (
    // 🔴 한 행 = 한 줄(원장 2026-09-16 *"행이 너무 폭 넓어졌거든? 하나의 행이 줄바꿈 되지 않게 남은 여백들 잘 활용해서"*) —
    //    칸마다 값·꼬리표·버튼을 가로로 늘어놓고 줄바꿈을 막는다. 들어갈 폭은 표의 최소 폭(colgroup 위)이 보장하고, 창이 그보다
    //    좁으면 끌어서 가로로 민다(넘치는 표 규약). 오류 문구만 예외로 아래에 선다(잠깐 뜨는 알림).
    <tr aria-busy={pending} className="group border-border hover:bg-accent/30 border-t transition-colors [&>td]:whitespace-nowrap">
      {/* 선택(원장 2026-09-17) — 미확정 행만 고를 수 있다('선택 일괄 확정'의 대상). 확정된 행은 해제 후 선택. */}
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox"
          checked={selected && !confirmed}
          disabled={confirmed || pending || !r.classId}
          onChange={(e) => onSelect(e.target.checked)}
          aria-label={`${r.studentName} 선택`}
          title={confirmed ? "이미 확정됨 — 해제한 뒤 고를 수 있습니다" : undefined}
          className="accent-primary size-4 cursor-pointer align-middle disabled:cursor-default"
        />
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
        {/* 미확정 행의 확정 폼(빈 폼) — 회차/단가 입력·확정 버튼이 form 속성으로 여기에 묶인다. */}
        {!confirmed ? (
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
        <span className="text-text-dim">{r.plannedSessions ?? "—"}</span>
      </td>
      {/* 확정 회차 */}
      <td className="num relative px-3 py-2 text-center">
        {confirmed ? (
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
            <MonthlySessionEditor id={r.id} sessions={r.confirmedSessions!} confirmedAt={r.confirmedAt} studentName={r.studentName} />
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
            form={fid}
            name="sessions"
            type="number"
            step="any"
            min={0}
            max={99}
            value={draft.sessions}
            onChange={(e) => onDraft({ ...draft, sessions: e.target.value })}
            disabled={pending}
            aria-label={`${r.studentName} 확정 회차`}
            className={`${NUM_INPUT} w-14 text-center ${suggestedSessions ? "bg-amber-soft" : "bg-background"}`}
            {...(suggestedSessions ? lastMonthTip(r) : {})}
          />
        )}
      </td>
      {/* 회당 단가 */}
      <td className="num px-3 py-2 text-right">
        {confirmed ? (
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
              form={fid}
              name="unitPrice"
              type="text"
              inputMode="numeric"
              list={listId}
              placeholder="단가"
              value={draft.price}
              onChange={(e) => onDraft({ ...draft, price: e.target.value })}
              disabled={pending}
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
      {/* 실납 청구액(옛 '이 반 청구액') — `금액 꼬리표 · 수납 연결·배분`을 한 줄로. 배분 재확인은 꼬리표 자리에 앰버로(사유는 마우스 오버 카드). */}
      <td className="num text-muted-foreground px-3 py-2 text-right text-xs">
        {/* 오류 문구(수납 연결 불러오기 실패)만 아래로 꺾인다 — `flex-wrap` + 버튼 쪽 `basis-full`. 평소엔 한 줄. */}
        <div className="inline-flex flex-wrap items-baseline justify-end gap-x-2">
          {r.allocatedAmount != null ? <b>{won(r.allocatedAmount)}</b> : <span>{r.classAmount !== null ? won(r.classAmount) : "—"}</span>}
          {r.allocationStale ? (
            <span className="text-amber cursor-help" {...(r.classAmount !== null ? ALLOCATION_STALE_TIP : ALLOCATION_STALE_TIP_NO_AMOUNT)}>배분 재확인 필요</span>
          ) : r.allocatedAmount != null ? (
            <span className="text-green bg-green-soft rounded-sm px-1.5 py-0.5 text-xs font-medium">{r.refundState === "full" ? "전액 환불" : "배분 완료"}</span>
          ) : r.classAmount !== null ? (
            <span>이름 매칭 참고</span>
          ) : null}
          <ReceiptAllocationButton invoiceId={r.invoiceId} studentName={r.studentName} />
        </div>
      </td>
      {/* 메모(특이사항) — 누르면 그 자리에서 고친다. */}
      <td className="px-3 py-2">
        <TermNoteCell id={r.id} note={r.note} studentName={r.studentName} />
      </td>
      {/* 기타(옛 '개별') — 확정·해제. 오른쪽에 고정(STICKY_END_ROW). */}
      <td className={`${STICKY_END_ROW} px-3 py-2 text-center`}>
        {confirmed ? (
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
            {confirming ? "확정 중…" : monthly ? "월 금액 확정" : "확정"}
          </button>
        )}
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
}: {
  groups: ClassGroup[];
  catalog: Catalog;
  period: string;
  /** 필터(미배분만 보기·검색)로 좁혀 보는 중 — 반 일괄 확정을 보이는 학생에게만. */
  visibleOnly?: boolean;
}) {
  const listId = useId();
  const { patches } = useSessionTermsState();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  // 손대지 않은 칸의 기본값 = 지난 달 확정 기준(있으면) → 없으면 예정 시수·빈 단가(원장 2026-09-17 "입력칸만 미리 채움").
  const draftOf = (row: SessionTermRow): Draft => drafts[row.id] ?? defaultDraft(row);
  // 체크박스 선택(원장 2026-09-17) — 화면 메모리. 확정되면 대상에서 빠진다(체크박스가 잠긴다).
  // 새 데이터(다른 창의 확정·새로고침)가 오면 그사이 확정된 행의 선택은 버린다 — 남겨 두면 나중에 해제될 때 체크가 옛 입력값과 함께
  // 되살아난다(재리뷰 2026-09-17). 렌더 중 파생(SessionTermsState와 같은 방식 — effect로 setState 금지).
  const [selection, setSelection] = useState<{ source: ClassGroup[]; ids: ReadonlySet<string> }>(() => ({ source: groups, ids: new Set() }));
  let selected = selection.ids;
  if (selection.source !== groups) {
    const open = new Set(groups.flatMap((g) => g.students).filter((row) => row.confirmedSessions === null).map((row) => row.id));
    selected = new Set([...selection.ids].filter((id) => open.has(id)));
    setSelection({ source: groups, ids: selected });
  }
  const setMany = (ids: string[], on: boolean) =>
    setSelection((current) => {
      const next = new Set(current.ids);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return { ...current, ids: next };
    });
  return (
    <DragScrollArea className="border-border rounded-2xl border">
      <datalist id={listId}>
        {catalog.map((c) => (
          <option key={c.price} value={c.price} label={`${won(c.price)}${c.label ? ` · ${c.label}` : ""}`} />
        ))}
      </datalist>
      {/* 열 11개 = 선택 체크박스 + 원장 2026-09-17 *"이름 / 학교학년 / 담임 / 예정시수 / 확정시수 / 단가 및 수강료 / 예상 및 확정
          청구액 / 실납 청구액 / 메모(특이사항) / 기타"*. 한 행 = 한 줄(원장 2026-09-16)은 그대로 — 비율은 칸에 실제로 서는 내용 폭을
          Pretendard로 잰 값(2026-09-17, 칸 여백 포함: 선택 36 · 이름 4자 88 · 학교학년 6자 102 · 담임 70 · 시수 머리 94 · 단가 122 ·
          예상 `148,750원 예상 · 7시수 × 21,250원` 약 250~290 · 실납 `148,750원 배분 재확인 필요 수납 연결·배분` 약 306 ·
          메모 머리 132 · 기타 `월 금액 확정` 134)에서 잡았고, 이름 칸은 개별 등원 요일(4자 이름 약 62 + `월·수·금` 약 49)을 붙이며 최소 폭을
          1,580px로 올리고 이름 9% · 실납 19.75% · 메모 8.5%로 옮겼다(2026-09-17), 최소 폭 1,580px에서 각 칸이 제 한 줄을 담는다(메모가 가장 빠듯하다 — 134 vs 132). 남는 폭은 메모에
          조금 더 준다. ⚠️ 수납 창 기본 크기(1,160)보다 넓다 — 그 크기에선 끌어서 가로로 민다(수납 15열 표와 같은 결정,
          원장 2026-09-04). 그래서 '기타' 열(확정·해제)은 오른쪽에, 반 머리 줄의 일괄 입력·확정 버튼은 보이는 오른쪽 끝에
          고정했다(원장 2026-09-17 승인). 열을 더하면 이 폭과 비율을 함께 다시 잴 것. */}
      <table className="w-full min-w-[1580px] table-fixed text-sm">
        <colgroup>
          <col className="w-[2.5%]" />
          <col className="w-[9%]" />
          <col className="w-[7%]" />
          <col className="w-[5%]" />
          <col className="w-[6.25%]" />
          <col className="w-[6.25%]" />
          <col className="w-[8%]" />
          <col className="w-[18.5%]" />
          <col className="w-[19.75%]" />
          <col className="w-[8.5%]" />
          <col className="w-[9.25%]" />
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
            const confirmed = g.students.filter((s) => s.confirmedSessions !== null).length;
            const allDone = confirmed === g.students.length;
            const open = g.students.filter((s) => s.confirmedSessions === null);
            const openSelected = open.filter((s) => selected.has(s.id));
            const allSelected = open.length > 0 && openSelected.length === open.length;
            // 반이 없는 묶음(`noclass:…`)엔 반 상세가 없다.
            const hasClass = g.students.some((s) => s.classId === g.classId);
            return (
              <Fragment key={g.classId}>
                <tr className="bg-accent/40 border-border border-t-2">
                  <td className="px-2 py-2 text-center">
                    {/* 이 반의 미확정 학생 전체 선택 — 반이 없는 묶음엔 선택 확정이 없다 */}
                    {hasClass ? <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = openSelected.length > 0 && !allSelected;
                      }}
                      disabled={open.length === 0}
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
                          {monthlyPrice !== null ? " · 월 수강료" : ""} · 확정{" "}<span className={allDone ? "text-chart-2" : "text-amber"}>{confirmed}/{g.students.length}</span>
                        </span>
                      </div>
                      {/* 불투명(반 머리 줄과 같은 색) — 좁은 창에서 왼쪽 반 정보 위로 겹칠 때 글자가 섞이지 않게. */}
                      <div className="bg-card bg-[linear-gradient(color-mix(in_oklab,var(--color-accent)_40%,transparent),color-mix(in_oklab,var(--color-accent)_40%,transparent))] sticky right-3 z-[1] rounded-md pl-2">
                        {/* 보이는 학생이 전부 확정 → 입력칸·일괄 버튼 대신 '전체 확정 해제' 하나(원장 2026-09-17). 판정은 화면에 반영된
                            확정 상태(patches)라 한 명만 해제해도 곧바로 입력칸이 돌아온다. 반이 없는 묶음은 서버가 반을 못 가려 종전대로. */}
                        {allDone && hasClass && g.students.length > 0 ? (
                          <ClassUnconfirmButton
                            period={period}
                            classId={g.classId}
                            className={g.className}
                            rows={g.students}
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
                              for (const row of g.students) if (row.confirmedSessions === null) next[row.id] = { ...(current[row.id] ?? defaultDraft(row)), price };
                              return next;
                            })
                          }
                          selection={hasClass ? { rows: openSelected, draftOf, onConfirmed: (ids) => setMany(ids, false) } : undefined}
                        />
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
                {g.students.map((r) => (
                  <TermRow
                    key={r.id}
                    r={r}
                    listId={listId}
                    draft={draftOf(r)}
                    onDraft={(draft) => setDrafts((current) => ({ ...current, [r.id]: draft }))}
                    selected={selected.has(r.id)}
                    onSelect={(on) => setMany([r.id], on)}
                  />
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
