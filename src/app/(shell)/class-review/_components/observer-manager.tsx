"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "@/components/icons/eywa-icon-compat";
import { Button } from "@/components/ui/button";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { replaceReviewObserver } from "@/features/class-review/server/actions";

/**
 * 평가자 관리(지정 모드) — **아직 채점 안 한 평가자**를 다른 직원으로 바꾼다
 * (원장 2026-08-21). 채점을 마친 평가자는 잠겨 있다(바꾸면 점수가 사라진다).
 *
 * 사무실(canWrite·비-강사)만 렌더된다 — 서버 액션(replaceReviewObserver)이 같은 조건으로 재검증(#77).
 * 선택은 **fixed 오버레이 모달**(표 안 팝오버 금지 규칙 — overflow에 잘린다).
 */

export type ObserverRow = {
  /** users.id */
  id: string;
  name: string;
  submitted: boolean;
};

export function ObserverManager({
  docId,
  teacherId,
  observers,
  staff,
}: {
  docId: string;
  /** 평가 대상 강사 — 후보에서 뺀다(자기 자신을 평가할 수 없다). 서버도 거른다(이중). */
  teacherId: string;
  observers: ObserverRow[];
  /** 교체 후보(활성 직원). */
  staff: { value: string; label: string }[];
}) {
  const router = useRouter();
  // 교체 대상(모달) — 열려 있는 옛 평가자.
  const [editing, setEditing] = useState<ObserverRow | null>(null);
  const [pickedId, setPickedId] = useState("");
  const [pending, start] = useTransition();

  // 이미 이 평가에 든 사람·대상 강사는 후보에서 뺀다(서버도 거르지만 화면에서 미리).
  const takenIds = new Set([...observers.map((o) => o.id), teacherId]);
  const options = staff.filter((s) => !takenIds.has(s.value));

  function submit() {
    if (!editing || !pickedId) return;
    const fd = new FormData();
    fd.append("docId", docId);
    fd.append("oldObserverId", editing.id);
    fd.append("newObserverId", pickedId);
    start(async () => {
      const res = await replaceReviewObserver(undefined, fd);
      if (res?.error) toast.error(res.error);
      else if (res?.ok) {
        toast.success(res.notice ?? "평가자를 변경했습니다");
        setEditing(null);
        setPickedId("");
        router.refresh();
      }
    });
  }

  return (
    <div className="bg-card rounded-2xl p-5 shadow-card">
      <p className="micro mb-1">평가자 관리</p>
      <p className="text-text-dim mb-3 text-xs">
        아직 채점하지 않은 평가자는 다른 직원으로 바꿀 수 있습니다. 채점을 마친 평가자는 잠깁니다.
      </p>
      <ul className="divide-line divide-y">
        {observers.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="flex items-center gap-2">
              <span className="text-foreground text-sm font-medium">{o.name}</span>
              {o.submitted ? (
                <span className="bg-green-soft text-green rounded-full px-2 py-0.5 text-xs font-semibold">
                  채점 완료
                </span>
              ) : (
                <span className="bg-bg-soft text-text-dim rounded-full px-2 py-0.5 text-xs">미채점</span>
              )}
            </span>
            {o.submitted ? (
              <span className="text-text-faint text-xs">변경 불가</span>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(o);
                  setPickedId("");
                }}
              >
                변경
              </Button>
            )}
          </li>
        ))}
      </ul>

      {editing ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setEditing(null)}
          role="presentation"
        >
          <div
            className="bg-background border-line w-full max-w-sm rounded-xl border p-5 shadow-lg"
            role="dialog"
            aria-modal="true"
            aria-label="평가자 변경"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-foreground text-base font-bold">평가자 변경</h2>
            <p className="text-text-dim mt-1 text-sm">
              <span className="font-medium">{editing.name}</span> 님을 대신할 직원을 고르세요.
            </p>
            <div className="mt-3">
              <span className="micro mb-1 block">새 평가자</span>
              <SearchableSelect
                options={options}
                value={pickedId}
                onValueChange={setPickedId}
                placeholder="직원 선택"
                searchPlaceholder="이름 검색"
                ariaLabel="새 평가자"
              />
            </div>
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(null)}>
                취소
              </Button>
              <Button type="button" size="sm" disabled={pending || !pickedId} onClick={submit}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                변경
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
