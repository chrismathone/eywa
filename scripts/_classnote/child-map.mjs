/**
 * scripts/_classnote/child-map.mjs — ClassNote **원아(child) ↔ eywa 학생** 확정의 순수 로직(IO 없음 · Vitest).
 *
 * 왜 필요한가(2026-08-06): 인바운드(학부모 글·댓글) 매핑이 지금은 **보드명**(`(수학)홍길동`) 기준이라
 * 1인 보드에서만 통한다. 그런데 영어는 **그룹반**(`[EIE] Let's Speak 6 …`)이라 보드명에 학생이 없고,
 * 재원 341명 중 **영어만 다니는 학생이 149명(44%)** 이다 — 셔틀·출결 용도로는 절반이 빈 명단이 된다.
 *
 * 실측이 준 해법: 피드 행에 **`child`(원아 id)가 그룹반 포함 100%** 실려 있다(학부모 글 43건 전건).
 * 그래서 매핑을 이름이 아니라 **원아 id**로 옮기고, 그 id를 학생에 한 번 붙여 둔다
 * (`students.classnote_child_id`, 0184a).
 *
 * 확정 근거 3겹(2026-08-06 실측 474명 중 461명 = 97%):
 *   ① 보호자 전화(`admissioninfos.basic_info.carer1/2_phone`) — 형제가 같은 번호를 공유해 후보가 여럿일 수 있다
 *   ② 원아명 ↔ eywa 유효이름(동명이인 접미사 A~G까지 포함) — 형제를 가르는 축
 *   ③ 생년 ↔ 학년(±1) — ①②로도 안 갈릴 때의 마지막 축
 * 경로별 실측: 전화유일 276 · 전화+이름 170 · 이름유일 12 · 이름+생년 2 · 미확정 13.
 *
 * 🔴 **전화는 대조에만 쓰고 어디에도 남기지 않는다** — 로그·DB·화면 금지(classnote-integration.md §11 경고).
 *    이 모듈은 전화를 **받아서 비교만** 하고, 돌려주는 건 학생 id와 "어떤 근거로 맞췄나"뿐이다.
 * 🔴 **애매하면 확정하지 않는다.** 잘못 붙이면 남의 집 연락이 그 학생 이름으로 뜬다 — 미확정은
 *    "아직 모른다"로 남기는 게 언제나 낫다(퇴원 동명이인 사고의 교훈, parent-post-filter.mjs 주석 참조).
 */
import { expectedBirthYear } from "./board-safety.mjs";
import { childIdentityKeys, matchesIdentity, studentIdentityKeys } from "./identity-keys.mjs";

/**
 * 전화 비교 키 — 숫자만 남기고 국가번호(82)를 0으로 되돌린다.
 * 하이픈·공백·`+82-10-…` 표기가 양쪽에서 제각각이라 원문 비교는 대부분 빗나간다.
 * @param {unknown} raw
 * @returns {string} 비교 불가(10자리 미만)면 빈 문자열
 */
export function phoneKey(raw) {
  const d = String(raw ?? "")
    .replace(/\D/g, "")
    .replace(/^82/, "0");
  return d.length >= 10 ? d : "";
}

/**
 * 원아 1명 → eywa 학생 확정.
 *
 * @param {{ childId: number, name?: string|null, birth?: string|null, phones?: Array<string|null|undefined> }} child
 * @param {Array<{ id: string, name?: string|null, classnote_name?: string|null, grade?: string|null, phones?: Array<string|null|undefined> }>} students
 *   전 학생(퇴원 포함) — ⚠️ 재원만 넘기면 퇴원 동명이인의 원아가 재원 학생에게 잘못 붙는다.
 * @param {{ schoolYear: number }} opts
 * @returns {{ studentId: string, by: "phone"|"phone+name"|"phone+name+birth"|"name"|"name+birth" }
 *          | { studentId: null, why: string }}
 */
export function resolveChildStudent(child, students, { schoolYear }) {
  const list = students ?? [];
  const ck = childIdentityKeys(child?.name ?? "");
  const nameOk = (s) => matchesIdentity(ck, studentIdentityKeys(s?.name ?? "", s?.classnote_name ?? null));
  const birthYear = Number(String(child?.birth ?? "").slice(0, 4));
  const birthOk = (s) => {
    const expected = expectedBirthYear(s?.grade ?? null, schoolYear);
    return !!(expected && birthYear && Math.abs(expected - birthYear) <= 1);
  };

  const wanted = new Set((child?.phones ?? []).map(phoneKey).filter(Boolean));
  const byPhone = wanted.size
    ? list.filter((s) => (s?.phones ?? []).some((p) => wanted.has(phoneKey(p))))
    : [];

  const only = (arr, by) => (arr.length === 1 ? { studentId: arr[0].id, by } : null);

  if (byPhone.length) {
    // 전화가 맞으면 그 집이 맞다 — 남은 문제는 "그 집의 누구냐"(형제)뿐이라 이름·생년으로 좁힌다.
    const named = byPhone.filter(nameOk);
    return (
      only(byPhone, "phone") ??
      only(named, "phone+name") ??
      only(named.filter(birthOk), "phone+name+birth") ?? {
        studentId: null,
        why: `전화후보 ${byPhone.length}명 중 이름일치 ${named.length}명 — 사람이 확인 필요`,
      }
    );
  }

  // 전화가 없거나 어느 학생과도 안 맞는 경우 — 이름만으로는 위험하므로 **유일할 때만** 인정한다.
  const named = list.filter(nameOk);
  return (
    only(named, "name") ??
    only(named.filter(birthOk), "name+birth") ?? {
      studentId: null,
      why: named.length ? `전화 대조 실패 · 같은 이름 ${named.length}명` : "전화 대조 실패 · 이름 일치 0명",
    }
  );
}

/**
 * 전건 계획 — 이미 붙어 있는 매핑은 건드리지 않고(멱등) **새로 확정된 것만** 돌려준다.
 *
 * ⚠️ 한 학생에 두 원아가 붙으려 하면 **둘 다 보류**한다. 유니크 인덱스가 뒤에서 막아주긴 하지만,
 *    막힌 쪽이 조용히 사라지면 "왜 저 아이만 안 오지"를 아무도 못 찾는다 — 여기서 이유를 남긴다.
 *
 * @returns {{ plan: Array<{childId:number, studentId:string, by:string}>, skipped: Array<{childId:number, why:string}> }}
 */
export function planChildMap(children, students, { schoolYear }) {
  const alreadyByChild = new Map();
  const takenByStudent = new Map();
  for (const s of students ?? []) {
    if (s?.classnote_child_id != null) {
      alreadyByChild.set(Number(s.classnote_child_id), s.id);
      takenByStudent.set(s.id, Number(s.classnote_child_id));
    }
  }
  const plan = [];
  const skipped = [];
  const claimed = new Map(); // studentId → childId (이번 계획 안에서의 충돌 감지)
  for (const c of children ?? []) {
    const childId = Number(c?.childId);
    if (!Number.isFinite(childId)) continue;
    if (alreadyByChild.has(childId)) continue; // 이미 붙어 있다 = 할 일 없음
    const r = resolveChildStudent(c, students, { schoolYear });
    if (!r.studentId) {
      skipped.push({ childId, why: r.why });
      continue;
    }
    const existing = takenByStudent.get(r.studentId);
    if (existing != null && existing !== childId) {
      skipped.push({ childId, why: `그 학생엔 이미 다른 원아(${existing})가 붙어 있음` });
      continue;
    }
    const dup = claimed.get(r.studentId);
    if (dup != null) {
      skipped.push({ childId, why: `같은 학생에 원아 ${dup}와 동시 매칭 — 둘 다 보류` });
      const at = plan.findIndex((p) => p.childId === dup);
      if (at >= 0) {
        plan.splice(at, 1);
        skipped.push({ childId: dup, why: `같은 학생에 원아 ${childId}와 동시 매칭 — 둘 다 보류` });
      }
      continue;
    }
    claimed.set(r.studentId, childId);
    plan.push({ childId, studentId: r.studentId, by: r.by });
  }
  return { plan, skipped };
}
