"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";

const VALID = /^(19|20)\d{2}-\d{2}-\d{2}$/;

/**
 * 기간 '직접 지정'의 날짜 두 칸 — 원장 2026-09-28 *"기간필터도 원하는 기간 커스터마이징가능하게"*.
 * 🔴 입력은 **제 상태**로 들고, 칸을 벗어나거나 Enter일 때만 주소로 보낸다 — 값을 주소에 묶고 타자마다 이동하면
 *    일(日) 두 자리를 치는 사이에 칸이 옛 날짜로 되돌아가 두 번째 숫자가 엉뚱한 값에 붙는다(리뷰 2026-09-28).
 * 주소의 다른 값(`embed` 포함)은 그대로 들고 간다([[#133]]). 부모가 `key`로 주소 값이 바뀔 때 다시 세운다.
 */
export function CustomRange({ from, to }: { from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/withdrawals";
  const current = useSearchParams();
  const [draft, setDraft] = useState({ from, to });
  const commit = (next = draft) => {
    if (!VALID.test(next.from) || !VALID.test(next.to)) return;
    if (next.from === from && next.to === to) return;
    const params = new URLSearchParams(current?.toString() ?? "");
    params.set("range", "custom");
    params.set("from", next.from);
    params.set("to", next.to);
    params.delete("page");
    router.push(`${pathname}?${params.toString()}`);
  };
  const dateInput = `${CONTROL_H} ${CONTROL_LABEL} border-line bg-background rounded-lg border px-2`;
  const field = (key: "from" | "to", label: string) => (
    <input
      type="date"
      aria-label={label}
      className={dateInput}
      value={draft[key]}
      {...(key === "from" ? { max: draft.to } : { min: draft.from })}
      onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
  return (
    // 🔑 칸 하나를 떠날 때가 아니라 **두 칸을 다 떠날 때** 보낸다 — 시작일에서 Tab으로 종료일로 옮기는 순간 보내면
    //    화면이 다시 서며 종료일 칸의 포커스·입력 중 값이 날아간다(재리뷰 2026-09-28).
    <span
      className="inline-flex items-center gap-1.5"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) commit();
      }}
    >
      {field("from", "시작일")}
      <span aria-hidden>~</span>
      {field("to", "종료일")}
    </span>
  );
}
