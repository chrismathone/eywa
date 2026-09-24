import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  academyDocuments,
  announcements,
  auditLogs,
  enrollmentConsultations,
  expenses,
  lessonReports,
  meetingMinutes,
  studentConsultations,
} from "@/lib/db/schema";
import { buildDashboardWorld, shiftYmd } from "./dashboard-world.mjs";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type World = ReturnType<typeof buildDashboardWorld>;

async function flag(tx: Tx, query: ReturnType<typeof sql>): Promise<boolean> {
  const result = await tx.execute(query);
  const row = (Array.isArray(result) ? result[0] : (result as { rows?: unknown[] }).rows?.[0]) as
    | Record<string, unknown>
    | undefined;
  const value = row ? Object.values(row)[0] : null;
  return value === true || value === "t" || value === "true";
}

export async function insertConsultations(
  tx: Tx,
  tenantId: string,
  note: string,
  world: World,
  studentOf: Map<string, string>,
) {
  const rows = world.consultations.map((row) => ({ row, id: crypto.randomUUID() }));
  await tx.insert(enrollmentConsultations).values(
    rows.map(({ row, id }) => ({
      id,
      tenantId,
      studentId: row.studentCode ? (studentOf.get(row.studentCode) ?? null) : null,
      prospectName: row.name,
      prospectGrade: row.grade,
      prospectSchool: row.school,
      parentPhone: row.parentPhone,
      parentRequest: note,
      subject: row.subject,
      consultationPath: row.path,
      outcome: row.outcome as "pending" | "consulted" | "enrolled" | "declined" | "no_show",
      paymentAmount: row.payment == null ? null : String(row.payment),
      consultedAt: new Date(row.at),
      createdAt: new Date(row.at),
    })),
  );
  // 운영실 '금일 등록'은 '등록 완료'로 옮긴 시각을 상태 변경 감사로그에서 읽는다 — 앱이 남기는 것과 같은 모양으로.
  const moved = rows.filter(({ row }) => row.movedAt);
  if (moved.length) {
    await tx.insert(auditLogs).values(
      moved.map(({ row, id }) => ({
        tenantId,
        actorId: null,
        actorName: "데모 데이터",
        action: "enrollment_consultation_outcome",
        targetType: "enrollment_consultations",
        targetLabel: row.name,
        metadata: { consultationId: id, from: "consulted", to: "enrolled", via: "demo" },
        createdAt: new Date(row.movedAt!),
      })),
    );
  }
}

export async function insertStudentConsultations(tx: Tx, tenantId: string, world: World, studentOf: Map<string, string>) {
  await tx.insert(studentConsultations).values(
    world.studentConsultations.map((row) => ({
      id: crypto.randomUUID(),
      tenantId,
      studentId: studentOf.get(row.studentCode)!,
      consultedAt: new Date(row.at),
      subject: row.subject,
      summary: row.summary,
      followUpDate: row.followUpDate,
      followUpDone: row.followUpDone,
      followUpAction: row.followUpDate ? "보호자에게 다시 전화" : null,
    })),
  );
}

export async function insertReports(tx: Tx, tenantId: string, today: string, world: World, studentOf: Map<string, string>) {
  const sentAt = new Date(`${shiftYmd(today, -3)}T03:00:00.000Z`);
  await tx.insert(lessonReports).values(
    world.reports.map((row) => ({
      id: crypto.randomUUID(),
      tenantId,
      studentId: studentOf.get(row.studentCode)!,
      shareToken: crypto.randomUUID(),
      reportDate: row.date,
      subject: row.subject,
      progress: row.progress,
      homeworkScore: row.homeworkScore,
      classnoteStatus: row.unread ? "success" : null,
      classnoteSentAt: row.unread ? sentAt : null,
    })),
  );
}

export async function insertOps(tx: Tx, tenantId: string, world: World) {
  await tx.insert(expenses).values(
    world.expenses.map((row) => ({
      id: crypto.randomUUID(),
      tenantId,
      title: String(row.title),
      category: String(row.category),
      amount: String(row.amount),
      expenseDate: row.date,
      memo: row.memo,
      approvalStatus: "approved",
    })),
  );
  await tx.insert(announcements).values(
    world.announcements.map((row) => ({
      id: crypto.randomUUID(),
      tenantId,
      title: row.title,
      content: row.content,
      audience: "all" as const,
    })),
  );
  await tx.insert(meetingMinutes).values(
    world.meetings.map((row) => ({
      id: crypto.randomUUID(),
      tenantId,
      title: row.title,
      content: row.content,
      heldAt: new Date(row.at),
    })),
  );
  await tx.insert(academyDocuments).values(
    world.documents.map((row) => ({
      id: crypto.randomUUID(),
      tenantId,
      title: row.title,
      kind: "text",
      body: row.body,
      category: "other",
    })),
  );
}

export async function insertMakeup(
  tx: Tx,
  tenantId: string,
  world: World,
  classOf: Map<string, string>,
  studentOf: Map<string, string>,
) {
  if (!world.makeup.length) return;
  const ready = await flag(tx, sql`select to_regclass('public.makeup_reservations') is not null as ok`);
  if (!ready) return;
  for (const row of world.makeup) {
    await tx.execute(sql`
      insert into makeup_reservations (
        tenant_id, student_id, class_id, absence_date, makeup_date, slot_start, slot_end, period_label, note, status
      ) values (
        ${tenantId}, ${studentOf.get(row.studentCode)!}, ${classOf.get(row.classKey)!},
        ${row.absenceDate}, ${row.makeupDate}, ${row.slotStart}, ${row.slotEnd}, ${row.periodLabel},
        ${"demo-roster:"}, ${"reserved"}
      )
    `);
  }
}

export async function insertChecks(tx: Tx, tenantId: string, world: World, studentOf: Map<string, string>) {
  if (!world.checks.length) return;
  const ready = await flag(tx, sql`select to_regclass('public.student_onboarding_checks') is not null as ok`);
  if (!ready) return;
  const subjectColumn = await flag(
    tx,
    sql`select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'student_onboarding_checks' and column_name = 'subject'
    ) as ok`,
  );
  for (const row of world.checks) {
    if (subjectColumn) {
      await tx.execute(sql`
        insert into student_onboarding_checks (tenant_id, student_id, subject, item_key, done_on, memo)
        values (${tenantId}, ${studentOf.get(row.studentCode)!}, ${row.subject}, ${row.itemKey}, ${row.doneOn}, ${"demo-roster:"})
      `);
    } else {
      await tx.execute(sql`
        insert into student_onboarding_checks (tenant_id, student_id, item_key, done_on, memo)
        values (${tenantId}, ${studentOf.get(row.studentCode)!}, ${row.itemKey}, ${row.doneOn}, ${"demo-roster:"})
      `);
    }
  }
}
