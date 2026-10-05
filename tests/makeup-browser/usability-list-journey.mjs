import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function usabilityListJourney({ db, uid, context, frame, caseId, output, framedSurface }) {
  const results = [];
  const filter = new URLSearchParams({ tab: "all", student_id: uid(62), owner_id: uid(22), q: "가상학생B", page: "1" });
  // Assign via actual command as a precondition; list filtering/back is exercised by real UI navigation.
  const [received] = await db`select mt.cmd(mt.id(22),'intake',jsonb_build_object('student_id',mt.id(62),'original_class_id',mt.id(51),'original_date',mt.d(-45))) ->> 'id' as id`;
  const listCaseId = received.id;
  await db`select mt.cmd(mt.id(22),'assign',jsonb_build_object('case_id',${listCaseId}::uuid,'owner_id',mt.id(22),'reason','합성 목록 조건'),mt.rev('makeup_cases',${listCaseId}::uuid))`;
  await db`select mt.cmd(mt.id(22),'deny',jsonb_build_object('case_id',${listCaseId}::uuid,'reason','합성 종결 목록 확인'),mt.rev('makeup_cases',${listCaseId}::uuid))`;
  await frame.goto(`http://127.0.0.1:3045/makeups?${filter}&embed=1`, { waitUntil: "domcontentloaded" });
  await frame.getByRole("button", { name: "조회", exact: true }).click();
  await expect.poll(() => new URL(frame.url()).searchParams.get("student_id")).toBe(uid(62));
  assert.equal(new URL(frame.url()).searchParams.get("owner_id"), uid(22));
  await frame.getByRole("link", { name: "가상학생B", exact: true }).click();
  await frame.getByRole("link", { name: "목록", exact: true }).click();
  await expect.poll(() => new URL(frame.url()).searchParams.get("q")).toBe("가상학생B");
  assert.equal(new URL(frame.url()).searchParams.get("embed"), "1");
  results.push("S07: GET submit and detail round-trip retain owner/student/query/embed");

  // S06: a closed case may still need checks. The badge counts cases and targets the closed queue.
  await db.begin(async sql => {
    await sql`select mt.as_command()`;
    await sql`insert into makeup_reconciliation(tenant_id,kind,dedupe_key,case_id,detail)
      values(mt.id(11),'source_conflict','synthetic:closed-audit',${listCaseId}::uuid,jsonb_build_object('code','synthetic_follow_up'))`;
    await sql`select mt.end_command()`;
  });
  await frame.reload();
  const closed = frame.getByRole("link", { name: "종결 후 확인 필요", exact: true });
  await expect(closed).toBeVisible();
  const target = new URL(await closed.getAttribute("href"), "http://127.0.0.1:3045");
  assert.equal(target.searchParams.get("tab"), "closed"); assert.equal(target.searchParams.get("flag"), "recon_open");
  await closed.click();
  await expect(frame.getByRole("link", { name: "가상학생B", exact: true })).toBeVisible();
  results.push("S06: closed-case follow-up is visible and opens tab=closed/flag=recon_open");

  // R06: inspect actual populated list at the audit widths, including keyboard-reachable controls.
  for (const width of [360, 390, 768, 1280]) {
    await frame.setViewportSize({ width, height: 900 });
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `list page fits ${width}px`);
    await expect(frame.getByRole("link", { name: "가상학생B", exact: true })).toBeVisible();
    const row = frame.locator("tbody tr").first();
    await row.scrollIntoViewIfNeeded();
    const cells = await row.locator("td").evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right };
    }));
    if (width < 768) assert.ok(cells.every(cell => cell.left >= 0 && cell.right <= width), "student, next action and due date fit together without horizontal scrolling");
    await frame.getByRole("button", { name: "조회", exact: true }).focus();
    assert.equal(await frame.getByRole("button", { name: "조회", exact: true }).evaluate(node => node === document.activeElement), true);
    await frame.screenshot({ path: `${output}/usability-list-${width}.png`, fullPage: true });
  }
  await frame.setViewportSize({ width: 1280, height: 900 });
  await frame.evaluate(() => { document.body.style.zoom = "2"; });
  assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "list 200% CSS zoom fits");
  await frame.screenshot({ path: `${output}/usability-list-zoom200.png`, fullPage: true });
  await frame.evaluate(() => { document.body.style.zoom = ""; });
  results.push("R06: populated list 360/390/768/1280 and 200% CSS zoom has no page overflow; query keyboard reachable");
  // Detail in its own frame remains available after the list probes.
  const detail = await framedSurface(context, `/makeups/${caseId}?embed=1`);
  await expect(detail.getByText(/실시 인정 · 인정 완료/)).toBeVisible();
  await detail.page().close();
  return results;
}
