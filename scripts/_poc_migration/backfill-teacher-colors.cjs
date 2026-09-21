/*
 * backfill-teacher-colors.cjs — ijw 익스포트의 강사 퍼스널 색(staff.bgColor/textColor)을 aywa users로 백필.
 *
 * 기존 backfill-english-slots.cjs는 classes(반색)만 건드리고 users(강사색)는 안 건드렸다 → 시간표
 * 익스포터(Excel/시트)가 users.bg_color 없으면 해시색 폴백(계획서 "분기점"). 이 스크립트가 그 갭을 메운다.
 *  - users.bg_color / text_color  ← ijw staff.bgColor / textColor  (#RRGGBB)
 *
 * 매칭(자연키): ijw staff.name == aywa users.display_name (전수확인: 색상 보유 42명 → 42/42 매칭, 불일치 0).
 * 멱등(UPDATE). 기본 DRY-RUN(통계만), `--apply`로 실제 반영.
 *   node --env-file=.env.local scripts/_poc_migration/backfill-teacher-colors.cjs [--apply]
 */
const fs = require("fs");
const postgres = require("postgres");

// 최신 ijw export 자동 선택(run.ts·import-textbooks-expenses와 동일 패턴 — 하드코딩 파일명 footgun 제거).
const TMP = "D:/tmp";
const EXPORT = require("path").join(TMP, fs.readdirSync(TMP).filter((x) => x.startsWith("ijw-export-") && x.endsWith(".json")).sort().pop());
const APPLY = process.argv.includes("--apply");
const asDocs = (c) => (Array.isArray(c) ? c : c && c.docs ? c.docs : Object.values(c));
const HEX = /^#[0-9a-fA-F]{6}$/;

(async () => {
  const j = JSON.parse(fs.readFileSync(EXPORT, "utf8"));
  const staff = asDocs(j.collections.staff).map((d) => d.data || d).filter((s) => s.name && HEX.test(s.bgColor || ""));

  const sql = postgres(process.env.DATABASE_URL, { prepare: false });
  const stats = { staffWithColor: staff.length, matched: 0, missing: [], updates: 0 };
  try {
    const tRow = await sql`select tenant_id from classes group by tenant_id order by count(*) desc limit 1`;
    const tenantId = tRow[0].tenant_id;
    const eUsers = await sql`select id, display_name, bg_color, text_color, english_name from users where tenant_id=${tenantId}`;
    const byName = new Map();
    for (const u of eUsers) {
      const list = byName.get(u.display_name) ?? [];
      list.push(u);
      byName.set(u.display_name, list);
    }

    const pending = [];
    for (const s of staff) {
      const cands = byName.get(s.name) ?? [];
      if (cands.length === 0) { stats.missing.push(s.name); continue; }
      stats.matched++;
      const bg = s.bgColor;
      const tx = HEX.test(s.textColor || "") ? s.textColor : "#000000";
      const en = (s.englishName && String(s.englishName).trim()) || null; // ijw 영문닉네임 → 슬롯 라벨 매칭용
      // 색·영문명이 이미 같으면 스킵(멱등·노이즈 감소)
      for (const u of cands) {
        if (u.bg_color === bg && u.text_color === tx && (u.english_name ?? null) === en) continue;
        stats.updates++;
        pending.push(() => sql`update users set bg_color=${bg}, text_color=${tx}, english_name=${en} where id=${u.id}`);
      }
    }

    console.log("DRY-RUN STATS:", JSON.stringify({ ...stats, missing: stats.missing.slice(0, 20) }, null, 2));
    console.log("PENDING UPDATES:", pending.length, APPLY ? "→ APPLYING" : "(dry-run — pass --apply to write)");
    if (APPLY) {
      let done = 0;
      for (const u of pending) { await u(); done++; }
      console.log("APPLIED", done, "updates.");
    }
  } catch (e) {
    console.log("ERR", e.message, e.stack);
  }
  await sql.end();
})();
