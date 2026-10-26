// ④ 결석 문자 판별 — 추출 단계(운영 DB 읽기 전용 · 침산만). 최근 분류된 학부모 글 약 300건 + 과거 운영 판정(당시 모델).
// node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/ai-credit-mvp/extract-attendance.mjs [--n 300]
// 분류·알림 서버 함수는 부르지 않는다(읽기만). 운영 묶음은 classified_at(같은 실행)으로 다시 묶는다 — 실행당 12건 상한.
// AI가 판정한 글만(model 있음) — 첨부만 있는 글은 연동 PC가 AI 없이 일반으로 처리한다(AI 판정 대상이 아니다).
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { closeReadOnly, openReadOnly, tenantIdOf } from "./lib/db-readonly.mjs";
import { maskPhones, piiHits } from "./lib/pii.mjs";

// --before <YYYY-MM-DD> = 그 날짜 전 글만 → 추가 조정용 표본(attendance-tune2) · 최종 평가 표본(10-07 이후)을 건드리지 않고 조일 재료를 늘린다.
const BEFORE = process.argv.includes("--before") ? process.argv[process.argv.indexOf("--before") + 1] : null;
const OUT = `D:/tmp/ai-credit-mvp-2026-10-26/01-snapshots/${BEFORE ? "attendance-tune2" : "attendance"}`;
const N = Number(process.argv[process.argv.indexOf("--n") + 1] || 300) || 300;
// 연락일 = KST 날짜(운영 messageDateOf와 같다: posted_at ?? created_at).
const kstDay = (ts) => new Date(new Date(ts).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

const sql = await openReadOnly();
try {
  const cs = await tenantIdOf(sql);
  const rows = await sql`
    select m.id, m.student_id, m.source, m.class_name, m.content, m.posted_at, m.created_at, m.classified_at,
           m.category, m.starts_on::text starts_on, m.ends_on::text ends_on, m.detail, m.model, m.classify_error, s.name student
    from classnote_parent_messages m left join students s on s.id = m.student_id and s.tenant_id = m.tenant_id
    where m.tenant_id = ${cs} and m.classified_at is not null and m.model is not null
      and (${BEFORE}::date is null or m.created_at < (${BEFORE}::date - interval '9 hours'))
    order by m.created_at desc limit ${N}`;
  rows.reverse(); // 오래된 것부터
  // 운영 묶음 재구성: 같은 분류 실행(classified_at 10초 안) — 실행 안에서 created_at 차례, 12건씩
  let batch = 0, last = null, inBatch = 0;
  const byRun = [...rows].sort((a, b) => new Date(a.classified_at) - new Date(b.classified_at) || new Date(a.created_at) - new Date(b.created_at));
  for (const r of byRun) {
    const t = new Date(r.classified_at).getTime();
    if (last === null || t - last > 10_000 || inBatch >= 12) { batch++; inBatch = 0; }
    r.op_batch = batch; inBatch++; last = t;
  }
  const records = rows.map((r) => {
    const content = String(r.content ?? "");
    const pii = piiHits(content);
    return {
      id: r.id, mid: createHash("sha256").update(`at-v1|${r.id}`).digest("hex").slice(0, 10), studentId: r.student_id, student: r.student ?? "",
      source: r.source, className: r.class_name, messageDate: kstDay(r.posted_at ?? r.created_at), postedAt: r.posted_at, createdAt: r.created_at,
      content: maskPhones(content), length: content.length, truncatedAt600: content.length > 600, opBatch: r.op_batch,
      past: { category: r.category, startsOn: r.starts_on, endsOn: r.ends_on, detail: r.detail, model: r.model, error: r.classify_error, classifiedAt: r.classified_at },
      held: pii.length > 0, pii,
    };
  });
  // 조정용 = 앞 날짜 60건(연락일 순) · 최종 = 나머지(같은 학생의 같은 날 대화가 갈라지지 않게 날짜 경계에서 자른다)
  const dates = [...new Set(records.map((r) => r.messageDate))].sort();
  let cut = 0, cutDate = dates[0];
  for (const d of dates) { const n = records.filter((r) => r.messageDate === d).length; if (cut + n > 60 && cut >= 50) break; cut += n; cutDate = d; }
  // --before면 전부 조정용(이 표본은 최종 평가에 쓰지 않는다).
  const tuning = records.filter((r) => (BEFORE || r.messageDate <= cutDate) && !r.held).map((r) => r.id);
  const final = BEFORE ? [] : records.filter((r) => r.messageDate > cutDate && !r.held).map((r) => r.id);
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "inputs.jsonl"), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
  writeFileSync(join(OUT, "splits.json"), JSON.stringify({ rule: `연락일 순 · ${cutDate}까지 = 조정용 · 그 뒤 = 최종(날짜 경계로 자름)`, cutDate, tuning, final }, null, 2));
  writeFileSync(join(OUT, "redaction-report.json"), JSON.stringify({ rule: "lib/pii.mjs — 주민번호·카드·계좌·급여 표현이면 보류 · 전화번호는 가림", held: records.filter((r) => r.held).map((r) => ({ mid: r.mid, pii: r.pii })), total: records.length }, null, 2));
  const by = (f) => records.reduce((m, r) => ((m[f(r)] = (m[f(r)] || 0) + 1), m), {});
  writeFileSync(join(OUT, "context.json"), JSON.stringify({ tenantId: cs, extractedAt: new Date().toISOString(), n: records.length, from: dates[0], to: dates.at(-1),
    pastCategory: by((r) => r.past.category), pastModel: by((r) => r.past.model ?? "(없음)"), truncatedAt600: records.filter((r) => r.truncatedAt600).length, opBatches: batch }, null, 2));
  console.log(JSON.stringify({ n: records.length, from: dates[0], to: dates.at(-1), cutDate, tuning: tuning.length, final: final.length, held: records.filter((r) => r.held).length,
    pastCategory: by((r) => r.past.category), pastModel: by((r) => r.past.model ?? "(없음)"), truncated: records.filter((r) => r.truncatedAt600).length, opBatches: batch }));
} finally {
  await closeReadOnly(sql);
}
