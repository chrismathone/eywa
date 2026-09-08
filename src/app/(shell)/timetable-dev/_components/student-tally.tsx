/**
 * 학생 집계 인라인 스탯(재원/신입/전입/대기/퇴원) — 문법 ② 미니판(시간표는 세로 공간이 귀해
 * BigStat 카드 대신 인라인). 최상위 프레임에선 PageHeader 우측, 창(임베드)에선 헤더 줄을 통째로
 * 접고 툴바 우측에 이걸 넣는다(두 표면이 이 컴포넌트 하나를 공유 — 마크업 중복 금지).
 * 서버 컴포넌트(순수 마크업) — 이중 마운트돼도 상호작용이 없어 안전(#67 무관).
 */
export function StudentTally({
  enrolled,
  newCount,
  transferCount,
  holdCount,
  withdrawnCount,
}: {
  enrolled: number;
  newCount: number;
  transferCount: number;
  holdCount: number;
  withdrawnCount: number;
}) {
  const items = [
    { n: enrolled, label: "재원", cls: "text-primary", always: true },
    { n: newCount, label: "신입", cls: "text-danger", always: false },
    { n: transferCount, label: "전입", cls: "text-blue", always: false },
    { n: holdCount, label: "대기", cls: "text-amber", always: false },
    { n: withdrawnCount, label: "퇴원", cls: "text-text-faint", always: false },
  ];
  return (
    <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-1 whitespace-nowrap">
      {items
        .filter((it) => it.always || it.n > 0)
        .map((it) => (
          <span key={it.label} className="text-sm">
            <b className={`num ${it.cls} text-lg font-bold`}>{it.n}</b>{" "}
            <span className="text-text-dim">{it.label}</span>
          </span>
        ))}
    </div>
  );
}
