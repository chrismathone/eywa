import { getStudentMemos } from "@/features/students/server/queries";
import { MemoForm } from "../_components/memo-form";
import { MemoItem } from "../_components/memo-item";

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
            <MemoItem key={m.id} memo={m} studentId={studentId} />
          ))}
        </ul>
      )}
    </div>
  );
}
