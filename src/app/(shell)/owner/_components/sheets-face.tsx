import { getGoogleSheetsStatus } from "@/features/integrations/server/queries";
import { SheetsClient } from "@/app/(shell)/admin/integrations/sheets/_client";

/**
 * 연동 면 (owner ?tab=sheets) — 구글 시트 내보내기 ON/OFF 토글. 켜면 시간표 화면에 '시트' 버튼이 뜬다.
 * 대상 시트·서비스 계정(GOOGLE_SERVICE_ACCOUNT_KEY)은 운영자가 설정(관리자 문의) — 학원장은 ON/OFF만.
 */
export async function SheetsFace() {
  const status = await getGoogleSheetsStatus();
  return (
    <div className="max-w-2xl space-y-4">
      <header className="border-border border-b pb-3">
        <p className="eyebrow">관리 · 외부 연동</p>
        <h2 className="text-foreground text-lg font-semibold">구글 시트 내보내기</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          연동을 켜면 수학 시간표 화면에 ‘구글 시트’ 내보내기 버튼이 생깁니다(원장 전용). 누르면 대상
          시트에 <strong>eywa·</strong> 접두 탭으로 비파괴 추가됩니다(기존 탭 보존 — 공유 시트 안전).
        </p>
      </header>
      <SheetsClient status={status} />
    </div>
  );
}
