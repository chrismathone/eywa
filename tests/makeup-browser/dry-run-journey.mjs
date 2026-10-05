import assert from "node:assert/strict";
import { expect } from "@playwright/test";

export async function dryRunJourney({ db, page, saved, uid, output, mobileProbe }) {
  const reservationId = uid(9901);
  await db`insert into makeup_reservations(id,tenant_id,student_id,class_id,absence_date,makeup_date,
    slot_start,slot_end,period_label,created_by)
    values(${reservationId},${uid(11)},${uid(61)},${uid(51)},mt.d(-10),mt.d(3),'15:00','16:00','합성 기존 약속',${uid(22)})`;
  const snapshot = async () => (await db`select
    (select count(*)::int from makeup_cases) as cases,
    (select count(*)::int from makeup_legacy_maps) as maps,
    (select coalesce(sum(recognized_minutes),0)::int from makeup_cases) as recognized,
    (select coalesce(jsonb_agg(jsonb_build_object('id',id,'units',session_units) order by id),'[]'::jsonb) from attendance_records) as units,
    (select to_jsonb(r) from makeup_reservations r where id=${reservationId}) as reservation`)[0];
  const before = await snapshot();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:3045/makeups/dry-run?embed=1");
  await expect(page.getByText(/조회 쓰기 0건/)).toBeVisible();
  assert.deepEqual(await snapshot(), before);
  const row = page.getByRole("row").filter({ hasText: "가상학생A" }).filter({ hasText: "A · 일정 보존 대상" });
  await expect(row).toHaveCount(1);
  await expect.poll(() => row.locator("form").evaluate(node => Object.keys(node).some(key => key.startsWith("__reactProps$") && typeof node[key]?.onSubmit === "function")), { timeout: 30000 }).toBe(true);
  await row.getByText("원본 해시·사건 키", { exact: true }).focus();
  await page.keyboard.press("Enter");
  const [hash] = await db`select md5((to_jsonb(r)-'updated_at')::text) as value from makeup_reservations r where id=${reservationId}`;
  await expect(row.getByText(hash.value, { exact: true })).toBeVisible();
  await mobileProbe("/makeups/dry-run?embed=1", `${output}/mobile-dry-run.png`);
  await saved(row.locator("form"));
  await page.waitForURL(url => /^\/makeups\/[0-9a-f-]{36}$/.test(url.pathname));
  const [map] = await db`select checksum,batch_id from makeup_legacy_maps where legacy_id=${reservationId}`;
  assert.equal(map.checksum, hash.value); assert.ok(map.batch_id);
  const after = await snapshot();
  assert.equal(after.cases, before.cases + 1); assert.equal(after.maps, before.maps + 1);
  assert.equal(after.recognized, before.recognized);
  assert.deepEqual(after.units, before.units); assert.deepEqual(after.reservation, before.reservation);
  return "UI dry-run reads write zero; keyboard reveals source hash; explicit link preserves source/money and stores hash/batch; 390px fits";
}
