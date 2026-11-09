import { addDays } from "@/lib/date-kst";
import { CHECK_FAILED, CHECK_SKIPPED, formatCheckValue, monthDayLabel, NO_CHECK_GIVEN, type AdviceView } from "../advice";

/** 확인 지표 한 줄 — 기준값과 그 기간 · 좋아지는 쪽. 잴 수 없는 의견은 까닭. */
export function CheckLine({ view }: { view: AdviceView }) {
  const c = view.check;
  if (!c) {
    if (!view.noCheck) return null;
    const server = view.noCheck === NO_CHECK_GIVEN || view.noCheck === CHECK_FAILED || view.noCheck === CHECK_SKIPPED;
    return <p className="text-sm break-words">{server ? `확인 지표 없음 — ${view.noCheck}` : `숫자로 다시 재기 어려운 의견입니다 — ${view.noCheck}`}</p>;
  }
  const b = c.baseline;
  return (
    <p className="text-sm break-words">
      <span className="font-bold">확인 지표</span> · {c.label}
      {b ? (
        <>
          {" · 기준값 "}
          <span className="num font-bold">{formatCheckValue(b.value, c.unit)}</span>
          {c.unit === "percent" && b.sample !== null ? ` (${formatCheckValue(b.sample, "number")} 중)` : ""}
          {` · ${monthDayLabel(b.from)}~${monthDayLabel(addDays(b.to, -1))}`}
        </>
      ) : (
        " · 기준값을 재지 못했습니다"
      )}
      {` · ${c.better === "up" ? "오르면 좋음" : "내리면 좋음"}`}
    </p>
  );
}

const TARGET_UNIT: Record<NonNullable<AdviceView["targets"]>["kind"], string> = { student: "명", class: "개 반", teacher: "명", consultation: "건" };

/** 실행 지표 · 굳힌 대상 명단 · 다시 잴 날(실행일 기준) — 결과 지표가 있는 의견만(s2_0038). */
export function PlanLine({ view }: { view: AdviceView }) {
  const c = view.check;
  if (!c) return null;
  const d = view.doneCheck;
  const parts: string[] = [];
  if (view.targets) parts.push(`대상 ${view.targets.count}${TARGET_UNIT[view.targets.kind]} 고정`);
  if (c.nextCheckOn) parts.push(`${monthDayLabel(c.nextCheckOn)} 다시 잼${view.actedOn ? `(실행한 날 ${monthDayLabel(view.actedOn)}부터)` : "(채택·완료하면 그날부터 다시 셉니다)"}`);
  if (!d && parts.length === 0) return null;
  return (
    <div className="text-sm break-words">
      {d ? (
        <p>
          <span className="font-bold">실행 지표</span> · {d.label}
          {d.baseline ? (
            <>
              {" · 기준값 "}
              <span className="num font-bold">{formatCheckValue(d.baseline.value, d.unit)}</span>
            </>
          ) : null}
        </p>
      ) : null}
      {parts.length ? <p className="text-text-dim">{parts.join(" · ")}</p> : null}
    </div>
  );
}
