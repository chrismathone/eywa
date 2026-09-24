"use client";

import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { PLAN_PRESETS } from "@/features/super-admin/labels";

/**
 * 플랜 입력 — 자유 입력 칸 + **빠른 선택 칩**(드롭다운 규약: 자유 입력 필드는 datalist·select 대신 칩).
 * 칩은 한글 이름을 보이고 저장 값(`free`·`pro`·`enterprise`)을 채운다 — 화면이 저장 코드를 읽게 하지 않는다.
 * ⚠️ 칩 클릭은 `input` 이벤트를 내보내 폼이 변경을 알아챈다(직원관리 직급 칸과 같은 방식).
 */
export function PlanField({ defaultValue = "free" }: { defaultValue?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="block">
      <span className="text-foreground text-sm font-bold">플랜</span>
      <Input ref={ref} type="text" name="plan" defaultValue={defaultValue} className="mt-1" />
      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {PLAN_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => {
              const el = ref.current;
              if (!el) return;
              el.value = p.value;
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }}
            className="border-line text-foreground hover:bg-muted cursor-pointer rounded-md border px-2 py-0.5 text-xs font-medium"
          >
            {p.label}
          </button>
        ))}
        <span className="text-foreground text-xs">— 그 밖의 플랜은 직접 적습니다.</span>
      </span>
    </label>
  );
}
