"use client";

/**
 * 학생을 다른 반에 놓았을 때 뜨는 팝업 맨 위의 **`반 이동` / `수업 나누기`** 전환(원장 2026-10-06 — 이름 확정).
 * 나누기 권한이 있는 사람에게만 보인다(없으면 팝업은 종전 그대로 반 이동만). 게이트는 서버 액션이 다시 본다([[#77]]).
 */
export function DropModeTabs({
  mode,
  onMove,
  onSplit,
}: {
  mode: "move" | "split";
  onMove?: () => void;
  onSplit?: () => void;
}) {
  const tab = (key: "move" | "split", label: string, hint: string, onClick?: () => void) => (
    <button
      type="button"
      onClick={key === mode ? undefined : onClick}
      aria-pressed={key === mode}
      className={`flex-1 rounded-md px-2 py-1.5 text-left transition ${
        key === mode ? "bg-primary text-primary-foreground" : "text-text-dim hover:bg-bg-soft"
      }`}
    >
      <span className="block text-xs font-bold">{label}</span>
      <span className={`block text-xs font-normal ${key === mode ? "opacity-85" : "text-text-faint"}`}>{hint}</span>
    </button>
  );
  return (
    <div className="border-line flex gap-1 rounded-lg border p-0.5" role="group" aria-label="옮기는 방식">
      {tab("move", "반 이동", "반을 통째로 옮김", onMove)}
      {tab("split", "수업 나누기", "일부 시간만 다른 반에서", onSplit)}
    </div>
  );
}
