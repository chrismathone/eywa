"use client";

export function PrintManualActions() {
  return (
    <div className="mx-auto flex max-w-[190mm] justify-end gap-2 px-4 py-4 print:hidden">
      <button type="button" onClick={() => window.print()}
        className="rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-800">
        PDF로 저장 / 인쇄
      </button>
    </div>
  );
}
