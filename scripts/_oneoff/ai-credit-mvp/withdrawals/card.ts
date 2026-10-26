// ① 퇴원 사유 — 학생 한 명의 근거 카드(모델·독립 평가자 공용) + 인용 검사용 근거 지도(순수).
// 이름·학교·연락처는 싣지 않는다(익명 sid · 학년만). 근거 id: mk(메이크에듀) · a:<aid>:<칸> · e<n> · c<n> · p<n>.

export type WdRecord = {
  sid: string; grade: string | null; enrolledAt: string | null; withdrawnAt: string | null; group: string; held: boolean;
  sources: {
    makeedu: { reasonRaw: string; withdrawnOn: string | null; gapDays: number | null } | null;
    archives: { aid: string; exitDate: string | null; className: string | null; thisWithdrawal: string; fields: Record<string, string> }[];
    enrollments: { className: string | null; subject: string | null; start: string | null; end: string | null; reason: string | null; detail: string | null; memo: string; transferred: boolean; gapDays: number | null }[];
    consultations: { date: string | null; gapDays: number | null; category: string | null; summary: string; followUp: string; aiSummary: string }[];
    parentMessages: { date: string | null; gapDays: number | null; content: string }[];
  };
};

/** 근거로 인용할 수 있는 글(이번 퇴원 자료만) — id → 글. '다른 때' 원본은 넣지 않는다(규칙 1). */
export function evidenceMap(r: WdRecord): Map<string, string> {
  const m = new Map<string, string>();
  if (r.sources.makeedu?.reasonRaw) m.set("mk", r.sources.makeedu.reasonRaw);
  for (const a of r.sources.archives) {
    if (a.thisWithdrawal === "다른 때(과목 종료 등)") continue;
    for (const [k, v] of Object.entries(a.fields)) if (v) m.set(`a:${a.aid}:${k}`, v);
  }
  r.sources.enrollments.forEach((e, i) => { const t = [e.reason, e.memo].filter(Boolean).join(" · "); if (t && near(e.gapDays, 31)) m.set(`e${i + 1}`, t); });
  r.sources.consultations.forEach((c, i) => { const t = [c.summary, c.followUp, c.aiSummary].filter(Boolean).join("\n"); if (t) m.set(`c${i + 1}`, t); });
  r.sources.parentMessages.forEach((p, i) => { if (p.content) m.set(`p${i + 1}`, p.content); });
  return m;
}
const near = (gap: number | null, days: number) => gap != null && Math.abs(gap) <= days;

/** `recorded` = 기록된 분류 글(코드가 원문에서 떼어 낸 것 · 해석은 붙이지 않는다)을 둘째 줄에 — v3부터. */
export function cardText(r: WdRecord, opts: { recorded?: { src: string; text: string }[] } = {}): string {
  const L: string[] = [`### 학생 ${r.sid} · 학년 ${r.grade || "모름"} · 퇴원일 ${r.withdrawnAt ?? "모름"} · 등록일 ${r.enrolledAt ?? "모름"}`];
  if (opts.recorded) L.push(`[기록된 분류] ${opts.recorded.length ? opts.recorded.map((x) => `${x.src} '${x.text}'`).join(" · ") : "없음"}`);
  const mk = r.sources.makeedu;
  L.push(mk?.reasonRaw ? `[mk] 메이크에듀 퇴원 사유(퇴원일 ${mk.withdrawnOn ?? "모름"}): ${mk.reasonRaw}` : "[mk] 메이크에듀 퇴원 사유: 없음");
  for (const a of r.sources.archives) {
    const ref = a.thisWithdrawal === "다른 때(과목 종료 등)";
    L.push(`[원본 보고서 a:${a.aid} · ${a.thisWithdrawal}${ref ? " → 참고만, 근거로 쓰지 말 것" : ""} · 종료일 ${a.exitDate ?? "모름"} · 반 ${a.className ?? "모름"}]`);
    for (const [k, v] of Object.entries(a.fields)) L.push(`  - ${k}: ${v.replace(/\s*\n\s*/g, " / ")}`);
  }
  r.sources.enrollments.forEach((e, i) => {
    if (!near(e.gapDays, 31)) return;
    L.push(`[e${i + 1}] 수강 종료 ${e.end ?? "?"}(퇴원일 ${fmtGap(e.gapDays)}) · 반 ${e.className ?? "?"}${e.transferred ? " · 반 이동" : ""} · 종료 사유 ${e.reason || "빈칸"}${e.memo ? ` · 메모 ${e.memo}` : ""}`);
  });
  r.sources.consultations.forEach((c, i) => L.push(`[c${i + 1}] 원생상담 ${c.date}(퇴원일 ${fmtGap(c.gapDays)}) · ${c.category ?? ""}: ${[c.summary, c.followUp, c.aiSummary].filter(Boolean).join(" / ").replace(/\s*\n\s*/g, " ")}`));
  r.sources.parentMessages.forEach((p, i) => L.push(`[p${i + 1}] 학부모 글 ${p.date}(퇴원일 ${fmtGap(p.gapDays)}): ${p.content.replace(/\s*\n\s*/g, " ")}`));
  return L.join("\n");
}
const fmtGap = (g: number | null) => (g == null ? "?" : g === 0 ? "당일" : g < 0 ? `${-g}일 전` : `${g}일 뒤`);

const foldQ = (s: string) => s.replace(/\s+/g, "").replace(/["'“”‘’…]/g, "");

/** 인용 검사 — 공백을 접어 그 근거 글에 그대로 들어 있어야 한다(따옴표·말줄임 등 꾸밈은 떼고 본다). */
export function quoteFound(map: Map<string, string>, src: string, quote: string): boolean {
  const q = foldQ(quote ?? "");
  const t = map.get(src);
  return q.length >= 2 && !!t && foldQ(t).includes(q);
}

/**
 * 인용이 실제로 들어 있는 근거 id — 적은 id에 없으면 이번 퇴원 자료 안을 모두 찾는다(칸 이름을 빼고 `a:<원본id>`만 적는 일이 잦다).
 * 🔴 '다른 때' 원본은 지도에 없으므로 거기서만 나온 인용은 끝까지 못 찾는다(규칙 1).
 */
export function locateQuote(map: Map<string, string>, src: string, quote: string): string | null {
  if (quoteFound(map, src, quote)) return src;
  const q = foldQ(quote ?? "");
  if (q.length < 2) return null;
  const prefer = [...map.keys()].filter((k) => k.startsWith(src));
  for (const k of [...prefer, ...map.keys()]) if (foldQ(map.get(k)!).includes(q)) return k;
  return null;
}
