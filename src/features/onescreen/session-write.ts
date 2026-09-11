/**
 * 원스크린 세션 저장이 **덜 쓴 창으로 잘 쓴 창을 덮지 않게** 하는 판정 — 순수(Vitest).
 *
 * 같은 강사·같은 학생·같은 날은 세션 1행이라, 창이 둘이면 나중 저장이 이겼다(2026-09-04 정지우:
 * 멘트·오늘 과제가 있는 창을 진도·태도만 있는 창이 덮음). 경고 배너는 락이 아니라서 막지 못했다.
 *
 * 규칙:
 * · 행이 없거나, 이 창이 **방금 저장/로드한 리비전**(sameRevision)이면 그대로 반영(칸을 비우는 것도 허용).
 * · 리비전이 다른데 DB에 내용이 없으면 반영(빈 행을 채우는 창).
 * · 리비전이 다른데 들어오는 값이 DB보다 **칸이 더 많으면** 반영(잘 쓴 창이 늦게 저장).
 * · 그 외(빈 창·덜 쓴 창·같은 칸 수 옛 값)는 무시 — DB를 지키다.
 */
export type SessionContent = {
  subjectProgress?: Record<string, SessionProgressEntry | null | undefined> | null;
  attitude?: string | null;
  homework?: string | null;
  note?: string | null;
  dailyScore?: number | null;
  checkScore?: number | null;
};

export type SessionProgressEntry = {
  today?: string | null;
  draft?: string | null;
  autoDraft?: string | null;
  trendDraft?: string | null;
  textbook?: string | null;
  homeworkToday?: string | null;
  /** 영어 템플릿의 '다음 시간 테스트'(2026-09-10) — 강사가 친 칸이라 내용으로 센다(영어 행만 실린다). */
  nextTest?: string | null;
  attitude?: string | null;
  homework?: string | null;
  note?: string | null;
  dailyScore?: number | null;
  checkScore?: number | null;
};

const hasText = (v: string | null | undefined) => !!String(v ?? "").trim();

/** 문항수(dailyMax)처럼 기본값만 있는 칸은 세지 않는다 — 빈 창도 /20 을 들고 있다. */
export function sessionContentBits(s: SessionContent | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  if (hasText(s.attitude)) out.add("attitude");
  if (hasText(s.homework)) out.add("homework");
  if (hasText(s.note)) out.add("note");
  if (s.dailyScore != null) out.add("dailyScore");
  if (s.checkScore != null) out.add("checkScore");
  for (const [key, e] of Object.entries(s.subjectProgress ?? {})) {
    if (!e) continue;
    if (hasText(e.today)) out.add(`${key}:today`);
    if (hasText(e.draft)) out.add(`${key}:draft`);
    if (hasText(e.autoDraft)) out.add(`${key}:autoDraft`);
    if (hasText(e.trendDraft)) out.add(`${key}:trendDraft`);
    if (hasText(e.textbook)) out.add(`${key}:textbook`);
    if (hasText(e.homeworkToday)) out.add(`${key}:homeworkToday`);
    if (hasText(e.nextTest)) out.add(`${key}:nextTest`);
    if (hasText(e.attitude)) out.add(`${key}:attitude`);
    if (hasText(e.homework)) out.add(`${key}:homework`);
    if (hasText(e.note)) out.add(`${key}:note`);
    if (e.dailyScore != null) out.add(`${key}:dailyScore`);
    if (e.checkScore != null) out.add(`${key}:checkScore`);
  }
  return out;
}

/** DB 세션 행 → 판정용 스냅샷. */
export function sessionContentFromRow(
  row:
    | {
        subject_progress?: SessionContent["subjectProgress"];
        attitude?: string | null;
        homework?: string | null;
        special_note?: string | null;
        daily_score?: number | null;
        check_score?: number | null;
      }
    | null
    | undefined,
): SessionContent | null {
  if (!row) return null;
  return {
    subjectProgress: row.subject_progress ?? {},
    attitude: row.attitude ?? null,
    homework: row.homework ?? null,
    note: row.special_note ?? null,
    dailyScore: row.daily_score ?? null,
    checkScore: row.check_score ?? null,
  };
}

export function sameSessionRevision(
  client: string | null | undefined,
  server: string | null | undefined,
): boolean {
  if (!client || !server) return false;
  const ct = Date.parse(client);
  const st = Date.parse(server);
  if (Number.isNaN(ct) || Number.isNaN(st)) return client === server;
  return ct === st;
}

export function sessionSaveDecision(
  existing: SessionContent | null | undefined,
  incoming: SessionContent,
  sameRevision: boolean,
): "apply" | "ignore" {
  if (!existing) return "apply";
  if (sameRevision) return "apply";
  const ex = sessionContentBits(existing);
  const inc = sessionContentBits(incoming);
  if (ex.size === 0) return "apply";
  const existingOnly = [...ex].filter((b) => !inc.has(b));
  const incomingOnly = [...inc].filter((b) => !ex.has(b));
  // 잘 쓴 창이 뒤처진 리비전으로 저장 — DB에 있는 칸을 다 갖고 + 더 있음.
  if (existingOnly.length === 0 && incomingOnly.length > 0) return "apply";
  return "ignore";
}
