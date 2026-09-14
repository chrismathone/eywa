import { describe, expect, it } from "vitest";
import { buildHapbanRoster, resolveDropTarget, shouldOpenClassPick, type HapbanSlotIn } from "./hapban";
import { compareStudentLines } from "./student-sort";

const stu = (
  name: string,
  studentId: string,
  enrollmentId: string,
  over: Partial<HapbanSlotIn["students"][number]> = {},
) => ({ name, studentId, enrollmentId, status: "active" as const, attendanceDays: [], ...over });

const slotA = (students: HapbanSlotIn["students"]): HapbanSlotIn => ({
  id: "slot-a", classId: "class-a", className: "A반", students,
});
const slotB = (students: HapbanSlotIn["students"]): HapbanSlotIn => ({
  id: "slot-b", classId: "class-b", className: "B반", students,
});

describe("buildHapbanRoster", () => {
  it("① 서로소 두 반 = 합집합 + labels 1/2 + 세그먼트 순서 보존", () => {
    const r = buildHapbanRoster([slotA([stu("가나", "s1", "e1")]), slotB([stu("다라", "s2", "e2")])]);
    expect(r.segments.map((s) => [s.index, s.classId, s.slotId])).toEqual([
      [1, "class-a", "slot-a"],
      [2, "class-b", "slot-b"],
    ]);
    expect(r.active.map((s) => [s.name, s.label, s.ownClassId])).toEqual([
      ["가나", "1", "class-a"],
      ["다라", "2", "class-b"],
    ]);
    expect(r.hold).toHaveLength(0);
    expect(r.withdrawn).toHaveLength(0);
  });

  it("② 양쪽 재원 중복 = 1행 '1,2' + 채택=세그1 + blocking=[A,B]", () => {
    const r = buildHapbanRoster([
      slotA([stu("노현우", "s1", "e-a")]),
      slotB([stu("노현우", "s1", "e-b")]),
    ]);
    expect(r.active).toHaveLength(1);
    const row = r.active[0]!;
    expect(row.label).toBe("1,2");
    expect(row.enrollmentId).toBe("e-a"); // 채택 = 세그먼트 인덱스 최소
    expect(row.ownClassId).toBe("class-a");
    expect(row.ownSlotId).toBe("slot-a");
    expect(row.blockingClassIds).toEqual(["class-a", "class-b"]);
  });

  it("③ A퇴원+B재원 = 재원 [2]만(퇴원 섹션 부재) + blocking=[B](퇴원 제외)", () => {
    const r = buildHapbanRoster([
      slotA([stu("김철수", "s1", "e-a", { status: "withdrawn", endDate: "2026-06-01" })]),
      slotB([stu("김철수", "s1", "e-b")]),
    ]);
    expect(r.active.map((s) => [s.label, s.ownClassId])).toEqual([["2", "class-b"]]);
    expect(r.withdrawn).toHaveLength(0);
    expect(r.active[0]!.blockingClassIds).toEqual(["class-b"]);
  });

  it("④ 양쪽 퇴원 = 1행 '1,2' + endDate=max + blocking=[]", () => {
    const r = buildHapbanRoster([
      slotA([stu("이영희", "s1", "e-a", { status: "withdrawn", endDate: "2026-05-01" })]),
      slotB([stu("이영희", "s1", "e-b", { status: "withdrawn", endDate: "2026-06-15" })]),
    ]);
    expect(r.withdrawn).toHaveLength(1);
    expect(r.withdrawn[0]!.label).toBe("1,2");
    expect(r.withdrawn[0]!.endDate).toBe("2026-06-15");
    expect(r.withdrawn[0]!.blockingClassIds).toEqual([]);
  });

  it("⑤ A-hold + B-active = active 승(labels='2') 그러나 blocking=[A,B](hold 포함)", () => {
    const r = buildHapbanRoster([
      slotA([stu("박민수", "s1", "e-a", { status: "hold" })]),
      slotB([stu("박민수", "s1", "e-b")]),
    ]);
    expect(r.active).toHaveLength(1);
    expect(r.hold).toHaveLength(0);
    expect(r.active[0]!.label).toBe("2");
    expect(r.active[0]!.ownClassId).toBe("class-b");
    expect(r.active[0]!.blockingClassIds).toEqual(["class-a", "class-b"]);
  });

  it("⑥ 양쪽 hold = hold '1,2' 1행", () => {
    const r = buildHapbanRoster([
      slotA([stu("최지훈", "s1", "e-a", { status: "hold" })]),
      slotB([stu("최지훈", "s1", "e-b", { status: "hold" })]),
    ]);
    expect(r.hold).toHaveLength(1);
    expect(r.hold[0]!.label).toBe("1,2");
  });

  it("⑦ studentId 결측 = enrollmentId 폴백 키(dedup 안 됨·무크래시)", () => {
    const r = buildHapbanRoster([
      slotA([{ name: "무명", enrollmentId: "e-a", status: "active" as const }]),
      slotB([{ name: "무명", enrollmentId: "e-b", status: "active" as const }]),
    ]);
    expect(r.active).toHaveLength(2); // 폴백 키가 달라 dedup 안 됨
  });

  it("⑨ 요일 합집합: A=[mon]+B=[thu] 양쪽 재원 → display=합집합(hover도 동일), own=채택(A)의 [mon]", () => {
    const r = buildHapbanRoster([
      slotA([stu("정수린", "s1", "e-a", { attendanceDays: ["mon"] })]),
      slotB([stu("정수린", "s1", "e-b", { attendanceDays: ["thu"] })]),
    ]);
    const row = r.active[0]!;
    expect(row.displayAttendanceDays.sort()).toEqual(["mon", "thu"]);
    // hover 카드(StudentInfoCard)가 읽는 attendanceDays도 합집합 — 명단 배치와 모순 방지(적대리뷰).
    expect([...(row.attendanceDays ?? [])].sort()).toEqual(["mon", "thu"]);
    expect(row.ownAttendanceDays).toEqual(["mon"]);
  });

  it("⑨-b dayOwners: 요일 칸 행은 그 요일 실소유 enrollment에 바인딩(A=[mon]→mon, B=[thu]→thu)", () => {
    const r = buildHapbanRoster([
      slotA([stu("정수린", "s1", "e-a", { attendanceDays: ["mon"] })]),
      slotB([stu("정수린", "s1", "e-b", { attendanceDays: ["thu"] })]),
    ]);
    const row = r.active[0]!;
    expect(row.dayOwners["mon"]).toMatchObject({ enrollmentId: "e-a", classId: "class-a", slotId: "slot-a" });
    expect(row.dayOwners["thu"]).toMatchObject({ enrollmentId: "e-b", classId: "class-b", slotId: "slot-b" });
  });

  it("⑩ 한쪽 [](전 요일)+한쪽 [thu] → display=[](전 요일)", () => {
    const r = buildHapbanRoster([
      slotA([stu("한서준", "s1", "e-a", { attendanceDays: [] })]),
      slotB([stu("한서준", "s1", "e-b", { attendanceDays: ["thu"] })]),
    ]);
    expect(r.active[0]!.displayAttendanceDays).toEqual([]);
  });

  it("정렬: 통합 후에도 공유 comparator(신입→전입→기존 가나다) 적용", () => {
    const r = buildHapbanRoster([
      slotA([stu("나기존", "s1", "e1"), stu("가신입", "s2", "e2", { isNew: true })]),
      slotB([stu("다전입", "s3", "e3", { isTransferredIn: true })]),
    ]);
    expect(r.active.map((s) => s.name)).toEqual(["가신입", "다전입", "나기존"]);
  });
});

describe("resolveDropTarget", () => {
  const over = (o: Parameters<typeof resolveDropTarget>[1]) => o;

  it("멤버→요일존 = 자기 반 + [day] (재해석)", () => {
    expect(
      resolveDropTarget(
        { classId: "class-b", blockingClassIds: ["class-b"] },
        over({ classId: "class-a", slotId: "slot-a", day: "thu", memberClassIds: ["class-a", "class-b"] }),
      ),
    ).toEqual({ toClassId: "class-b", day: "thu" });
  });

  it("'1,2' 멤버→요일존 = {자기반,[day]} — null 아님(재해석이 차단보다 우선)", () => {
    expect(
      resolveDropTarget(
        { classId: "class-a", blockingClassIds: ["class-a", "class-b"] },
        over({ classId: "class-a", slotId: "slot-a", day: "thu", memberClassIds: ["class-a", "class-b"] }),
      ),
    ).toEqual({ toClassId: "class-a", day: "thu" });
  });

  it("멤버→본문 = 자기 반 + day 없음(공통 존=전 요일)", () => {
    expect(
      resolveDropTarget(
        { classId: "class-b", blockingClassIds: ["class-b"] },
        over({ classId: "class-a", slotId: "slot-a", memberClassIds: ["class-a", "class-b"] }),
      ),
    ).toEqual({ toClassId: "class-b", day: undefined });
  });

  it("멤버(1만)→세그먼트B = B 이동(명시적 반 이동)", () => {
    expect(
      resolveDropTarget(
        { classId: "class-a", blockingClassIds: ["class-a"] },
        over({ classId: "class-b", slotId: "slot-b" }), // 세그먼트엔 memberClassIds 없음
      ),
    ).toEqual({ toClassId: "class-b", day: undefined });
  });

  it("멤버(1,2)→소속 세그먼트B = no-op(null, GiST 사고 차단)", () => {
    expect(
      resolveDropTarget(
        { classId: "class-a", blockingClassIds: ["class-a", "class-b"] },
        over({ classId: "class-b", slotId: "slot-b" }),
      ),
    ).toBeNull();
  });

  it("자기 반(target===from) 드롭은 차단 안 함 — 같은-반 요일편집 경로로 통과(적대리뷰)", () => {
    // 합반 행을 자기 반의 다른 셀(일반 셀, memberClassIds 없음)로 드래그 = 기존 요일편집 제스처.
    expect(
      resolveDropTarget(
        { classId: "class-a", blockingClassIds: ["class-a", "class-b"] },
        over({ classId: "class-a", slotId: "slot-a-other", day: "thu" }),
      ),
    ).toEqual({ toClassId: "class-a", day: "thu" });
    // 자기 세그먼트 헤더 드롭도 같은-반으로 통과(진짜 no-op은 caller의 sameDaySet 판정).
    expect(
      resolveDropTarget(
        { classId: "class-a", blockingClassIds: ["class-a", "class-b"] },
        over({ classId: "class-a", slotId: "slot-a" }),
      ),
    ).toEqual({ toClassId: "class-a", day: undefined });
  });

  it("A-hold+B-active 학생→세그먼트A = no-op(blocking에 hold 포함)", () => {
    expect(
      resolveDropTarget(
        { classId: "class-b", blockingClassIds: ["class-a", "class-b"] },
        over({ classId: "class-a", slotId: "slot-a" }),
      ),
    ).toBeNull();
  });

  it("외부인→요일존 = 대표 반 + [day] / 외부인→본문 = 대표 반", () => {
    const ext = { classId: "class-x", blockingClassIds: ["class-x"] };
    expect(
      resolveDropTarget(ext, over({ classId: "class-a", slotId: "slot-a", day: "mon", memberClassIds: ["class-a", "class-b"] })),
    ).toEqual({ toClassId: "class-a", day: "mon" });
    expect(
      resolveDropTarget(ext, over({ classId: "class-a", slotId: "slot-a", memberClassIds: ["class-a", "class-b"] })),
    ).toEqual({ toClassId: "class-a", day: undefined });
  });

  it("blocking/member 부재(일반 셀) = 기존 동작 그대로", () => {
    expect(resolveDropTarget({ classId: "class-x" }, over({ classId: "class-y", slotId: "slot-y" }))).toEqual({
      toClassId: "class-y",
      day: undefined,
    });
    // 같은 반 드롭도 그대로 반환 — no-op 판정은 caller(sameDaySet)의 몫(기존 계약 유지).
    expect(resolveDropTarget({ classId: "class-y" }, over({ classId: "class-y", slotId: "slot-y" }))).toEqual({
      toClassId: "class-y",
      day: undefined,
    });
  });
});

describe("shouldOpenClassPick (합반 드롭 → 반+요일 선택 팝업 판정)", () => {
  const mc = [
    { classId: "class-a", className: "A반", slotId: "slot-a" },
    { classId: "class-b", className: "B반", slotId: "slot-b" },
  ];

  it("외부 학생 → 본문/요일존/세그먼트 어디든 팝업", () => {
    expect(shouldOpenClassPick("class-x", { classId: "class-a", memberClasses: mc, hapbanZone: "roster" })).toBe(true);
    expect(shouldOpenClassPick("class-x", { classId: "class-a", memberClasses: mc, hapbanZone: "segment" })).toBe(true);
  });

  it("멤버 → 본문/요일존 = 팝업 없음(자기 반 요일편집 재해석 유지)", () => {
    expect(shouldOpenClassPick("class-a", { classId: "class-a", memberClasses: mc, hapbanZone: "roster" })).toBe(false);
  });

  it("멤버 → 자기 세그먼트 = 팝업 없음 / 다른 세그먼트 = 팝업(이동+요일 한 번에)", () => {
    expect(shouldOpenClassPick("class-a", { classId: "class-a", memberClasses: mc, hapbanZone: "segment" })).toBe(false);
    expect(shouldOpenClassPick("class-a", { classId: "class-b", memberClasses: mc, hapbanZone: "segment" })).toBe(true);
  });

  it("일반 셀(memberClasses 부재) = 항상 팝업 없음", () => {
    expect(shouldOpenClassPick("class-x", { classId: "class-y" })).toBe(false);
  });
});

describe("compareStudentLines (서버 정렬과 동치)", () => {
  it("재원(신입→준신입→전입→기존 가나다) → 대기(가나다) → 퇴원(endDate desc)", () => {
    const rows = [
      { name: "하퇴원1", status: "withdrawn" as const, endDate: "2026-05-01" },
      { name: "가기존", status: "active" as const },
      { name: "나신입", status: "active" as const, isNew: true },
      { name: "다대기", status: "hold" as const },
      { name: "라전입", status: "active" as const, isTransferredIn: true },
      { name: "마퇴원2", status: "withdrawn" as const, endDate: "2026-06-01" },
      // 🔴 준신입(31~60일)을 빼면 이 계약 테스트는 **옛 3단 코드에서도 통과**해 가드 가치가 0이 된다.
      //    합반은 행을 스프레드로 재조립한 뒤 다시 정렬하는 경로라 회귀가 숨기 가장 좋은 자리다.
      { name: "바준신입", status: "active" as const, isRecent: true },
    ];
    rows.sort(compareStudentLines);
    expect(rows.map((r) => r.name)).toEqual([
      "나신입",
      "바준신입",
      "라전입",
      "가기존",
      "다대기",
      "마퇴원2",
      "하퇴원1",
    ]);
  });

  it("status 미지정 = 재원 취급", () => {
    const rows = [{ name: "나", status: "hold" as const }, { name: "가" }];
    rows.sort(compareStudentLines);
    expect(rows.map((r) => r.name)).toEqual(["가", "나"]);
  });
});
