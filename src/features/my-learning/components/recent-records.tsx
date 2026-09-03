import Link from "next/link";
import { ATT_SOFT } from "@/features/attendance/status-color";
import type { Session } from "../history";

// 색은 출결 단일 소스 — 같은 달력을 그리는 attendance-calendar와 **같은 상수**를 쓴다.
const ATT_CLASS: Record<string, string> = {
  출석: ATT_SOFT.present,
  지각: ATT_SOFT.late,
  결석: ATT_SOFT.absent,
};

/** 최근 수업 기록 — 최신순. 클릭 시 그날 데일리 리포트로 이동. */
export function RecentRecords({ history }: { history: Session[] }) {
  const recs = [...history].reverse();
  return (
    <section className="bg-card border-line shadow-card rounded-2xl border p-5">
      <h2 className="text-foreground text-base font-bold">
        최근 수업 기록{" "}
        <span className="text-text-faint text-xs font-normal">· 날짜를 누르면 그날 리포트로</span>
      </h2>
      <ul className="divide-line mt-2 divide-y">
        {recs.map((h) => {
          const absent = h.attendance === "결석";
          return (
            <li key={h.date}>
              <Link
                href={`/my-learning/report?date=${encodeURIComponent(h.date)}`}
                className="hover:bg-bg-soft -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition"
              >
                <span className="tabular text-foreground w-9 text-sm font-bold">{h.date}</span>
                <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${ATT_CLASS[h.attendance]}`}>
                  {h.attendance}
                </span>
                <span className="ml-auto flex items-center gap-2.5 text-xs">
                  <span className={`tabular ${absent ? "text-text-faint" : "text-text-dim"}`}>
                    일일 {absent ? "—" : h.daily}
                  </span>
                  <span className={`tabular ${absent ? "text-text-faint" : "text-text-dim"}`}>
                    확인 {absent ? "—" : h.check}
                  </span>
                </span>
                <span className="text-text-faint">›</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
