"use client";
import { TOOLBAR_CHIP, TOOLBAR_CHIP_OFF } from "@/components/toolbar-controls";

import { Fragment, useActionState, useState, useTransition } from "react";
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

const KRW = new Intl.NumberFormat("ko-KR");
const won = (n: number) => `${KRW.format(n)}원`;

type Row = SessionTermRow & { subjectLabel: string };
type Catalog = { id: string; name: string; price: number }[];
export type ClassGroup = { classId: string; className: string; subjectLabel: string; students: Row[] };

/** 계획 갱신 — 확정값은 보존하고 계획 N만 재산출(서버 액션이 보장). */
export function RefreshPlanButton({ period }: { period: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await refreshPlannedTerms(period);
          if (res?.error) alert(res.error);
          else router.refresh();
        })
      }
      className={`${TOOLBAR_CHIP} gap-1.5 ${TOOLBAR_CHIP_OFF} disabled:opacity-50`}
      title="시간표·수강 기간·공휴일 기준으로 반별 계획 회차를 다시 계산합니다 (확정된 값은 유지)"
    >
      {pending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
      계획 갱신
    </button>
  );
}

/** 반 일괄 확정 — 이 반 전원을 (회차 · 회당 단가)로 한 번에 확정. 회차 비우면 각자 계획 회차 적용. */
function ClassBatch({ period, group, catalog }: { period: string; group: ClassGroup; catalog: Catalog }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const listId = `class-price-${group.classId}`;

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
    start(async () => {
      const res = await confirmClassTerms(period, group.classId, price, sessions);
      if (res.error) setErr(res.error);
      else router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-1.5">
      <input
        name="sessions"
        type="number"
        min={0}
        max={99}
        placeholder="계획"
        aria-label={`${group.className} 반 회차`}
        title="비우면 학생별 계획 회차를 그대로 적용"
        className="border-input bg-background num w-14 rounded-md border px-2 py-1 text-center text-xs"
      />
      <span className="text-text-faint text-xs">회 ×</span>
      <input
        name="unitPrice"
        type="text"
        inputMode="numeric"
        list={listId}
        placeholder="단가"
        aria-label={`${group.className} 회당 단가`}
        className="border-input bg-background num w-24 rounded-md border px-2 py-1 text-right text-xs"
      />
      <datalist id={listId}>
        {catalog.map((c) => (
          <option key={c.id} value={c.price}>
            {c.name}
          </option>
        ))}
      </datalist>
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold transition disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-3 animate-spin" /> : null}이 반 일괄 확정
      </button>
      {err ? <span className="text-danger text-xs">{err}</span> : null}
    </form>
  );
}

const NUM_INPUT = "border-input bg-background num rounded-md border px-2 py-1 text-xs";

/**
 * 학생 1명 행 — 개인 보정(반 일괄과 다른 회차/단가). 확정 여부와 무관하게 **같은 8열** 구조로 렌더해
 * 헤더와 정렬을 맞춘다(colSpan 금지 — 미확정 입력칸이 헤더 밖으로 밀리던 정렬버그). 미확정 행의 회차·단가
 * 입력과 확정 버튼은 서로 다른 `<td>`에 있지만 `form` 속성으로 한 폼에 묶인다(HTML5 폼 연결).
 */
function TermRow({ r, catalog }: { r: Row; catalog: Catalog }) {
  const [state, confirmAction] = useActionState<SessionTermActionState, FormData>(confirmSessionTerm, undefined);
  const [unState, unconfirmAction] = useActionState<SessionTermActionState, FormData>(unconfirmSessionTerm, undefined);
  const confirmed = r.confirmedSessions !== null;
  const err = state?.error ?? unState?.error;
  const fid = `stf-${r.id}`;
  const listId = `price-presets-${r.id}`;

  return (
    <tr className="border-border hover:bg-accent/30 border-t transition-colors">
      <td className="text-muted-foreground px-3 py-2 text-xs">{r.studentGrade ?? "—"}</td>
      <td className="text-foreground px-3 py-2 font-medium">
        {r.studentName}
        {/* 미확정 행의 확정 폼(빈 폼) — 회차/단가 입력·확정 버튼이 form 속성으로 여기에 묶인다. */}
        {!confirmed ? (
          <form id={fid} action={confirmAction} className="hidden">
            <input type="hidden" name="id" value={r.id} />
          </form>
        ) : null}
      </td>
      <td className="num px-3 py-2 text-center">
        <span className="text-text-dim">{r.plannedSessions ?? "—"}</span>
      </td>
      {/* 확정 회차 */}
      <td className="num px-3 py-2 text-center">
        {confirmed ? (
          <span className="text-foreground font-bold">{r.confirmedSessions}</span>
        ) : (
          <input
            form={fid}
            name="sessions"
            type="number"
            min={0}
            max={99}
            defaultValue={r.plannedSessions ?? ""}
            aria-label={`${r.studentName} 확정 회차`}
            className={`${NUM_INPUT} w-14 text-center`}
          />
        )}
      </td>
      {/* 회당 단가 */}
      <td className="num px-3 py-2 text-right">
        {confirmed ? (
          r.unitPrice !== null ? (
            won(r.unitPrice)
          ) : (
            "—"
          )
        ) : (
          <>
            <input
              form={fid}
              name="unitPrice"
              type="text"
              inputMode="numeric"
              list={listId}
              placeholder="단가"
              aria-label={`${r.studentName} 회당 단가`}
              className={`${NUM_INPUT} w-24 text-right`}
            />
            <datalist id={listId}>
              {catalog.map((c) => (
                <option key={c.id} value={c.price}>
                  {c.name}
                </option>
              ))}
            </datalist>
          </>
        )}
      </td>
      {/* 확정 금액 */}
      <td className="num text-foreground px-3 py-2 text-right font-bold">
        {confirmed && r.amount !== null ? won(r.amount) : "—"}
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
            <button type="submit" className="text-text-dim hover:text-foreground text-xs underline-offset-2 hover:underline">
              해제
            </button>
          </form>
        ) : (
          <button
            type="submit"
            form={fid}
            className="bg-primary text-primary-foreground rounded-lg px-2.5 py-1 text-xs font-bold"
          >
            확정
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
  return (
    <DragScrollArea className="border-border rounded-2xl border">
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
          <tr className="bg-bg-soft text-text-faint">
            <th className="eyebrow px-3 py-1.5 text-left font-normal">학년</th>
            <th className="eyebrow px-3 py-1.5 text-left font-normal">이름</th>
            <th className="eyebrow px-3 py-1.5 text-center font-normal">계획</th>
            <th className="eyebrow px-3 py-1.5 text-center font-normal">확정</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">회당 단가</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">확정 금액</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">이 반 청구액</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">개별</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
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
                          · {g.students.length}명 · 계획 {plannedSummary(g.students)} · 확정{" "}
                          <span className={allDone ? "text-chart-2" : "text-amber"}>
                            {confirmed}/{g.students.length}
                          </span>
                        </span>
                      </div>
                      <ClassBatch period={period} group={g} catalog={catalog} />
                    </div>
                  </td>
                </tr>
                {g.students.map((r) => (
                  <TermRow key={r.id} r={r} catalog={catalog} />
                ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </DragScrollArea>
  );
}
