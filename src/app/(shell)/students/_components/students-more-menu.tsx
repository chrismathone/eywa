"use client";

import { ExcelMenu } from "@/components/excel-import/excel-menu";
import { useSheetT } from "@/features/teacher-view/lang-context";

/**
 * 원생목록의 엑셀 버튼 — 공용 `ExcelMenu`(원장 2026-09-29 *"탭마다 엑셀 내보내기/가져오기 버튼 이름과 위치가 다 제각각임.
 * 엑셀 내보내기/가져오기 로 통일하고 위치도 검색과 같은 라인으로"*). 자리는 머리가 아니라 **검색 줄**.
 * 내보내기 = 지금 화면 목록 · 가져오기 = 공용 창(원생 서식). 가져오기는 full(`canImport`)만 — 강사는 내보내기만 본다.
 * 글자는 사전 경유(강사뷰 영어 화면 — 가져오기는 관리자 전용이라 공용 부품의 한국어 그대로).
 */
export function StudentsMoreMenu({ exportHref, canImport }: { exportHref: string; canImport: boolean }) {
  // 화면 언어 — provider 밖(관리자 풀셸)에선 한국어로 떨어진다(i18n 기본값).
  const t = useSheetT();
  return (
    <span data-help="st-excel">
      <ExcelMenu exportHref={exportHref} exportLabel={t("stu.excel")} importKind={canImport ? "students" : null} importLabel={t("stu.excelImport")} />
    </span>
  );
}
