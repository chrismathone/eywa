/** makeedu 학생 가져오기는 막지 않고, 새 재원생 반영 뒤 좌석 초과만 원장 알림에 남긴다. */
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

  const text = seatLimitAlertText(maxSeats, enrolled);
  // 중복 방지와 알림을 한 문장으로 기록한다. 받는 원장이 없으면 버킷도 소모하지 않는다.
  const notified = await sql`
    with recipients as (
      select id from users where tenant_id = ${tenantId} and system_role = 'master' and status = 'active'
    ), fresh as (
      insert into notification_events (tenant_id, event_type, subject_key, bucket, seeded)
      select ${tenantId}, ${EVENT_TYPE}, 'makeedu_student_import', ${`${maxSeats}:${enrolled}`}, false
      where exists (select 1 from recipients)
      on conflict (tenant_id, event_type, subject_key, bucket) do nothing returning id
    )
    insert into notifications (tenant_id, recipient_id, type, title, body, link)
    select ${tenantId}, recipients.id, ${EVENT_TYPE}, ${text.title}, ${text.body}, '/students'
    from recipients cross join fresh returning id`;
  return notified.length;
}

module.exports = { EVENT_TYPE, notifySeatLimitExceeded, seatLimitAlertNeeded, seatLimitAlertText };
