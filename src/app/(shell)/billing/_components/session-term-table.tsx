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
import type { SessionPrice } from "@/features/billing/session-pricing";
import { useBillingSettingsRefresh } from "@/features/billing/use-billing-settings-refresh";
import { useSessionTermsState } from "./session-terms-state";

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
    if (sessions != null && (!Number.isInteger(sessions) || sessions < 0 || sessions > 99)) {
      setErr("회차는 0~99 정수");
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
        else if (res.terms) apply(res.terms);
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
            min={0}
            max={99}
            disabled={pending}
            placeholder="회차"
            value={sessionsInput}
            onChange={(e) => { setSessionsInput(e.target.value); setNotice(null); }}
            aria-label={`${group.className} 반 회차`}
            title="비우면 단가만 입력하고 미확정 상태로 유지"
            className="border-input bg-background num w-14 rounded-md border px-2 py-1 text-center text-xs"
          />
          <span className="text-text-faint text-xs">회 ×</span>
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
 * 학생 1명 행 — 개인 보정(반 일괄과 다른 회차/단가). 확정 여부와 무관하게 **같은 8열** 구조로 렌더해
 * 헤더와 정렬을 맞춘다(colSpan 금지 — 미확정 입력칸이 헤더 밖으로 밀리던 정렬버그). 미확정 행의 회차·단가
 * 입력과 확정 버튼은 서로 다른 `<td>`에 있지만 `form` 속성으로 한 폼에 묶인다(HTML5 폼 연결).
 */
type Draft = { sessions: string; price: string };
function TermRow({ r, listId, draft, onDraft }: { r: Row; listId: string; draft: Draft; onDraft: (draft: Draft) => void }) {
  const { apply } = useSessionTermsState();
  const [state, confirmAction, confirming] = useActionState<SessionTermActionState, FormData>(async (prev, data) => {
    try {
      const result = await confirmSessionTerm(prev, data);
      if (result?.terms) apply(result.terms);
      return result;
    } catch { return { error: "확정하지 못했습니다. 다시 시도해 주세요" }; }
  }, undefined);
  const [unState, unconfirmAction, unconfirming] = useActionState<SessionTermActionState, FormData>(async (prev, data) => {
    try {
      const result = await unconfirmSessionTerm(prev, data);
      if (result?.terms) {
        onDraft({ sessions: String(r.confirmedSessions ?? r.plannedSessions ?? ""), price: String(r.unitPrice ?? "") });
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
  const n = draft.sessions.trim() === "" ? NaN : Number(draft.sessions);
  const priceText = draft.price.replace(/[,\s]/g, "");
  const price = priceText === "" ? NaN : Number(priceText);
  const preview = monthly ? r.monthlyPrice : Number.isInteger(n) && n >= 0 && n <= 99 && Number.isFinite(price) && price >= 0 ? n * Math.round(price) : null;

  return (
    <tr aria-busy={pending} className="border-border hover:bg-accent/30 border-t transition-colors">
      <td className="text-muted-foreground px-3 py-2 text-xs">{r.studentGrade ?? "—"}</td>
      <td className="text-foreground px-3 py-2 font-medium">
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
      <td className="num px-3 py-2 text-center">
        {confirmed ? (
          <span className="text-foreground font-bold">{monthly ? "월 고정" : r.confirmedSessions}</span>
        ) : monthly ? (
          <span className="text-text-dim text-xs">월 고정</span>
        ) : (
          <input
            form={fid}
            name="sessions"
            type="number"
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
          <div aria-label={`${r.studentName} 예상금액`}>
            <span className="text-primary">{won(preview)}</span>
            <div className="text-text-dim text-xs font-normal">예상 · {monthly ? "월 정액" : `${n}회 × ${won(Math.round(price))}`}</div>
          </div>
        ) : "—"}
      </td>
      {/* 이 반 청구액(참고) */}
      <td className="num text-muted-foreground px-3 py-2 text-right text-xs">
        {r.classAmount !== null ? won(r.classAmount) : "—"}
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
        {err ? <p className="text-danger mt-1 text-xs">{err}</p> : null}
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
  return min === max ? `${min}회` : `${min}~${max}회`;
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
      <table className="w-full min-w-[860px] table-fixed text-sm">
        <colgroup>
          <col className="w-[7%]" />
          <col className="w-[15%]" />
          <col className="w-[8%]" />
          <col className="w-[12%]" />
          <col className="w-[16%]" />
          <col className="w-[14%]" />
          <col className="w-[16%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead>
          <tr className="bg-bg-soft text-text-dim text-sm">
            <th className="px-3 py-2 text-left font-bold">학년</th>
            <th className="px-3 py-2 text-left font-bold">이름</th>
            <th className="px-3 py-2 text-center font-bold">계획</th>
            <th className="px-3 py-2 text-center font-bold">확정</th>
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
