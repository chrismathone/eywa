import { describe, expect, it } from "vitest";
import type { SubjectSetting } from "@/features/owner/settings-types";
import { FIXTURE_WORK } from "@/features/work-requests/testing/fixture";
import { consultGaps } from "./consult";
import { operationsDetails } from "./details-operations";
import { consultGroupsOf } from "./details-shared";
import { withExtras } from "./details";
import { mergeExtras, NO_EXTRAS } from "./extras-types";
import type { ResolvedView } from "@/features/dashboard/layout/view";
import { secretaryDetails } from "./secretary-details";
import { FIXTURE_EXTRAS, FIXTURE_SNAPSHOT } from "./testing/fixture";

const ctx = { snapshot: FIXTURE_SNAPSHOT, extras: FIXTURE_EXTRAS, amounts: true, subjects: [], eieOn: true, can: () => true };

describe("같은 값은 같은 판정 — 카드와 상세 · 다른 화면", () => {
  it("'지난달부터 담임 상담 없는 학생'은 학생 수다(두 담임이 같은 학생을 빠뜨려도 한 명)", () => {
    const homeroom = FIXTURE_EXTRAS.consult!.homeroom!;
    const twin = { ...homeroom.rows[0]!, id: "t9", name: "강사 라", pending: [{ id: "s3", name: "학생 마", grade: "중2", prev: "none" as const, last: null }] };
    expect(consultGaps(FIXTURE_EXTRAS.consult!)).toMatchObject({ twice: 2, teachers: 2 });
    expect(consultGaps({ ...FIXTURE_EXTRAS.consult!, homeroom: { ...homeroom, rows: [...homeroom.rows, twin] } })).toMatchObject({ twice: 2, teachers: 3 });
  });
  it("콜&상담 과목 칸 = 신규 콜&상담 통계와 같은 묶음 · 학원 설정 이름(못 읽는 글자는 묶음 없음)", () => {
    const subjects = [{ key: "math", label: "수학", color: "primary" }, { key: "english", label: "영어", color: "green" }] as SubjectSetting[];
    const groupsOf = consultGroupsOf({ ...ctx, extras: { ...FIXTURE_EXTRAS, settingSubjects: subjects } });
    expect(groupsOf("EIE")).toEqual(["영어"]);
    expect([...groupsOf("영어 수학")].sort()).toEqual(["수학", "영어"]);
    expect(groupsOf("영수")).toEqual([]);
    expect(groupsOf(null)).toEqual([]);
    // 재료(학원 설정 과목)가 아직 없으면 묶음 없이 — 지어내지 않는다.
    expect(consultGroupsOf(ctx)("수학")).toEqual([]);
  });
  it("6개월 청구 상세는 카드처럼 금액으로 · 이번 달 수납 상세는 그 카드의 금액 옵션을 따른다", () => {
    const d = operationsDetails({ ...ctx, amounts: false });
    expect(d.billingMonth?.stats[0]?.[0]).toBe("청구서");
    expect(d.billing6?.stats[0]?.[0]).toBe("실청구");
    expect(operationsDetails(ctx).billing6?.stats[0]?.[0]).toBe("실청구");
    // 금액을 가린 배치면 6개월 상세도 건수 — 기간 문구도 건수로.
    const counts = operationsDetails({ ...ctx, amounts: false, snapshot: { ...FIXTURE_SNAPSHOT, view: { amounts: false, monthAmounts: false } as unknown as ResolvedView } }).billing6!;
    expect([counts.stats[0]?.[0], counts.period]).toEqual(["청구서", "청구월 기준 청구서 건수"]);
  });
  it("다시 읽은 추가 값은 실린 칸만 바꾸고 못 읽은 칸은 이전 값을 둔다", () => {
    const prev = { ...NO_EXTRAS, roster: FIXTURE_EXTRAS.roster, report: FIXTURE_EXTRAS.report, longBilling: FIXTURE_EXTRAS.longBilling };
    const next = mergeExtras(prev, { roster: null, report: null, absenceLines: [], failed: ["report"] });
    expect(next.roster).toBeNull(); // 실렸다(비어 있음도 값이다)
    expect(next.report).toBe(FIXTURE_EXTRAS.report); // 못 읽음 → 이전 값
    expect(next.longBilling).toBe(FIXTURE_EXTRAS.longBilling); // 안 실림 → 이전 값
    expect(next.absenceLines).toEqual([]);
    expect("failed" in next).toBe(false);
  });
  it("3개월 내 퇴원 명단이 이번 달뿐이면 그렇다고 적는다(위 '6개월 합계'와 범위가 다르다)", () => {
    // 이 카드는 스냅샷 밖 값이라 화면처럼 추가 값을 끼운 스냅샷으로 본다(`withExtras`).
    const early = (extras: typeof FIXTURE_EXTRAS) => operationsDetails({ ...ctx, snapshot: withExtras(FIXTURE_SNAPSHOT, extras), extras }).earlyExits!;
    expect(early(FIXTURE_EXTRAS).tables[0]?.note).toBeUndefined();
    expect(early({ ...FIXTURE_EXTRAS, earlyNames: null }).tables[0]?.note).toContain("이번 달 명단만");
  });
  it("사람 상세에 맡은 업무 요청 — 업무 요청만 있는 사람의 줄도 상세가 열린다", () => {
    const all = secretaryDetails({ ...ctx, work: FIXTURE_WORK });
    const lee = all["person:u2"];
    expect(lee?.stats).toEqual([["맡은 업무 요청", "1건"]]);
    expect(lee?.tables.map((t) => [t.title, t.rows.map((r) => r.cells)])).toEqual([["맡은 업무 요청", [["10월 미납 5건 대조 및 학부모 안내", "11.04 · 2일 남음", "처리 중"]]]]);
    expect(secretaryDetails(ctx)["person:u2"]).toBeUndefined();
  });
  it("사람 상세의 '맡은 업무 요청' 수치 = 표의 줄 수(기한 지난 수치는 그 일부 · 기한 지난 줄이 먼저)", () => {
    const late = { ...FIXTURE_WORK.items[0]!, id: "late", title: "기한 지난 요청", dueOn: "2026-10-30" };
    const all = secretaryDetails({ ...ctx, work: { ...FIXTURE_WORK, items: [...FIXTURE_WORK.items, late] } });
    const lee = all["person:u2"]!;
    expect(lee.stats).toEqual([["기한 지난 업무 요청", "1건"], ["맡은 업무 요청", "2건"]]);
    expect(lee.tables).toHaveLength(1);
    expect(lee.tables[0]!.rows.map((r) => r.cells[0])).toEqual(["기한 지난 요청", "10월 미납 5건 대조 및 학부모 안내"]);
  });
});
