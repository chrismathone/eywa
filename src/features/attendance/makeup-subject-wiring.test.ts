import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// 원스크린 화면 + 옮겨 낸 훅(P3-O)을 한 덩어리로 읽는다 — 화면에서 코드를 옮겨도 같은 단언이 선다.
import { readOnescreenScreen } from "../onescreen/components/onescreen-screen-source.test-util";

/**
 * 구조 가드 — **보강 후보는 그 반 과목으로 좁힌다**(원장 제보 2026-08-19: 수학 반에서 보강을 추가하는데
 * 영어 반 결석이 후보로 떴다. 잘못 고르면 영어 결석 칸에 수학 보강 메모가 간다).
 *
 * 진입점이 셋이라 **하나만 빠져도 그 화면에서만 옛 동작이 남는다** — 여기서 세 곳을 함께 잠근다.
 * (선례: `makeup-ask-wiring.test.ts` · `src/lib/auth/teacher-home-wiring.test.ts`)
 */
const read = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

/** 주석 속 예시 문자열을 빼고 **실행되는 줄**만 본다(문서에 적힌 이름이 가드를 속이지 않게). */
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
    })
    .join("\n");

describe("보강 후보 조회는 **앵커 반 id**를 함께 넘긴다 — 세 진입점 전부", () => {
  it("반별 출석부(월간 → 반 입력폼)", () => {
    // 라우트 param classId = 지금 보강을 넣는 반.
    expect(code(read("app/(shell)/attendance/[date]/[classId]/input-form.tsx"))).toContain(
      "fetchMakeupAbsences(picked.id, date, classId)",
    );
  });

  it("ECS·공용 흐름(MakeupAddFlow)", () => {
    expect(code(read("features/attendance/components/makeup-add-flow.tsx"))).toContain(
      "fetchMakeupAbsences(s.id, date, classId)",
    );
  });

  it("강사 원스크린 — 반 필터 앵커를 **모든** 갈래에서 넘긴다", () => {
    const client = code(readOnescreenScreen());
    expect(client).toContain("fetchMakeupAbsences(studentId, activeDate, anchorClassId)");
    // 🔴 '목록에 없던 학생 · 합칠 후보 있음 · 후보 없음' 세 갈래가 **모두** 앵커를 넘겨야 한다.
    //    ⚠️ 개수만 세면 나중에 생긴 네 번째 갈래가 `loadAbsences(studentId, null)`로 통과한다 —
    //       **호출을 전수로 뽑아 하나하나** 본다(정의부는 타입이 붙어 있어 자연히 빠진다).
    const calls = client.match(/void loadAbsences\([^;]*\);/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
    // 2번째 인자가 **앵커에서 온 값**이어야 한다 — `null`·상수를 넘기면 그 갈래만 조용히 안 걸린다.
    for (const call of calls) expect(call).toContain("anchorId");
  });

  it("🔴 반 필터가 '전체'여도 **합칠 후보가 있으면** 그 반으로 좁힌다 — 이 경로는 결석분을 실제로 쓴다", () => {
    // linkMakeupAbsence는 앵커 없이도 choice.absentClassId 칸에 메모를 붙인다 → 안 좁히면 수학 보강이
    // 영어 결석 칸에 메모를 남긴다(고치려던 사고 그대로).
    const client = code(readOnescreenScreen());
    expect(client).toContain("anchorId ?? candidateAnchorClassId(plan.candidates)");
    // ⚠️ 후보가 두 과목이면 안 좁힌다(겸직 강사에서 다른 과목 결석이 통째로 사라진다).
    expect(client).toContain("return keys.size === 1 ? (candidates[0]?.classId ?? null) : null;");
  });

  it("🔴 응답 순서 가드가 있다 — 같은 학생을 **다른 앵커**로 다시 열면 옛 응답이 새 창을 덮는다", () => {
    // 과목 필터 전엔 두 응답이 같아서 안 보이던 레이스다(학생 id 비교만으론 못 거른다).
    // 늦게 온 수학 목록이 영어 창을 덮으면 화면이 '수학 과목 …'이라고 **틀린 라벨로 단언**한다.
    const client = code(readOnescreenScreen());
    expect(client).toContain("const mine = ++absenceSeq.current;");
    expect(client).toContain("if (mine !== absenceSeq.current) return;");
  });
});

describe("🔴 과목은 **서버가** 반 id로 읽는다 — 클라가 준 과목 문자열을 믿지 않는다", () => {
  const action = read("features/attendance/server/makeup-actions.ts");
  const query = read("features/attendance/server/makeup-options.ts");

  it("서버 액션은 **클라에서 과목을 받지 않는다** — 반 id만 받고 나머지는 세션에서 읽는다", () => {
    const body = code(action);
    expect(body).toContain("anchorClassId?: string | null");
    // 🔴 인자 목록에 과목이 없어야 한다 — 클라가 과목을 주기 시작하면 그 반과 무관한 과목으로 목록을 연다.
    //    ⚠️ 2026-09-02부터 **앵커가 없을 때의 폴백**으로 강사 과목을 쓰는데, 그 값도 클라가 아니라
    //    세션(`effectiveTeacherScope`)에서 읽는다 — 규칙은 "클라를 믿지 않는다"로 그대로다.
    const params = body.slice(body.indexOf("fetchMakeupAbsences("), body.indexOf("): Promise<"));
    expect(params).not.toContain("subject");
    expect(body).toContain("effectiveTeacherScope()");
    expect(body).toContain(
      "getMakeupAbsenceOptions(studentId, makeupDate, anchorClassId ?? null, teacherSubjects, deadline)",
    );
  });

  it("🔴 보강 기한(결석한 달의 다음 달 말일)도 **세션**이 정한다 — 강사뷰만(원장 2026-09-18)", () => {
    const body = code(action);
    const params = body.slice(body.indexOf("fetchMakeupAbsences("), body.indexOf("): Promise<"));
    // 클라가 "기한 없이"를 요청할 수 있으면 강사뷰가 1년치를 다시 연다.
    expect(params).not.toContain("deadline");
    expect(body).toContain('const deadline = (await getShellView()) === "teacher";');
    // 쓰기 문도 같은 판정 — 목록에서 뺀 결석을 '직접 입력'이나 다른 문으로 되살리지 못한다(#77).
    const gate = code(read("features/attendance/server/makeup-deadline-gate.ts"));
    expect(gate).toContain('if ((await getShellView()) !== "teacher") return null;');
    // 🔴 보강을 결석에 잇는 쓰기 문 **셋 다** 같은 함수를 지난다(재리뷰 2026-09-18 — 분리 보강 연결이 빠져 있었다).
    for (const file of [
      "features/attendance/server/makeup-note-action.ts",
      "features/attendance/server/actions.ts",
      "features/onescreen/server/makeup-register-actions.ts",
    ]) {
      expect(code(read(file)), file).toContain("await makeupDeadlineError(");
    }
  });

  it("조회부가 `classes.subject`를 직접 읽어 기준으로 삼는다", () => {
    const body = code(query);
    expect(body).toContain('.from("classes")');
    expect(body).toContain('.select("subject")');
    expect(body).toContain("buildAbsenceOptions(raw, makeupDate, current, anchorSubject, teacherSubjects, { deadline })");
  });

  it("🔴 앵커가 있으면 강사 과목 폴백은 **무시된다**(앵커가 더 정확한 기준이다)", () => {
    const pure = code(read("features/attendance/makeup-options.ts"));
    expect(pure).toMatch(/anchor\s*\?\s*subjectMatchesAnchor\(anchor, f\.subject\)/);
    expect(pure).toContain("subjectMatchesTeacher(teacherSubjects, f.subject)");
    // 액션도 앵커가 있으면 폴백을 아예 안 읽는다(추가 조회 0).
    expect(code(action)).toContain("anchorClassId ? null : ((await effectiveTeacherScope())?.subjects ?? null)");
  });

  it("결석 행 임베드가 과목까지 가져온다(FK 힌트는 그대로 — #94)", () => {
    expect(code(query)).toContain(
      "classes!attendance_records_class_id_classes_id_fk(class_name, subject)",
    );
  });
});

describe("🔴 후보가 **사라져서** 보강을 못 넣는 일이 없게", () => {
  const pure = read("features/attendance/makeup-options.ts");
  const query = read("features/attendance/server/makeup-options.ts");

  it("판정은 순수 모듈 한 곳(subjectMatchesAnchor) — 화면·서버가 각자 조건을 짜지 않는다", () => {
    expect(code(pure)).toContain("export function subjectMatchesAnchor(");
    expect(code(query)).not.toContain("=== anchorSubject");
  });

  it("🔴 앵커 조회가 어떻게 실패하든 폴백은 '안 거른다' — 예외를 흘리면 목록이 통째로 비어 '결석 없음'이 된다", () => {
    const body = code(query);
    // 권한 밖·삭제된 반(행 없음)
    expect(body).toContain("if (!anchorClassId) return null;");
    // 조회가 터진 경우 — Promise.all이 통째로 실패하지 않게 **그 함수 안에서** 삼킨다(과목·설정 둘 다).
    // ⚠️ 함수 순서·방어 return 추가 같은 무해한 손질에 헛실패하지 않게 위치가 아니라 **모양**으로 본다.
    expect(body.match(/catch \([^)]*\) \{[\s\S]{0,200}?return null;/g) ?? []).toHaveLength(2);
    expect(body).toContain("async function loadSettings(");
  });

  it("🔴 필터가 꺼진 것을 **알 수 있어야** 한다 — 조용히 옛 동작으로 돌아가면 아무도 모른다", () => {
    // supabase-js는 쿼리 실패에 throw하지 않는다 → error를 버리면 흔적이 0이다([[#89]]).
    const body = code(query);
    expect(body).toContain("const { data, error } = await supabase");
    expect(body).toContain("console.error(\"[makeup-options] 앵커 반 과목 조회 실패");
  });
});

describe("왜 비었는지 화면이 말한다 — raw 과목 키는 안 내보낸다", () => {
  const dialog = read("features/attendance/components/makeup-confirm-dialog.tsx");
  const query = read("features/attendance/server/makeup-options.ts");

  it("설정에 없는 키는 라벨로 안 쓴다(`math`·`english`가 화면에 뜨지 않게)", () => {
    // labelOf는 못 찾으면 raw 키를 그대로 돌려준다 — 그 경우를 걸러야 한다.
    expect(code(query)).toContain("label !== subject");
    expect(code(query)).toContain("buildSubjectMaps(settings.operations.subjects).labelOf(subject)");
  });

  it("과목 라벨이 없으면 이름 대신 '이 과목'으로 말한다", () => {
    expect(code(dialog)).toContain('lang === "en" ? "this subject" : text("이 과목")');
  });

  it("0건의 뜻을 가른다 — 과목 때문에 뺐으면 그렇게 알린다", () => {
    const body = code(dialog);
    expect(body).toContain("hiddenBySubject > 0");
    expect(body).toContain("에 메울 결석이 없습니다");
    expect(body).toContain("최근 1년 결석 기록이 없습니다");
  });
});
