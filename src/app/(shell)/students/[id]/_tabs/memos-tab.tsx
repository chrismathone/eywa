
import { SheetText } from "@/features/teacher-view/interface-label";
import { getStudentMemos } from "@/features/students/server/queries";
import { MemoForm } from "../_components/memo-form";
import { MemoItem } from "../_components/memo-item";

/** canWrite = `canWriteTenant(role, "students")`(메모 서버 액션 게이트와 같은 판정) — page.tsx가 계산해 내린다. */
export async function MemosTab({ studentId, canWrite }: { studentId: string; canWrite: boolean }) {
  const memos = await getStudentMemos(studentId);

  return (
    <div className="space-y-4">
      <header className="border-border flex items-baseline justify-between border-b pb-3">
        <h2 className="text-foreground text-base font-bold"><SheetText value={"특이사항"} /></h2>
        <p className="text-muted-foreground num text-xs">{memos.length}<SheetText value={"건"} /></p>
      </header>

      <MemoForm studentId={studentId} canWrite={canWrite} />

      {memos.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm"><SheetText value={"기록된 특이사항이 없습니다"} /></p>
      ) : (
        // 메모는 짧은 카드라 1열로만 쌓으면 넓은 창에서 한 건이 1900px 한 줄을 다 먹는다. auto-fit으로
        // 폭이 되는 만큼 열을 늘린다(1건이면 전폭 = 기존과 동일). items-start = 카드가 같은 행 최고
        // 높이로 늘어나지 않게(한 줄 메모가 긴 메모 높이만큼 부풀지 않음).
        <ul className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] items-start gap-2">
          {memos.map((m) => (
            <MemoItem key={m.id} memo={m} studentId={studentId} canWrite={canWrite} />
          ))}
        </ul>
      )}
    </div>
  );
}
