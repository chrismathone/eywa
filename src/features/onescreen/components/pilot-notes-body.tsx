import { PILOT_SECTION_TITLES as T } from "../math-report-pilot";
import { HOMEWORK_TODAY_CLOSE, HOMEWORK_TODAY_INTRO, LEVELS } from "../math-report-pilot-sections";
import { isScoreLine, parseLevelRows, type LevelRow, type PilotNoteSection } from "../pilot-notes";

// 항목별 보고서 글을 학부모 카드(/r·인쇄 = ClassNote 게시 사진)에 그린다 — 원장 2026-10-23 시안 B(막대형 표) 확정
// + *"표에맞게 밑에도 어느정도 디자인 맞춰서"*. 색은 학원 색(primary) 한 가지뿐 — 상·하를 다른 색으로 가르면 '하'가 경고처럼 읽힌다.
// 조각 판정은 pilot-notes.ts(순수). 형식이 안 맞는 항목은 글 그대로 그린다(표를 지어내지 않는다).

/** 시안 B — 고른 등급까지 칸을 채우고 끝 칸에 등급 글자. 열 폭은 colgroup 고정(등급 글자 길이로 표가 안 밀린다). */
function LevelTable({ rows }: { rows: LevelRow[] }) {
  return (
    <table className="border-line w-full table-fixed border-collapse border text-[15px]">
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

/** 항목 본문 — 표 / 점수 줄 / 과제 상자 / 한마디 상자 / 그 외 글. */
function SectionBody({ s }: { s: PilotNoteSection }) {
  if (s.title === T.levels) {
    const rows = parseLevelRows(s.body);
    if (rows) return <LevelTable rows={rows} />;
  }
  const lines = s.body.split("\n");
  if ((s.title === T.daily || s.title === T.check) && isScoreLine(lines[0] ?? "")) {
    const rest = lines.slice(1).join("\n").trim();
    return (
      <div className="flex flex-col gap-1">
        <p className="text-foreground text-lg font-extrabold">{lines[0]}</p>
        {rest ? <p className={TEXT}>{rest}</p> : null}
      </div>
    );
  }
  if (s.title === T.homeworkToday) {
    const head = lines[0] === HOMEWORK_TODAY_INTRO ? lines[0] : null;
    const tail = lines[lines.length - 1] === HOMEWORK_TODAY_CLOSE ? lines[lines.length - 1] : null;
    const tasks = lines.slice(head ? 1 : 0, tail ? -1 : undefined).join("\n").trim();
    return (
      <div className="flex flex-col gap-2">
        {head ? <p className={TEXT}>{head}</p> : null}
        {tasks ? <p className="bg-primary-softer text-foreground rounded-lg px-4 py-2.5 text-base font-bold whitespace-pre-wrap">{tasks}</p> : null}
        {tail ? <p className={TEXT}>{tail}</p> : null}
      </div>
    );
  }
  if (s.title === T.note) {
    return <p className="bg-primary-softer text-foreground rounded-lg px-4 py-3 text-base leading-relaxed font-semibold whitespace-pre-wrap">{s.body}</p>;
  }
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
