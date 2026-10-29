/**
 * scripts/_classnote/link-english-class-boards.mjs — 영어 반 ↔ ClassNote 영어 반 방 연결(s2_0006) 제안·기록.
 *
 * 실행:
 *   node --env-file=.env.local scripts/_classnote/link-english-class-boards.mjs                          # 제안만(변경 없음)
 *   node --env-file=.env.local scripts/_classnote/link-english-class-boards.mjs --sql=out.sql             # 겹침이 완전한 반의 insert SQL 파일
 *   node --env-file=.env.local scripts/_classnote/link-english-class-boards.mjs --sql=out.sql --include-partial  # 일부 빠진 반도
 *   … --apply [--include-partial]                                                                       # 바로 기록(aywa DB만)
 *
 * ⚠️ ClassNote에 접속하지 않는다 — 판정 재료는 aywa DB뿐이다(반 방 원아 = 매일 새벽 스냅샷 0142a · 확정 원아 = 0185a).
 * ⚠️ 이미 연결된 반은 건드리지 않는다(`on conflict do nothing` — 사람이 고친 연결을 되돌리지 않는다).
 * 🔴 '같은 수 둘'(tie)·'반 방 없음'(none)은 기록하지 않는다 — 사람이 정한다.
 */
import fs from "node:fs";
import postgres from "postgres";
import { resolveTenant } from "./classnote-core.mjs";
import { planEnglishClassLinks } from "./english-class-link-plan.mjs";

const APPLY = process.argv.includes("--apply");
const PARTIAL = process.argv.includes("--include-partial");
const SQL_OUT = process.argv.find((a) => a.startsWith("--sql="))?.slice(6) ?? null;

const STATUS = { clean: "완전", partial: "일부 빠짐", tie: "같은 수 둘 — 사람이 고름", none: "반 방 없음" };

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 없음");
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
  try {
    const tenant = await resolveTenant(sql);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
    const [classRows, linkRows, boardRows, memberRows, mathRows, existing, nameRows] = await Promise.all([
      sql`select c.id, c.class_name,
          coalesce(array_agg(distinct e.student_id) filter (where e.student_id is not null), '{}') as student_ids
        from classes c
        left join enrollments e on e.tenant_id = c.tenant_id and e.class_id = c.id
          and (e.end_date is null or e.end_date > ${today}) and (e.start_date is null or e.start_date <= ${today})
          and exists (select 1 from students s where s.id = e.student_id and s.status = 'enrolled' and not coalesce(s.is_test, false))
        where c.tenant_id = ${tenant} and c.is_active and c.subject = 'english' and (c.closed_at is null or c.closed_at >= ${today})
        group by c.id, c.class_name order by c.class_name`,
      sql`select student_id, child_id from classnote_child_links where tenant_id = ${tenant}`,
      sql`select board_id, board_name from classnote_boards where tenant_id = ${tenant}`,
      sql`select board_id, child_id from classnote_board_members where tenant_id = ${tenant}`,
      sql`select board_id from classnote_class_boards where tenant_id = ${tenant}`,
      sql`select class_id, board_name from classnote_english_class_boards where tenant_id = ${tenant}`.catch((e) => {
        if (e?.code === "42P01") return null;
        throw e;
      }),
      sql`select id, name from students where tenant_id = ${tenant}`,
    ]);
    const childrenOf = new Map();
    for (const l of linkRows) childrenOf.set(l.student_id, [...(childrenOf.get(l.student_id) ?? []), Number(l.child_id)]);
    const membersOf = new Map();
    for (const m of memberRows) {
      const k = Number(m.board_id);
      if (!membersOf.has(k)) membersOf.set(k, new Set());
      membersOf.get(k).add(Number(m.child_id));
    }
    const nameOf = new Map(nameRows.map((s) => [s.id, s.name]));
    const linkedNow = new Map((existing ?? []).map((x) => [x.class_id, x.board_name]));
    const plans = planEnglishClassLinks({
      classes: classRows.map((c) => ({ classId: c.id, className: c.class_name, studentIds: c.student_ids })),
      childrenOf,
      boards: boardRows.map((b) => ({ boardId: Number(b.board_id), boardName: b.board_name })),
      membersOf,
      excludeBoardIds: new Set(mathRows.map((b) => Number(b.board_id))),
    });

    console.log(`tenant=${tenant} · 영어 반 ${plans.length}개 · 모드=${APPLY ? "APPLY(기록)" : SQL_OUT ? `SQL 파일(${SQL_OUT})` : "제안만"}`);
    if (existing === null) console.log("⚠️ s2_0006 표가 아직 없습니다 — SQL을 먼저 적용해야 기록할 수 있습니다(제안은 그대로 봅니다).");
    for (const p of plans) {
      const head = `${p.className} (재원 ${p.students} · 원아 연결 ${p.linked})`;
      const now = linkedNow.get(p.classId);
      console.log(`\n· ${head}${now ? `  [이미 연결: ${now}]` : ""}`);
      console.log(`   → ${p.boardName ?? "—"} : ${p.inBoard}/${p.linked}  [${STATUS[p.status]}]`);
      if (p.runnerUp) console.log(`     다음 후보: ${p.runnerUp.boardName} ${p.runnerUp.inBoard}명`);
      if (p.missing.length) console.log(`     그 방에 없음: ${p.missing.map((s) => nameOf.get(s) ?? s).join(", ")}`);
      if (p.noLink.length) console.log(`     ClassNote 원아 연결 없음(학부모 미가입 추정): ${p.noLink.map((s) => nameOf.get(s) ?? s).join(", ")}`);
    }
    const picks = plans.filter((p) => p.boardId != null && !linkedNow.has(p.classId) && (p.status === "clean" || (PARTIAL && p.status === "partial")));
    const count = (s) => plans.filter((p) => p.status === s).length;
    console.log(`\n요약: 완전 ${count("clean")} · 일부 빠짐 ${count("partial")} · 같은 수 둘 ${count("tie")} · 반 방 없음 ${count("none")} · 이번에 기록할 반 ${picks.length}`);

    const linkedBy = (p) => `overlap ${p.inBoard}/${p.linked} · ${today}`;
    if (SQL_OUT) {
      const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
      const lines = picks.map(
        (p) => `insert into public.classnote_english_class_boards (tenant_id, class_id, board_id, board_name, linked_by) values (${q(tenant)}, ${q(p.classId)}, ${p.boardId}, ${q(p.boardName)}, ${q(linkedBy(p))}) on conflict (tenant_id, class_id) do nothing; -- ${p.className}`,
      );
      fs.writeFileSync(SQL_OUT, `-- 영어 반 ↔ 반 방 연결 ${picks.length}건 (${today} 제안 · link-english-class-boards.mjs)\nbegin;\n${lines.join("\n")}\ncommit;\n`);
      console.log(`SQL 파일 저장: ${SQL_OUT}`);
    }
    if (APPLY) {
      if (existing === null) throw new Error("s2_0006 표가 없어 기록하지 않습니다");
      let n = 0;
      for (const p of picks) {
        const r = await sql`insert into classnote_english_class_boards (tenant_id, class_id, board_id, board_name, linked_by)
          values (${tenant}, ${p.classId}, ${p.boardId}, ${p.boardName}, ${linkedBy(p)}) on conflict (tenant_id, class_id) do nothing`;
        n += r.count;
      }
      console.log(`기록 ${n}건`);
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
