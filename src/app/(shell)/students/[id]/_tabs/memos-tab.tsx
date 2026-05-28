import { getStudentMemos } from "@/features/students/server/queries";
import { MemoForm } from "../_components/memo-form";
import { DeleteMemoButton } from "../_components/memo-delete-button";

const CATEGORY_LABEL: Record<string, string> = {
  general: "일반",
  homework: "숙제/과제",
  behavior: "행동",
  parent: "학부모",
  health: "건강",
  other: "기타",
};

const CATEGORY_COLOR: Record<string, string> = {
  general: "bg-chart-1/10 text-chart-1 border-chart-1/20",
  homework: "bg-chart-2/10 text-chart-2 border-chart-2/20",
  behavior: "bg-chart-3/10 text-chart-3 border-chart-3/20",
  parent: "bg-chart-5/10 text-chart-5 border-chart-5/20",
  health: "bg-chart-4/10 text-chart-4 border-chart-4/20",
  other: "bg-muted text-muted-foreground border-border",
};

export async function MemosTab({ studentId }: { studentId: string }) {
  const memos = await getStudentMemos(studentId);

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-semibold">메모</h2>
        <p className="text-muted-foreground num text-xs">{memos.length}건</p>
      </header>

      <MemoForm studentId={studentId} />

      {memos.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">기록된 메모가 없습니다</p>
      ) : (
        <ul className="space-y-2">
          {memos.map((m) => (
            <li
              key={m.id}
              className="bg-card border-border space-y-1.5 rounded-md border px-3 py-2.5"
            >
              <header className="flex items-baseline justify-between">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                      CATEGORY_COLOR[m.category] ?? CATEGORY_COLOR.other
                    }`}
                  >
                    {CATEGORY_LABEL[m.category] ?? m.category}
                  </span>
                  {m.createdByName ? (
                    <span className="text-muted-foreground text-[11px]">{m.createdByName}</span>
                  ) : null}
                  <span className="text-muted-foreground num text-[10px]">
                    {new Date(m.createdAt).toLocaleString("ko-KR", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <DeleteMemoButton memoId={m.id} studentId={studentId} />
              </header>
              <p className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
                {m.content}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
