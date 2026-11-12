import { and, eq, inArray, like } from "drizzle-orm";
import { assertTenantViewOutboundAllowed } from "@/lib/auth/tenant-view-outbound";
import { db } from "@/lib/db";
import { classes, classrooms, classSchedules, dayOfWeekEnum, enrollments, invoices, students, tenants } from "@/lib/db/schema";
import { kstToday } from "@/lib/date-kst";
import { insertDashboardSatellite } from "./dashboard-apply";
import { buildDashboardWorld } from "./dashboard-world.mjs";
import { ensureDemoStaff } from "./demo-staff";
import { buildScenario, SCENARIOS } from "./plan.mjs";
import type { DemoModuleChange } from "./demo-modules";

const ROOM_NAMES = ["1강의실", "2강의실", "3강의실", "4강의실"] as const;
const NOTE_PREFIX = "demo-roster:";

class NotDemoError extends Error {
  constructor() {
    super("NOT_DEMO");
  }
}

/**
 * 가상 재원을 데모 지점에만 넣는다.
 * 슬러그가 `demo`가 아니면 지우기 전에 멈춘다. 지우는 행은 이 버튼이 넣은 것
 * (학생 코드 DMO- · 반 메모 demo-roster:)뿐이다.
 */
export async function replaceDemoRoster(
  tenantId: string,
  scenarioId: string,
): Promise<{ label: string; students: number; modules: DemoModuleChange } | { error: string }> {
  // 🔴 DB에 직접 접속해 쓴다 — Supabase 요청을 보는 쓰기 차단을 지나지 않으므로, 운영 콘솔의 '지점 보기'(읽기 전용)는 여기서 따로 멈춘다(tenant-view-outbound.ts).
  await assertTenantViewOutboundAllowed();
  if (!(scenarioId in SCENARIOS)) return { error: "없는 구성입니다" };
  const plan = buildScenario(scenarioId);
  const today = kstToday();
  const world = buildDashboardWorld(plan, today);
  const note = `${NOTE_PREFIX}${scenarioId}`;

  try {
    const [gate] = await db.select({ slug: tenants.slug }).from(tenants).where(eq(tenants.id, tenantId));
    if (gate?.slug !== "demo") return { error: "데모 지점에서만 바꿀 수 있습니다" };
    const staff = await ensureDemoStaff(tenantId);
    const teacherCursor = { math: 0, english: 0 };
    return await db.transaction(async (tx) => {
      const [tenant] = await tx
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for("update");
      if (tenant?.slug !== "demo") throw new NotDemoError();

      const doomedStudents = await tx
        .select({ id: students.id })
        .from(students)
        .where(and(eq(students.tenantId, tenantId), like(students.studentCode, "DMO-%"), like(students.notes, `${NOTE_PREFIX}%`)));
      const doomedClasses = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.tenantId, tenantId), like(classes.notes, `${NOTE_PREFIX}%`)));
      const studentIds = doomedStudents.map((row) => row.id);
      const classIds = doomedClasses.map((row) => row.id);

      if (classIds.length) {
        await tx.delete(enrollments).where(and(eq(enrollments.tenantId, tenantId), inArray(enrollments.classId, classIds)));
      }
      if (studentIds.length) {
        await tx.delete(enrollments).where(and(eq(enrollments.tenantId, tenantId), inArray(enrollments.studentId, studentIds)));
        await tx.delete(invoices).where(and(eq(invoices.tenantId, tenantId), inArray(invoices.studentId, studentIds)));
        await tx.delete(students).where(and(eq(students.tenantId, tenantId), inArray(students.id, studentIds)));
      }
      if (classIds.length) {
        await tx.delete(classes).where(and(eq(classes.tenantId, tenantId), inArray(classes.id, classIds)));
      }
      await removeSpareRooms(tx, tenantId);

      const roomId = new Map<string, string>();
      for (const name of ROOM_NAMES) {
        const [existing] = await tx
          .select({ id: classrooms.id })
          .from(classrooms)
          .where(and(eq(classrooms.tenantId, tenantId), eq(classrooms.name, name)));
        if (existing) {
          roomId.set(name, existing.id);
          continue;
        }
        const id = crypto.randomUUID();
        await tx.insert(classrooms).values({ id, tenantId, name, capacity: 20 });
        roomId.set(name, id);
      }

      const classId = new Map<object, string>();
      await tx.insert(classes).values(
        plan.classes.map((cls) => {
          const id = crypto.randomUUID();
          classId.set(cls, id);
          const pool = cls.subject === "english" ? staff.english : staff.math;
          const cursor = cls.subject === "english" ? "english" : "math";
          const teacherId = pool.length ? pool[teacherCursor[cursor]++ % pool.length] : null;
          return {
            id,
            tenantId,
            className: cls.name,
            subject: cls.subject,
            isActive: true,
            notes: note,
            teacherId,
            classroomId: roomId.get(cls.room) ?? null,
          };
        }),
      );

      const studentId = new Map<object, string>();
      await tx.insert(students).values(
        plan.students.map((student) => {
          const id = crypto.randomUUID();
          studentId.set(student, id);
          return {
            id,
            tenantId,
            name: student.name,
            gender: student.gender,
            school: student.school.name,
            grade: student.grade,
            status: "enrolled" as const,
            enrolledAt: world.enrolledAt.get(student.code) ?? plan.start,
            isTest: false,
            parentName: student.parentName,
            parentPhone: student.parentPhone,
            studentCode: student.code,
            notes: note,
          };
        }),
      );

      await tx.insert(classSchedules).values(
        plan.classes.flatMap((cls) =>
          cls.days.flatMap((day: typeof dayOfWeekEnum.enumValues[number]) =>
            cls.periods.map((period: { start: string; end: string; label: string }) => ({
              id: crypto.randomUUID(),
              tenantId,
              classId: classId.get(cls)!,
              dayOfWeek: day,
              startTime: period.start,
              endTime: period.end,
              validFrom: plan.start,
              periodLabel: period.label,
              classroomId: roomId.get(cls.room) ?? null,
            })),
          ),
        ),
      );

      await tx.insert(enrollments).values(
        plan.students.flatMap((student) =>
          student.classes.map((cls: object) => ({
            id: crypto.randomUUID(),
            tenantId,
            studentId: studentId.get(student)!,
            classId: classId.get(cls)!,
            startDate: world.startDate.get(student.code) ?? plan.start,
          })),
        ),
      );

      const modules = await insertDashboardSatellite(tx, tenantId, plan, note, classId, studentId, today);

      return { label: plan.scenario.title as string, students: plan.stats.students as number, modules };
    });
  } catch (err) {
    if (err instanceof NotDemoError) return { error: "데모 지점에서만 바꿀 수 있습니다" };
    const cause = err instanceof Error ? (err.cause as { message?: string } | undefined)?.message ?? err.message : String(err);
    console.error("[demo-roster]", cause.slice(0, 300));
    return { error: "데모 데이터를 바꾸지 못했습니다" };
  }
}

async function removeSpareRooms(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], tenantId: string) {
  const classRooms = await tx.select({ id: classes.classroomId }).from(classes).where(eq(classes.tenantId, tenantId));
  const slotRooms = await tx.select({ id: classSchedules.classroomId }).from(classSchedules).where(eq(classSchedules.tenantId, tenantId));
  const named = await tx
    .select({ id: classrooms.id })
    .from(classrooms)
    .where(and(eq(classrooms.tenantId, tenantId), inArray(classrooms.name, [...ROOM_NAMES])));
  const used = new Set(
    [...classRooms, ...slotRooms].map((row) => row.id).filter((id): id is string => !!id),
  );
  const spare = named.map((row) => row.id).filter((id) => !used.has(id));
  if (spare.length) await tx.delete(classrooms).where(inArray(classrooms.id, spare));
}
