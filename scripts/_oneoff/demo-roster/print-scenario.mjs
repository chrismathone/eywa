/**
 * 갈래 하나를 사람이 읽게 출력한다. 쓰기는 없다.
 * DB가 있으면 slug가 demo인 지점의 현재 건수만 읽는다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY_KO, buildScenario } from "../../../src/features/demo-roster/plan.mjs";

const DAYS = ["mon", "tue", "wed", "thu", "fri"];

function pct(n, d) {
  if (!d) return "0%";
  return `${Math.round((n / d) * 1000) / 10}%`;
}

function pad(s, w) {
  const text = String(s);
  let width = 0;
  for (const ch of text) width += ch.charCodeAt(0) > 255 ? 2 : 1;
  return text + " ".repeat(Math.max(0, w - width));
}

function render(plan) {
  const { scenario, stats, classes, students } = plan;
  const lines = [];
  const say = (s = "") => lines.push(s);
  say(`데모 지점 가상 재원 · ${scenario.title}`);
  say(scenario.blurb);
  say("쓰기 없음. 학교·학생 이름은 가상이다. 시작일 2026-09-01 (오늘 2026-09-22 기준 이미 재원).");
  say("");
  say(
    `재원 ${stats.students}명 · 수학 ${stats.math} · 영어 ${stats.eng} · 동시수강 ${stats.both}명 (${pct(stats.both, stats.students)}) · 타겟 4개교 ${stats.targetN}명 (${pct(stats.targetN, stats.students)}) · 반 ${stats.classes} · 시간표 행 ${stats.scheduleRows} · 겹침 0`,
  );
  say("");
  say("학교");
  say(`${pad("학교", 12)}${pad("급", 6)}${pad("타겟", 6)}${pad("인원", 6)}${pad("수학", 6)}${pad("영어", 6)}${pad("둘 다", 8)}비율`);
  for (const s of stats.bySchool) {
    say(
      `${pad(s.name, 12)}${pad(s.kind === "elem" ? "초등" : "중등", 6)}${pad(s.target ? "타겟" : "", 6)}${pad(s.n, 6)}${pad(s.math, 6)}${pad(s.english, 6)}${pad(s.both, 8)}${pct(s.n, stats.students)}`,
    );
  }
  say("");
  say("학교 × 학년 (인원)");
  say(pad("학교", 12) + plan.grades.map((g) => pad(g.grade, 6)).join("") + pad("합", 6));
  stats.bySchool.forEach((s, i) => {
    const row = stats.matrix[i];
    say(pad(s.name, 12) + row.map((n) => pad(n || "·", 6)).join("") + pad(s.n, 6));
  });
  say("");
  say("학년");
  say(`${pad("학년", 8)}${pad("인원", 6)}${pad("수학", 6)}${pad("영어", 6)}${pad("둘 다", 8)}`);
  for (const g of stats.byGrade) {
    say(`${pad(g.grade, 8)}${pad(g.n, 6)}${pad(g.math, 6)}${pad(g.english, 6)}${pad(g.both, 8)}`);
  }
  say("");
  say("반 · 시간 · 강의실");
  say(`${pad("반", 28)}${pad("인원", 6)}${pad("요일", 10)}${pad("시간", 26)}강의실`);
  for (const c of classes) {
    const days = c.days.map((d) => DAY_KO[d]).join("");
    const extra = c.folded ? ` (+${c.folded})` : "";
    say(`${pad(c.name + extra, 28)}${pad(c.members.length, 6)}${pad(days, 10)}${pad(`${c.clock} ${c.timeLabel}`, 26)}${c.room}`);
  }
  say("");
  say("주간 시간표 (칸 안은 그 교시에 서는 반)");
  for (const p of plan.periods) {
    const rows = DAYS.map((d) => {
      const here = classes.filter((c) => c.days.includes(d) && c.periods.some((x) => x.start === p.start));
      if (!here.length) return null;
      return `  ${DAY_KO[d]}  ${here.map((c) => `${c.name} ${c.room} ${c.members.length}명`).join(" · ")}`;
    }).filter(Boolean);
    if (!rows.length) continue;
    say(`${p.label} ${p.start}–${p.end}`);
    for (const row of rows) say(row);
  }
  say("");
  say("동시수강 표본 (같은 학생의 수학·영어가 다른 날인지)");
  const sample = students.filter((s) => s.role === "both").slice(0, 8);
  for (const s of sample) {
    const bits = s.classes.map((c) => `${c.name} ${c.days.map((d) => DAY_KO[d]).join("")} ${c.clock}`);
    say(`  ${s.name} · ${s.school.name} ${s.grade} · ${bits.join(" / ")}`);
  }
  say("");
  say(`넣게 되면: 학생 ${stats.students} · 수강 ${stats.eng + stats.math} · 반 ${stats.classes} · 강의실 ${stats.rooms.join(" ")} · 시간표 행 ${stats.scheduleRows}`);
  say("담임은 비운다. 데모 지점 직원은 지점장 한 명이라 그 계정을 모든 반의 담임으로 넣지 않는다.");
  say("학생 코드 DMO-0001… · 보호자 전화 010-5550-… (가상 번호).");
  return lines.join("\n");
}

async function probeDemo() {
  if (!process.env.DATABASE_URL) {
    return "DB는 안 봤다. 계획을 숫자로만 확인했다. 지금 데모 지점 건수가 필요하면 --env-file 로 다시 실행한다.";
  }
  const postgres = (await import("postgres")).default;
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, connect_timeout: 8 });
  try {
    const tenants = await sql`select id, slug, name from tenants where slug = 'demo'`;
    if (tenants.length !== 1) {
      return `slug=demo 지점이 ${tenants.length}개라 건수를 읽지 않았다.`;
    }
    const id = tenants[0].id;
    const [st] = await sql`select count(*)::int as n from students where tenant_id = ${id}`;
    const [cl] = await sql`select count(*)::int as n from classes where tenant_id = ${id}`;
    const [en] = await sql`select count(*)::int as n from enrollments where tenant_id = ${id}`;
    const [sc] = await sql`select count(*)::int as n from class_schedules where tenant_id = ${id}`;
    const [rm] = await sql`select count(*)::int as n from classrooms where tenant_id = ${id}`;
    let preset = "";
    try {
      const [row] = await sql`select data->>'preset' as preset from tenant_settings where tenant_id = ${id}`;
      if (row?.preset) preset = ` · 설정 preset=${row.preset}`;
    } catch {
      preset = "";
    }
    return `지금 DB의 데모 지점 "${tenants[0].name}" (${tenants[0].slug})${preset}: 학생 ${st.n} · 반 ${cl.n} · 수강 ${en.n} · 시간표 행 ${sc.n} · 강의실 ${rm.n}. 이 실행은 읽기만 했다.`;
  } finally {
    await sql.end({ timeout: 2 });
  }
}

export async function runScenario(id) {
  const foreign = process.argv.find((a) => a.startsWith("--tenant=") && a !== "--tenant=demo");
  if (foreign) {
    console.error("이 스크립트는 demo 지점 전용이다. 다른 테넌트는 받지 않는다.");
    process.exit(1);
  }
  if (process.argv.includes("--apply")) {
    console.error("아직 쓰지 않는다. 네 갈래를 비교한 뒤에 고른 것만 넣는다.");
    process.exit(1);
  }
  const plan = buildScenario(id);
  const text = render(plan);
  const dir = join(tmpdir(), "demo-roster");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${id}.txt`);
  writeFileSync(file, text, "utf8");
  console.log(text);
  console.log("");
  try {
    console.log(await probeDemo());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`DB 조회는 건너뛰었다 (${message.replace(/postgres:\/\/\S+/gi, "…")}). 계획 숫자는 위에 있다.`);
  }
  console.log(`출력 파일: ${file}`);
}
