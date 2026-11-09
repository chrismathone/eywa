import { EyIcon } from "@/components/icons/aywa-icons";
import { ConnectionSkeleton } from "@/features/student-contribution/components/current-connections";

/**
 * 원생 로열티 학생 상세 스켈레톤 — page가 게이트를 확인한 뒤 **먼저 세우는 껍데기**(`StudentOntologyPanel`)와 똑같이 그린다:
 * 머리 자리 `ConnectionSkeleton`('학생 기록') · 본문 자리 `ConnectionSkeleton`('월별 기여도') · 접힌 '현재 연결' 상자.
 * 🔴 옛 것(목록 막대 재수출)과 껍데기가 달라 loading → 껍데기 → 내용으로 두 번 튀었다. 같은 부품을 import해 껍데기가 바뀌면 따라온다.
 * '현재 연결' 상자는 고정 문구라 실물 요약 줄을 그대로 옮겼다(누르는 동작만 없다).
 */
export default function Loading() {
  return (
    <div className="w-full min-w-0 space-y-5 pb-6">
      <ConnectionSkeleton label="학생 기록" />
      <ConnectionSkeleton label="월별 기여도" />
      <div aria-hidden className="border-line rounded-xl border">
        <div className="flex items-center justify-between gap-4 px-5 py-4">
          <span>
            <span className="block font-semibold">현재 연결</span>
            <span className="mt-1 block text-xs">현재 수강·담당자, 상담·메모와 최근 기록 요약</span>
          </span>
          <span className="text-primary flex shrink-0 items-center gap-2 text-sm">
            <span>펼치기</span>
            <span>
              <EyIcon name="chevronDown" size={16} />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
