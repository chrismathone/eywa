"use client";

import { JJ_BOOKS, parseJjBooks, toggleJjBook } from "../jj-books";

/**
 * JJ 수업보고서 행의 교재 칸 — 자유 입력 대신 세 권 중에서 고른다(원장 2026-10-27, jj-books.ts).
 * 여러 권을 함께 고를 수 있다. 목록 밖 값(시트·직전 교재로 미리 채워진 것)은 보이지도 실리지도 않는다(jjBooksOnly, 2026-10-28).
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
  const { picked } = parseJjBooks(value);
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
            // 표의 교재 칸(160px)엔 'Listening (NTA)'가 한 줄로 안 들어간다 — 버튼 안에서 접는다(넘쳐 옆 칸을 덮지 않게).
            className={`min-h-7 max-w-full rounded-md border px-2 py-0.5 text-xs leading-tight font-bold break-keep transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
              on ? "border-primary bg-primary text-white" : "border-line bg-card text-text-dim hover:border-primary"
            }`}
          >
            {b}
          </button>
        );
      })}
    </div>
  );
}
