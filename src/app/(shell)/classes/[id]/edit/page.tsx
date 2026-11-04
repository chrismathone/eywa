import { notFound } from "next/navigation";
import { isModuleEnabled } from "@/lib/modules";
import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { canWriteLoadedClass } from "@/features/classes/server/class-scope";
import {
  getClassDetail,
  getClassTeacherOptions,
} from "@/features/classes/server/queries";
import { getClassroomOptions } from "@/features/enrollments/server/queries";
import { countRecentSentReports } from "@/features/classes/server/report-optout-sent";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { isCurrentSlot } from "@/features/classes/schedule-preserve";
// 운영 기간 압축은 반 정보 표시와 **같은 함수**(class-period.ts) — 폼과 반 정보가 다른 날짜를 말하지 않게.
import { commonPeriod } from "@/features/classes/class-period";
import { kstToday } from "@/lib/date-kst";
import { ClassForm } from "../../_components/class-form";

export const metadata = { title: "반 수정 — 에이와" };

export default async function EditClassPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAccess("classes");
  const { id } = await params;
  const today = kstToday();

  const [klass, teachers, classrooms, settings, recentSentReports] = await Promise.all([
    getClassDetail(id),
    getClassTeacherOptions(),
    // 보관된 강의실이라도 **이 반에 배정돼 있으면** 선택지에 남긴다(안 그러면 저장 시 배정이 조용히 지워진다).
    getClassroomOptions({ keepForClassId: id }),
    getTenantSettings(),
    // '수업보고서 미발송'을 켤 때 경고할 최근 30일 발송 건수(2026-11-04 사고) — 행을 받지 않는 count라 가볍다(B2).
    // 반 정보와 독립이라 함께 받는다(B4). 못 세면 null(화면은 그래도 경고) — 이 조회 때문에 화면이 안 열리지 않는다.
    countRecentSentReports(id, today),
  ]);

  if (!klass) notFound();
  // 🔴 **남의 반 수정 폼은 열지 않는다** — 서버 액션(`updateClass`)과 같은 판정을 화면에서도 한 번
  //    (#77: 폼을 열 수 있으면 "저장만 거절"이 되고, 그 사이 입력한 것이 통째로 사라진다).
  //    `getClassDetail`이 이미 열람 스코프를 걸지만 그쪽은 **부담임·위임까지 넓다**(읽기 축).
  if (!(await canWriteLoadedClass(klass.teacherId))) notFound();
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
        today={today}
        defaults={{
          id: klass.id,
          className: klass.className,
          subject: klass.subject,
          teacherId: klass.teacherId,
          classroomId: klass.classroomId,
          notes: klass.notes,
          bgColor: klass.bgColor,
          isSpecial: klass.isSpecial,
          reportOptout: klass.reportOptout,
          recentSentReports,
          ...(klass.englishTrack ? { englishTrack: klass.englishTrack } : {}),
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
            slotTeacherLabel: s.slotTeacherLabel,
            labSeparate: s.labSeparate,
          })),
          labSeparateKnown: klass.labSeparateKnown,
        }}
        teacherOptions={teacherOptions}
        classroomOptions={classrooms}
        subjectOptions={subjectOptions}
        periodsConfig={periodsConfig}
        showEnglishTrack={isModuleEnabled(settings.modules.disabled, "eie")}
        classnoteOn={classnoteModuleOn(settings)}
      />
    </div>
  );
}
