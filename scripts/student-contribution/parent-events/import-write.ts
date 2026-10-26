import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { buildEventBundle, type EventBundle, type EventSourcePack } from "./bundle";
import { readEventDatabase } from "./snapshot";
type Options = { owner: string; approvedFingerprint: string; scoringApproved: boolean; privacyKey: string };
/** First reviewed backfill only. Existing identities are never overwritten by a later file or shifted row. */
export async function applyInitialEvents(db: Sql, report: EventBundle, pack: EventSourcePack, options: Options, verifySources: () => Promise<void>) {
  if (!report.readOnly || report.schema !== 1 || report.fingerprint !== options.approvedFingerprint || !/^[a-f0-9]{64}$/.test(options.approvedFingerprint)) throw new Error("Approved fingerprint mismatch");
  await verifySources();
  const verifiedAt = new Date();
  return db.begin("isolation level serializable", async sql => {
    await sql`set local lock_timeout = '5s'`;
    await sql`set local statement_timeout = '60s'`;
    const owners = await sql`select id,display_name from public.users where tenant_id=${report.tenantId} and id=${options.owner} and system_role='master' and status='active'`;
    if (owners.length !== 1) throw new Error("Approval owner does not belong to this academy");
    const settings = await sql`select refresh_token,config from public.student_contribution_settings where tenant_id=${report.tenantId} for update`;
    if (settings.length !== 1 || settings[0]!.refresh_token) throw new Error("Aggregation is running or settings are unavailable");
    const runs = await sql`select id,fingerprint,status from public.student_parent_event_imports where tenant_id=${report.tenantId} order by created_at`;
    const applied = runs.find(r => r.fingerprint === report.fingerprint && r.status === "applied");
    if (applied) return { id: String(applied.id), alreadyApplied: true, count: 0 };
    if (runs.length) throw new Error("Existing import history requires a separately reviewed reconciliation; no overwrite performed");
    if (settings[0]!.config?.rates?.parentSeminarEvents?.enabled === true) throw new Error("Disable the new metric before its first import");
    const fresh = buildEventBundle(await readEventDatabase(sql, report.tenantId), pack, report.today, options.privacyKey);
    if (fresh.fingerprint !== options.approvedFingerprint) throw new Error("Data or mapping changed since review; prepare a new report");
    if (!fresh.credits.length) throw new Error("No approved recognitions to import");
    const id = randomUUID();
    await sql`insert into public.student_parent_event_imports(tenant_id,id,fingerprint,policy_version,status,approved_by,approved_at,scoring_approved_at,summary)
      values(${fresh.tenantId},${id},${fresh.fingerprint},${fresh.policy},'applied',${options.owner},now(),${options.scoringApproved ? new Date() : null},${sql.json({ ...fresh.summary, approvedRate: options.scoringApproved ? { group: "operations", points: 1 } : null })})`;
    for (const e of fresh.events) await sql`insert into public.student_parent_events(tenant_id,id,title,event_date,session,import_id) values(${fresh.tenantId},${e.id},${e.title},${e.date},${e.session},${id})`;
    for (const r of fresh.registrations) {
      await sql`insert into public.student_parent_event_registrations(tenant_id,id,event_id,identity_hash,content_hash,source_file,source_sheet,source_row,source_ref,state,attendance_basis,import_id)
        values(${fresh.tenantId},${r.sourceId},${r.eventId},${r.identityHash},${r.contentHash},${r.fileId},${r.sheetId},${r.row},${r.sourceRef},'recognized',${r.attendanceBasis},${id})`;
      await sql`insert into public.student_parent_event_revisions(tenant_id,registration_id,content_hash,raw,source_ref,read_at,import_id)
        values(${fresh.tenantId},${r.sourceId},${r.contentHash},${sql.json(JSON.parse(JSON.stringify(r.raw)))},${r.sourceRef},${verifiedAt},${id})`;
    }
    for (const c of fresh.credits) await sql`insert into public.student_parent_event_recognitions(tenant_id,event_id,student_id,family_key,basis,source_ids,import_id)
      values(${fresh.tenantId},${c.eventId},${c.studentId},${c.familyKey},${c.basis},${c.sourceIds},${id})`;
    await sql`insert into public.audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata)
      values(${fresh.tenantId},${options.owner},${owners[0]!.display_name},'student_parent_events_import','student_contribution','설명회 참석 연결',
      ${sql.json({ importId: id, fingerprint: fresh.fingerprint, policy: fresh.policy, executedBy: "운영 스크립트", approvedBy: options.owner, ...fresh.summary })})`;
    const stored = await sql`select public.student_parent_event_snapshot(${fresh.tenantId}::uuid) as data`;
    const actual = stored[0]!.data;
    if (!actual.valid || actual.records.length !== fresh.credits.length || actual.records.some((r: { eventId: string; studentId: string }) => !fresh.credits.some(c => c.eventId === r.eventId && c.studentId === r.studentId))) throw new Error("Stored event results differ from the approved report");
    // Invalidate any in-flight settings version; no points, frozen month, or rate is changed here.
    await sql`update public.student_contribution_settings set revision=revision+1,updated_by=${options.owner},updated_at=now() where tenant_id=${fresh.tenantId}`;
    return { id, alreadyApplied: false, count: fresh.credits.length };
  });
}
/** Reviewed whole-batch rollback. Preserve source rows and let normal reconciliation reverse the recognized set. */
export async function revokeEventImport(db: Sql, tenant: string, id: string, fingerprint: string, owner: string, reason: string) {
  if (reason.trim().length < 5) throw new Error("A rollback reason is required");
  return db.begin("isolation level serializable", async sql => {
    await sql`set local lock_timeout = '5s'`;
    await sql`set local statement_timeout = '60s'`;
    const owners = await sql`select display_name from public.users where id=${owner} and tenant_id=${tenant} and system_role='master' and status='active'`;
    if (owners.length !== 1) throw new Error("Invalid approval owner");
    const settings = await sql`select refresh_token from public.student_contribution_settings where tenant_id=${tenant} for update`;
    if (settings.length !== 1 || settings[0]!.refresh_token) throw new Error("Wait for the current aggregation to finish");
    const runs = await sql`select fingerprint,status from public.student_parent_event_imports where tenant_id=${tenant} and id=${id} for update`;
    if (runs.length !== 1 || runs[0]!.fingerprint !== fingerprint) throw new Error("Rollback fingerprint mismatch");
    if (runs[0]!.status === "revoked") return { alreadyRevoked: true };
    await sql`update public.student_parent_event_imports set status='revoked',revoked_at=now(),revoke_reason=${reason} where tenant_id=${tenant} and id=${id}`;
    await sql`insert into public.audit_logs(tenant_id,actor_id,actor_name,action,target_type,target_label,metadata)
      values(${tenant},${owner},${owners[0]!.display_name},'student_parent_events_revoke','student_contribution','설명회 참석 연결 취소',${sql.json({ importId: id, fingerprint, reason, executedBy: "운영 스크립트", approvedBy: owner })})`;
    await sql`update public.student_contribution_settings set revision=revision+1,updated_by=${owner},updated_at=now() where tenant_id=${tenant}`;
    return { alreadyRevoked: false };
  });
}
