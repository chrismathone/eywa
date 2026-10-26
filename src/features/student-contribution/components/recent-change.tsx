import { signedText } from "./presentation";

export const changeColor = (value: number) => Math.abs(value) < 0.005 ? "text-text-dim" : value > 0 ? "text-green" : "text-danger";
export function RecentChange({ value, largest }: { value: number | null; largest: number }) {
  if (value === null) return <span className="text-text-dim">—</span>;
  const zero = Math.abs(value) < 0.005;
  return <span className={`inline-flex items-center justify-end gap-2 font-medium ${changeColor(value)}`}>
    <span aria-hidden className="relative hidden h-2 w-16 rounded-full bg-secondary @6xl:block">
      <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
      {!zero && <span className={`absolute h-full rounded-full ${value < 0 ? "right-1/2 bg-danger" : "left-1/2 bg-green"}`}
        style={{ width: `${Math.min(50, Math.abs(value) / Math.max(largest, 1e-9) * 50)}%` }} />}
    </span><span className="@6xl:min-w-16">{signedText(value)}</span>
  </span>;
}
