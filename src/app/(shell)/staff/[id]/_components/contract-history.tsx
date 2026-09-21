"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { toast } from "sonner";
import { Loader2, Pencil, Trash2, X } from "@/components/icons/aywa-icon-compat";
import { Button } from "@/components/ui/button";
import {
  deleteStaffContract,
  updateStaffContract,
  type ContractActionState,
} from "@/features/staff/server/contract-actions";
import { periodLabel, type ContractRow } from "@/features/staff/contract";

/**
 * 히스토리 정렬 — 최신이 위. 날짜가 있으면 날짜 내림차순, 날짜 없는 줄(인센티브 조항 등)은
 * 시트 원문 순서(line_no)를 따라 뒤에 붙인다. 원문 셀의 읽는 순서를 최대한 보존한다.
 */
function sortHistory(a: ContractRow, b: ContractRow): number {
  const ad = a.startDate ?? "";
  const bd = b.startDate ?? "";
  if (ad && bd && ad !== bd) return ad < bd ? 1 : -1;
  if (ad && !bd) return -1;
  if (!ad && bd) return 1;
  return (a.lineNo ?? 0) - (b.lineNo ?? 0);
}

const inputClass =
  "border-line bg-card text-foreground placeholder:text-text-faint focus:border-primary w-full rounded-lg border px-2.5 py-1.5 text-xs outline-none transition";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
      저장
    </Button>
  );
}

/**
 * 계약조건 히스토리 — 전 줄 수정·삭제(원장 지시 2026-08-03, 종전 "마지막 차수만 삭제" 제한 해제).
 * 현재계약도 이 목록의 최신 줄이라 여기서 고치면 위 현재계약 표시가 함께 바뀐다.
 */
export function ContractHistory({
  userId,
  rows,
  canWrite,
}: {
  userId: string;
  rows: ContractRow[];
  canWrite: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [terms, setTerms] = useState("");
  const [memo, setMemo] = useState("");

  const [upState, upAction] = useActionState<ContractActionState, FormData>(updateStaffContract, undefined);
  const [delState, delAction] = useActionState<ContractActionState, FormData>(deleteStaffContract, undefined);
  const seenUpRef = useRef<ContractActionState>(undefined);
  const seenDelRef = useRef<ContractActionState>(undefined);

  // 저장 성공 시 편집을 접는다 — 렌더 단계에서(effect 안 setState 금지 [[#25]]).
  const [closedFor, setClosedFor] = useState<ContractActionState>(undefined);
  if (upState?.ok && upState !== closedFor) {
    setClosedFor(upState);
    setEditingId(null);
  }

  useEffect(() => {
    if (!upState || upState === seenUpRef.current) return;
    seenUpRef.current = upState;
    if (upState.error) toast.error(upState.error);
    else if (upState.ok) toast.success(upState.notice ?? "수정했습니다");
  }, [upState]);
  useEffect(() => {
    if (!delState || delState === seenDelRef.current) return;
    seenDelRef.current = delState;
    if (delState.error) toast.error(delState.error);
    else if (delState.ok) toast.success(delState.notice ?? "삭제했습니다");
  }, [delState]);

  function startEdit(r: ContractRow) {
    setEditingId(r.id);
    setStart(r.startDate ?? "");
    setEnd(r.endDate ?? "");
    setTerms(r.terms ?? "");
    setMemo(r.memo ?? "");
  }

  return (
    <div className="mt-4">
      <p className="micro mb-2">계약조건 히스토리</p>
      {rows.length === 0 ? (
        <p className="text-text-faint text-xs">기입된 계약이 없습니다 — 연장할 때마다 여기에 쌓입니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {[...rows].sort(sortHistory).map((r) =>
            editingId === r.id ? (
              <li key={r.id} className="border-primary/40 rounded-lg border p-3">
                <form action={upAction}>
                  <input type="hidden" name="userId" value={userId} />
                  <input type="hidden" name="contractId" value={r.id} />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`eh-start-${r.id}`} className="micro mb-1 block">
                        시작일{r.kind === "note" ? " (선택)" : ""}
                      </label>
                      <input
                        id={`eh-start-${r.id}`}
                        name="startDate"
                        type="date"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor={`eh-end-${r.id}`} className="micro mb-1 block">
                        종료일{r.kind === "note" ? " (선택)" : ""}
                      </label>
                      <input
                        id={`eh-end-${r.id}`}
                        name="endDate"
                        type="date"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <label htmlFor={`eh-terms-${r.id}`} className="micro mt-2 mb-1 block">
                    계약조건
                  </label>
                  <input
                    id={`eh-terms-${r.id}`}
                    name="terms"
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    placeholder="예: 급여제 강사"
                    className={inputClass}
                  />
                  <label htmlFor={`eh-memo-${r.id}`} className="micro mt-2 mb-1 block">
                    메모
                  </label>
                  <input
                    id={`eh-memo-${r.id}`}
                    name="memo"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    placeholder="선택"
                    className={inputClass}
                  />
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setEditingId(null)}>
                      <X className="size-3.5" /> 취소
                    </Button>
                    <SaveButton />
                  </div>
                </form>
              </li>
            ) : (
              <li
                key={r.id}
                className="border-line flex items-start justify-between gap-3 rounded-lg border px-3 py-2"
              >
                <div className="min-w-0">
                  {/* 기간 있는 계약은 'N차 + 기간', 시트에서 온 이력 줄은 날짜(있으면) + 원문 그대로. */}
                  {r.kind === "contract" && r.startDate && r.endDate ? (
                    <p className="text-foreground text-xs font-medium">
                      <span className="text-text-dim">{r.seq}차</span>{" "}
                      <span className="num">{periodLabel({ startDate: r.startDate, endDate: r.endDate })}</span>
                    </p>
                  ) : (
                    <p className="text-text-dim text-xs">
                      {r.startDate ? <span className="num">{r.startDate}</span> : "기록"}
                    </p>
                  )}
                  {r.terms || r.memo ? (
                    <p className="text-text-dim mt-0.5 text-xs break-keep">
                      {[r.terms, r.memo].filter(Boolean).join(" · ")}
                    </p>
                  ) : null}
                </div>
                {canWrite ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(r)}
                      aria-label="수정"
                      title="이 줄을 수정합니다"
                      className="text-text-faint hover:text-primary transition"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <form
                      action={delAction}
                      onSubmit={(e) => {
                        if (!window.confirm("이 줄을 삭제할까요? 되돌릴 수 없습니다.")) e.preventDefault();
                      }}
                    >
                      <input type="hidden" name="userId" value={userId} />
                      <input type="hidden" name="contractId" value={r.id} />
                      <button
                        type="submit"
                        aria-label="삭제"
                        title="이 줄을 삭제합니다"
                        className="text-text-faint hover:text-danger transition"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </form>
                  </span>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
