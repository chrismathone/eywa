/**
 * scripts/_oneoff/dedupe-legacy-consultations.mjs — ijw 임포트(2026-07-01)가 두 벌로 넣은 원생상담 정리(실데이터).
 *
 * 원장 2026-10-27 *"상담통계에 상담 카운팅이 이상하다 확인해줘야함"* — 조사 결과: 같은 상담이
 *   ① 본문만 있는 행  ② `[학생 상담일지…]`/`[수학 해피콜]` 같은 머리말 + 같은 본문 + `[등록자: X]` 꼬리말 행
 * 두 벌로 들어가 상담 수·상담사별 건수·1인당 상담이 부풀었다(인재원 침산 144건, 녹음·AI·후속 있는 행 0건).
 *
 * 판정(전부 만족할 때만 '중복'): 2026-07-01 임포트분 · makeedu 아님 · 같은 학생 · 같은 KST 날짜 · 같은 상담사 ·
 *   머리말을 떼고 공백을 지운 본문이 남길 행(더 긴 쪽) 안에 들어 있음(앞 80자, 20자 미만은 판정 안 함) ·
 *   지울 행에 녹음·AI·후속이 **없음**(있으면 건너뛰고 알린다). 남기는 쪽 = 더 긴(머리말·등록자 있는) 행.
 *
 * 🔴 드라이런이 기본(`--apply` 없으면 아무것도 안 쓴다). 지운 행 전체를 JSON으로 먼저 백업한다(되살리기용).
 * 사용: node scripts/_oneoff/dedupe-legacy-consultations.mjs <tenant_slug> [--apply]
 * env: NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (service_role — tenant_id 필터 필수).
 */
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const slug = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!slug || slug.startsWith("--")) throw new Error("사용: node dedupe-legacy-consultations.mjs <tenant_slug> [--apply]");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function all(q) {
  let out = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await q().range(f, f + 999);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < 1000) return out;
  }
}

const { data: t, error: te } = await sb.from("tenants").select("id").eq("slug", slug).single();
if (te) throw te;
const rows = await all(() =>
  sb.from("student_consultations").select("*").eq("tenant_id", t.id).gte("created_at", "2026-07-01").lt("created_at", "2026-07-02").is("makeedu_id", null).order("id"),
);
const norm = (s) => (s ?? "").replace(/^\s*\[[^\]\n]*\]\s*/, "").replace(/\s*\[등록자:[^\]\n]*\]\s*$/, "").replace(/\s+/g, "");
const kst = (iso) => new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString().slice(0, 10);
const rich = (r) => !!(r.audio_path || r.ai_summary || r.follow_up_date || r.follow_up_action || r.transcription);

const groups = new Map();
for (const r of rows) {
  const k = `${r.student_id}|${kst(r.consulted_at)}|${r.counselor_id}`;
  groups.set(k, [...(groups.get(k) ?? []), r]);
}
const drop = [];
const skipped = [];
for (const g of groups.values()) {
  if (g.length < 2) continue;
  const kept = [];
  for (const r of [...g].sort((a, b) => (b.summary ?? "").length - (a.summary ?? "").length)) {
    const n = norm(r.summary);
    const dupOf = n.length >= 20 ? kept.find((k) => norm(k.summary).includes(n.slice(0, 80))) : null;
    if (!dupOf) kept.push(r);
    else if (rich(r)) skipped.push(r.id);
    else drop.push({ row: r, keep: dupOf.id });
  }
}
console.log(`대상 임포트 행 ${rows.length} · 중복 ${drop.length}건 · 내용이 있어 건너뜀 ${skipped.length}건`);
for (const d of drop.slice(0, 5)) console.log(`- ${d.row.id} → 남김 ${d.keep} | ${(d.row.summary ?? "").slice(0, 50).replace(/\n/g, " ")}`);
if (!APPLY) {
  console.log("드라이런 — 지우려면 --apply");
} else {
  const file = `dedupe-legacy-consultations.${slug}.${Date.now()}.backup.json`;
  fs.writeFileSync(file, JSON.stringify(drop.map((d) => d.row), null, 1));
  console.log(`백업: ${file}`);
  const ids = drop.map((d) => d.row.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await sb.from("student_consultations").delete().eq("tenant_id", t.id).in("id", ids.slice(i, i + 100));
    if (error) throw error;
  }
  console.log(`삭제 ${ids.length}건 완료`);
}
