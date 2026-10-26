// ① 퇴원 사유 복원 — 원장이 승인한 행만 적용하는 실행기(🔴 2026-10-26 MVP 세션은 실행하지 않는다 · 메인 세션이 원장 승인 뒤).
//   미리보기(기본, 읽기 전용 연결): node --env-file=D:/eywa_refactoring/.env.local scripts/_oneoff/ai-credit-mvp/withdrawals/apply.mjs --approved <승인.csv>
//   적용: … --approved <승인.csv> --apply   → 한 거래 안에서 백업 파일을 먼저 쓰고, 조건이 맞는 행만 바꾸고, 감사로그를 남긴다.
//   되돌리기: revert.mjs --backup <백업.json>
// 승인 CSV = review.xlsx '검토' 시트를 CSV로 저장한 것(첫 줄 머리 · '승인' 칸이 O인 줄만 · 원장이 사유·세부·메모 칸을 고쳤으면 고친 값을 쓴다).
// 🔴 키 대조: '사유 키'·'세부 키'는 앱 사유 목록(reason-keys.json — deliver.ts가 reason-detail.ts에서 뽑는다)에 있어야 하고, 세부는 그 사유의 것이어야
//    하며, 한글 '사유'·'세부' 칸이 키와 다르면 멈춘다(라벨만 고친 줄을 옛 키로 적용하지 않게).
// 🔴 조건부 갱신: 지금도 퇴원이고 · 사유가 비어 있고 · 퇴원일이 검토 때와 같을 때만(그 사이 누가 손댔으면 건너뛰고 알린다).
// 🔴 메모: 이미 적힌 메모는 지우지 않는다(기존 메모 뒤에 ' / '로 잇는다).
// 🔴 수강 종료 사유는 퇴원일 **당일** 끝난 수강 중 반 이동이 아니고 사유가 빈 줄만(앱 syncWithdrawalEnrollmentReasons와 같은 날 기준 —
//    그 함수는 옛 사유가 비면 건너뛰므로 여기서 따로 맞춘다). 마감한 강사평가 달(teacher_portfolio_months)은 건드리지 않는다(재집계 없음).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import { closeReadOnly, openReadOnly, tenantIdOf } from "../lib/db-readonly.mjs";

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : null; };
const APPLY = process.argv.includes("--apply");
const approvedFile = arg("approved");
if (!approvedFile) throw new Error("--approved <승인.csv> 필요");
const OUT = "D:/tmp/ai-credit-mvp-2026-10-26/03-withdrawals";
const KEYS = JSON.parse(readFileSync(arg("keys") ?? join(OUT, "reason-keys.json"), "utf8"));

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; continue; }
    if (ch === '"') q = true; else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const [head, ...body] = parseCsv(readFileSync(approvedFile, "utf8").replace(/^\ufeff/, ""));
const col = (name) => { const i = head.indexOf(name); if (i < 0) throw new Error(`승인 CSV에 '${name}' 칸이 없다`); return i; };
const C = { ok: col("승인"), sid: col("학생 id"), w: col("퇴원일"), reason: col("사유 키"), detail: col("세부 키"), memo: col("메모"), reasonLabel: col("사유"), detailLabel: col("세부") };
const cell = (r, i) => (r[i] ?? "").trim();
const approved = body.filter((r) => /^(o|O|ㅇ|승인)$/.test(cell(r, C.ok))).map((r) => ({
  studentId: cell(r, C.sid), withdrawnAt: cell(r, C.w), reason: cell(r, C.reason), detail: cell(r, C.detail) || null, memo: cell(r, C.memo) || null,
  reasonLabel: cell(r, C.reasonLabel), detailLabel: cell(r, C.detailLabel),
}));
const seen = new Set();
for (const a of approved) {
  const at = `(${a.studentId})`;
  if (!/^[0-9a-f-]{36}$/.test(a.studentId)) throw new Error(`학생 id가 이상하다 ${at}`);
  if (seen.has(a.studentId)) throw new Error(`같은 학생이 두 줄 ${at}`);
  seen.add(a.studentId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.withdrawnAt)) throw new Error(`퇴원일 형식이 이상하다 ${at}`);
  if (!KEYS.reasons[a.reason]) throw new Error(`모르는 사유 키 ${a.reason} ${at}`);
  if (a.reasonLabel && a.reasonLabel !== KEYS.reasons[a.reason]) throw new Error(`'사유' 칸(${a.reasonLabel})과 사유 키(${a.reason} = ${KEYS.reasons[a.reason]})가 다르다 — 키를 고칠 것 ${at}`);
  if (a.detail) {
    const d = KEYS.details[a.detail];
    if (!d) throw new Error(`모르는 세부 키 ${a.detail} ${at}`);
    if (d.reason !== a.reason) throw new Error(`세부 ${a.detail}(${d.label})는 사유 ${a.reason}의 세부가 아니다 ${at}`);
    if (a.detailLabel && a.detailLabel !== d.label) throw new Error(`'세부' 칸(${a.detailLabel})과 세부 키(${a.detail} = ${d.label})가 다르다 — 키를 고칠 것 ${at}`);
  } else if (a.detailLabel && a.detailLabel !== "(세부 없음)") throw new Error(`'세부' 칸(${a.detailLabel})이 있는데 세부 키가 비었다 ${at}`);
  if (a.reason === "other" && !a.memo) throw new Error(`'기타'는 메모 필수 ${at}`);
}
console.log(`승인 ${approved.length}줄 · ${APPLY ? "적용" : "미리보기(읽기 전용)"}`);

const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const joinMemo = (old, add) => (!add ? old ?? null : !(old ?? "").trim() ? add : (old.includes(add) ? old : `${old} / ${add}`));

const sql = APPLY ? postgres(process.env.DATABASE_URL, { ssl: "require", max: 1, prepare: false }) : await openReadOnly();
try {
  const cs = await tenantIdOf(sql);
  const plan = async (tx) => {
    const ids = approved.map((a) => a.studentId);
    // 적용은 행을 잠근다 · 읽기 전용 미리보기에선 잠금을 쓸 수 없어 따로 쓴다.
    const students = APPLY
      ? await tx`select id, name, status, withdrawn_at::text w, withdrawal_metadata m from students where tenant_id=${cs} and id = any(${ids}) for update`
      : await tx`select id, name, status, withdrawn_at::text w, withdrawal_metadata m from students where tenant_id=${cs} and id = any(${ids})`;
    const enr = APPLY
      ? await tx`select id, student_id, end_date::text e, withdrawal_reason, withdrawal_detail, withdrawal_memo, is_transferred from enrollments where tenant_id=${cs} and student_id = any(${ids}) for update`
      : await tx`select id, student_id, end_date::text e, withdrawal_reason, withdrawal_detail, withdrawal_memo, is_transferred from enrollments where tenant_id=${cs} and student_id = any(${ids})`;
    const S = new Map(students.map((s) => [s.id, s]));
    const changes = [], skipped = [];
    for (const a of approved) {
      const s = S.get(a.studentId);
      const why = !s ? "학생 없음" : s.status !== "withdrawn" ? "지금 퇴원 아님" : s.w !== a.withdrawnAt ? "퇴원일이 바뀜"
        : s.m != null && !isObj(s.m) ? "퇴원 정보 형식이 달라 손대지 않음" : (s.m?.reason ?? "") !== "" ? "이미 사유 있음" : null;
      if (why) { skipped.push({ studentId: a.studentId, why }); continue; }
      const old = s.m ?? {};
      const meta = { ...old, reason: a.reason, ...(a.detail ? { detail: a.detail } : {}), memo: joinMemo(old.memo, a.memo),
        consultation: old.consultation ?? { adminCalledParent: false, teacherCalledParent: false, talkedWithStudent: false } };
      const rows = enr.filter((e) => e.student_id === a.studentId && e.e === a.withdrawnAt && !e.is_transferred && !(e.withdrawal_reason ?? "").trim());
      changes.push({ ...a, name: s.name,
        before: { metadata: s.m ?? null, enrollments: rows.map((e) => ({ id: e.id, withdrawal_reason: e.withdrawal_reason, withdrawal_detail: e.withdrawal_detail, withdrawal_memo: e.withdrawal_memo })) },
        after: { metadata: meta, enrollments: rows.map((e) => ({ id: e.id, withdrawal_reason: a.reason, withdrawal_detail: (e.withdrawal_detail ?? "").trim() ? e.withdrawal_detail : a.detail, withdrawal_memo: joinMemo(e.withdrawal_memo, a.memo) })) } });
    }
    return { changes, skipped };
  };
  if (!APPLY) {
    const { changes, skipped } = await plan(sql);
    console.log(JSON.stringify({ 바꿀_학생: changes.length, 바꿀_수강줄: changes.reduce((n, c) => n + c.after.enrollments.length, 0), 건너뜀: skipped }));
  } else {
    await sql.begin(async (tx) => {
      const { changes, skipped } = await plan(tx);
      const backup = join(OUT, `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
      writeFileSync(backup, JSON.stringify({ tenantId: cs, at: new Date().toISOString(), changes }, null, 2)); // 백업이 먼저(실패하면 거래째 멈춘다)
      for (const c of changes) {
        const r = await tx`update students set withdrawal_metadata = ${tx.json(c.after.metadata)} where tenant_id=${cs} and id=${c.studentId} and status='withdrawn' and coalesce(withdrawal_metadata->>'reason','')='' returning id`;
        if (r.length !== 1) throw new Error(`조건이 바뀌어 멈춤: ${c.studentId}`);
        for (const e of c.after.enrollments) {
          const u = await tx`update enrollments set withdrawal_reason=${e.withdrawal_reason}, withdrawal_detail=${e.withdrawal_detail}, withdrawal_memo=${e.withdrawal_memo}
            where tenant_id=${cs} and id=${e.id} and coalesce(btrim(withdrawal_reason),'')='' returning id`;
          if (u.length !== 1) throw new Error(`수강 줄 조건이 바뀌어 멈춤: ${e.id}`);
        }
        await tx`insert into audit_logs (tenant_id, actor_id, actor_name, action, target_type, target_label, metadata)
          values (${cs}, null, '퇴원 사유 복원(원장 승인 · 2026-10-26 크레딧 MVP)', 'withdrawal_reason_restore', 'student', ${c.name ?? null},
          ${tx.json({ studentId: c.studentId, reason: c.reason, detail: c.detail, memo: c.memo, before: c.before, after: c.after })})`;
      }
      console.log(JSON.stringify({ 적용_학생: changes.length, 건너뜀: skipped.length, 백업: backup }));
    });
  }
} finally {
  if (APPLY) await sql.end(); else await closeReadOnly(sql);
}
