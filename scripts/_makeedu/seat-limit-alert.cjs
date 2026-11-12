/** makeedu 학생 가져오기는 외부 장부의 거울이라 막지 않는다. 반영 뒤 좌석 초과만 원장 벨에 남긴다. */
const EVENT_TYPE = "student_seat_limit_exceeded";

function seatLimitAlertNeeded(addedEnrolled, maxSeats, enrolled) {
  return addedEnrolled > 0 && Number.isFinite(maxSeats) && Number.isFinite(enrolled) && enrolled > maxSeats;
}

function seatLimitAlertText(maxSeats, enrolled) {
  return {
    title: "좌석 한도 초과",
    body: `makeedu 학생 가져오기 후 재원생 ${enrolled}명 · 좌석 한도 ${maxSeats}석`,
  };
}

async function notifySeatLimitExceeded(sql, tenantId, addedEnrolled) {
  if (addedEnrolled <= 0) return 0;
  const [license] = await sql`
    select max_seats from tenant_licenses
    where tenant_id = ${tenantId} and feature = 'student_seats' and is_active = true and max_seats is not null`;
  if (!license) return 0;
  const [usage] = await sql`
    select count(*)::int as enrolled from students where tenant_id = ${tenantId} and status = 'enrolled'`;
  const maxSeats = Number(license.max_seats), enrolled = Number(usage?.enrolled);
  if (!seatLimitAlertNeeded(addedEnrolled, maxSeats, enrolled)) return 0;

  // 받을 사람이 없는데 중복 방지 줄부터 남기면 나중에 원장이 생겨도 같은 초과를 알릴 수 없다.
  const recipients = await sql`
    select id from users where tenant_id = ${tenantId} and system_role = 'master' and status = 'active'`;
  if (!recipients.length) return 0;
  const [fresh] = await sql`
    insert into notification_events (tenant_id, event_type, subject_key, bucket, seeded)
    values (${tenantId}, ${EVENT_TYPE}, 'makeedu_student_import', ${`${maxSeats}:${enrolled}`}, false)
    on conflict (tenant_id, event_type, subject_key, bucket) do nothing
    returning id`;
  if (!fresh) return 0;

  const text = seatLimitAlertText(maxSeats, enrolled);
  const plan = recipients.map((recipient) => ({
    tenant_id: tenantId,
    recipient_id: recipient.id,
    type: EVENT_TYPE,
    title: text.title,
    body: text.body,
    link: "/students",
  }));
  await sql`insert into notifications ${sql(plan, "tenant_id", "recipient_id", "type", "title", "body", "link")}`;
  return plan.length;
}

module.exports = { EVENT_TYPE, notifySeatLimitExceeded, seatLimitAlertNeeded, seatLimitAlertText };
