/**
 * scripts/_classnote/confirm-child-links.mjs — **원장 확인 연결** 넣기·되돌리기(0185a `classnote_child_links.linked_by = 'confirmed'`).
 *
 * 왜(원장 2026-11-05 *"형제 뒤바뀜 3명과 보호자 전화 2명은 해결책을 통해 발송 막히지 않도록 해"*): 원아 신분 가드(child-identity.mjs)는
 * 운영관리 명부(학부모가 입소 때 낸 서류 — 명부 이름·보호자 전화)가 형제 것이거나 학생 본인 번호면 그 원아를 막는다. 원장이 그 원아가 이 학생의
 * 것임을 확인하면 이 도구로 그 연결 한 줄을 '원장 확인'으로 바꾼다 — 가드는 그 줄에서 **입소 서류만** 대조에서 뺀다(프로필 이름·보드 이름·생년·
 * 형제·다른 학생 기록·명부 재원 여부는 그대로 · 가드 맨 위 주석). ClassNote의 서류는 고치지 않는다(고치면 학부모 화면에도 바뀌어 보인다).
 * 앱에는 이 버튼이 없다 — 드문 일이라 사람이 확인하고 이 도구로 넣는다(가드 사유의 '원장 확인을 거쳐 다시 보낼 수 있습니다'가 가리키는 길).
 *
 * 실행(드라이런이 기본 — 바꾸지 않고 지금 상태만 보인다):
 *   node --env-file=.env.local scripts/_classnote/confirm-child-links.mjs --pairs <저장소 밖 파일.json> [--tenant <지점 slug>] [--apply] [--backup-dir <폴더>]
 *     파일 = [{ "student": "<학생 이름 또는 id>", "childId": 2235158, "before": "manual"(선택 — 지금 근거 칸이 이 값일 때만), "why": "<원장이 확인한 내용>" }]
 *     입력 파일·되돌리기 자료는 저장소 밖에만(학생 이름·원아 번호) — 되돌리기 자료 기본 폴더 = 입력 파일 폴더.
 *   되돌리기:
 *   node --env-file=.env.local scripts/_classnote/confirm-child-links.mjs --revert <backup-*.json> --why "<되돌리는 까닭>" [--apply]
 *
 * 🔴 지금 연결이 그 학생에게 있고 근거 칸이 기대(있으면)와 같을 때만 바꾼다(그새 사람이 고쳤을 수 있다) — 한 줄이라도 어긋나면 아무것도 바꾸지 않는다.
 *    바꾼 줄마다 감사로그 한 건(같은 트랜잭션 — 하나라도 실패하면 전부 되돌린다) · 넣으면 되돌리기 자료(backup-*.json)를 남긴다.
 * 🔴 ClassNote에는 접속하지 않는다(aywa DB만) · 전화 값은 읽지도 출력하지도 않는다.
 * 🔴 확인 연결을 읽는 판(AywaSync 1.0.16)보다 **먼저** 넣는다 — 옛 판은 이 칸을 보지 않아 먼저 넣어도 안전하고, 새 판이 확인 없이 전체 동기화를
 *    한 번 돌면 확인할 원아의 반 보드 기록이 보류로 다시 쓰여 그 학생 보고서가 막힌다(docs/decisions/reports-ai.md 2026-11-05).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { CONFIRMED_LINK } from "./child-identity.mjs";
import { resolveTenant } from "./classnote-core.mjs";

const argOf = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
};
const APPLY = process.argv.includes("--apply");
const PAIRS = argOf("--pairs");
const REVERT = argOf("--revert");
const REVERT_WHY = argOf("--why");
const SLUG = argOf("--tenant");
/** 되돌리기 자료 폴더 — 기본은 --pairs 파일이 있는 폴더(저장소 밖에 둔 입력 옆 · 재확인 2026-11-05: 실행 폴더 기본이면 저장소 루트에 생겨 커밋될 수 있었다). */
const BACKUP_DIR = argOf("--backup-dir") ?? (PAIRS ? path.dirname(path.resolve(PAIRS)) : null);
/** 이 저장소의 루트 — 학생 이름·원아 번호가 든 파일(입력·되돌리기 자료)은 저장소 안에 두지 않는다. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const insideRepo = (p) => {
  const rel = path.relative(REPO_ROOT, path.resolve(p));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** 감사로그 행위 — `action: "…"` 리터럴은 감사 행위 레지스트리 시험(actions-registry.test.ts)이 등록을 확인한다. */
const AUDIT = {
  confirm: { action: "classnote_child_link_confirm" },
  unconfirm: { action: "classnote_child_link_unconfirm" },
};
const ACTOR = "원장 지시 · 손 스크립트";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readPairs(file) {
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(rows) || !rows.length) throw new Error("--pairs 파일은 비어 있지 않은 배열이어야 합니다");
  return rows.map((r, i) => {
    const student = String(r?.student ?? "").trim();
    const childId = Number(r?.childId);
    const why = String(r?.why ?? "").trim();
    const before = r?.before == null ? null : String(r.before).trim();
    if (!student || !Number.isSafeInteger(childId) || childId <= 0 || !why) throw new Error(`--pairs ${i + 1}번째 줄: student · childId(양의 정수) · why가 필요합니다`);
    if (before === CONFIRMED_LINK) throw new Error(`--pairs ${i + 1}번째 줄: before에 '${CONFIRMED_LINK}'을 적을 수 없습니다`);
    return { student, childId, why, before };
  });
}

async function tenantId(sql) {
  if (!SLUG) return resolveTenant(sql);
  const rows = await sql`select id from tenants where slug = ${SLUG}`;
  if (rows.length !== 1) throw new Error(`지점 slug '${SLUG}' — ${rows.length}개`);
  return rows[0].id;
}

async function findStudent(sql, tenant, key) {
  const rows = UUID.test(key)
    ? await sql`select id, name from students where tenant_id = ${tenant} and id = ${key} and not coalesce(is_test, false)`
    : await sql`select id, name from students where tenant_id = ${tenant} and name = ${key} and not coalesce(is_test, false)`;
  if (rows.length !== 1) return { error: `학생 '${key}' ${rows.length}명 — 학생 id로 적어 주세요` };
  return { id: rows[0].id, name: rows[0].name };
}

const linkOf = async (sql, tenant, childId) =>
  (await sql`select child_id, student_id, linked_by from classnote_child_links where tenant_id = ${tenant} and child_id = ${childId}`)[0] ?? null;

function writeBackup(kind, tenant, rows) {
  const file = path.join(BACKUP_DIR, `backup-${kind}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  fs.writeFileSync(file, JSON.stringify({ kind, tenant, at: new Date().toISOString(), rows }, null, 2));
  return file;
}

/** 넣기 — 줄마다 지금 상태를 보이고, 전부 바꿀 수 있을 때만(이미 확인은 건너뜀) 한 트랜잭션으로 바꾼다. */
async function confirm(sql, tenant) {
  const plan = [];
  for (const p of readPairs(PAIRS)) {
    const st = await findStudent(sql, tenant, p.student);
    const link = st.error ? null : await linkOf(sql, tenant, p.childId);
    const state = st.error
      ? st.error
      : !link
        ? "연결 없음"
        : link.student_id !== st.id
          ? "다른 학생에 연결"
          : link.linked_by === CONFIRMED_LINK
            ? "이미 확인"
            : p.before && link.linked_by !== p.before
              ? `근거 칸이 기대(${p.before})와 다름(${link.linked_by})`
              : "바꿀 수 있음";
    plan.push({ ...p, studentId: st.id ?? null, studentName: st.name ?? p.student, current: link?.linked_by ?? null, state });
    console.log(`${st.name ?? p.student} · 원아 ${p.childId} · 지금 근거 ${link?.linked_by ?? "-"} → ${state}`);
  }
  const blocked = plan.filter((p) => p.state !== "바꿀 수 있음" && p.state !== "이미 확인");
  const todo = plan.filter((p) => p.state === "바꿀 수 있음");
  if (!APPLY) return console.log(`\n드라이런 — 바꾼 것 없음(바꿀 줄 ${todo.length} · 막힌 줄 ${blocked.length}). 적용은 --apply.`);
  if (blocked.length) throw new Error(`막힌 줄 ${blocked.length}개 — 아무것도 바꾸지 않았습니다(파일을 고친 뒤 다시)`);
  if (!todo.length) return console.log("\n바꿀 줄 없음(전부 이미 확인).");
  const backup = writeBackup("confirm", tenant, todo.map((p) => ({ childId: p.childId, studentId: p.studentId, studentName: p.studentName, before: p.current })));
  console.log(`\n되돌리기 자료: ${backup}`);
  await sql.begin(async (tx) => {
    for (const p of todo) {
      // `is not distinct from` — 근거 칸이 빈(NULL) 연결도 지금 값 그대로일 때 바꾼다(`= null`은 어떤 줄과도 맞지 않는다 · 재확인 2026-11-05).
      const u = await tx`update classnote_child_links set linked_by = ${CONFIRMED_LINK}
        where tenant_id = ${tenant} and child_id = ${p.childId} and student_id = ${p.studentId} and linked_by is not distinct from ${p.current}`;
      if (u.count !== 1) throw new Error(`${p.studentName} · 원아 ${p.childId}: ${u.count}줄 바뀜 — 전부 되돌림`);
      await tx`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${tenant}, null, ${ACTOR}, ${AUDIT.confirm.action}, ${"student"}, ${p.studentName},
          ${tx.json({ studentId: p.studentId, childId: p.childId, before: p.current, after: CONFIRMED_LINK, why: p.why })})`;
    }
  });
  console.log(`적용 ${todo.length}줄 · 감사로그 ${todo.length}건`);
  for (const p of todo) console.log(`다시 읽기: ${p.studentName} · 원아 ${p.childId} = ${(await linkOf(sql, tenant, p.childId))?.linked_by ?? "-"}`);
}

/** 되돌리기 — 되돌리기 자료의 줄을 원래 근거 칸으로(지금 '원장 확인'이고 학생이 같을 때만). */
async function revert(sql) {
  if (!REVERT_WHY?.trim()) throw new Error("--why <되돌리는 까닭> 이 필요합니다");
  const data = JSON.parse(fs.readFileSync(REVERT, "utf8"));
  if (data?.kind !== "confirm" || !Array.isArray(data.rows)) throw new Error("넣기 때 남긴 되돌리기 자료(backup-confirm-*.json)가 아닙니다");
  const tenant = data.tenant;
  const plan = [];
  for (const r of data.rows) {
    const link = await linkOf(sql, tenant, r.childId);
    const state = !link
      ? "연결 없음"
      : link.student_id !== r.studentId
        ? "다른 학생에 연결"
        : link.linked_by === r.before
          ? "이미 되돌림"
          : link.linked_by !== CONFIRMED_LINK
            ? `근거 칸이 원장 확인이 아님(${link.linked_by})`
            : "되돌릴 수 있음";
    plan.push({ ...r, state });
    console.log(`${r.studentName ?? r.studentId} · 원아 ${r.childId} · 지금 근거 ${link?.linked_by ?? "-"} → ${state}(되돌릴 값 ${r.before})`);
  }
  const blocked = plan.filter((p) => p.state !== "되돌릴 수 있음" && p.state !== "이미 되돌림");
  const todo = plan.filter((p) => p.state === "되돌릴 수 있음");
  if (!APPLY) return console.log(`\n드라이런 — 바꾼 것 없음(되돌릴 줄 ${todo.length} · 막힌 줄 ${blocked.length}). 적용은 --apply.`);
  if (blocked.length) throw new Error(`막힌 줄 ${blocked.length}개 — 아무것도 바꾸지 않았습니다`);
  await sql.begin(async (tx) => {
    for (const p of todo) {
      const u = await tx`update classnote_child_links set linked_by = ${p.before}
        where tenant_id = ${tenant} and child_id = ${p.childId} and student_id = ${p.studentId} and linked_by = ${CONFIRMED_LINK}`;
      if (u.count !== 1) throw new Error(`원아 ${p.childId}: ${u.count}줄 바뀜 — 전부 되돌림`);
      await tx`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
        values (${tenant}, null, ${ACTOR}, ${AUDIT.unconfirm.action}, ${"student"}, ${p.studentName ?? null},
          ${tx.json({ studentId: p.studentId, childId: p.childId, before: CONFIRMED_LINK, after: p.before, why: REVERT_WHY.trim() })})`;
    }
  });
  console.log(`되돌림 ${todo.length}줄 · 감사로그 ${todo.length}건`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 없음");
  if (!PAIRS === !REVERT) throw new Error("--pairs <파일> 또는 --revert <되돌리기 자료> 중 하나가 필요합니다");
  // 학생 이름·원아 번호가 든 파일은 저장소 밖에서만 읽고 쓴다(실수로 커밋되지 않게).
  for (const p of [PAIRS, REVERT, BACKUP_DIR].filter(Boolean))
    if (insideRepo(p)) throw new Error(`'${p}'가 저장소 안입니다 — 입력 파일·되돌리기 자료는 저장소 밖 폴더에 두세요(--backup-dir)`);
  const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1, idle_timeout: 5 });
  try {
    if (REVERT) await revert(sql);
    else await confirm(sql, await tenantId(sql));
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error("실패 —", String(e?.message ?? e).slice(0, 400));
  process.exitCode = 1;
});
