import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { reasonDetailOf } from "@/features/withdrawals/reason-detail";
import { SHEET_REASONS, archiveReason, webReportReason } from "./list-reason";

describe("퇴원보고서 목록의 사유 칸 — 우리 사유 그대로, 없으면 기타 + 설명(원장 2026-10-16)", () => {
  it("옛 양식 사유 글은 같은 뜻의 우리 사유(대분류 · 세부)로 — 띄어쓰기가 달라도 같다", () => {
    expect(archiveReason("학업의욕상실", "")).toEqual({ text: "학생 상태 · 학습 의욕 저하", note: null });
    expect(archiveReason("학습부진, 수업따라오기 벅참", "길게 쓴 상세")).toEqual({ text: "학생 상태 · 힘들어함", note: null });
    expect(archiveReason("타학원과 시간이 안맞음", null)).toEqual({ text: "시간/일정 · 다른 학원과 충돌", note: null });
    expect(archiveReason("이사 및 전학", null)).toEqual({ text: "이사", note: null });
    expect(archiveReason("진로 변경", null)).toEqual({ text: "진로·진학", note: null });
    expect(archiveReason(" 강사  교체 ", null)).toEqual({ text: "수업·강사 · 담당 강사 변경", note: null });
  });

  it("맞는 세부가 없으면 매핑의 설명이 사유 아래 설명 줄로 — 수업진행이 빡세서 = 수업·강사 (힘듦)(원장 2026-10-16)", () => {
    expect(archiveReason("수업진행이 빡세서", "상세 사유 원문")).toEqual({ text: "수업·강사", note: "힘듦" });
    // 설명이 없는 매핑은 종전대로 설명 없음
    expect(archiveReason("선생님과 맞지않아서", "상세")).toEqual({ text: "수업·강사", note: null });
  });

  it("뜻이 하나로 안 정해지거나 표에 없는 글은 지어 붙이지 않는다 — '기타' + 그 글이 설명", () => {
    expect(archiveReason("학습태도 불량 / 금전적인 문제(집안사정)", "상세")).toEqual({ text: "기타", note: "학습태도 불량 / 금전적인 문제(집안사정)" });
    expect(archiveReason("친구 및 반 분위기가 안좋아서", null)).toEqual({ text: "기타", note: "친구 및 반 분위기가 안좋아서" });
    // 우리 세부 이름이 두 대분류에 같이 있으면(친구 따라) 어느 쪽인지 모른다.
    expect(archiveReason("친구 따라", null)).toEqual({ text: "기타", note: "친구 따라" });
    // 휴원은 처리 모양이지 사유가 아니다 — 지어 붙이지 않는다(적대 리뷰 2026-10-16).
    expect(archiveReason("1달 휴원", null)).toEqual({ text: "기타", note: "1달 휴원" });
    expect(archiveReason("constructor", null)).toEqual({ text: "기타", note: "constructor" });
  });

  it("원문 사유가 '기타'·빈칸이면 상세 사유가 설명 · 둘 다 비면 미기재", () => {
    expect(archiveReason("기타", "한달 휴원후  다시\n돌아오겠다고 말씀하심.")).toEqual({ text: "기타", note: "한달 휴원후 다시 돌아오겠다고 말씀하심." });
    expect(archiveReason("기타", "")).toEqual({ text: "기타", note: null });
    expect(archiveReason("", "학교가 멀어서")).toEqual({ text: "기타", note: "학교가 멀어서" });
    expect(archiveReason(null, null)).toEqual({ text: "미기재", note: null, muted: true });
  });

  it("우리 라벨과 똑같이 적은 글은 표에 없어도 그 사유", () => {
    expect(archiveReason("졸업", null)).toEqual({ text: "졸업", note: null });
    expect(archiveReason("잦은 강사 변경", null)).toEqual({ text: "수업·강사 · 잦은 강사 변경", note: null });
  });

  it("표의 세부는 모두 그 대분류의 세부다(틀린 짝이면 세부 없이 대분류만 보이니 막는다)", () => {
    for (const [raw, { reason, detail }] of Object.entries(SHEET_REASONS)) {
      if (detail) expect(reasonDetailOf(detail)?.reason, raw).toBe(reason);
    }
  });

  it("목록 조회가 사유 칸을 싣는다 — 상세 조회 상수가 아니라 목록 상수에(빠지면 웹 보고서가 전부 '미기재')", () => {
    const src = readFileSync("src/features/withdrawal-reports/server/queries.ts", "utf8");
    const line = (name: string) => src.split(/\r?\n/).find((l) => l.startsWith(`const ${name} =`)) ?? "";
    expect(line("REPORT_LIST_COLUMNS")).toContain("body_reason:body->>reason,body_detail:body->>detail");
    expect(line("REPORT_COLUMNS")).not.toContain("body_reason");
    expect(readFileSync("src/features/withdrawal-reports/server/archives.ts", "utf8")).toContain("reason_raw:fields->>퇴원사유,detail_raw:fields->>상세사유");
  });

  it("웹 보고서 = 고른 사유 그대로 · '기타'는 상세 사유가 설명 · 아직 안 쓴 요청은 '작성 전'", () => {
    expect(webReportReason("manager_pending", "relocation", "이사를 가게 되어…")).toEqual({ text: "이사", note: null });
    expect(webReportReason("completed", "other", "집안 사정으로 쉬기로")).toEqual({ text: "기타", note: "집안 사정으로 쉬기로" });
    expect(webReportReason("requested", "other", "")).toEqual({ text: "작성 전", note: null, muted: true });
    // 임시 저장으로 사유를 고른 요청은 그 사유
    expect(webReportReason("requested", "career", "")).toEqual({ text: "진로·진학", note: null });
    expect(webReportReason("manager_pending", null, null)).toEqual({ text: "미기재", note: null, muted: true });
  });
});
