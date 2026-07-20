import Link from "next/link";
import type { Session } from "../history";

const ATT_CLASS: Record<string, string> = {
  출석: "bg-primary-soft text-primary",
  지각: "bg-amber-soft text-amber",
  결석: "bg-danger-soft text-danger",
};

/** 최근 수업 기록 — 최신순. 클릭 시 그날 데일리 리포트로 이동. */
export function RecentRecords({ history }: { history: Session[] }) {
  const recs = [...history].reverse();
  return (
    <section className="bg-card border-line shadow-card rounded-2xl border p-5">
      <h2 className="text-foreground text-[15px] font-bold">
        최근 수업 기록{" "}
        <span className="text-text-faint text-[12px] font-normal">· 날짜를 누르면 그날 리포트로</span>
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
                <span className="tabular text-foreground w-9 text-[13px] font-bold">{h.date}</span>
                <span className={`rounded-[3px] px-1.5 py-0.5 text-[11px] font-bold ${ATT_CLASS[h.attendance]}`}>
                  {h.attendance}
                </span>
                <span className="ml-auto flex items-center gap-2.5 text-[12px]">
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
