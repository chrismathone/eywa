/**
 * MockBilling — 수납 관리 테이블 (청구·금액·상태 pill + 요약). 제품 목업.
 */
type Status = "완납" | "미납" | "부분";

const ROWS: { name: string; item: string; amount: string; status: Status }[] = [
  { name: "강OO", item: "6월 수강료", amount: "320,000", status: "완납" },
  { name: "김OO", item: "6월 수강료", amount: "280,000", status: "완납" },
  { name: "박OO", item: "6월 수강료 + 교재", amount: "345,000", status: "미납" },
  { name: "이OO", item: "6월 수강료", amount: "300,000", status: "부분" },
  { name: "정OO", item: "6월 수강료", amount: "280,000", status: "완납" },
];

const PILL: Record<Status, string> = {
  완납: "bg-green-soft text-green",
  미납: "bg-danger-soft text-danger",
  부분: "bg-amber-soft text-amber",
};

export function MockBilling() {
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-foreground text-[13px] font-extrabold">수납 관리 · 6월</p>
        <div className="flex items-center gap-3 font-mono text-[10px]">
          <span className="text-text-dim">
            수납률 <span className="text-primary font-bold">87.1%</span>
          </span>
          <span className="text-text-dim">
            미납 <span className="text-danger font-bold">3건</span>
          </span>
        </div>
      </div>

      <div className="overflow-hidden">
        <div className="text-text-faint border-line grid grid-cols-[1.3fr_2fr_1.2fr_0.9fr] gap-2 border-b pb-1.5 font-mono text-[9px] font-bold tracking-[0.06em] uppercase">
          <span>학생</span>
          <span>청구 항목</span>
          <span className="text-right">금액</span>
          <span className="text-right">상태</span>
        </div>
        {ROWS.map((r) => (
          <div
            key={r.name}
            className="border-line/60 grid grid-cols-[1.3fr_2fr_1.2fr_0.9fr] items-center gap-2 border-b py-2 last:border-0"
          >
            <span className="text-foreground text-[11px] font-bold">{r.name}</span>
            <span className="text-text-dim truncate text-[11px]">{r.item}</span>
            <span className="num text-foreground text-right text-[11px] font-semibold">₩{r.amount}</span>
            <span className="text-right">
              <span className={`inline-block rounded px-1.5 py-0.5 text-[9.5px] font-bold ${PILL[r.status]}`}>
                {r.status}
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
