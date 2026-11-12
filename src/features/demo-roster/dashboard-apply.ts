import { and, eq, like, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  academyDocuments,
  announcements,
  attendanceRecords,
  enrollmentConsultations,
  enrollments,
  expenses,
  invoices,
  meetingMinutes,
  students,
  tenantSettings,
} from "@/lib/db/schema";
import { buildDashboardWorld, classKey } from "./dashboard-world.mjs";
import {
  insertChecks,
  insertConsultations,
  insertMakeup,
  insertOps,
  insertReports,
  insertStudentConsultations,
} from "./dashboard-rows";
import { writeDemoWeekdayGrouping } from "./demo-weekday";
import { demoModulesWithNewcomers, type DemoModuleChange } from "./demo-modules";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Plan = Parameters<typeof buildDashboardWorld>[0];
type World = ReturnType<typeof buildDashboardWorld>;

async function writeChunks<T>(rows: T[], write: (part: T[]) => Promise<void>) {
  for (let i = 0; i < rows.length; i += 200) await write(rows.slice(i, i + 200));
}

/** 슬러그 확인이 끝난 뒤에만 부른다. 운영실이 읽는 행을 이 구성에 맞춰 넣는다. */
export async function insertDashboardSatellite(
  tx: Tx,
  tenantId: string,
  plan: Plan,
  note: string,
  classId: Map<object, string>,
  studentId: Map<object, string>,
  today: string,
): Promise<DemoModuleChange> {
  const world = buildDashboardWorld(plan, today);
  const moduleChange = await enableNewcomers(tx, tenantId, typeof plan.id === "string" ? plan.id : "");
  await deleteMarkers(tx, tenantId);
  const classOf = new Map(plan.classes.map((cls) => [classKey(cls), classId.get(cls)!]));
  const studentOf = new Map(plan.students.map((student) => [student.code, studentId.get(student)!]));
  await insertWithdrawn(tx, tenantId, note, world, classOf, studentOf);
  await insertAttendance(tx, tenantId, world, classOf, studentOf);
  await insertInvoices(tx, tenantId, note, world, studentOf);
  await insertConsultations(tx, tenantId, note, world, studentOf);
  await insertStudentConsultations(tx, tenantId, world, studentOf);
  await insertReports(tx, tenantId, today, world, studentOf);
  await insertOps(tx, tenantId, world);
  await insertMakeup(tx, tenantId, world, classOf, studentOf);
  await insertChecks(tx, tenantId, world, studentOf);
  return moduleChange;
}

async function enableNewcomers(tx: Tx, tenantId: string, scenarioId: string): Promise<DemoModuleChange> {
  const [row] = await tx
    .select({ data: tenantSettings.data })
    .from(tenantSettings)
    .where(eq(tenantSettings.tenantId, tenantId))
    .for("update");
  const moduleChange = demoModulesWithNewcomers(row?.data);
  const stored = row?.data && typeof row.data === "object" && !Array.isArray(row.data)
    ? row.data as Record<string, unknown>
    : {};
  const nextData = {
    ...stored,
    version: 1,
    preset: "generic",
    modules: moduleChange.section,
    profile: stored.profile && typeof stored.profile === "object" && !Array.isArray(stored.profile) ? stored.profile : {},
    operations: stored.operations && typeof stored.operations === "object" && !Array.isArray(stored.operations) ? stored.operations : {},
  };
  if (!row) {
    await tx.insert(tenantSettings).values({
      tenantId,
      data: nextData,
    });
  } else {
    await tx.update(tenantSettings).set({
      data: nextData,
      updatedAt: sql`greatest(now(), ${tenantSettings.updatedAt} + interval '1 millisecond')`,
    }).where(eq(tenantSettings.tenantId, tenantId));
  }
  await writeDemoWeekdayGrouping(tx, tenantId, scenarioId);
  return moduleChange;
}

async function deleteMarkers(tx: Tx, tenantId: string) {
  await tx.delete(expenses).where(and(eq(expenses.tenantId, tenantId), like(expenses.memo, "demo-roster:%")));
  await tx.delete(announcements).where(and(eq(announcements.tenantId, tenantId), like(announcements.title, "[데모]%")));
  await tx.delete(meetingMinutes).where(and(eq(meetingMinutes.tenantId, tenantId), like(meetingMinutes.title, "[데모]%")));
  await tx
    .delete(academyDocuments)
    .where(and(eq(academyDocuments.tenantId, tenantId), like(academyDocuments.title, "[데모]%")));
  await tx
    .delete(enrollmentConsultations)
    .where(and(eq(enrollmentConsultations.tenantId, tenantId), like(enrollmentConsultations.parentRequest, "demo-roster:%")));
}

async function insertWithdrawn(
  tx: Tx,
  tenantId: string,
  note: string,
  world: World,
  classOf: Map<string, string>,
  studentOf: Map<string, string>,
) {
  if (!world.withdrawn.length) return;
  const rows = world.withdrawn.map((student) => {
    const id = crypto.randomUUID();
    studentOf.set(student.code, id);
    return {
      id,
      tenantId,
      name: student.name,
      gender: student.gender,
      school: student.school,
      grade: student.grade,
      status: "withdrawn" as const,
      enrolledAt: student.enrolledAt,
      withdrawnAt: student.withdrawnAt,
      parentName: student.parentName,
      parentPhone: student.parentPhone,
      studentCode: student.code,
      notes: note,
      isTest: false,
    };
  });
  await tx.insert(students).values(rows);
  await tx.insert(enrollments).values(
    world.withdrawn.map((student) => ({
      id: crypto.randomUUID(),
      tenantId,
      studentId: studentOf.get(student.code)!,
      classId: classOf.get(student.classKey)!,
      startDate: student.enrolledAt,
      endDate: student.endDate,
      withdrawalReason: "이사",
    })),
  );
}

async function insertAttendance(
  tx: Tx,
  tenantId: string,
  world: World,
  classOf: Map<string, string>,
  studentOf: Map<string, string>,
) {
  await writeChunks(world.attendance, async (part) => {
    await tx.insert(attendanceRecords).values(
      part.map((row) => ({
        id: crypto.randomUUID(),
        tenantId,
        classId: classOf.get(row.classKey)!,
        studentId: studentOf.get(row.studentCode)!,
        sessionDate: row.date,
        slotStart: row.slotStart,
        status: row.status as "present" | "absent" | "late" | "excused",
        sessionUnits: row.status === "absent" || row.status === "excused" ? null : "1",
        recordedAt: new Date(`${row.date}T01:00:00.000Z`),
      })),
    );
  });
}

async function insertInvoices(tx: Tx, tenantId: string, note: string, world: World, studentOf: Map<string, string>) {
  await writeChunks(world.invoices, async (part) => {
    await tx.insert(invoices).values(
      part.map((row) => ({
        id: crypto.randomUUID(),
        tenantId,
        studentId: studentOf.get(row.studentCode)!,
        period: row.period,
        category: "tuition",
        amountTotal: String(row.amount),
        amountPaid: String(row.paid),
        amountDiscount: "0",
        status: row.status as "paid" | "partial" | "unpaid",
        lineItems: [{ label: "수강료", amount: row.amount }],
        notes: note,
      })),
    );
  });
}
