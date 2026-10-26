// ② 수업보고서 평점 — 추출 단계(운영 DB 읽기 전용 · 침산만 · 1,000행씩). 결과는 D:/tmp 결과 루트로(Git 밖).
// node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/ai-credit-mvp/extract-ratings.mjs
// 옛 추출기(D:\tmp\report-rating-2026-10-22\extract.cjs)와 같은 모집단(success·recalled + 발송 큐 · 테스트 학생 제외)·같은 파생값을
// **오늘 DB로 다시 만든다** — 10-22 입력 그대로라는 보장은 없다(재현 판정은 저장된 코드 신호와 맞춰 본다).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeReadOnly, openReadOnly, tenantIdOf } from "./lib/db-readonly.mjs";
import { scanRecord } from "./lib/pii.mjs";

const OUT = "D:/tmp/ai-credit-mvp-2026-10-26/01-snapshots/ratings";
// 옛 추출기의 유사도 함수 그대로(이름 접미 알파벳 · 공백 제거 뒤 두 글자 다이스).
const norm = (s, name) => (s || "").replace(new RegExp(name ? name.replace(/[A-Z]$/, "") : "^$", "g"), "").replace(/\s+/g, "");
const bigrams = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const b = s.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); } return m; };
const dice = (a, b) => { if (a.length < 2 || b.length < 2) return 0; const A = bigrams(a), B = bigrams(b); let inter = 0; for (const [k, v] of A) inter += Math.min(v, B.get(k) || 0); return (2 * inter) / (a.length - 1 + b.length - 1); };

const sql = await openReadOnly();
try {
  const cs = await tenantIdOf(sql);
  const rows = [];
  let after = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const page = await sql`
      select r.id, r.report_date::text d, r.subject, r.makeup, r.ment_source, r.classnote_status st, r.source, r.created_at, r.classnote_sent_at::text sent_at,
             r.teacher_name, s.name student, s.school, s.grade, coalesce(c.class_name, mc.class_name) class_name,
             coalesce(r.class_id, r.makeup_class_id, r.classnote_class_id) unit_class,
             r.textbook, r.progress, r.homework_today, r.daily_test, r.check_test, r.exam_info, r.homework_score, r.attitude,
             r.notes, r.trend_note, r.video_homework, r.student_id
      from lesson_reports r
      join students s on s.id = r.student_id and s.tenant_id = r.tenant_id
      left join classes c on c.id = r.class_id
      left join classes mc on mc.id = coalesce(r.makeup_class_id, r.classnote_class_id)
      where r.tenant_id = ${cs} and r.classnote_status in ('success','recalled') and r.classnote_queued_at is not null
        and not coalesce(s.is_test, false) and r.id > ${after}
      order by r.id limit 1000`;
    rows.push(...page);
    if (page.length < 1000) break;
    after = page[page.length - 1].id;
  }
  const rated = new Map((await sql`select report_id, points, rated_on::text rated_on from lesson_report_ratings where tenant_id=${cs}`).map((x) => [x.report_id, x]));

  // 옛 추출기와 같은 차례(학생 · 과목 · 수업일 · 작성 시각)로 직전 보고서를 잇는다.
  rows.sort((a, b) => (a.student_id < b.student_id ? -1 : a.student_id > b.student_id ? 1 : 0) || String(a.subject).localeCompare(String(b.subject))
    || a.d.localeCompare(b.d) || new Date(a.created_at) - new Date(b.created_at));
  let prev = null;
  for (const r of rows) {
    if (prev && prev.student_id === r.student_id && prev.subject === r.subject) {
      r.prev_date = prev.d; r.prev_notes = prev.notes; r.prev_trend = prev.trend_note;
      r.sim_prev = +dice(norm(r.notes, r.student), norm(prev.notes, prev.student)).toFixed(2);
    } else r.sim_prev = null;
    prev = r;
  }
  const byUnit = new Map();
  for (const r of rows) { const k = `${r.unit_class}|${r.d}`; if (!byUnit.has(k)) byUnit.set(k, []); byUnit.get(k).push(r); }
  for (const list of byUnit.values()) for (const r of list) {
    let best = 0, bestText = null, same = 0;
    for (const o of list) if (o !== r) {
      const s = dice(norm(r.notes, r.student), norm(o.notes, o.student));
      if (s >= 0.85) same++;
      if (s > best) { best = s; bestText = o.notes; }
    }
    r.sim_class = list.length > 1 ? +best.toFixed(2) : null; r.class_size_today = list.length;
    r.sim_class_text = best >= 0.5 ? bestText : null; r.sim_class_same = same;
    r.classmate_names = list.filter((o) => o !== r).map((o) => o.student); // 6차 규칙(다른 아이 이름) 재료
  }
  for (const r of rows) {
    delete r.created_at;
    const pii = scanRecord({ notes: r.notes, trend: r.trend_note, prev: r.prev_notes, cls: r.sim_class_text, hw: r.homework_today, progress: r.progress });
    r.held = pii.length > 0; r.pii = pii;
    const rt = rated.get(r.id); r.rated = rt ? { points: rt.points == null ? null : Number(rt.points), on: rt.rated_on } : null;
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "reports-all.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const byDate = {};
  for (const r of rows) if (!r.rated && r.st === "success") byDate[r.d] = (byDate[r.d] || 0) + 1;
  writeFileSync(join(OUT, "context.json"), JSON.stringify({ tenantId: cs, extractedAt: new Date().toISOString(), population: rows.length, rated: rated.size,
    unratedSuccessByDate: byDate, held: rows.filter((r) => r.held).map((r) => ({ id: r.id, pii: r.pii })) }, null, 2));
  console.log(JSON.stringify({ population: rows.length, rated: rated.size, held: rows.filter((r) => r.held).length,
    unratedSuccess: Object.entries(byDate).sort().slice(-12) }));
} finally {
  await closeReadOnly(sql);
}
