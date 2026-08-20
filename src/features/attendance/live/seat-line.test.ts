/**
 * 자리 줄(LAB·JJ) 묶음 규칙 — [teacher-group.ts](./teacher-group.ts).
 *
 * 원장 2026-08-20: *"담당미지정으로 나오게하지말고, lAB이면 lAB, JJ면 JJ"*.
 * `getLiveBoard`는 서버 의존이라 통째로 못 돌린다 → 묶음 규칙만 순수 함수로 뽑아 여기서 잠근다.
 * 🔴 잠그는 성질: ① LAB≠JJ(방이 다르다) ② 자리 줄엔 사람 id·전화가 없다 ③ 닉네임으로 사람을 쪼개지
 *    않는다 ④ 자리도 담당도 없어야 `담당 미지정` ⑤ 옛 별칭도 같은 줄로 정규화된다.
 */
import { describe, expect, it } from "vitest";
import {
  groupDisplayName,
  groupHeaderOf,
  groupIdentityOf,
  groupKeyOf,
  UNASSIGNED_TEACHER_NAME,
  type TeacherGroupSlot,
} from "./teacher-group";

const slot = (over: Partial<TeacherGroupSlot> = {}): TeacherGroupSlot => ({
  teacherId: null,
  slotTeacherLabel: null,
  ...over,
});

/** 줄 머리까지 한 번에(화면이 실제로 받는 모양). */
const headerOf = (s: TeacherGroupSlot, person?: { name?: string | null; phone?: string | null }) =>
  groupHeaderOf(groupIdentityOf(s), person);

describe("자리 줄 묶음(teacher-group)", () => {
  it("🔴 LAB과 JJ는 서로 다른 줄이다 — 방이 다르므로 절대 합치지 않는다", () => {
    const lab = slot({ slotTeacherLabel: "LAB" });
    const jj = slot({ slotTeacherLabel: "JJ" });
    expect(groupKeyOf(lab)).toBe("LAB");
    expect(groupKeyOf(jj)).toBe("JJ");
    expect(groupKeyOf(lab)).not.toBe(groupKeyOf(jj));
    expect(headerOf(lab).teacherName).toBe("LAB");
    expect(headerOf(jj).teacherName).toBe("JJ");
  });

  it("자리 줄은 사람이 아니다 — teacherId·teacherPhone은 null이고 seatLabel이 채워진다", () => {
    // 실수로 사람 정보를 넘겨도 자리엔 붙지 않는다(방에는 전화할 수 없다).
    const head = headerOf(slot({ slotTeacherLabel: "LAB" }), { name: "이주희", phone: "010-0000-0000" });
    expect(head).toEqual({
      teacherId: null,
      seatLabel: "LAB",
      teacherName: "LAB",
      teacherPhone: null,
    });
  });

  it("담당이 있는 영어 슬롯은 닉네임 라벨이 붙어도 사람 줄로 간다(닉네임으로 쪼개지 않는다)", () => {
    // 실측 2026-08-19: 살아 있는 슬롯 194개가 teacher_id + 시트 닉네임을 함께 들고 있다.
    const jane = slot({ teacherId: "u-1", slotTeacherLabel: "Jane" });
    const hannah = slot({ teacherId: "u-1", slotTeacherLabel: "Hannah" });
    expect(groupKeyOf(jane)).toBe("u-1");
    // 같은 사람이 닉네임 두 개를 달고 있어도 한 줄이다.
    expect(groupKeyOf(hannah)).toBe(groupKeyOf(jane));
    expect(headerOf(jane, { name: "이현이", phone: "010-1111-2222" })).toEqual({
      teacherId: "u-1",
      seatLabel: null,
      teacherName: "이현이",
      teacherPhone: "010-1111-2222",
    });
  });

  it("자리도 아니고 담당·담임도 없으면 `담당 미지정`", () => {
    // 실측 2026-08-20: 수학 `중등M 중1 PS3F 월목`·`고등M 중3 BS4B 월목`(담임 공석).
    const bare = slot();
    // 자리 라벨이 아닌 표기(Daniella·부원장)는 사람도 자리도 아니라 여기로 온다.
    const nickOnly = slot({ slotTeacherLabel: "Daniella" });
    expect(groupKeyOf(bare)).toBe("");
    expect(groupKeyOf(nickOnly)).toBe("");
    expect(headerOf(bare)).toEqual({
      teacherId: null,
      seatLabel: null,
      teacherName: UNASSIGNED_TEACHER_NAME,
      teacherPhone: null,
    });
    expect(headerOf(nickOnly).teacherName).toBe(UNASSIGNED_TEACHER_NAME);
  });

  it("옛 별칭 라벨(이주희·랩실)도 LAB 줄로 정규화된다 — raw 문자열을 키로 쓰면 방이 쪼개진다", () => {
    for (const label of ["이주희", "랩실", "lab"]) {
      expect(groupKeyOf(slot({ slotTeacherLabel: label }))).toBe("LAB");
      expect(headerOf(slot({ slotTeacherLabel: label })).seatLabel).toBe("LAB");
    }
    for (const label of ["자율실", "집중자율수업실", "jj"]) {
      expect(groupKeyOf(slot({ slotTeacherLabel: label }))).toBe("JJ");
    }
  });

  it("계정은 있는데 표시 이름이 비면 `이름 없음` — 사람 줄이 사라지지 않는다", () => {
    const head = headerOf(slot({ teacherId: "u-9" }), { name: "  ", phone: null });
    expect(head.teacherName).toBe("이름 없음");
    expect(head.teacherId).toBe("u-9");
  });

  it("담당이 붙은 자리 라벨 슬롯은 사람이 이긴다(귀속 축과 같은 순서)", () => {
    // teacher-axis의 isSeatSlot이 teacher_id null을 요구하므로 구조적으로 드물지만, 규칙은 같아야 한다.
    const s = slot({ teacherId: "u-2", slotTeacherLabel: "LAB" });
    expect(groupKeyOf(s)).toBe("u-2");
    expect(groupIdentityOf(s).seatLabel).toBeNull();
    expect(groupDisplayName(groupIdentityOf(s), "박강사")).toBe("박강사");
  });
});
