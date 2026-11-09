import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAccess } from "@/lib/auth/require-access";
import { StudentHub } from "@/features/student-hub/components/student-hub";

export const metadata = { title: "학생 통합보기 — 에이와" };

/**
 * 학생 통합보기(aywa-next 375d27df4 student-hub) — 기존 학생 상세 탭을 건드리지 않고 별도 주소로 연다.
 * 실제 기록만 읽는다(이 DB에 없는 aywa-next 전용 표는 '연결 전'으로 표시).
 */
export default async function StudentHubPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  await requireAccess("students");
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!z.uuid().safeParse(id).success) notFound();
  return <StudentHub studentId={id} month={sp.month} />;
}
