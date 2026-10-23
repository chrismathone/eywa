import { LEVELS } from "../math-report-pilot-sections";
import {
  parseScoreLine,
  type LevelRow,
  type PilotNoteSection,
} from "../pilot-notes";

// 수학 데일리 학습알림 표의 **머리**(원장 2026-10-23 참고 시안 — 칸이 맞물린 표 한 장) — 로고 · 학생 · 날짜·반·담임 → 테스트 → 수업 평가.
// 6열 격자 하나로 세 덩어리를 잇는다(왼쪽 라벨 열 24% + 눈금 다섯 칸). 색은 globals.css `--report-*`(학부모 문서 전용 축).

/** 눈금 다섯 칸의 색 — 머리칸(원색) / 고른 칸 바탕(옅게) / 동그라미. Tailwind가 읽도록 클래스 문자열을 통째로 적는다. */
const LV_TONE = [
  {
    head: "bg-report-lv1 text-white",
    soft: "bg-report-lv1-soft",
    dot: "bg-report-lv1 ring-report-lv1",
  },
  {
    head: "bg-report-lv2 text-white",
    soft: "bg-report-lv2-soft",
    dot: "bg-report-lv2 ring-report-lv2",
  },
  {
    head: "bg-report-lv3 text-white",
    soft: "bg-report-lv3-soft",
    dot: "bg-report-lv3 ring-report-lv3",
  },
  {
    head: "bg-report-lv4 text-primary-deep",
    soft: "bg-report-lv4-soft",
    dot: "bg-report-lv4 ring-report-lv4",
  },
  {
    head: "bg-report-lv5 text-white",
    soft: "bg-report-lv5-soft",
    dot: "bg-report-lv5 ring-report-lv5",
  },
] as const;

const CELL = "border-line-strong border text-center align-middle";
const LABEL = `${CELL} bg-report-accent text-primary-deep px-1 text-sm font-black break-keep`;

/** "2026-10-23" → "2026.10.23 (금)" — 칸이 좁아 한 줄에 들도록 붙여 쓴다. 문자열 분해 + UTC 요일이라 서버 시간대와 무관. */
export function sheetDateLabel(date: string | null): string {
  const [y, m, d] = (date ?? "").split("-").map(Number);
  if (!y || !m || !d) return "";
  const w = "일월화수목금토"[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}.${String(m).padStart(2, "0")}.${String(d).padStart(2, "0")} (${w})`;
}

/** 테스트 한 줄 — 점수 줄이면 큰 숫자 + 문제마다 점, 아니면(안 친 날 사유 등) 글 그대로. */
function TestCell({ s }: { s: PilotNoteSection }) {
  const lines = s.body.split("\n");
  const score = parseScoreLine(lines[0] ?? "");
  const rest = (score ? lines.slice(1) : lines).join("\n").trim();
  return (
    <td colSpan={5} className={`${CELL} px-3 py-2.5 text-left`}>
      {score ? (
        <div className="flex items-center justify-between gap-3">
          <div className="flex shrink-0 flex-col">
            <p className="text-primary flex items-baseline gap-1 tabular-nums">
              <span className="text-4xl leading-none font-black">
                {score.right}
              </span>
              <span className="text-text-dim text-xl font-bold">
                / {score.total}
              </span>
            </p>
            <p className="text-text-dim mt-1 text-sm font-semibold">
              {(lines[0] ?? "").trim()}
            </p>
          </div>
          {score.total <= 20 ? (
            <div
              className="flex max-w-[55%] flex-wrap justify-end gap-1"
              aria-hidden
            >
              {Array.from({ length: score.total }, (_, i) => (
                <span
                  key={i}
                  className={`size-3 rounded-full ${i < score.right ? "bg-primary" : "bg-line"}`}
                />
              ))}
            </div>
          ) : (
            <div
              className="bg-line h-2.5 w-2/5 overflow-hidden rounded-full"
              aria-hidden
            >
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${(score.right / score.total) * 100}%` }}
              />
            </div>
          )}
        </div>
      ) : null}
      {rest ? (
        <p
          className={`text-foreground leading-relaxed break-keep whitespace-pre-wrap ${score ? "mt-2 text-sm" : "text-base"}`}
        >
          {rest}
        </p>
      ) : null}
    </td>
  );
}

export type PilotSheetHeadProps = {
  logoSrc: string | null;
  academyName: string;
  subjectLabel: string | null;
  studentName: string;
  schoolGrade: string;
  title: string;
  date: string | null;
  className: string | null;
  teacherName: string | null;
  tests: PilotNoteSection[];
  levels: LevelRow[] | null;
};

export function PilotSheetHead(p: PilotSheetHeadProps) {
  return (
    <table className="w-full table-fixed border-collapse tabular-nums">
      <colgroup>
        <col className="w-[24%]" />
        {LEVELS.map((lv) => (
          <col key={lv} />
        ))}
      </colgroup>
      <tbody>
        <tr>
          <td rowSpan={3} className={`${CELL} bg-card px-1.5 py-2.5`}>
            {p.logoSrc ? (
              // eslint-disable-next-line @next/next/no-img-element -- 공개/인쇄 페이지 외부 로고(최적화 불필요)
              <img
                src={p.logoSrc}
                alt={p.academyName}
                className="mx-auto block w-full max-w-[118px] object-contain"
              />
            ) : (
              <p className="text-primary text-lg font-black break-keep">
                {p.academyName}
              </p>
            )}
            {p.subjectLabel ? (
              <span className="bg-report-accent text-primary-deep mt-1.5 inline-block rounded-full px-2.5 py-0.5 text-xs font-black">
                {p.subjectLabel}
              </span>
            ) : null}
          </td>
          <td
            colSpan={3}
            rowSpan={3}
            className={`${CELL} bg-primary px-2 py-3 text-white`}
          >
            <p className="text-2xl leading-tight font-black break-keep">
              {p.studentName}
            </p>
            <p className="text-report-accent mt-1 text-base font-bold break-keep">
              {p.title}
            </p>
            {p.schoolGrade ? (
              <p className="mt-1.5 text-xs font-medium text-white/80">
                {p.schoolGrade}
              </p>
            ) : null}
          </td>
          <td
            colSpan={2}
            className={`${CELL} bg-report-tint text-primary h-10 px-1 text-base font-black whitespace-nowrap`}
          >
            {sheetDateLabel(p.date)}
          </td>
        </tr>
        <tr>
          <td
            className={`${CELL} bg-report-accent-soft text-text-dim h-10 text-sm font-bold`}
          >
            반
          </td>
          <td
            className={`${CELL} text-foreground px-1 text-sm font-bold break-keep`}
          >
            {p.className || "-"}
          </td>
        </tr>
        <tr>
          <td
            className={`${CELL} bg-report-accent-soft text-text-dim h-10 text-sm font-bold`}
          >
            담임
          </td>
          <td
            className={`${CELL} text-foreground px-1 text-sm font-bold break-keep`}
          >
            {p.teacherName || "-"}
          </td>
        </tr>

        {p.tests.map((s) => (
          <tr key={s.title}>
            <th scope="row" className={LABEL}>
              {s.title}
            </th>
            <TestCell s={s} />
          </tr>
        ))}

        {p.levels ? (
          <>
            <tr>
              <th scope="col" className={`${LABEL} h-9`}>
                수업 평가
              </th>
              {LEVELS.map((lv, i) => (
                <th
                  key={lv}
                  scope="col"
                  className={`${CELL} ${LV_TONE[i]!.head} h-9 text-sm font-black`}
                >
                  {lv}
                </th>
              ))}
            </tr>
            {p.levels.map((r) => {
              const at = LEVELS.indexOf(r.level);
              return (
                <tr key={r.label}>
                  <th scope="row" className={`${LABEL} h-11`}>
                    {r.label}
                  </th>
                  {LEVELS.map((lv, i) => (
                    <td
                      key={lv}
                      className={`${CELL} h-11 ${i === at ? LV_TONE[i]!.soft : ""}`}
                    >
                      {i === at ? (
                        <span
                          aria-label={lv}
                          className={`${LV_TONE[i]!.dot} inline-block size-5 rounded-full ring-2 ring-offset-2 ring-offset-transparent align-middle`}
                        />
                      ) : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </>
        ) : null}
      </tbody>
    </table>
  );
}
