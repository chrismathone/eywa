"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  deleteScenario,
  saveCurrentAsScenario,
  type DeleteScenarioState,
  type SaveScenarioState,
} from "@/features/admin/server/actions";
import type { ScenarioRow } from "@/features/admin/server/queries";

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
      현재 상태 저장
    </Button>
  );
}

export function ScenariosClient({ scenarios }: { scenarios: ScenarioRow[] }) {
  const [state, action] = useActionState<SaveScenarioState, FormData>(
    saveCurrentAsScenario,
    undefined,
  );

  return (
    <div className="space-y-4">
      <form
        action={action}
        className="bg-card border-border space-y-3 rounded-md border p-4"
      >
        <h2 className="text-foreground text-sm font-semibold">새 시나리오 저장</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-muted-foreground block text-[11px] font-medium">이름</label>
            <input
              name="name"
              required
              placeholder="예: 2026 봄학기 시나리오 A"
              className="border-border bg-card text-foreground w-full rounded-md border px-3 py-1.5 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-muted-foreground block text-[11px] font-medium">메모</label>
            <input
              name="notes"
              placeholder="가설·의도"
              className="border-border bg-card text-foreground w-full rounded-md border px-3 py-1.5 text-sm"
            />
          </div>
        </div>
        <div className="flex items-center justify-end">
          <SaveBtn />
        </div>
        {state?.error ? <p className="text-chart-4 text-xs">{state.error}</p> : null}
        {state?.id ? <p className="text-chart-2 text-xs">저장 완료</p> : null}
      </form>

      <section className="bg-card border-border rounded-md border">
        <header className="border-border border-b px-5 py-3">
          <h2 className="text-foreground text-sm font-semibold">저장된 시나리오</h2>
        </header>
        {scenarios.length === 0 ? (
          <p className="text-muted-foreground px-5 py-8 text-center text-sm">
            저장된 시나리오가 없습니다
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {scenarios.map((s) => (
              <ScenarioItem key={s.id} scenario={s} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ScenarioItem({ scenario }: { scenario: ScenarioRow }) {
  const [, action] = useActionState<DeleteScenarioState, FormData>(deleteScenario, undefined);

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="flex-1">
        <p className="text-foreground text-sm font-medium">{scenario.name}</p>
        <p className="text-muted-foreground text-xs">
          {new Date(scenario.createdAt).toLocaleString("ko-KR")}
          {scenario.createdByName ? ` · ${scenario.createdByName}` : ""}
          {scenario.basePeriod ? ` · ${scenario.basePeriod} 기준` : ""}
        </p>
        {scenario.notes ? (
          <p className="text-muted-foreground mt-1 text-xs">{scenario.notes}</p>
        ) : null}
      </div>
      <form action={action}>
        <input type="hidden" name="id" value={scenario.id} />
        <button
          type="submit"
          className="text-muted-foreground hover:text-chart-4"
          aria-label="삭제"
        >
          <Trash2 className="size-3.5" />
        </button>
      </form>
    </li>
  );
}
