"use client";

import { useState } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { loadReferrerOptions } from "@/features/enrollment/server/referrer-actions";
import type { ReferrerOption } from "@/features/enrollment/referrer";
import { writeLockedPlaceholder } from "@/lib/write-lock";

/**
 * 콜&상담 '소개한 사람'(0362a) — 원생·직원 이름으로 걸러 고른다. 강사평가 '원생 소개'가 이 연결만 센다.
 * - 목록은 칸을 **처음 열 때** 불러온다(수정 화면을 열 때마다 학생 전체를 읽지 않게).
 * - 글에 이름이 그대로 나온 원생·직원은 **후보**로만 띄운다 — 눌러야 연결된다(자동 확정 안 함, 원장 2026-10-13).
 * - QR 신청서에 학부모가 적은 이름(`referrerName`)은 그대로 보존하고 옆에 보인다.
 * - `disabled`(읽기 권한) = 고르기 칸 비활성 + 권한 안내, '지우기'·'연결' 단추는 그리지 않는다(원장 2026-11-05 · write-lock.ts).
 *   목록 조회(`loadReferrerOptions`)도 쓰기 게이트라 열리지 않는 칸이 맞다.
 */
export function ReferrerField({ initial, initialName, candidates, disabled = false }: {
  initial: { value: string; label: string; hint: string } | null;
  initialName: string | null;
  candidates: ReferrerOption[];
  disabled?: boolean;
}) {
  const [value, setValue] = useState(initial?.value ?? "");
  const [options, setOptions] = useState<ReferrerOption[]>(initial ? [initial] : []);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const load = async () => {
    if (state === "loading" || state === "ready") return;
    setState("loading");
    const res = await loadReferrerOptions();
    if (!res.ok) { setState("error"); return; }
    // 이미 고른 사람이 목록에 없으면(퇴원 등) 그대로 남겨 둔다 — 고른 값이 말없이 사라지지 않게.
    const picked = options.filter((o) => o.value === value && !res.options.some((x) => x.value === o.value));
    setOptions([...picked, ...res.options]);
    setState("ready");
  };
  const pick = (o: ReferrerOption) => {
    setOptions((prev) => (prev.some((x) => x.value === o.value) ? prev : [o, ...prev]));
    setValue(o.value);
  };
  const shown = candidates.filter((c) => c.value !== value);

  return (
    <div className="space-y-1.5">
      <input type="hidden" name="referrer" value={value} />
      <input type="hidden" name="referrerName" value={initialName ?? ""} />
      <div className="flex items-center gap-1.5">
        <SearchableSelect
          options={options.map((o) => ({ value: o.value, label: o.label, hint: o.hint }))}
          value={value}
          onValueChange={setValue}
          onOpenChange={(open) => { if (open) void load(); }}
          requireQuery
          disabled={disabled}
          placeholder={disabled ? writeLockedPlaceholder("enrollment") : "이름으로 찾기"}
          searchPlaceholder={state === "loading" ? "목록을 불러오는 중…" : "원생·직원 이름"}
          ariaLabel="소개한 사람"
          className="min-w-0 flex-1"
          portal
        />
        {value && !disabled ? (
          <button type="button" onClick={() => setValue("")} className="text-text-dim hover:text-foreground shrink-0 text-xs underline-offset-2 hover:underline">
            지우기
          </button>
        ) : null}
      </div>
      {state === "error" ? <p role="alert" className="text-danger text-xs">목록을 불러오지 못했습니다. 다시 열어 주세요.</p> : null}
      {initialName ? <p className="text-text-dim text-xs">신청서에 적은 이름: {initialName}</p> : null}
      {shown.length && !disabled ? (
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-text-dim">글에 나온 이름</span>
          {shown.map((c) => (
            <button key={c.value} type="button" onClick={() => pick(c)} className="border-border hover:bg-primary-softer rounded-full border px-2 py-0.5">
              {c.label}{c.hint ? ` · ${c.hint}` : ""} 연결
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
