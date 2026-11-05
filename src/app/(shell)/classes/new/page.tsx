import { BackLink } from "@/components/back-link";
import { isModuleEnabled } from "@/lib/modules";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { getClassTeacherOptions } from "@/features/classes/server/queries";
import { getClassroomOptions } from "@/features/enrollments/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { settingsToPeriodsConfig } from "@/features/timetable/lib/periods";
import { kstToday } from "@/lib/date-kst";
import { ClassForm } from "../_components/class-form";

export const metadata = { title: "새 반 — 에이와" };

export default async function NewClassPage() {
  const user = await requireAccess("classes");

  // 🔴 새 반 저장(`createClass` → `requireClassManage`)은 **full만** 받는다 — 화면도 같은 함수로 판정한다.
  //    `canWriteTenant`를 쓰면 scoped(강사)가 통과해 "칸은 열렸는데 저장만 거절"이 된다(#77).
  //    주소로 바로 들어온 읽기 권한이면 막지 않고 칸을 전부 끈 채 보여 준다(원장 2026-11-05 — lib/write-lock.ts).
  const [teachers, classrooms, settings, canCreate] = await Promise.all([
    getClassTeacherOptions(),
    getClassroomOptions(),
    getTenantSettings(),
    canManageTenant(user.systemRole, "classes"),
  ]);
  const subjectOptions = buildSubjectMaps(settings.operations.subjects).options;
  const periodsConfig = settingsToPeriodsConfig(settings.operations);

  return (
    <div className="space-y-6">
      <BackLink href="/classes" label="수업목록으로" />

      <header className="border-border border-b pb-5">
        <p className="eyebrow">새 반 생성</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">반 정보</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          기본 정보 입력 후 주간 스케줄을 설정하세요.
        </p>
      </header>

      <ClassForm
        mode="create"
        today={kstToday()}
        teacherOptions={teachers}
        classroomOptions={classrooms}
        subjectOptions={subjectOptions}
        periodsConfig={periodsConfig}
        showEnglishTrack={isModuleEnabled(settings.modules.disabled, "eie")}
        classnoteOn={classnoteModuleOn(settings)}
        readOnly={!canCreate}
      />
    </div>
  );
}
