import { HelpCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

export const metadata = { title: "도움말 — eywa" };

export default function HelpPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="도움말"
        description="기능별 가이드, 단축키, FAQ."
      />
      <EmptyState
        icon={HelpCircle}
        title="가이드 준비 중"
        description="구현이 진행되면서 각 기능의 사용법이 여기에 채워집니다."
      />
    </div>
  );
}
