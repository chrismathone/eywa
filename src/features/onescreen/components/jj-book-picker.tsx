"use client";

import { JJ_BOOKS, parseJjBooks, toggleJjBook } from "../jj-books";

/**
 * JJ 수업보고서 행의 교재 칸 — 자유 입력 대신 세 권 중에서 고른다(원장 2026-10-27, jj-books.ts).
 * 여러 권을 함께 고를 수 있다. 목록 밖 옛 값은 취소선 글자로 보여만 준다(한 권이라도 누르면 사라진다).
 */
export function JjBookPicker({
  value,
  onChange,
  disabled = false,
  label,
}: {
  value: string | null | undefined;
  onChange: (next: string) => void;
  disabled?: boolean;
  /** 칸 이름(스크린리더) — 호출부의 기존 교재 칸 aria-label을 그대로. */
  label: string;
}) {
  const { picked, other } = parseJjBooks(value);
  return (
    <div role="group" aria-label={label} className="flex min-w-0 flex-wrap items-center gap-1">
      {JJ_BOOKS.map((b) => {
        const on = picked.includes(b);
        return (
          <button
            key={b}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(toggleJjBook(value, b))}
            className={`h-7 shrink-0 rounded-md border px-2 text-xs font-bold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              on ? "border-primary bg-primary text-white" : "border-line bg-card text-text-dim hover:border-primary"
            }`}
          >
            {b}
          </button>
        );
      })}
      {other.length ? (
        <span className="text-text-faint min-w-0 overflow-hidden text-xs text-ellipsis whitespace-nowrap line-through" title={other.join(", ")}>
          {other.join(", ")}
        </span>
      ) : null}
    </div>
  );
}
