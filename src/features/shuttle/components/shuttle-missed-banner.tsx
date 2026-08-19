import Link from "next/link";
import { getShuttleMissedForAttendance } from "../server/attendance-link";

/**
 * 오늘 출결 위에 뜨는 셔틀 신호 띠 — "셔틀에 안 탄 아이가 오늘 몇 명인지".
 *
 * 🔴 이것은 **신호일 뿐 결석이 아니다**(원장 2026-08-19 "신호만"). 부모가 직접 데려오면 셔틀은
 *    미탑승이어도 출석이라, 문구도 "결석"이 아니라 "확인하세요"로 쓴다.
 * ⚠️ 신호가 없으면 아무것도 그리지 않는다(빈 띠가 매일 자리를 차지하면 곧 안 보게 된다).
 */
export async function ShuttleMissedBanner({ date }: { date: string }) {
  const rows = await getShuttleMissedForAttendance(date);
  if (rows.length === 0) return null;

  return (
    <aside className="border-amber/30 bg-amber-soft rounded-2xl border px-3 py-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-amber text-[12.5px] font-bold">
          셔틀 미탑승 <span className="num">{rows.length}</span>명
        </span>
        <span className="text-text-dim text-[11.5px]">
          — 출결은 자동으로 바뀌지 않습니다. 등원 여부를 확인하세요.
        </span>
        <Link
          href={`/shuttle/today?d=${date}`}
          className="text-primary ml-auto text-[11.5px] font-bold hover:underline"
        >
          셔틀 등하원 보기
        </Link>
      </div>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
        {rows.map((r) => (
          <li key={r.studentId} className="text-text text-[12px]">
            <span className="font-bold">{r.studentName}</span>
            <span className="text-text-dim"> · {r.where}</span>
            {r.reason && <span className="text-text-dim"> · {r.reason}</span>}
          </li>
        ))}
      </ul>
    </aside>
  );
}
