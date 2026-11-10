import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { sheetT } from "@/features/teacher-view/i18n";
import { OneScreenCardColumn } from "./onescreen-card-column";

describe("OneScreenCardColumn", () => {
  it("선택 학생이 없으면 보고서 카드 대신 '학생 고르기' 빈 칸만 그린다", () => {
    render(
      <OneScreenCardColumn
        selected={null}
        ctx={{} as never}
        row={{} as never}
        card={{} as never}
        rowActions={{} as never}
        english={{} as never}
      />,
    );
    expect(screen.getByText(sheetT("ko", "os.c.pickStudent"))).toBeTruthy();
  });
});
