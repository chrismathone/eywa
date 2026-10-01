export const metadata = { title: "수업 시간표" };

/**
 * 학부모 탭 3 '수업 시간표' — **자리만** 잡아 둔 섹션. 내용(아이가 듣는 반·요일·교시)은 다음 작업에서 채운다.
 */
export default function ParentClassesPage() {
  return (
    <>
      <h1 className="text-2xl font-bold">수업 시간표</h1>
      <section className="bg-card rounded-2xl p-6 text-center shadow-[var(--shadow-card)]">
        <p className="font-bold">준비 중인 기능이에요</p>
        <p className="text-text-dim mt-1 text-sm break-keep">아이가 듣는 수업의 요일과 시간을 여기서 볼 수 있게 준비하고 있어요.</p>
      </section>
    </>
  );
}
