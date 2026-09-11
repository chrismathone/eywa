"use client";

// 등록상담 병합 — 좌우 대조가 아니라 **"무엇이 어떻게 될지"를 그대로 보여주는** 화면.
// 규칙이 정한 것(자동)과 사람이 정할 것(선택)을 나눠 보여준다 — 자동 항목까지 다 물으면 아무도 안 쓴다.
//
// 🔴 값 판단은 서버(planMerge)만 한다. 이 컴포넌트는 계획을 그리고 **행 id만** 돌려보낸다.
import { useEffect, useState, useTransition } from "react";
import { AlertCircle, ArrowRight, Loader2 } from "@/components/icons/eywa-icon-compat";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { COLUMN_LABEL } from "@/features/enrollment/merge-policy";
import { outcomePill } from "@/features/enrollment/outcome-meta";
import type { MergePlan } from "@/features/enrollment/merge-plan";
import { mergeConsultations, previewConsultationMerge } from "@/features/enrollment/server/merge-actions";

type RowRef = { id: string; label: string; outcome: string; consultedAt: string; source: string };

const dateOf = (iso: string) => new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul" });

export function MergeDialog({
  ids,
  currentId,
  onClose,
  onMerged,
}: {
  ids: string[];
  /** 지금 보고 있는 상담 id — 이게 합쳐져 사라지면 페이지가 유령이 되므로 남은 쪽으로 보낸다. */
  currentId: string;
  onClose: () => void;
  /**
   * 병합 성공 뒤 할 일을 **호출부가 정한다**. 없으면 종전대로(진 쪽이면 남은 쪽으로 이동, 이긴 쪽이면 닫기).
   * 🔑 칸반 카드에서 열면 상세로 튕겨 나가면 안 된다 — 보드에 남아 새로고침만 하면 된다.
   */
  onMerged?: (winnerId: string) => void;
}) {
  const [plan, setPlan] = useState<MergePlan | null>(null);
  const [rows, setRows] = useState<RowRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  // null = 자동 추천을 그대로 쓴다. 사람이 다른 상담을 고르면 그 id가 들어간다.
  const [pickedWinner, setPickedWinner] = useState<string | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  // ⚠️ `ids`는 배열 prop이라 그대로 deps에 넣으면 부모가 리렌더될 때마다 새 참조 = 요청이 끝없이 돈다.
  const idsKey = [...ids].sort().join(",");

  useEffect(() => {
    let alive = true;
    void previewConsultationMerge(idsKey.split(","), pickedWinner ?? undefined).then((res) => {
      if (!alive) return;
      if (res.error || !res.plan) {
        setError(res.error ?? "병합 계획을 만들지 못했습니다");
        return;
      }
      setError(null);
      setPlan(res.plan);
      setRows(res.rows);
      // 계획이 바뀌면 이전 선택은 엉뚱한 행을 가리킬 수 있어 비운다.
      setChoices({});
    });
    return () => {
      alive = false;
    };
  }, [idsKey, pickedWinner]);

  const winnerId = pickedWinner ?? plan?.winnerId ?? null;

  const conflicts = plan?.decisions.filter((d) => d.needsHuman) ?? [];
  const autos = plan?.decisions.filter((d) => !d.needsHuman && d.status !== "same") ?? [];
  const undecided = conflicts.filter((d) => !choices[d.key]);
  const blocked = (plan?.blockers.length ?? 0) > 0;

  function submit() {
    if (!plan || !winnerId) return;
    startTransition(async () => {
      const res = await mergeConsultations(winnerId, plan.loserIds, choices);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`상담 ${plan.loserIds.length + 1}건을 1건으로 합쳤습니다`);
      if (onMerged) {
        onMerged(res.winnerId ?? winnerId);
        onClose();
        return;
      }
      // 🔴 지금 페이지가 지워진 쪽이면 그대로 두면 안 된다 — 없는 레코드를 계속 보여주게 된다.
      //    ⚠️ 서버 액션 직후의 router.push는 액션 응답이 덮어써 삼켜진다(gotcha #102) → location.assign.
      if (res.winnerId && res.winnerId !== currentId) {
        window.location.assign(`/enrollment/${res.winnerId}`);
        return;
      }
      onClose();
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">콜&상담 병합</DialogTitle>
        </DialogHeader>

        {error ? <p className="text-chart-4 text-sm">{error}</p> : null}

        {plan && !error ? (
          <div className="space-y-4 text-sm">
            {/* 남길 상담 — 자동 추천을 쓰되 사람이 바꿀 수 있다. */}
            <section>
              <h3 className="text-text-dim mb-1.5 text-xs font-semibold">남길 상담</h3>
              <div className="space-y-1">
                {rows.map((r) => (
                  <label
                    key={r.id}
                    className={`border-border flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 ${
                      r.id === winnerId ? "bg-primary/5 border-primary/40" : "bg-card"
                    }`}
                  >
                    <input
                      type="radio"
                      name="winner"
                      checked={r.id === winnerId}
                      onChange={() => setPickedWinner(r.id)}
                      className="accent-primary"
                    />
                    <span className="num text-text-dim">{dateOf(r.consultedAt)}</span>
                    <span className="text-foreground">{outcomePill(r.outcome).label}</span>
                    <span className="text-text-faint ml-auto text-xs">{r.source}</span>
                  </label>
                ))}
              </div>
            </section>

            {plan.blockers.length > 0 ? (
              <section className="border-chart-4/40 bg-chart-4/5 rounded-lg border p-3">
                <p className="text-chart-4 flex items-center gap-1.5 font-semibold">
                  <AlertCircle className="size-4" /> 병합할 수 없습니다
                </p>
                <ul className="text-muted-foreground mt-1 list-disc pl-5">
                  {plan.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            {plan.warnings.length > 0 ? (
              <ul className="border-amber/30 bg-amber-soft/30 text-muted-foreground space-y-1 rounded-lg border p-3">
                {plan.warnings.map((w) => (
                  <li key={w}>· {w}</li>
                ))}
              </ul>
            ) : null}

            {conflicts.length > 0 ? (
              <section>
                <h3 className="text-text-dim mb-1.5 text-xs font-semibold">
                  골라 주세요 <span className="num">{conflicts.length}</span>건
                </h3>
                <div className="space-y-2">
                  {conflicts.map((d) => (
                    <div key={d.key} className="border-border bg-card rounded-lg border p-2.5">
                      <p className="text-foreground mb-1.5 font-semibold">{COLUMN_LABEL[d.key] ?? d.key}</p>
                      {d.reason ? <p className="text-text-faint mb-1.5 text-xs">{d.reason}</p> : null}
                      <div className="flex flex-col gap-1.5">
                        {(d.options ?? []).map((o) => {
                          const row = rows.find((r) => r.id === o.rowId);
                          return (
                            <button
                              key={o.rowId}
                              type="button"
                              onClick={() => setChoices((c) => ({ ...c, [d.key]: o.rowId }))}
                              className={`rounded-md border px-2 py-1.5 text-left text-xs ${
                                choices[d.key] === o.rowId
                                  ? "border-primary bg-primary/10 text-foreground"
                                  : "border-border bg-bg-soft text-muted-foreground"
                              }`}
                            >
                              <span className="text-foreground">{o.preview}</span>
                              {row ? (
                                <span className="text-text-faint ml-1.5 whitespace-nowrap">
                                  <span className="num">{dateOf(row.consultedAt)}</span> · {row.source}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {autos.length > 0 ? (
              <section>
                <h3 className="text-text-dim mb-1.5 text-xs font-semibold">
                  자동으로 정해진 항목 <span className="num">{autos.length}</span>건
                </h3>
                <ul className="text-muted-foreground space-y-1">
                  {autos.map((d) => (
                    <li key={d.key} className="flex items-start gap-1.5">
                      <ArrowRight className="text-text-faint mt-0.5 size-3.5 shrink-0" />
                      <span>
                        <b className="text-foreground">{COLUMN_LABEL[d.key] ?? d.key}</b>
                        {d.reason ? ` — ${d.reason}` : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            취소
          </Button>
          <Button onClick={submit} disabled={!plan || blocked || undecided.length > 0 || pending}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {undecided.length > 0 ? `${undecided.length}건 더 골라 주세요` : "병합"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
