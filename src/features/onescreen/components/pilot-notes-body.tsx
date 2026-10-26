import { LEVELS } from "../math-report-pilot-sections";
import { isPilotTitle, parseLevelRows, parseScoreLine, type LevelRow, type PilotNoteSection } from "../pilot-notes";

// 항목별 보고서 글을 학부모 카드(/r·인쇄 = ClassNote 게시 사진)에 그린다 — 원장 2026-10-23 시안 B(막대형 표) 확정
// + *"표에맞게 밑에도 어느정도 디자인 맞춰서"*. 색은 학원 색(primary) 한 가지뿐 — 상·하를 다른 색으로 가르면 '하'가 경고처럼 읽힌다.
// 조각 판정은 pilot-notes.ts(순수). 형식이 안 맞는 항목은 글 그대로 그린다(표를 지어내지 않는다).

/** 시안 B — 고른 등급까지 칸을 채우고 끝 칸에 등급 글자. 열 폭은 colgroup 고정(등급 글자 길이로 표가 안 밀린다). */
function LevelTable({ rows }: { rows: LevelRow[] }) {
  return (
    <table className="border-line w-full table-fixed border-collapse border text-sm">
      <colgroup>
        <col className="w-[30%]" />
        {LEVELS.map((lv) => (
          <col key={lv} />
        ))}
      </colgroup>
      <thead>
        <tr className="bg-bg-soft">
          <th className="border-line-faint text-text-faint h-10 border text-sm font-semibold">구분</th>
          {LEVELS.map((lv) => (
            <th key={lv} className="border-line-faint text-text-dim h-10 border text-sm font-bold">
              {lv}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          // 값이 없는 줄(숙제 없음·평가 없음) — 칸을 비우지 않고 다섯 칸을 합쳐 그 사실을 적는다(원장 2026-10-26).
          if (r.level === null)
            return (
              <tr key={r.label}>
                <th className="border-line-faint text-foreground h-11 border pl-3 text-left font-bold break-keep">{r.label}</th>
                <td colSpan={LEVELS.length} className="border-line-faint text-text-dim h-11 border text-center text-sm font-bold">
                  {r.none}
                </td>
              </tr>
            );
          const at = LEVELS.indexOf(r.level);
          return (
            <tr key={r.label}>
              <th className="border-line-faint text-foreground h-11 border pl-3 text-left font-bold break-keep">{r.label}</th>
              {LEVELS.map((lv, i) => (
                <td key={lv} className="border-line-faint h-11 border p-1">
                  {i < at ? <span className="bg-primary-soft block h-full rounded" /> : null}
                  {i === at ? (
                    <span className="bg-primary text-primary-foreground flex h-full items-center justify-center rounded text-sm font-extrabold">
                      {lv}
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const TEXT = "text-foreground text-base leading-relaxed whitespace-pre-wrap";

/**
 * 테스트 점수 블록 — 원장 2026-10-23 *"5문제 중 5개 맞음 이거 말고 다른 디자인으로 깔끔하게 몇개중 몇개 맞췄다"*.
 * 왼쪽 큰 숫자(맞힌 수 / 전체) + 그 아래 정식 표기 한 줄(결정 로그 2026-08-11 "N문제 중 M개 맞음"), 오른쪽은 문제마다 점 하나.
 * 문제가 많으면(20개 초과) 점 대신 막대 — 점이 줄을 넘겨 블록이 부푼다.
 */
function ScoreBlock({ right, total, line }: { right: number; total: number; line: string }) {
  return (
    <div className="border-line flex items-center justify-between gap-4 rounded-xl border px-4 py-3">
      <div className="flex shrink-0 flex-col">
        <p className="flex items-baseline gap-1 tabular-nums">
          <span className="text-primary text-4xl leading-none font-extrabold">{right}</span>
          <span className="text-text-dim text-xl font-bold">/ {total}</span>
        </p>
        <p className="text-text-faint mt-1.5 text-sm font-semibold">{line}</p>
      </div>
      {total <= 20 ? (
        <div className="flex max-w-[60%] flex-wrap justify-end gap-1.5" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`size-3.5 rounded-full ${i < right ? "bg-primary" : "bg-line"}`} />
          ))}
        </div>
      ) : (
        <div className="bg-line h-2.5 w-2/5 overflow-hidden rounded-full" aria-hidden>
          <div className="bg-primary h-full rounded-full" style={{ width: `${(right / total) * 100}%` }} />
        </div>
      )}
    </div>
  );
}

/**
 * 옛 '오늘 과제' 항목의 앞·뒤 문장 — 원장 2026-10-23 *"오늘 내준 과제 및 다음 시간에 잘 해 왔는지 등 멘트 삭제"*로 새 글엔 없다.
 * 이미 저장된 글은 이 두 줄을 상자 밖에 그대로 둔다(발송된 글 그대로).
 */
const LEGACY_HW_INTRO = "오늘 내준 과제는 아래와 같습니다.";
const LEGACY_HW_CLOSE = "다음 시간에 잘 해 왔는지 함께 확인하겠습니다.";
/** 오늘의 숙제 항목의 영상 숙제 줄(math-report-pilot-sections.ts pilotBody) — 숙제 상자 밖, 아래 줄에 둔다. */
const VIDEO_LINE = /^영상 숙제가 있습니다/;

/** 사랑의 한마디 상자 — 학부모 카드는 이 항목을 카드 맨 아래 따로 세운다(parent-report-card.tsx). */
export function PilotNoteBox({ text }: { text: string }) {
  return <p className="bg-primary-softer text-foreground rounded-lg px-4 py-3 text-base leading-relaxed font-semibold whitespace-pre-wrap">{text}</p>;
}

/** 항목 본문 — 표 / 점수 줄 / 숙제 상자 / 한마디 상자 / 그 외 글. 데일리 학습알림 표(pilot-report-sheet.tsx)도 띠 아래 본문으로 쓴다. */
export function SectionBody({ s }: { s: PilotNoteSection }) {
  if (isPilotTitle(s.title, "levels")) {
    const rows = parseLevelRows(s.body);
    if (rows) return <LevelTable rows={rows} />;
  }
  const lines = s.body.split("\n");
  const score = isPilotTitle(s.title, "daily") || isPilotTitle(s.title, "check") ? parseScoreLine(lines[0] ?? "") : null;
  if (score) {
    const rest = lines.slice(1).join("\n").trim();
    return (
      <div className="flex flex-col gap-2.5">
        <ScoreBlock right={score.right} total={score.total} line={(lines[0] ?? "").trim()} />
        {rest ? <p className={TEXT}>{rest}</p> : null}
      </div>
    );
  }
  if (isPilotTitle(s.title, "homeworkToday")) {
    const head = lines[0] === LEGACY_HW_INTRO ? lines[0] : null;
    const tail = lines[lines.length - 1] === LEGACY_HW_CLOSE ? lines[lines.length - 1] : null;
    const body = lines.slice(head ? 1 : 0, tail ? -1 : undefined);
    const tasks = body.filter((l) => !VIDEO_LINE.test(l)).join("\n").trim();
    const video = body.filter((l) => VIDEO_LINE.test(l)).join("\n");
    return (
      <div className="flex flex-col gap-2">
        {head ? <p className={TEXT}>{head}</p> : null}
        {tasks ? <p className="bg-primary-softer text-foreground rounded-lg px-4 py-2.5 text-base font-bold whitespace-pre-wrap">{tasks}</p> : null}
        {video ? <p className={TEXT}>{video}</p> : null}
        {tail ? <p className={TEXT}>{tail}</p> : null}
      </div>
    );
  }
  if (isPilotTitle(s.title, "note")) return <PilotNoteBox text={s.body} />;
  return <p className={TEXT}>{s.body}</p>;
}

export function PilotNotesBody({ sections }: { sections: PilotNoteSection[] }) {
  return (
    <div className="divide-line-faint flex flex-col divide-y">
      {sections.map((s, i) => (
        <section key={`${i}-${s.title}`} className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
          <h3 className="text-foreground flex items-center gap-2 text-lg font-extrabold">
            <span aria-hidden className="bg-primary size-2.5 shrink-0 rounded-sm" />
            {s.title}
          </h3>
          {s.body ? <SectionBody s={s} /> : null}
        </section>
      ))}
    </div>
  );
}
