import { formatCheckValue, type AdviceView } from "../advice";

const TARGET_UNIT: Record<NonNullable<AdviceView["targets"]>["kind"], string> = { student: "명", class: "개 반", teacher: "명", consultation: "건" };

/** 실행 지표(일을 했는지) · 굳힌 대상 명단 — 결과 지표가 있는 의견만(s2_0039). 다시 잴 날·결과는 확인 지표 줄이 보인다. */
export function PlanLine({ view }: { view: AdviceView }) {
  if (!view.check) return null;
  const d = view.doneCheck;
  if (!d && !view.targets) return null;
  return (
    <p className="text-sm break-words">
      {d ? (
        <>
          <span className="font-bold">실행 지표</span> · {d.label}
          {d.baseline ? (
            <>
              {" · 기준값 "}
              <span className="num font-bold">{formatCheckValue(d.baseline.value, d.unit)}</span>
            </>
          ) : null}
        </>
      ) : null}
      {view.targets ? <span className="text-text-dim">{`${d ? " · " : ""}대상 ${view.targets.count}${TARGET_UNIT[view.targets.kind]} 고정`}</span> : null}
    </p>
  );
}
