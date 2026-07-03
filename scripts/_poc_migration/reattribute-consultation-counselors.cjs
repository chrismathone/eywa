#!/usr/bin/env node
/**
 * reattribute-consultation-counselors.cjs — 학생상담 counselor_id 재배정(사후 교정).
 *
 * ⚠️ 배경: ijw 전체복원(run.ts)의 상담자 해석 버그로 임포트 상담 1411건이 전부 'fallbackUser'(보조T)에
 * 몰렸다. resolveUser(uid)가 미해결 시 항상 fallbackUser를 반환해 `?? nameToTeacher.get(consultantName)`
 * (이름 매칭)이 dead code였다(run.ts에서 우선순위 수정 완료). 이 스크립트는 **이미 적재된** 보조T 상담을
 * ijw 원본의 consultantName으로 실제 상담자에게 되돌린다.
 *
 * 매칭키 = (학생명, 상담일 YMD, 상담내용) — ijw record ↔ eywa 보조T 상담. 같은 키에 서로 다른 상담자면
 * 모호(skip), consultantName이 eywa 사용자와 안 맞으면 skip(보조T 유지). **멱등**: counselor_id=보조T 행만
 * 대상. **되돌리기**: 적용한 (id) 목록을 revert 파일로 남긴다 → 되돌리려면 그 id들을 보조T로 UPDATE.
 *
 * 실행: node --env-file=.env.local scripts/_poc_migration/reattribute-consultation-counselors.cjs        (dry-run)
 *       node --env-file=.env.local scripts/_poc_migration/reattribute-consultation-counselors.cjs --apply
 */
const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const APPLY = process.argv.includes("--apply");
const TMP = process.env.MAKEEDU_OUT ? path.dirname(process.env.MAKEEDU_OUT) : "D:/tmp";
const BOJO_NAME = "보조T";

// 최신 ijw export 자동 선택(다른 백필 스크립트와 동일 규약).
function latestExport() {
  const dir = "D:/tmp";
  const files = fs.readdirSync(dir).filter((f) => /^ijw-export-.*\.json$/.test(f)).sort();
  if (!files.length) throw new Error("D:/tmp에 ijw-export-*.json 없음");
  return path.join(dir, files[files.length - 1]);
}

const stripParen = (n) => String(n || "").replace(/\s*\(.*?\)\s*/g, "").trim();
const normContent = (s) => {
  const t = String(s ?? "").trim();
  return t === "(내용 없음)" ? "" : t;
};
const key = (name, ymd, content) => `${String(name).trim()}${ymd}${normContent(content)}`;

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });

(async () => {
  try {
    const exportPath = latestExport();
    console.log("ijw export:", path.basename(exportPath), "| 모드:", APPLY ? "APPLY" : "DRY-RUN");
    const data = JSON.parse(fs.readFileSync(exportPath, "utf8"));
    const ijw = data.collections.student_consultations;

    // eywa 사용자 이름맵(display_name/english_name → id), 보조T id.
    const users = await sql`select id, display_name, english_name from users`;
    const nameToUser = new Map();
    let bojoId = null;
    for (const u of users) {
      if (u.display_name) {
        nameToUser.set(u.display_name.trim(), u.id);
        if (u.display_name.trim() === BOJO_NAME) bojoId = u.id;
      }
      if (u.english_name) nameToUser.set(u.english_name.trim(), u.id);
    }
    if (!bojoId) throw new Error("보조T 사용자를 찾을 수 없음");
    const resolveName = (nm) => {
      if (!nm) return null;
      return nameToUser.get(String(nm).trim()) ?? nameToUser.get(stripParen(nm)) ?? null;
    };

    // ijw 매칭맵: key → {userId, consultantName} (충돌=서로 다른 userId면 ambiguous로 표시).
    const map = new Map(); // key → userId | "AMBIGUOUS"
    const nameOfKey = new Map();
    let ijwUnresolvedName = 0;
    for (const raw of ijw) {
      const c = raw.data || raw;
      const uid = resolveName(c.consultantName);
      const k = key(c.studentName, String(c.date).slice(0, 10), c.content);
      if (!uid) {
        ijwUnresolvedName++;
        if (!map.has(k)) { map.set(k, null); nameOfKey.set(k, c.consultantName); }
        continue;
      }
      const cur = map.get(k);
      if (cur === undefined || cur === null) { map.set(k, uid); nameOfKey.set(k, c.consultantName); }
      else if (cur !== uid && cur !== "AMBIGUOUS") map.set(k, "AMBIGUOUS");
    }

    // eywa 보조T 상담 + 학생명·상담일·요약.
    const rows = await sql`
      select sc.id, s.name as student_name, sc.consulted_at::date::text as ymd, sc.summary
      from student_consultations sc join students s on s.id = sc.student_id
      where sc.counselor_id = ${bojoId}`;
    console.log("보조T 상담(대상):", rows.length);

    const updates = []; // {id, userId}
    const reasons = { matched: 0, noKey: 0, unresolvedName: 0, ambiguous: 0 };
    const perTeacher = new Map();
    for (const r of rows) {
      const k = key(r.student_name, r.ymd, r.summary);
      const hit = map.get(k);
      if (hit === undefined) { reasons.noKey++; continue; }
      if (hit === null) { reasons.unresolvedName++; continue; }
      if (hit === "AMBIGUOUS") { reasons.ambiguous++; continue; }
      if (hit === bojoId) { reasons.unresolvedName++; continue; } // 원본도 보조T면 그대로
      updates.push({ id: r.id, userId: hit });
      reasons.matched++;
      perTeacher.set(hit, (perTeacher.get(hit) || 0) + 1);
    }

    console.log("재배정 대상:", reasons.matched, "| 키불일치:", reasons.noKey,
      "| 상담자명 미해결:", reasons.unresolvedName, "| 모호:", reasons.ambiguous);
    // 재배정 후 강사별 미리보기(상위)
    const nameById = new Map(users.map((u) => [u.id, u.display_name]));
    console.log("재배정 강사별(상위 12):");
    [...perTeacher.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
      .forEach(([uid, n]) => console.log("  " + String(nameById.get(uid) || uid).padEnd(14), n));

    if (!APPLY) { console.log("\n(dry-run — 적용하려면 --apply)"); return; }

    // 적용 — 멱등(counselor_id=보조T 행만). 되돌리기 파일에 적용 id 기록.
    const revertPath = path.join(TMP, `reattribute-revert-${Date.now()}.json`);
    fs.writeFileSync(revertPath, JSON.stringify({ bojoId, appliedIds: updates.map((u) => u.id) }, null, 2));
    let done = 0;
    // userId별로 묶어 배치 UPDATE(id 청크).
    const byUser = new Map();
    for (const u of updates) { if (!byUser.has(u.userId)) byUser.set(u.userId, []); byUser.get(u.userId).push(u.id); }
    for (const [uid, ids] of byUser) {
      for (let i = 0; i < ids.length; i += 200) {
        const chunk = ids.slice(i, i + 200);
        const res = await sql`update student_consultations set counselor_id = ${uid}
          where id in ${sql(chunk)} and counselor_id = ${bojoId}`;
        done += res.count;
      }
    }
    console.log("적용 완료:", done, "행 재배정 | 되돌리기 파일:", revertPath);
    const [left] = await sql`select count(*)::int n from student_consultations where counselor_id = ${bojoId}`;
    console.log("남은 보조T 상담:", left.n);
  } catch (e) {
    console.log("ERR", e.message);
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
})();
