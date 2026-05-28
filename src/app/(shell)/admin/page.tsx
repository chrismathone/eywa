import Link from "next/link";
import { Copy, Database, FileText, FileSpreadsheet } from "lucide-react";
import { requireAccess } from "@/lib/auth/require-access";

export const metadata = { title: "관리자 도구 — eywa" };

const TOOLS = [
  {
    href: "/admin/duplicates",
    icon: Copy,
    label: "중복 학생 병합",
    description: "이름·학년·학교가 같은 학생 그룹을 찾아 통합합니다.",
  },
  {
    href: "/admin/cleanup",
    icon: Database,
    label: "데이터 정리",
    description: "고아 데이터 (수강 없는 재원생, 스케줄 없는 반 등) 검출 및 정리.",
  },
  {
    href: "/admin/scenarios",
    icon: FileText,
    label: "시나리오 관리",
    description: "현재 시간표·수강 상태를 jsonb snapshot으로 저장.",
  },
  {
    href: "/admin/integrations/sheets",
    icon: FileSpreadsheet,
    label: "Google Sheets 동기화",
    description: "시간표를 Google Sheets로 push (service account JWT).",
  },
];

export default async function AdminHomePage() {
  await requireAccess("admin");

  return (
    <div className="space-y-6">
      <header className="border-border border-b pb-5">
        <p className="eyebrow">관리자 도구</p>
        <h1 className="display text-foreground text-2xl">데이터 · 통합</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          master 권한 전용. 주의: 중복 병합·시나리오 복원은 되돌릴 수 없습니다.
        </p>
      </header>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                className="bg-card border-border hover:bg-bg-soft block rounded-md border p-5 transition"
              >
                <div className="text-chart-1 inline-flex items-center gap-2">
                  <Icon className="size-4" />
                  <h2 className="text-foreground text-sm font-semibold">{t.label}</h2>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">{t.description}</p>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
