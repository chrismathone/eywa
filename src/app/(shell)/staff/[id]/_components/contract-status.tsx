"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { CalendarClock, Loader2, Plus, Trash2, X } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/atoms/pill";
import {
  deleteLatestStaffContract,
  extendStaffContract,
  type ContractActionState,
} from "@/features/staff/server/contract-actions";
import { currentContract, daysUntil, nextContractDefault, periodLabel, type ContractRow } from "@/features/staff/contract";

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none transition";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {label}
    </Button>
  );
}

/**
 * 계약현황 — 현재계약(첫 출근일 기준 1년, 차수만큼 증감) + 계약조건 히스토리 + 연장.
 * 기간 계산은 순수 함수([`contract.ts`])가 단일 소스이고 여기선 그리기만 한다.
 */
export function ContractStatus({
  userId,
  hireDate,
  rows,
  today,
  canWrite,
}: {
  userId: string;
  hireDate: string | null;
  rows: ContractRow[];
  /** 서버가 넘긴 오늘 날짜("YYYY-MM-DD") — 클라에서 new Date()를 쓰면 시간대·하이드레이션이 어긋난다. */
  today: string;
  canWrite: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ContractActionState, FormData>(extendStaffContract, undefined);
  const [delState, delAction] = useActionState<ContractActionState, FormData>(deleteLatestStaffContract, undefined);
  const seenRef = useRef<ContractActionState>(undefined);
  const seenDelRef = useRef<ContractActionState>(undefined);

  // 성공하면 입력 패널을 접는다 — **렌더 단계**에서(effect 안 setState는 금지 [[#25]]).
  const [closedFor, setClosedFor] = useState<ContractActionState>(undefined);
  if (state?.ok && state !== closedFor) {
    setClosedFor(state);
    setOpen(false);
  }

  // 토스트는 부수효과라 effect에서.
  useEffect(() => {
    if (!state || state === seenRef.current) return;
    seenRef.current = state;
    if (state.error) toast.error(state.error);
    else if (state.ok) toast.success(state.notice ?? "저장했습니다");
  }, [state]);
  useEffect(() => {
    if (!delState || delState === seenDelRef.current) return;
    seenDelRef.current = delState;
    if (delState.error) toast.error(delState.error);
    else if (delState.ok) toast.success(delState.notice ?? "삭제했습니다");
  }, [delState]);

  const current = currentContract(rows, hireDate);
  const next = nextContractDefault(rows, hireDate);
  const left = current ? daysUntil(current.endDate, today) : null;
  // 만료됐거나 60일 안에 끝나면 '갱신할 때' — 배지와 버튼이 같은 기준을 쓴다.
  const dueSoon = left !== null && left <= 60;
  const latestId = rows.length > 0 ? [...rows].sort((a, b) => b.seq - a.seq)[0].id : null;

  return (
    <section className="border-line bg-card flex flex-col rounded-2xl border p-5 shadow-card">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="text-foreground text-sm font-bold">계약현황</h2>
        {canWrite && next ? (
          // 만료됐거나 임박하면 채운 버튼 + '계약 갱신'으로 — 지난 계약을 못 보고 지나치지 않게(원장 지시).
          <Button variant={dueSoon ? "default" : "outline"} size="sm" onClick={() => setOpen((v) => !v)}>
            {open ? <X className="size-3.5" /> : <Plus className="size-3.5" />}
            {open ? "취소" : dueSoon ? "계약 갱신" : "계약 연장"}
          </Button>
        ) : null}
      </div>

      {/* 현재계약 */}
      {current ? (
        <div className="border-line bg-bg-soft/40 rounded-xl border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="micro">현재 계약</span>
            <Pill color="primary" soft>
              {current.seq}차
            </Pill>
            {left !== null ? (
              left < 0 ? (
                <Pill color="danger" soft>
                  만료 {Math.abs(left)}일 지남
                </Pill>
              ) : left <= 60 ? (
                <Pill color="amber" soft>
                  만료 {left}일 전
                </Pill>
              ) : null
            ) : null}
          </div>
          <p className="num text-foreground mt-1.5 text-base font-bold">{periodLabel(current)}</p>
          {!current.stored ? (
            <p className="text-text-faint mt-1 text-[11px]">
              입사일 기준으로 계산한 기간입니다 — 실제 계약서와 다르면 &lsquo;계약 연장&rsquo;으로 기입하세요.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="border-line rounded-xl border border-dashed p-4 text-center">
          <CalendarClock className="text-text-faint mx-auto size-5" />
          <p className="text-text-dim mt-1.5 text-xs">
            입사일이 없어 계약 기간을 계산할 수 없습니다 — 이력서에서 입사일을 먼저 입력하세요.
          </p>
        </div>
      )}

      {/* 연장 폼 */}
      {open && next ? (
        <form action={formAction} className="border-line mt-4 rounded-xl border p-4">
          <input type="hidden" name="userId" value={userId} />
          <p className="micro mb-2">{next.seq}차 계약 기입</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="c-start" className="micro mb-1 block">
                시작일
              </label>
              <input id="c-start" name="startDate" type="date" defaultValue={next.startDate} className={inputClass} />
            </div>
            <div>
              <label htmlFor="c-end" className="micro mb-1 block">
                종료일
              </label>
              <input id="c-end" name="endDate" type="date" defaultValue={next.endDate} className={inputClass} />
            </div>
          </div>
          <label htmlFor="c-terms" className="micro mt-3 mb-1 block">
            계약조건
          </label>
          <input id="c-terms" name="terms" placeholder="예: 급여제 강사" className={inputClass} />
          <label htmlFor="c-memo" className="micro mt-3 mb-1 block">
            메모
          </label>
          <input id="c-memo" name="memo" placeholder="선택" className={inputClass} />
          <div className="mt-3 flex justify-end">
            <SubmitButton label="계약 기입" />
          </div>
        </form>
      ) : null}

      {/* 히스토리 */}
      <div className="mt-4">
        <p className="micro mb-2">계약조건 히스토리</p>
        {rows.length === 0 ? (
          <p className="text-text-faint text-xs">기입된 계약이 없습니다 — 연장할 때마다 여기에 쌓입니다.</p>
        ) : (
          <ul className="space-y-1.5">
            {[...rows]
              .sort((a, b) => b.seq - a.seq)
              .map((r) => (
                <li
                  key={r.id}
                  className="border-line flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-foreground text-xs font-medium">
                      <span className="text-text-dim">{r.seq}차</span>{" "}
                      <span className="num">{periodLabel(r)}</span>
                    </p>
                    {r.terms || r.memo ? (
                      <p className="text-text-dim mt-0.5 text-[11px] break-keep">
                        {[r.terms, r.memo].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                  {canWrite && r.id === latestId ? (
                    <form action={delAction}>
                      <input type="hidden" name="userId" value={userId} />
                      <input type="hidden" name="contractId" value={r.id} />
                      <button
                        type="submit"
                        aria-label={`${r.seq}차 계약 삭제`}
                        title="마지막 차수만 삭제할 수 있습니다"
                        className="text-text-faint hover:text-danger shrink-0 transition"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
      </div>
    </section>
  );
}
