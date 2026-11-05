import { BackLink } from "@/components/back-link";
import { requireAccess } from "@/lib/auth/require-access";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { getStudentOptionsForConsultation } from "@/features/consultations/server/queries";
import { getTeacherOptions } from "@/features/students/server/queries";
import { getTenantSettings } from "@/features/owner/server/queries";
import { subjectLabelRecord } from "@/features/owner/subjects";
import { getNewcomerLinkTargets } from "@/features/newcomers/server/consult-link";
import { hasClassSupport } from "@/features/consultations/server/class-support";
import { ConsultationForm } from "../_components/consultation-form";
import { AudioConsultationForm } from "../_components/audio-consultation-form";
import { formInstanceKey } from "@/lib/recording-resume";

export const metadata = { title: "새 원생상담 — 에이와" };

export default async function NewConsultationPage({
  searchParams,
}: {
  searchParams: Promise<{ studentId?: string; form?: string; recordStudent?: string }>;
}) {
  const viewer = await requireAccess("consultations");
  // `form` = 녹음이 걸린 상담 화면이 있을 때 연 새 작성 화면 · `recordStudent` = 녹음 아이콘의 '작성 화면 열기'로 돌아온
  // 학생(recording-resume.ts). 같은 주소에서 쿼리만 바뀌면 Next가 폼을 그대로 두므로 둘로 key를 걸어 새로 그린다.
  const { studentId, form, recordStudent } = await searchParams;
  const instanceKey = `${formInstanceKey(form)}:${typeof recordStudent === "string" ? recordStudent : ""}`;
  const [canWrite, students, counselors, settings, newcomerTargets, classSupported, actor] = await Promise.all([
    // 저장 게이트(createStudentConsultation)와 같은 판정 — 읽기 권한이면 칸은 잠그고 저장·녹음은 그리지 않는다.
    canWriteTenant(viewer.systemRole, "consultations"),
    getStudentOptionsForConsultation(),
    getTeacherOptions(),
    getTenantSettings(),
    // 신규생 관리 칸(0295a) — 못 읽어도 상담 등록은 된다(칸만 안 뜬다).
    getNewcomerLinkTargets().catch(() => []),
    // 반 칸(0318a) — SQL 적용 전이면 칸을 안 그린다([[#95]]).
    hasClassSupport().catch(() => false),
    // '상담사' 기본값·자동 과목의 '나' = 저장 액션(createStudentConsultation)과 같은 행위자 — 강사뷰면 대상 직원 X
    // (원장 2026-11-05 강사뷰 전수: X 화면에서 상담사 칸이 A로 채워져 A 명의 상담이 남았다).
    getCurrentUser({ teacherView: true }),
  ]);
  const me = actor ?? viewer;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <BackLink href="/consultations" label="원생상담으로" />

      <header className="border-border space-y-1 border-b pb-3">
        <p className="eyebrow">새 원생상담</p>
        <h1 className="font-bold tracking-tight text-foreground text-2xl">상담 기록 추가</h1>
        <p className="text-muted-foreground text-sm">
          학생/학부모 면담을 기록합니다. 후속 조치 날짜를 지정하면 기한이 다가올수록 색상으로 알려드립니다.
        </p>
      </header>

      <div key={instanceKey} className="space-y-4">
        {/* 녹음·파일로 만드는 상담은 통째로 쓰기 동작(녹음 시작·업로드·저장)이라 읽기 권한이면 그리지 않는다. */}
        {canWrite ? (
          <AudioConsultationForm students={students} recordingOwner={{ tenantId: viewer.tenantId, userId: viewer.id }}
            initialStudentId={typeof recordStudent === "string" ? recordStudent : undefined} />
        ) : null}

        <ConsultationForm
          mode="create"
          readOnly={!canWrite}
          students={students}
          counselors={counselors}
          subjectLabels={subjectLabelRecord(settings.operations.subjects)}
          currentUserId={me.id}
          templates={settings.consultations.templates}
          currentUserName={me.displayName}
          // 🔴 고를 수 있는 학생(담당 범위로 좁힌 목록)의 것만 내려보낸다 — 강사에게 전사 신입 명단이 새지 않게.
          newcomerTargets={newcomerTargets.filter((t) => students.some((s) => s.id === t.studentId))}
          classSupported={classSupported}
          initialValue={
            studentId
              ? {
                  studentId,
                  counselorId: null,
                  consultedAt: new Date().toISOString(),
                  category: "general",
                  subject: null,
                  audience: "parent",
                  summary: "",
                  followUpAction: null,
                  followUpDate: null,
                  followUpDone: false,
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}
