"use client";

function clamp(n: number, max: number) {
  return Math.max(0, Math.min(max, n));
}

/** 점수 셀 — 맞은 개수 입력 + /만점. allowMax면 만점(/N)도 편집 가능(학원 설정). (그리드 분해 0단계 이동) */
export function ScoreInput({
  value,
  max,
  onChange,
  label,
  allowMax,
  onMax,
}: {
  value: number | null;
  max: number;
  onChange: (v: number | null) => void;
  label: string;
  allowMax?: boolean;
  onMax?: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-0.5">
      <input
        inputMode="numeric"
        value={value == null ? "" : String(value)}
        aria-label={label}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9]/g, "");
          onChange(raw === "" ? null : clamp(parseInt(raw, 10) || 0, max));
        }}
        className="border-line focus:border-primary tabular h-8 w-10 rounded-sm border bg-background px-1 text-center text-[13px] font-bold outline-none"
      />
      <span className="text-text-faint tabular text-[11px]">/</span>
      {allowMax && onMax ? (
        <input
          inputMode="numeric"
          value={String(max)}
          aria-label={`${label} 문항수`}
          title="문항수(만점)"
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
            if (!Number.isNaN(n) && n > 0) onMax(n);
          }}
          className="border-line focus:border-primary tabular h-8 w-8 rounded-sm border bg-background px-0.5 text-center text-[11px] outline-none"
        />
      ) : (
        <span className="text-text-faint tabular text-[11px]">{max}</span>
      )}
    </div>
  );
}
