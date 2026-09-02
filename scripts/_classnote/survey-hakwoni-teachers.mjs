/**
 * 읽기 전용 조사 — 테스트 학생 '학원이' 보드에 **교사가 몇 명 붙어 있나**.
 *
 * 원장 2026-09-02: *"학원이는 배정 제외하고 classnote에 전부 배정해야돼 … 테스트 공지 등을 확인하기
 * 위해서 classnote상에서 학원이를 모든 선생님에게 배정하라는 뜻이였음."*
 *
 * 🔴 **GET만 한다.** 실제 연결(`POST /api/v1/employments/`)은 되돌릴 수 없다 —
 *    해제 라우트가 REST에 없어 UI 수동뿐이다(docs/classnote-integration.md §3). 그래서 조사와 실행을 나눈다.
 *
 * 실행: node --env-file=.env.local scripts/_classnote/survey-hakwoni-teachers.mjs
 */
import { fetchAllDrf, fetchBoards, fetchCenterId, launchAdminBrowser, loginClassnote } from "./classnote-admin-core.mjs";

const TARGET = /^\((수학|영어)\)학원이/;

const browser = await launchAdminBrowser({ headed: false });
try {
  const page = await (await browser.newContext()).newPage();
  await loginClassnote(page);
  const centerId = await fetchCenterId(page);
  const boards = await fetchBoards(page, centerId);
  const mine = boards.filter((b) => TARGET.test(b.name));
  console.log(`센터 ${centerId} · 보드 ${boards.length}개 · '학원이' 보드 ${mine.length}개`);
  for (const b of mine) console.log(`  · ${b.name} (id ${b.id}, 원아 ${b.children ?? "?"})`);

  // ⚠️ v1_2 employments는 **DRF가 아니라 평배열**이다(실측 239KB) — `fetchAllDrf`로 읽으면 조용히 0건이 된다.
  const emps = await page.evaluate(async (c) => {
    const r = await fetch(`/api/v1_2/centers/${c}/employments`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error("employments " + r.status);
    return r.json();
  }, centerId);
  const teachers = await fetchAllDrf(page, `/api/v1_2/centers/${centerId}/teachers`);
  console.log(`
센터 교사 ${teachers.length}명 · 교사↔반 연결 ${emps.length}건`);

  for (const b of mine) {
    const on = emps.filter((e) => e.class_in_charge === b.id);
    const onIds = new Set(on.map((e) => e.teacher_id));
    console.log(`
[${b.name}] 연결된 교사 ${on.length}명`);
    for (const e of on) console.log(`    ${e.teacher_name} (teacher ${e.teacher_id}, 승인 ${e.is_approved})`);
    const off = teachers.filter((t) => !onIds.has(t.id));
    console.log(`  안 붙은 교사 ${off.length}명:`);
    for (const t of off) {
      const n = emps.filter((e) => e.teacher_id === t.id).length;
      console.log(`    ${t.name} (teacher ${t.id}, 담당 보드 ${n}개)`);
    }
  }
  // 원본 한 건을 그대로 찍어 필드 모양을 남긴다(다음 사람이 추측하지 않게).
  if (emps[0]) console.log(`\n[employments 원본 예시]\n${JSON.stringify(emps[0], null, 2).slice(0, 600)}`);
} finally {
  await browser.close();
}
