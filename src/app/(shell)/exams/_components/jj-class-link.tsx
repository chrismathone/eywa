/**
 * 반 상세 머리의 **인재원 학습** 입구 — JJ실을 이 반(aywa 영어 반)으로 좁혀 연다(2026-09-11 "학생별 반별 유기적으로").
 * 서버 컴포넌트. 보일지는 호출부(반 상세)가 정한다: 연동 학원 · 영어 반 · 성적관리 열람 권한.
 *
 * ⚠️ 반 상세는 강사뷰 한/영 전환 화면이라 라벨은 SHEET_DICT(`cls.d.jjStudy`)에서 온다 — 여기에 한글 리터럴을 두지 않는다.
 */
import { Button } from "@/components/ui/button";
import { WindowLink } from "@/components/workspace/window-link";
import { sheetT } from "@/features/teacher-view/i18n";

export function JjClassLink({ classId, lang }: { classId: string; lang: "ko" | "en" }) {
  const label = sheetT(lang, "cls.d.jjStudy");
  return (
    <Button
      variant="outline"
      render={
        <WindowLink href={`/exams/input?subject=english&type=jj&jjClass=${encodeURIComponent(classId)}`} title={label} />
      }
    >
      {label}
    </Button>
  );
}
