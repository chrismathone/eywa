/**
 * 새 수학 보고서 — 선생님이 **고친 글**에 바뀐 값만 다시 맞춘다(원장 2026-10-27 *"글을 수정하면 자동작성을 다시 누르라고 하나봐요,
 * 그래서 쓴게 다 없어 진데요"*). 순수 모듈(Vitest).
 *
 * 글은 `■ 제목` 항목들의 묶음이다(math-report-pilot.ts `pilotSection`). 값이 바뀌면 사실 항목(출결·일일 테스트·태도·숙제…)만
 * 서버가 지금 값으로 다시 짜 주고(AI 없이 — `generateReportComment`의 `pilotKeepUnderstanding`), 여기서 항목별로 합친다:
 *  · '오늘의 수업' = 선생님이 고친 그대로(서버가 그 글로 짰다).
 *  · '사랑의 한마디' = 칸에 적힌 지금 값(서버가 그 값으로 짰다).
 *  · 나머지 사실 항목 = 선생님이 손댄 항목(지난 자동작성 글과 다르다)은 그대로, 손대지 않은 항목은 새 값으로.
 *  · 선생님이 새로 만든 항목(지난 자동작성 글에 없던 제목)은 '사랑의 한마디' 바로 앞에 남긴다.
 *  · 첫 '■' 앞에 선생님이 적은 글도 그대로 남긴다.
 */
import { PILOT_LEGACY_TITLES, PILOT_SECTION_TITLES } from "./math-report-pilot";

type Section = { title: string; body: string };
type Parsed = { head: string; sections: Section[] };

const LEGACY_TO_NOW: Record<string, string> = {
  [PILOT_LEGACY_TITLES.homework]: PILOT_SECTION_TITLES.homework,
  [PILOT_LEGACY_TITLES.homeworkToday]: PILOT_SECTION_TITLES.homeworkToday,
  [PILOT_LEGACY_TITLES.note]: PILOT_SECTION_TITLES.note,
};
const canonTitle = (t: string) => LEGACY_TO_NOW[t] ?? t;

/** 글 → 첫 '■' 앞 글 + 항목들. 항목 본문은 다음 '■ ' 줄 전까지(앞뒤 공백은 뗀다). */
export function parsePilotSections(text: string | null | undefined): Parsed {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const head: string[] = [];
  const sections: Section[] = [];
  let cur: { title: string; lines: string[] } | null = null;
  const flush = () => {
    if (cur) sections.push({ title: cur.title, body: cur.lines.join("\n").trim() });
  };
  for (const line of lines) {
    const m = line.match(/^■\s*(.+?)\s*$/);
    if (m) {
      flush();
      cur = { title: canonTitle(m[1]), lines: [] };
    } else if (cur) cur.lines.push(line);
    else head.push(line);
  }
  flush();
  return { head: head.join("\n").trim(), sections };
}

/** 한 항목의 본문(없으면 ""). */
export function pilotSectionBody(text: string | null | undefined, title: string): string {
  return parsePilotSections(text).sections.find((s) => s.title === title)?.body ?? "";
}

function render(p: Parsed): string {
  return [p.head, ...p.sections.filter((s) => s.body).map((s) => `■ ${s.title}\n${s.body}`)]
    .map((x) => x.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 합치기 — `draft`(선생님이 고친 지금 글) · `autoDraft`(지난 자동작성 원문) · `fresh`(지금 값으로 다시 짠 글, '오늘의 수업'은 고친 글 그대로).
 * 돌려주는 `autoDraft`는 새 사실 항목 + 지난 AI의 '오늘의 수업' — 자동작성 원문(0370a 말투 학습)이 선생님 글로 오염되지 않게 한다.
 */
export function mergePilotDraft(
  draft: string | null | undefined,
  autoDraft: string | null | undefined,
  fresh: string,
): { draft: string; autoDraft: string } {
  const cur = parsePilotSections(draft);
  const old = parsePilotSections(autoDraft);
  const next = parsePilotSections(fresh);
  const curBy = new Map(cur.sections.map((s) => [s.title, s.body]));
  const oldBy = new Map(old.sections.map((s) => [s.title, s.body]));
  const T = PILOT_SECTION_TITLES;

  const merged: Section[] = next.sections.map((s) => {
    if (s.title === T.understanding || s.title === T.note) return s;
    const mine = curBy.get(s.title);
    const was = oldBy.get(s.title);
    // 선생님이 손댄 사실 항목 — 그대로 둔다(고친 말을 지우지 않는다).
    if (mine !== undefined && was !== undefined && mine !== was) return { title: s.title, body: mine };
    return s;
  });
  // 선생님이 새로 만든 항목 — '사랑의 한마디' 앞에.
  const added = cur.sections.filter((s) => !oldBy.has(s.title) && !next.sections.some((n) => n.title === s.title) && s.body);
  if (added.length) {
    const noteAt = merged.findIndex((s) => s.title === T.note);
    merged.splice(noteAt < 0 ? merged.length : noteAt, 0, ...added);
  }

  const aiUnderstanding = oldBy.get(T.understanding) ?? "";
  const nextAuto: Section[] = next.sections.map((s) =>
    s.title === T.understanding ? { title: s.title, body: aiUnderstanding } : s,
  );
  // 지난 원문엔 있었는데 이번 글엔 없는 '오늘의 수업'(선생님이 지웠다) — 원문에는 AI 글을 남긴다(원문 = AI가 쓴 것).
  if (aiUnderstanding && !nextAuto.some((s) => s.title === T.understanding)) {
    const at = nextAuto.findIndex((s) => s.title === T.homeworkToday || s.title === T.note);
    nextAuto.splice(at < 0 ? nextAuto.length : at, 0, { title: T.understanding, body: aiUnderstanding });
  }
  return {
    draft: render({ head: cur.head, sections: merged }),
    autoDraft: render({ head: "", sections: nextAuto }),
  };
}
