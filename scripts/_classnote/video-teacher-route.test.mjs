import { describe, expect, it } from "vitest";
import { chooseVideoTeacher, isJjClass } from "./video-teacher-route.mjs";

const math = { class_id: "math-class", subject: "math", teacher_id: "a", teacher_name: "수학담임", teacher_status: "active" };
const english = { class_id: "english-class", subject: "english", teacher_id: "b", teacher_name: "영어담임", teacher_status: "active" };
const base = { tenantId: "tenant", video: { boardName: "(수학)학생" }, studentIds: ["student"], boardClassIds: [], classes: [math, english] };
describe("영상 담임 분류", () => {
  it("학생 이름이나 글 작성자가 아닌 게시 과목의 담임을 선택한다", () => {
    expect(chooseVideoTeacher(base).teacherId).toBe("a");
    expect(chooseVideoTeacher({ ...base, video: { boardName: "(영어)학생" } }).teacherId).toBe("b");
    expect(chooseVideoTeacher({ ...base, video: { boardName: "[EIE] Let's Talk 5 (월수목 14:20~16:20)" } }).teacherId).toBe("b");
    expect(chooseVideoTeacher({ ...base, video: { boardName: "[EIE] Let's Talk 5" }, classes: [english, { ...english, teacher_id: "c" }] }).teacherId).toBeNull();
  });
  it("연결된 반 번호가 있으면 보드명보다 우선한다", () => {
    expect(chooseVideoTeacher({ ...base, boardClassIds: ["english-class"] }).teacherId).toBe("b");
    expect(chooseVideoTeacher({ ...base, boardClassIds: ["closed-class"] }).teacherId).toBeNull();
  });
  it("학생 연결 충돌·누락 또는 알 수 없는 그룹반은 임의 담임에게 보내지 않는다", () => {
    for (const studentIds of [[], ["one", "two"]]) expect(chooseVideoTeacher({ ...base, studentIds }).folderName).toBe("담임 확인 필요");
    expect(chooseVideoTeacher({ ...base, video: { boardName: "미연결 그룹반" } }).teacherId).toBeNull();
  });
  it("같은 과목 복수 담임과 미지정·퇴직 담임은 확인 대상으로 남긴다", () => {
    for (const other of [{ ...math, teacher_id: "c" }, { ...math, teacher_id: null }, { ...math, teacher_status: "inactive" }])
      expect(chooseVideoTeacher({ ...base, classes: [math, other] }).teacherId).toBeNull();
    expect(chooseVideoTeacher({ ...base, classes: [math, math] }).teacherId).toBe("a");
  });
  it("동명이인 담임은 폴더명에서도 구분한다", () => {
    expect(chooseVideoTeacher({ ...base, classes: [{ ...math, same_name_count: 2, teacher_id: "abcdefgh-1234" }] }).folderName).toBe("수학담임 선생님 (abcdefgh)");
  });
  it("1인 보드 글은 JJ 반을 빼고 남은 반의 담임으로 보낸다", () => {
    const regular = { ...math, class_id: "ms2a", class_name: "중등M 초6 MS2A", teacher_id: "a" };
    const jj = { ...math, class_id: "jj2a", class_name: "중등M 초6 JJ2A", teacher_id: "j", teacher_name: "JJ담임" };
    for (const name of ["중등M 개별 JJ2K", "초등M 초5 JJ1A", "중등M 중2 JJPS"]) expect(isJjClass(name)).toBe(true);
    for (const name of ["중등M 초6 MS2A", "[EIE] Junior Plus 2", "고등M 개별 토", null]) expect(isJjClass(name)).toBe(false);
    // 정규반 + JJ 반(담임이 다르다) → 정규반 담임·정규반 이름
    expect(chooseVideoTeacher({ ...base, classes: [jj, regular, english] })).toMatchObject({ teacherId: "a", classId: "ms2a", className: "중등M 초6 MS2A", folderName: "수학담임 선생님" });
    // 그 과목에 JJ 반뿐이면 그 반을 쓴다
    expect(chooseVideoTeacher({ ...base, classes: [jj, english] })).toMatchObject({ teacherId: "j", classId: "jj2a" });
    // JJ를 빼고도 반이 둘이면 반 이름은 추측하지 않는다 — 담임이 같으면 그 담임 폴더, 다르면 확인 폴더(둘 다 올라가기는 한다)
    const other = { ...regular, class_id: "bs1d", class_name: "초등M 개별 BS1D" };
    const same = chooseVideoTeacher({ ...base, classes: [jj, regular, other] });
    expect(same).toMatchObject({ teacherId: "a", classId: null, className: null, folderName: "수학담임 선생님", studentId: "student" });
    expect(same.reason).toContain("여러 개");
    for (const variant of [{ teacher_id: "c", teacher_name: "다른담임" }, { teacher_id: null }, { teacher_status: "inactive" }]) {
      const held = chooseVideoTeacher({ ...base, classes: [jj, regular, { ...other, ...variant }] });
      expect(held).toMatchObject({ teacherId: null, classId: null, folderName: "담임 확인 필요", studentId: "student" });
      expect(held.reason).toContain("여러 개");
    }
    // 반 보드에 올라온 글은 그 반이 JJ여도 그 반 그대로다(JJ 제외는 1인 보드 글에만)
    expect(chooseVideoTeacher({ ...base, boardClassIds: ["jj2a"], classes: [jj, regular] })).toMatchObject({ teacherId: "j", classId: "jj2a" });
  });
  it("담임이 같더라도 에이와 반이 둘이면 반 이름을 추측하지 않는다", () => {
    const result = chooseVideoTeacher({ ...base, classes: [math, { ...math, class_id: "other-class" }] });
    expect(result.classId).toBeNull();
    expect(result.reason).toContain("여러 개");
  });

  /**
   * 원장 2026-10-06 — 보고서 글에 댓글로 올린 영상은 그 보고서의 숙제다. `report`는 `video-report-link.mjs`가 DB로 확인한 값
   * (이 학생 · 영상 과제 있음 · 반 있음)이고, 여기서는 그 값으로 반과 숙제일이 어떻게 정해지는지를 잠근다.
   */
  it("보고서 글에 올린 영상은 그 보고서의 반 · 숙제일로 간다 — 1인 보드라 반을 못 가르던 학생도 정해진다", () => {
    const regular = { ...math, class_id: "ms2a", class_name: "중등M 초6 MS2A", teacher_id: "a" };
    const other = { ...math, class_id: "bs1d", class_name: "초등M 개별 BS1D", teacher_id: "c", teacher_name: "다른담임" };
    const jj = { ...math, class_id: "jj2a", class_name: "중등M 초6 JJ2A", teacher_id: "j", teacher_name: "JJ담임" };
    const classes = [regular, other, jj, english];
    // 보고서가 없으면 반이 둘이라 보류(반 이름 없음 · 숙제일 없음) — 종전 그대로
    const before = chooseVideoTeacher({ ...base, classes });
    expect(before).toMatchObject({ teacherId: null, classId: null, folderName: "담임 확인 필요" });
    expect(before).not.toHaveProperty("homeworkDate");
    // 그 글의 보고서가 BS1D의 10/6 수업이면 그 반 담임 폴더 + 숙제일
    const pinned = chooseVideoTeacher({ ...base, classes, report: { classId: "bs1d", homeworkDate: "2026-10-06" } });
    expect(pinned).toMatchObject({ teacherId: "c", classId: "bs1d", className: "초등M 개별 BS1D", folderName: "다른담임 선생님", homeworkDate: "2026-10-06" });
    expect(pinned.reason).toContain("보고서 글");
    // JJ 반 보고서 글이면 JJ 반 그대로다(JJ 제외는 반을 모를 때의 규칙)
    expect(chooseVideoTeacher({ ...base, classes, report: { classId: "jj2a", homeworkDate: "2026-10-02" } }))
      .toMatchObject({ teacherId: "j", classId: "jj2a", homeworkDate: "2026-10-02" });
    // 반 보드에 올라온 글이어도 보고서의 반이 앞선다
    expect(chooseVideoTeacher({ ...base, classes, boardClassIds: ["ms2a"], report: { classId: "bs1d", homeworkDate: "2026-10-06" } }))
      .toMatchObject({ classId: "bs1d", homeworkDate: "2026-10-06" });
  });
  it("담임이 비어 있어도 반이 정해졌으면 숙제일은 싣는다 — 폴더만 '담임 확인 필요'", () => {
    const vacant = { ...math, class_id: "ms2a", class_name: "중등M 초6 MS2A", teacher_id: null, teacher_name: null, teacher_status: null };
    expect(chooseVideoTeacher({ ...base, classes: [vacant], report: { classId: "ms2a", homeworkDate: "2026-10-06" } }))
      .toMatchObject({ teacherId: null, folderName: "담임 확인 필요", classId: "ms2a", homeworkDate: "2026-10-06" });
  });
  it("🔴 지금 그 반을 다니지 않으면 보고서를 쓰지 않는다 — 반을 옮긴 뒤 옛 글에 올린 영상은 예전 판정 그대로", () => {
    const moved = chooseVideoTeacher({ ...base, report: { classId: "old-class", homeworkDate: "2026-09-20" } });
    expect(moved).toEqual(chooseVideoTeacher(base));
    expect(moved).not.toHaveProperty("homeworkDate");
    // 학생을 못 정한 영상도 마찬가지 — 보고서가 있어도 숙제일을 싣지 않는다
    expect(chooseVideoTeacher({ ...base, studentIds: [], report: { classId: "math-class", homeworkDate: "2026-10-06" } })).not.toHaveProperty("homeworkDate");
  });
});
