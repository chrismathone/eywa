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
import { useBillingSettingsRefresh } from "@/features/billing/use-billing-settings-refresh";
import { tipProps } from "@/components/hover-tip/tip";
import { useSessionTermsState } from "./session-terms-state";
import { ReceiptAllocationButton } from "./receipt-allocation-dialog";

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

/** 회차 없이 단가만 입력하면 미확정 학생의 입력칸만 채운다. */
function ClassBatch({ period, group, listId, onPrice }: { period: string; group: ClassGroup; listId: string; onPrice: (price: string) => void }) {
  const router = useRouter();
  const monthlyPrice = group.students[0]?.monthlyPrice ?? null;
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const { apply } = useSessionTermsState();
  const [sessionsInput, setSessionsInput] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

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
      setNotice("단가 입력 완료 · 예상금액 확인 후 개별 확정하세요");
      return;
    }
    setNotice(null);
    start(async () => {
      try {
        const res = await confirmClassTerms(period, group.classId, price, sessions);
        if (res.error) setErr(res.error);
        else if (res.terms) {
          apply(res.terms);
          if (group.students.some((row) => row.invoiceHasAllocations)) router.refresh();
        }
      } catch { setErr("확정하지 못했습니다. 다시 시도해 주세요"); }
    });
  }

  return (
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
      {err ? <span className="text-danger text-xs">{err}</span> : null}
      {notice ? <span role="status" className="text-text-dim text-xs">{notice}</span> : null}
    </form>
  );
}

const NUM_INPUT = "border-input bg-background num rounded-md border px-2 py-1 text-xs";

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
 * 학생 1명 행 — 개인 보정(반 일괄과 다른 회차/단가). 확정 여부와 무관하게 **같은 8열** 구조로 렌더해
 * 헤더와 정렬을 맞춘다(colSpan 금지 — 미확정 입력칸이 헤더 밖으로 밀리던 정렬버그). 미확정 행의 회차·단가
 * 입력과 확정 버튼은 서로 다른 `<td>`에 있지만 `form` 속성으로 한 폼에 묶인다(HTML5 폼 연결).
 */
type Draft = { sessions: string; price: string };
function TermRow({ r, listId, draft, onDraft }: { r: Row; listId: string; draft: Draft; onDraft: (draft: Draft) => void }) {
  const router = useRouter();
  const { apply } = useSessionTermsState();
  const [state, confirmAction, confirming] = useActionState<SessionTermActionState, FormData>(async (prev, data) => {
    try {
      const result = await confirmSessionTerm(prev, data);
      if (result?.terms) {
        apply(result.terms);
        if (r.invoiceHasAllocations) router.refresh();
      }
      return result;
    } catch { return { error: "확정하지 못했습니다. 다시 시도해 주세요" }; }
  }, undefined);
  const [unState, unconfirmAction, unconfirming] = useActionState<SessionTermActionState, FormData>(async (prev, data) => {
    try {
      const result = await unconfirmSessionTerm(prev, data);
      if (result?.terms) {
        onDraft({ sessions: String(r.confirmedSessions ?? r.plannedSessions ?? ""), price: String(r.unitPrice ?? "") });
        apply(result.terms);
        if (r.invoiceHasAllocations) router.refresh();
      }
      return result;
    } catch { return { error: "해제하지 못했습니다. 다시 시도해 주세요" }; }
  }, undefined);
  const pending = confirming || unconfirming;
  const confirmed = r.confirmedSessions !== null;
  const monthly = confirmed ? r.pricingMode === "monthly" : r.monthlyPrice !== null;
  const err = confirmed ? unState?.error : state?.error;
  const fid = `stf-${r.id}`;
  const n = draft.sessions.trim() === "" ? NaN : Number(draft.sessions);
  const priceText = draft.price.replace(/[,\s]/g, "");
  const price = priceText === "" ? NaN : Number(priceText);
  const preview = monthly ? r.monthlyPrice : validSessionQuantity(n) && Number.isFinite(price) && price >= 0 ? sessionPricingAmount("per_session", n, Math.round(price)) : null;

  return (
    // 🔴 한 행 = 한 줄(원장 2026-09-16 *"행이 너무 폭 넓어졌거든? 하나의 행이 줄바꿈 되지 않게 남은 여백들 잘 활용해서"*) —
    //    칸마다 값·꼬리표·버튼을 가로로 늘어놓고 줄바꿈을 막는다. 들어갈 폭은 표의 최소 폭(colgroup 위)이 보장하고, 창이 그보다
    //    좁으면 끌어서 가로로 민다(넘치는 표 규약). 오류 문구만 예외로 아래에 선다(잠깐 뜨는 알림).
    <tr aria-busy={pending} className="border-border hover:bg-accent/30 border-t transition-colors [&>td]:whitespace-nowrap">
      <td className="text-muted-foreground px-3 py-2 text-xs">{r.studentGrade ?? "—"}</td>
      <td className="text-foreground truncate px-3 py-2 font-medium" title={r.studentName}>
        {r.studentName}
        {/* 미확정 행의 확정 폼(빈 폼) — 회차/단가 입력·확정 버튼이 form 속성으로 여기에 묶인다. */}
        {!confirmed ? (
          <form id={fid} action={confirmAction} className="hidden">
            <input type="hidden" name="id" value={r.id} />
            {monthly ? <>
              <input type="hidden" name="sessions" value={r.plannedSessions ?? 0} />
              <input type="hidden" name="unitPrice" value={r.monthlyPrice!} />
            </> : null}
          </form>
        ) : null}
      </td>
      <td className="num px-3 py-2 text-center">
        <span className="text-text-dim">{r.plannedSessions ?? "—"}</span>
      </td>
      {/* 확정 회차 */}
      <td className="num relative px-3 py-2 text-center">
        {confirmed ? (
          !monthly && r.quantityBasis === "days" ? (
            <span className="text-danger cursor-help font-bold underline decoration-dotted underline-offset-4" {...DAYS_BASIS_TIP}>
              {r.confirmedSessions}
              <span className="sr-only"> · 일수 기준 · 재확정 필요</span>
            </span>
          ) : (
            <span className="text-foreground font-bold">{monthly ? "월 고정" : r.confirmedSessions}</span>
          )
        ) : monthly ? (
          <span className="text-text-dim text-xs">월 고정</span>
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
            className={`${NUM_INPUT} w-14 text-center`}
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
              className={`${NUM_INPUT} w-24 text-right`}
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
      {/* 이 반 청구액(참고) — `금액 꼬리표 · 수납 연결·배분`을 한 줄로. 배분 재확인은 꼬리표 자리에 앰버로(사유는 마우스 오버 카드). */}
      <td className="num text-muted-foreground px-3 py-2 text-right text-xs">
        {/* 오류 문구(수납 연결 불러오기 실패)만 아래로 꺾인다 — `flex-wrap` + 버튼 쪽 `basis-full`. 평소엔 한 줄. */}
        <div className="inline-flex flex-wrap items-baseline justify-end gap-x-2">
          {r.allocatedAmount != null ? <b>{won(r.allocatedAmount)}</b> : <span>{r.classAmount !== null ? won(r.classAmount) : "—"}</span>}
          {r.allocationStale ? (
            <span className="text-amber cursor-help" {...(r.classAmount !== null ? ALLOCATION_STALE_TIP : ALLOCATION_STALE_TIP_NO_AMOUNT)}>배분 재확인 필요</span>
          ) : r.allocatedAmount != null ? (
            <span>청구액 배분</span>
          ) : r.classAmount !== null ? (
            <span>이름 매칭 참고</span>
          ) : null}
          <ReceiptAllocationButton invoiceId={r.invoiceId} studentName={r.studentName} />
        </div>
      </td>
      {/* 개별 액션 */}
      <td className="px-3 py-2 text-right">
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
 * 표가 각자 열 너비를 계산해 카드끼리 열이 어긋난다("수업끼리 제각각") → 한 표로 합쳐 전 반이 같은 8열 공유.
 * table-fixed + colgroup으로 열 너비를 고정해 확정/미확정·반 무관하게 정렬을 못박는다.
 */
export function SessionTermGroups({
  groups,
  catalog,
  period,
}: {
  groups: ClassGroup[];
  catalog: Catalog;
  period: string;
}) {
  const listId = useId();
  const { patches } = useSessionTermsState();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftOf = (row: Row): Draft => drafts[row.id] ?? { sessions: String(row.plannedSessions ?? ""), price: "" };
  useBillingSettingsRefresh();
  return (
    <DragScrollArea className="border-border rounded-2xl border">
      <datalist id={listId}>
        {catalog.map((c) => (
          <option key={c.price} value={c.price} label={`${won(c.price)}${c.label ? ` · ${c.label}` : ""}`} />
        ))}
      </datalist>
      {/* 한 행 = 한 줄(원장 2026-09-16) — 비율은 칸에 실제로 서는 내용 폭에서 잡았다(예상 금액·이 반 청구액이 가장 길다:
          `148,750원 예상 · 7시수 × 21,250원` · `148,750원 이름 매칭 참고 수납 연결·배분`). 최소 폭 1,130px에서 각 칸이 제
          한 줄을 담는다(실제 글꼴로 잰 칸별 필요 폭 합 약 1,110px — 적대적 리뷰 2026-09-16). 🔴 수납 창 기본·최소 크기(1,160)에서
          가로 스크롤이 생기지 않게 이 폭을 넘기지 말 것(넘기면 '개별' 열 확정 버튼이 화면 밖으로 밀린다). 그보다 좁으면 끌어서 민다. */}
      <table className="w-full min-w-[1130px] table-fixed text-sm">
        <colgroup>
          <col className="w-[4%]" />
          <col className="w-[8.5%]" />
          <col className="w-[7.5%]" />
          <col className="w-[7.5%]" />
          <col className="w-[11%]" />
          <col className="w-[24.5%]" />
          <col className="w-[26%]" />
          <col className="w-[11%]" />
        </colgroup>
        <thead>
          <tr className="bg-bg-soft text-text-dim text-sm [&>th]:whitespace-nowrap">
            <th className="px-3 py-2 text-left font-bold">학년</th>
            <th className="px-3 py-2 text-left font-bold">이름</th>
            <th className="px-3 py-2 text-center font-bold">계획 시수</th>
            <th className="px-3 py-2 text-center font-bold">확정 시수</th>
            <th className="px-3 py-2 text-right font-bold">단가 / 월 금액</th>
            <th className="px-3 py-2 text-right font-bold">예상 / 확정 금액</th>
            <th className="px-3 py-2 text-right font-bold">이 반 청구액</th>
            <th className="px-3 py-2 text-right font-bold">개별</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => {
            const g = { ...group, students: group.students.map((row) => ({ ...row, ...patches[row.id] })) };
            const monthlyPrice = g.students[0]?.monthlyPrice ?? null;
            const confirmed = g.students.filter((s) => s.confirmedSessions !== null).length;
            const allDone = confirmed === g.students.length;
            return (
              <Fragment key={g.classId}>
                <tr className="bg-accent/40 border-border border-t-2">
                  <td colSpan={8} className="px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-foreground text-sm font-bold">{g.className}</span>
                        <span className="text-text-dim text-xs">{g.subjectLabel}</span>
                        <span className="text-text-faint text-xs">
                          · {g.students.length}명 · 계획 {plannedSummary(g.students)}
                          {monthlyPrice !== null ? " · 월 수강료" : ""} · 확정{" "}<span className={allDone ? "text-chart-2" : "text-amber"}>{confirmed}/{g.students.length}</span>
                        </span>
                      </div>
                      <ClassBatch period={period} group={g} listId={listId} onPrice={(price) => setDrafts((current) => {
                        const next = { ...current };
                        for (const row of g.students) if (row.confirmedSessions === null) next[row.id] = { ...(current[row.id] ?? { sessions: String(row.plannedSessions ?? "") }), price };
                        return next;
                      })} />
                    </div>
                  </td>
                </tr>
                {g.students.map((r) => (
                  <TermRow key={r.id} r={r} listId={listId} draft={draftOf(r)} onDraft={(draft) => setDrafts((current) => ({ ...current, [r.id]: draft }))} />
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
