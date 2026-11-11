/**
 * 강사평가 마감 달의 **담임 판정 정정** — 계획(읽기 전용 · 원장 2026-11-11 *"추천방식으로 시작"*).
 *
 * 같은 스냅숏(끝 = 2026-10-31 → 4~10월 한 번에)으로 옛 판정·새 판정을 계산해 `planRevision`(순수 · Vitest)이 마감 행마다
 * 같음 / 고침 / 지움 / 손대지 않음을 정한다. 저장하지 않는다 — 결과를 저장소 밖 파일로만 쓴다(적용은 apply.mts).
 *
 * 실행(작업본 루트에서):
 *   TSX_TSCONFIG_PATH=scripts/_oneoff/portfolio-revision/tsconfig.json \
 *   node --env-file=.env.local --import tsx scripts/_oneoff/portfolio-revision/plan.mts [--out=<폴더>]
 * 결과: <폴더>/plan.json(적용 재료 — 고친 payload 포함) · <폴더>/report.md(사람이 읽는 요약)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveSettings } from "@/features/owner/resolve";
import { buildPortfolio } from "@/features/teacher-portfolio/model/build";
import { planRevision, type RevisionAction, type StoredMonth } from "@/features/teacher-portfolio/model/revision";
import type { Metric, PortfolioPeriod, PortfolioSnapshot } from "@/features/teacher-portfolio/model/types";
import { loadEvaluationConfig, loadManualEntries } from "@/features/teacher-portfolio/server/evaluation-store";
import { loadPortfolioSnapshot } from "@/features/teacher-portfolio/server/snapshot";
import { loadTenure } from "@/features/teacher-portfolio/server/tenure";

const TENANT_SLUG = "cs";
const END = "2026-10-31";
const FROM_MONTH = "2026-04";
const TO_MONTH = "2026-10";
const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? join(process.env.USERPROFILE ?? ".", "eywa-data", "portfolio-revision");

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const must = <T,>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

const { data: tenant, error: tenantError } = await admin.from("tenants").select("id, name").eq("slug", TENANT_SLUG).single();
if (tenantError || !tenant) throw new Error(`지점을 찾지 못했습니다: ${tenantError?.message ?? ""}`);
const T = tenant.id as string;
const rawSettings = must(await admin.from("tenant_settings").select("data").eq("tenant_id", T).maybeSingle(), "학원 설정");
const settings = resolveSettings((rawSettings as { data?: unknown } | null)?.data ?? {}, { name: tenant.name as string });

// 마감 행(원본) — 근거가 커서 달마다 따로 받는다.
type StoredRow = { teacher_id: string; month: string; payload: PortfolioPeriod; total: number | null; closed_at: string; closing_source: string; computed_at: string };
const stored: StoredRow[] = [];
for (let m = FROM_MONTH; m <= TO_MONTH; m = `${m.slice(0, 4)}-${String(Number(m.slice(5)) + 1).padStart(2, "0")}`) {
  const rows = must(await admin.from("teacher_portfolio_months").select("teacher_id, month, payload, total, closed_at, closing_source, computed_at")
    .eq("tenant_id", T).eq("month", m).not("closed_at", "is", null).order("teacher_id"), `마감 행 ${m}`) as StoredRow[];
  stored.push(...rows);
}
const months = [...new Set(stored.map((r) => r.month))].sort();
console.log("마감 행", stored.length, "·", months.join(" "));

const now = new Date();
const t0 = Date.now();
const snap = await loadPortfolioSnapshot(admin, T, {
  end: END, now, touchesSince: `${FROM_MONTH}-01`,
  settings: { holidays: settings.operations.holidays, subjects: settings.operations.subjects, report_subjects: settings.report.classnoteSubjects, report_exempt: settings.report.writingExemptTeachers },
});
console.log("스냅숏", Date.now() - t0, "ms · 담임 변경(activity_log)", snap.teacherChanges?.length ?? 0, "· 지운 계정 잇기", Object.keys(snap.teacherAliases ?? {}).length);
const [evaluation, entries, tenure] = await Promise.all([loadEvaluationConfig(admin, T), loadManualEntries(admin, T, months), loadTenure(admin, T)]);

// 지금 수업을 안 맡는 강사(퇴사 등)도 마감 행이 있으면 그 달을 계산한다.
const openMonths = new Map<string, string[]>();
for (const r of stored) openMonths.set(r.teacher_id, [...(openMonths.get(r.teacher_id) ?? []), r.month]);
// 옛 판정 = 감사로그 전이만 · 지운 계정 잇기 없음 · 재직 기간 없음(종전 코드와 같은 재료).
const beforeSnap: PortfolioSnapshot = { ...snap, teacherChanges: [], teacherAliases: {}, users: snap.users.map((u) => ({ ...u, hire_date: null, resign_date: null })) };
const index = (r: ReturnType<typeof buildPortfolio>) => new Map(r.teachers.flatMap((t) => t.periods.map((w) => [`${t.id}|${w.month}`, w] as const)));
// 🔴 옛·새 판정은 **그 달을 매긴 설정**(저장 행의 payload.evaluation)으로 계산한다 — 세는 법(퇴원율 뺄 사유 등)이 마감 뒤 바뀌었어도
//    그때 규칙으로 견준다(Codex 리뷰 2026-11-11). 설정 사본이 없는 행은 지금 설정(침산은 없다).
const configKey = (r: StoredRow) => JSON.stringify(r.payload.evaluation ?? evaluation.config);
const configs = new Map(stored.map((r) => [configKey(r), r.payload.evaluation ?? evaluation.config] as const));
const builds = new Map<string, { before: ReturnType<typeof index>; after: ReturnType<typeof index> }>();
for (const [key, config] of configs) {
  const opts = { openMonths, evaluation: { config, entries }, keepOutsideTenure: true };
  builds.set(key, { before: index(buildPortfolio(beforeSnap, opts)), after: index(buildPortfolio(snap, opts)) });
}
console.log("설정 사본", configs.size, "벌 · 계산", configs.size * 2, "번");
const storedOf = new Map(stored.map((r) => [`${r.teacher_id}|${r.month}`, r]));
const buildOf = (t: string, m: string) => builds.get(configKey(storedOf.get(`${t}|${m}`)!))!;
const beforeOf = (t: string, m: string) => buildOf(t, m).before.get(`${t}|${m}`);
const afterOf = (t: string, m: string) => buildOf(t, m).after.get(`${t}|${m}`);

const input: StoredMonth[] = stored.map((r) => ({ teacherId: r.teacher_id, month: r.month, payload: r.payload }));
const actions = planRevision({ stored: input, before: beforeOf, after: afterOf, tenure: (t) => tenure.get(t), fallbackConfig: evaluation.config });

// 사람이 읽는 요약.
const names = new Map(snap.users.map((u) => [u.id, u.display_name]));
// 마감 뒤 자료 변화가 섞이는 자리 = 저장값과 '지금 자료로 다시 센 옛 판정'이 다른 항목·칸(배점 칸은 빼고 견준다) — 고치면 그 변화도 함께 들어간다.
const SCORE_KEYS = new Set(["label", "max", "off", "value", "missing", "gap"]);
// 숫자만 견준다 — 중첩 칸·세부 목록 안의 숫자까지(글자는 코드 문구가 바뀌어도 달라진다 — 그건 자료 변화가 아니다 · Codex 리뷰 2026-11-11).
const numericLeaves = (v: unknown, path: string, top: boolean): string[] => {
  if (v === null || typeof v === "number" || typeof v === "boolean") return [`${path}=${v}`];
  if (Array.isArray(v)) return v.flatMap((x) => numericLeaves(x, `${path}[]`, false));
  if (v && typeof v === "object") return Object.entries(v).filter(([k]) => !(top && SCORE_KEYS.has(k))).flatMap(([k, x]) => numericLeaves(x, path ? `${path}.${k}` : k, false));
  return [];
};
const content = (m: unknown) => numericLeaves(m, "", true).sort();
const drifted = (a: Extract<RevisionAction, { kind: "revise" }>, c: string) => {
  const s = storedOf.get(`${a.teacherId}|${a.month}`)!.payload, b = beforeOf(a.teacherId, a.month)!;
  const si = s.items.find((m) => m.id === c), bi = b.items.find((m) => m.id === c);
  return si || bi ? JSON.stringify(content(si)) !== JSON.stringify(content(bi))
    : JSON.stringify(content((s as Record<string, unknown>)[c])) !== JSON.stringify(content((b as Record<string, unknown>)[c]));
};
let driftCount = 0;
const itemOf = (p: PortfolioPeriod | undefined, id: string) => p?.items.find((m) => m.id === id) as (Metric & { base?: number; counted?: number }) | undefined;
const fmtItem = (m: (Metric & { base?: number; counted?: number }) | undefined) =>
  !m ? "—" : `${m.raw === null || m.raw === undefined ? "—" : Math.round(m.raw * 10) / 10}${m.base !== undefined ? `(${m.counted}/${m.base})` : ""}=${m.value ?? "—"}점`;
const lines: string[] = [`# 강사평가 마감 달 담임 판정 정정 — 계획(저장 없음 · ${now.toISOString()})`, ""];
const count = (k: RevisionAction["kind"]) => actions.filter((a) => a.kind === k).length;
lines.push(`마감 행 ${actions.length} · 고침 ${count("revise")} · 지움 ${count("remove")} · 손대지 않음 ${count("skip")} · 같음 ${count("same")}`, "");
lines.push("⚠ = 그 자리에 마감 뒤 자료 변화도 섞인다(저장값 ≠ 지금 자료로 다시 센 옛 판정) — 고치면 그 변화도 함께 들어간다.", "");
const byTeacher = new Map<string, RevisionAction[]>();
for (const a of actions) if (a.kind !== "same") byTeacher.set(a.teacherId, [...(byTeacher.get(a.teacherId) ?? []), a]);
for (const [id, list] of [...byTeacher].sort((a, b) => (names.get(a[0]) ?? "").localeCompare(names.get(b[0]) ?? "", "ko"))) {
  const t = tenure.get(id);
  lines.push(`## ${names.get(id) ?? id} (입사 ${t?.hireDate?.slice(0, 10) ?? "?"}${t?.resignDate ? ` · 퇴사 ${t.resignDate.slice(0, 10)}` : ""})`);
  for (const a of list.sort((x, y) => x.month.localeCompare(y.month))) {
    const s = storedOf.get(`${a.teacherId}|${a.month}`)!;
    if (a.kind === "remove") { lines.push(`- ${a.month} 지움(${a.reason === "beforeHire" ? "입사 전" : "퇴사 뒤"}) · 저장 총점 ${s.total} · 퇴원율 ${fmtItem(itemOf(s.payload, "churn"))}`); continue; }
    if (a.kind === "skip") { lines.push(`- ${a.month} 손대지 않음(${a.reason})`); continue; }
    if (a.kind !== "revise") continue;
    const parts = a.changed.map((c) => {
      const o = itemOf(s.payload, c), n = itemOf(a.payload, c);
      const mark = drifted(a, c) ? "⚠" : "";
      if (mark) driftCount++;
      if (o || n) return `${mark}${c} ${fmtItem(o)} → ${fmtItem(n)}`;
      const ov = (s.payload as Record<string, unknown>)[c], nv = (a.payload as Record<string, unknown>)[c];
      return `${mark}${c} ${Array.isArray(ov) ? `${ov.length}개` : JSON.stringify(ov)} → ${Array.isArray(nv) ? `${nv.length}개` : JSON.stringify(nv)}`;
    });
    lines.push(`- ${a.month} 총점 ${s.total} → ${a.payload.total} · ${parts.join(" · ")}`);
  }
  lines.push("");
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "plan.json"), JSON.stringify({
  generatedAt: now.toISOString(), tenantId: T, end: END,
  actions: actions.filter((a) => a.kind === "revise" || a.kind === "remove").map((a) => ({
    ...a, original: { computed_at: storedOf.get(`${a.teacherId}|${a.month}`)!.computed_at, closed_at: storedOf.get(`${a.teacherId}|${a.month}`)!.closed_at },
  })),
}));
lines.splice(3, 0, `바뀌는 자리 중 마감 뒤 자료 변화가 섞인 곳(⚠) ${driftCount}`, "");
writeFileSync(join(OUT, "report.md"), lines.join("\n"));
console.log(lines.slice(0, 3).join("\n"));
console.log("결과:", join(OUT, "report.md"));
