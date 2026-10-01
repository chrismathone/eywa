export const metadata = { title: "실시간 차량" };

/**
 * 학부모 탭 1 '실시간 차량' — **자리만** 잡아 둔 섹션.
 *
 * 🔴 지어내지 않는다: 차량 위치를 보내는 기기(기사 폰 GPS)도 지도 키도 아직 없다(관리자 '실시간 위치'와 같은 상태).
 *    기능이 생기면 이 화면이 아이가 탄 차의 위치·도착 예정을 보여 준다.
 */
export default function ParentLivePage() {
  return (
    <>
      <h1 className="text-2xl font-bold">실시간 차량</h1>
      <section className="bg-card rounded-2xl p-6 text-center shadow-[var(--shadow-card)]">
        <p className="font-bold">준비 중인 기능이에요</p>
        <p className="text-text-dim mt-1 text-sm break-keep">
          아이가 탄 셔틀이 지금 어디쯤인지 지도로 볼 수 있게 준비하고 있어요.
        </p>
      </section>
    </>
  );
}
