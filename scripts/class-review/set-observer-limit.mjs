// 이미 만들어진 수업 평가의 **평가자 정원**을 바꾼다(원장 지시 2026-08-18: "기존에 있던 평가자 선착순
// 4명으로 디비에서 변경해줘"). 정원은 생성 시 문서에 동결되므로(header.observerLimit), 앱에서 만든 뒤에
// 바꾸려면 이 스크립트로 문서를 직접 고쳐야 한다.
//
//   node scripts/class-review/set-observer-limit.mjs --limit 4                  # 드라이런(선착순만)
//   node scripts/class-review/set-observer-limit.mjs --limit 4 --apply          # 적용
//   node scripts/class-review/set-observer-limit.mjs --limit 4 --mode all --apply
//   node scripts/class-review/set-observer-limit.mjs --revert <로그경로> --apply # 원복
//
// ⚠️ 기본 대상은 **선착순(open) 건만**이다. 지정(assigned) 건은 평가자가 생성 시 확정된 명단이라
//    정원을 바꿔도 화면이 안 변한다(observerLimit은 선착순 마감·빈 칸 계산에만 쓰인다) — 굳이 건드려
//    "고쳤는데 그대로"라는 혼란을 만들지 않는다. 필요하면 --mode all.
// 🔴 **이미 제출이 정원보다 많은 건은 건너뛴다** — 정원을 줄이면 이미 채점한 사람이 화면에서 사라진다
//    (observerColumns가 앞에서부터 slice). 줄이려면 그 건은 사람이 직접 판단할 것.
// ⚠️ form_data는 **읽어서 header만 바꾼 뒤 통째로 다시 쓴다** — 부분 PATCH가 아니므로 다른 키(문항
//    스냅샷·제출·평가자)를 절대 잃지 않도록 원본 객체를 펼쳐서 넘긴다.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv;
const APPLY = argv.includes("--apply");
const REVERT = argv.includes("--revert") ? argv[argv.indexOf("--revert") + 1] : null;
const MODE = argv.includes("--mode") ? argv[argv.indexOf("--mode") + 1] : "open";
const LIMIT = argv.includes("--limit") ? Number(argv[argv.indexOf("--limit") + 1]) : NaN;

const env = Object.fromEntries(
  readFileSync(join(HERE, "../../.env.local"), "utf-8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);
const SB = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const rest = async (p, init) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init?.method ?? "GET"} ${p} → ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
const writeDoc = (id, formData) =>
  rest(`academy_documents?id=eq.${id}&form_type=eq.class_review`, {
    method: "PATCH",
    body: JSON.stringify({ form_data: formData }),
  });

if (REVERT) {
  const log = JSON.parse(readFileSync(REVERT, "utf-8"));
  console.log(`원복 ${APPLY ? "[적용]" : "[드라이런]"} — ${log.changed.length}건`);
  for (const c of log.changed) {
    console.log(`  ${c.teacherName} ${c.date}: ${c.to} → ${c.from ?? "(없음)"}`);
    if (!APPLY) continue;
    const [row] = await rest(`academy_documents?select=form_data&id=eq.${c.id}`);
    const fd = row.form_data ?? {};
    const header = { ...(fd.header ?? {}) };
    if (c.from === undefined || c.from === null) delete header.observerLimit;
    else header.observerLimit = c.from;
    await writeDoc(c.id, { ...fd, header });
  }
  console.log(APPLY ? "원복 완료" : "(--apply 필요)");
  process.exit(0);
}

if (!Number.isInteger(LIMIT) || LIMIT < 1 || LIMIT > 6) {
  console.error("--limit 은 1~6 정수여야 합니다 (상세 매트릭스 열 수 상한).");
  process.exit(1);
}

const rows = await rest("academy_documents?select=id,form_data&form_type=eq.class_review&order=created_at");
const plan = [];
const skipped = [];
for (const r of rows) {
  const fd = r.form_data ?? {};
  const h = fd.header ?? {};
  const isOpen = h.observerMode === "open";
  if (MODE === "open" && !isOpen) continue;
  if (MODE === "assigned" && isOpen) continue;
  const submitted = Object.keys(fd.submissions ?? {}).filter((k) => k !== "self").length;
  const cur = h.observerLimit;
  const item = {
    id: r.id,
    teacherName: h.teacherName ?? "?",
    date: (h.date ?? "").slice(0, 10),
    mode: isOpen ? "선착순" : "지정",
    from: cur,
    to: LIMIT,
    submitted,
  };
  if (submitted > LIMIT) skipped.push(item); // 정원을 줄이면 이미 채점한 사람이 사라진다 → 건너뜀
  else if (cur === LIMIT) skipped.push({ ...item, why: "이미 그 값" });
  else plan.push(item);
}

console.log(`\n=== 평가자 정원 → ${LIMIT}명 ${APPLY ? "[적용]" : "[드라이런]"} (대상 모드: ${MODE}) ===\n`);
for (const p of plan) {
  console.log(`  ${p.mode}  ${p.teacherName} ${p.date}  정원 ${p.from ?? "(없음→3)"} → ${p.to}  (제출 ${p.submitted})`);
}
if (!plan.length) console.log("  변경 대상 없음");
for (const s of skipped) {
  const why = s.why ?? `제출 ${s.submitted}명 > 정원 ${LIMIT} — 줄이면 채점자가 사라짐`;
  console.log(`  [건너뜀] ${s.teacherName} ${s.date} — ${why}`);
}
console.log(`\n변경 ${plan.length}건 / 건너뜀 ${skipped.length}건`);
if (!APPLY) { console.log("\n(드라이런 — --apply로 실행)"); process.exit(0); }
if (!plan.length) process.exit(0);

const changed = [];
for (const p of plan) {
  const [row] = await rest(`academy_documents?select=form_data&id=eq.${p.id}`);
  const fd = row.form_data ?? {};
  await writeDoc(p.id, { ...fd, header: { ...(fd.header ?? {}), observerLimit: LIMIT } });
  changed.push(p);
  console.log(`적용 ✓ ${p.teacherName} ${p.date} → ${LIMIT}명`);
}

const dir = join(HERE, "logs");
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const logPath = join(dir, `set-observer-limit-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), limit: LIMIT, changed }, null, 2));
console.log(`\n원복 로그: ${logPath}`);

// 되읽어 확인 — 정원뿐 아니라 **다른 키가 살아 있는지**(문항 스냅샷·제출·평가자) 함께 본다.
const after = await rest(`academy_documents?select=id,form_data&id=in.(${changed.map((c) => c.id).join(",")})`);
console.log("\n=== 적용 후 확인 ===");
for (const r of after) {
  const fd = r.form_data ?? {};
  const h = fd.header ?? {};
  console.log(
    `  ${h.teacherName} ${(h.date ?? "").slice(0, 10)}  정원=${h.observerLimit}  모드=${h.observerMode}` +
      `  문항영역=${(fd.areas ?? []).length}  제출=${Object.keys(fd.submissions ?? {}).length}` +
      `  평가자=${(fd.evaluators ?? []).length}`,
  );
}
