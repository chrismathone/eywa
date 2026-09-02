"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * 라벨 인쇄 범위 — 전체 / 번호 범위(`1~8, 10~15`). 적용하면 같은 창 안에서 `?range=…&all=…`로 다시 그린다
 * (인쇄 미리보기가 곧 결과라 별도 확인 단계가 없다). 잘못 적은 조각은 서버가 한글로 돌려준다.
 */
export function RangeForm({ range, all, max, error, count }: { range: string; all: boolean; max: number; error?: string; count: number }) {
  const router = useRouter();
  const [mode, setMode] = useState<"all" | "range">(range ? "range" : "all");
  const [text, setText] = useState(range);
  const [includeDisposed, setIncludeDisposed] = useState(all);

  function apply() {
    const q = new URLSearchParams();
    if (mode === "range" && text.trim()) q.set("range", text.trim());
    if (includeDisposed) q.set("all", "1");
    const qs = q.toString();
    router.replace(qs ? `?${qs}` : "?");
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-black/15 px-3 py-2 text-[12.5px]"
    >
      <label className="flex items-center gap-1.5">
        <input type="radio" name="scope" checked={mode === "all"} onChange={() => setMode("all")} /> 전체
      </label>
      <label className="flex items-center gap-1.5">
        <input type="radio" name="scope" checked={mode === "range"} onChange={() => setMode("range")} /> 범위(No)
      </label>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value.trim()) setMode("range");
        }}
        placeholder={`예: 1~8, 10~15  (1~${max})`}
        aria-label="번호 범위"
        className="h-8 w-56 rounded-md border border-black/25 px-2 text-[12.5px] outline-none focus:border-black/60"
      />
      <label className="flex items-center gap-1.5 text-black/70">
        <input type="checkbox" checked={includeDisposed} onChange={(e) => setIncludeDisposed(e.target.checked)} /> 폐기 포함
      </label>
      <Button type="submit" size="sm" variant="outline">
        적용
      </Button>
      <span className="text-black/60">
        라벨 <span className="num">{count}</span>장{error ? "" : ` · 번호는 표의 No와 같습니다`}
      </span>
      {error ? <span className="text-[12px] text-red-700">{error}</span> : null}
    </form>
  );
}
