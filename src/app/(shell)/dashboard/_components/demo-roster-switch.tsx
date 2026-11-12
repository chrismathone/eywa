"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { switchDemoRoster } from "@/features/demo-roster/server/actions";
import type { DemoRosterControl } from "@/features/demo-roster/types";

/** 데모 지점 대시보드 전용. 네 구성 중 하나를 고르면 확인 뒤에 그 구성으로 갈아끼운다. */
export function DemoRosterSwitch({ control }: { control: DemoRosterControl }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [ask, setAsk] = useState<string | null>(null);
  const [appliedId, setAppliedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const currentId = appliedId ?? control.currentId;
  const asked = control.options.find((option) => option.id === ask) ?? null;
  const current = control.options.find((option) => option.id === currentId) ?? null;

  const apply = () => {
    if (!ask) return;
    const id = ask;
    setError(null);
    start(async () => {
      const result = await switchDemoRoster(id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setAppliedId(id);
      setAsk(null);
      // 운영실 숫자는 5분 주기 조회라, 구성을 바꾼 뒤에는 그 주기를 기다리지 않고 바로 다시 읽는다.
      await queryClient.refetchQueries({ queryKey: ["dashboard-overview"], type: "active" });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-demo-roster="">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={pending}
          className="inline-flex min-h-[34px] items-center gap-1 rounded-md border border-ink bg-bg-soft px-2.5 font-semibold text-ink disabled:opacity-50"
        >
          {pending ? "바꾸는 중" : current ? `데모 데이터 · ${current.label}` : "데모 데이터"}
          <span aria-hidden>▾</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          {control.options.map((option) => (
            <DropdownMenuItem
              key={option.id}
              disabled={pending}
              onClick={() => {
                setError(null);
                setAsk(option.id);
              }}
            >
              {option.label}
              {option.id === currentId ? " · 사용 중" : ""}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {asked ? (
        <span className="text-sm">
          {asked.label}으로 바꿉니다. 이 지점의 가상 재원과 운영실에 보이는 데모 숫자만 갈아끼웁니다.
          <button
            type="button"
            className="text-primary ml-2 font-semibold underline underline-offset-4 disabled:opacity-50"
            disabled={pending}
            onClick={apply}
          >
            바꾸기
          </button>
          <button
            type="button"
            className="ml-2 underline underline-offset-4 disabled:opacity-50"
            disabled={pending}
            onClick={() => setAsk(null)}
          >
            취소
          </button>
        </span>
      ) : null}
      {control.mixed ? <span className="text-sm">구성이 섞여 있습니다. 하나를 고르면 정리됩니다.</span> : null}
      {error ? <span className="text-destructive text-sm">{error}</span> : null}
    </div>
  );
}
