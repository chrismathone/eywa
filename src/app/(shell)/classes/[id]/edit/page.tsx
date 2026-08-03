import { notFound } from "next/navigation";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import {
  getClassDetail,
  getClassTeacherOptions,
} from "@/features/classes/server/queries";
import { getClassroomOptions } from "@/features/enrollments/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { isCurrentSlot } from "@/features/classes/schedule-preserve";
import { kstToday } from "@/lib/date-kst";
import { ClassForm } from "../../_components/class-form";

export const metadata = { title: "반 수정 — eywa" };

/**
 * 슬롯들의 운영 기간 → 폼 한 쌍으로 압축.
 * ⚠️ 시작일·종료일 **둘 다** 갈릴 수 있고, 갈리면 **칸을 비운다**. 폼은 항상 `periodProvided=1`을
 *    보내므로 값을 채워 보내면 그 한 값이 전 교시에 적용된다 — 예전엔 시작일을 말없이 최솟값으로
 *    평탄화해, 7/3부터 시작한 교시가 3/1부터 있었던 것으로 소급됐다(타임머신 과거 주가 거짓이 된다).
 *    비워 보내면 서버(`preserveScheduleFields`)가 교시별 기존값을 그대로 보존한다.
 */
function commonPeriod(slots: { validFrom: string | null; validTo: string | null }[]): {
  validFrom: string | null;
  validTo: string | null;
  mixed: "from" | "to" | "both" | null;
} {
  const froms = [...new Set(slots.map((s) => s.validFrom ?? ""))];
  const tos = [...new Set(slots.map((s) => s.validTo ?? ""))];
  const fromMixed = froms.length > 1;
  const toMixed = tos.length > 1;
  return {
    validFrom: fromMixed ? null : (froms[0] || null),
    validTo: toMixed ? null : (tos[0] || null),
    mixed: fromMixed && toMixed ? "both" : fromMixed ? "from" : toMixed ? "to" : null,
  };
}

export default async function EditClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("classes");
  const { id } = await params;

  const [klass, teachers, classrooms, settings] = await Promise.all([
    getClassDetail(id),
    getClassTeacherOptions(),
    getClassroomOptions(),
    getTenantSettings(),
  ]);

  if (!klass) notFound();
  // 🔴 현재 담임이 배정 후보 밖(퇴직·역할 변경)이어도 **선택지에 남긴다**. 담임 select는 컨트롤드라
  // 값에 맞는 option이 없으면 빈 칸이 되고, 그대로 저장하면 `teacherId: get(...) || null`로 담임이
  // **조용히 NULL이 된다**(반을 고치러 들어갔다가 담임을 지우는 사고). 이름은 이미 klass에 있어 추가 조회 없음.
  const teacherOptions =
    klass.teacherId && !teachers.some((t) => t.id === klass.teacherId)
      ? [...teachers, { id: klass.teacherId, name: `${klass.teacherName ?? "이름 없음"} (현재 담임)`, subjects: [] }]
      : teachers;
  const subjectOptions = buildSubjectMaps(settings.operations.subjects).options;
  const periodsConfig = settingsToPeriodsConfig(settings.operations);
  // 폼이 편집하는 대상 = **현재 유효한 슬롯만**. 운영 종료일이 지난 행은 지난 배치의 이력이라
  // (영어 시트 구조 가져오기가 옛 배치를 마감하고 새 배치를 넣는다) 화면에 섞으면 ① 같은 칸에 옛/현
  // 두 행이 겹쳐 보이고 ② 저장 시 옛 강사·강의실 라벨이 현재 행에 되살아난다. 서버도 같은 범위만 쓴다.
  const today = kstToday();
  const liveSlots = klass.scheduleSlots.filter((s) => isCurrentSlot(s.validTo, today));
  const historyCount = klass.scheduleSlots.length - liveSlots.length;
  // 운영 기간 프리필 — 기간은 스케줄 **슬롯마다** 있고 폼은 반 단위 한 쌍이라, 전 슬롯이 같을 때만
  // 채운다(갈리면 비우고 periodMixed로 알림 — 조용한 소급·덮어쓰기 방지).
  const period = commonPeriod(liveSlots);

  return (
    <div className="space-y-6">
      <BackLink href={`/classes/${id}`} label="반 상세로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">반 수정</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">{klass.className}</h1>
      </header>

      <ClassForm
        mode="edit"
        scope={`class:${id}`}
        defaults={{
          id: klass.id,
          className: klass.className,
          subject: klass.subject,
          teacherId: klass.teacherId,
          classroomId: klass.classroomId,
          notes: klass.notes,
          bgColor: klass.bgColor,
          isSpecial: klass.isSpecial,
          validFrom: period.validFrom,
          validTo: period.validTo,
          ...(period.mixed ? { periodMixed: period.mixed } : {}),
          ...(historyCount > 0 ? { historyCount } : {}),
          schedules: liveSlots.map((s) => ({
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
            teacherId: s.teacherId,
            classroomId: s.classroomId,
          })),
        }}
        teacherOptions={teacherOptions}
        classroomOptions={classrooms}
        subjectOptions={subjectOptions}
        periodsConfig={periodsConfig}
      />
    </div>
  );
}
