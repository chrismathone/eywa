import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";
import { getClassTeacherOptions } from "@/features/classes/server/queries";
import { getClassroomOptions } from "@/features/enrollments/server/queries";
import { ClassForm } from "../_components/class-form";

export const metadata = { title: "새 반 — eywa" };

export default async function NewClassPage() {
  await requireAccess("classes");

  const [teachers, classrooms] = await Promise.all([
    getClassTeacherOptions(),
    getClassroomOptions(),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/classes"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition"
      >
        <ArrowLeft className="size-3.5" />
        수업목록으로
      </Link>

      <header className="border-border border-b pb-5">
        <p className="eyebrow">새 반 생성</p>
        <h1 className="display text-foreground text-2xl">반 정보</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          기본 정보 입력 후 주간 스케줄을 설정하세요.
        </p>
      </header>

      <ClassForm mode="create" teacherOptions={teachers} classroomOptions={classrooms} />
    </div>
  );
}
