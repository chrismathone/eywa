/**
 * makeedu 상담의 '등록자' 라벨 → 직원, 그리고 상담 과목 판정. 동기화 3경로(증분·전체·엑셀)와 백필이 같이 쓴다.
 *
 * 🔴 추측 금지 — 후보가 둘 이상이면 연결·기입하지 않는다(동명이인에게 남의 상담을 붙이는 것보다 비워 두는 편이 낫다).
 * 이름 해석 규약은 시간표의 닉네임 해석(`src/features/timetable/lib/teacher-label.ts` buildTeacherLabelMap)과 같다:
 * `english_name` = 닉네임, 같은 이름이 여럿이면 **재직자 우선**, 그래도 여럿이면 안 붙인다. (워커가 CommonJS라 TS를
 * require할 수 없어 같은 규칙을 여기 둔다 — 규칙을 바꿀 땐 두 곳을 함께.)
 */

/**
 * 이름 뒤 호칭("선생님"·"쌤"·" T") — 등록자 칸에 붙어 오는 경우가 있다. 원문 그대로 못 찾았을 때만 떼고 다시 본다
 * (`MATT`·`이쌤`처럼 이름 자체가 그 글자로 끝나는 사람을 먼저 살리려고).
 */
const HONORIFIC = /(?:\s+|(?<=[가-힣]))(?:선생님|쌤)$|\s+T$/;

function normName(value) {
  return String(value || "").replace(/[​-‍﻿]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** 값 → 후보 목록. 후보가 여럿이면 재직자만 남기고, 그래도 여럿이면 null(모호). */
function candidateIndex(users, key) {
  const map = new Map();
  for (const user of users) {
    const value = normName(user[key]);
    if (!value) continue;
    (map.get(value) ?? map.set(value, []).get(value)).push(user);
  }
  return (value) => {
    const cands = map.get(normName(value));
    if (!cands || cands.length === 0) return undefined; // 없음
    if (cands.length === 1) return cands[0];
    const active = cands.filter((u) => u.status === "active");
    return active.length === 1 ? active[0] : null; // null = 모호
  };
}

function makeCounselorMatcher(users) {
  const byDisplay = candidateIndex(users, "display_name");
  const byEnglish = candidateIndex(users, "english_name");
  const match = (label) => {
    if (!label) return null;
    const direct = byDisplay(label);
    if (direct !== undefined) return direct; // 찾았거나(행) 모호(null)

    // makeedu는 `송지혜 Jennifer`·`이지은(Amy)`·`조희연 (Hailey)`, 반대 순서 `Jennifer 송지혜`·`Jennifer(송지혜)`도 쓴다.
    // 한글 이름이 기준 — 영문 별칭은 users와 달라도 된다(원어민 닉네임이 바뀐 경우). 한글 이름이 있는데
    // 직원에 없으면 **영문으로 넘어가지 않는다**(다른 사람의 같은 영문 닉네임에 붙을 수 있다).
    const ko = "([가-힣]+(?:\\s+[가-힣]+)*)";
    const en = "([A-Za-z][A-Za-z .'-]*?)";
    const m =
      label.match(new RegExp(`^${ko}\\s*[（(]\\s*${en}\\s*[）)]$`)) ||
      label.match(new RegExp(`^${ko}\\s+${en}$`));
    const r =
      label.match(new RegExp(`^${en}\\s*[（(]\\s*${ko}\\s*[）)]$`)) ||
      label.match(new RegExp(`^${en}\\s+${ko}$`));
    const korean = m ? m[1] : r ? r[2] : null;
    const english = m ? m[2] : r ? r[1] : null;
    if (korean) {
      const hit = byDisplay(korean);
      if (hit) return hit;
      if (hit === null && english) {
        // 동명이인 한글 이름 → 영문 별칭이 그중 **한 명과만** 맞으면 그 사람.
        const narrowed = users.filter((u) => normName(u.display_name) === normName(korean) && normName(u.english_name) === normName(english));
        return narrowed.length === 1 ? narrowed[0] : null;
      }
      return null;
    }
    return byEnglish(label) || null;
  };
  return (registrant) => {
    const label = String(registrant || "").replace(/[​-‍﻿]/g, "").trim().replace(/\s+/g, " ");
    const hit = match(label);
    if (hit || !HONORIFIC.test(label)) return hit;
    return match(label.replace(HONORIFIC, "").trim());
  };
}

function registrantFromSummary(summary) {
  const lines = String(summary || "").split(/\r?\n/).map((line) => line.replace(/[​-‍﻿]/g, "").trim()).filter(Boolean);
  const dateLine = lines.findIndex((line) => /^20\d\d년\s+\d{1,2}월\s+\d{1,2}일$/.test(line));
  return dateLine >= 0 ? lines[dateLine + 1] || null : null;
}

/**
 * 학원설정 과목 `{key: label}`. 설정이 비어 있을 때만 기본 과목(DEFAULT_SETTINGS와 같은 셋)으로 폴백한다 —
 * 설정이 있으면 **설정만**(삭제한 과목이 동기화로 되살아나지 않게).
 */
async function loadSubjectLabels(sql, tenantId) {
  const rows = await sql`select data #> '{operations,subjects}' as subjects from tenant_settings where tenant_id = ${tenantId}`;
  const labels = {};
  for (const item of rows[0]?.subjects || []) {
    if (item?.key && item?.label) labels[item.key] = item.label;
  }
  return Object.keys(labels).length
    ? labels
    : { math: "수학", english: "영어", science: "과학", korean: "국어" };
}

/** 원천 과목 글자 → 설정 과목 키. 키(`math`)·라벨(`수학`)·공백 차이만 허용, 그 밖은 null(추측 금지). */
function subjectKeyOf(text, labels) {
  const t = String(text || "").replace(/\s+/g, "").toLowerCase();
  if (!t) return null;
  for (const [key, label] of Object.entries(labels)) {
    if (key.toLowerCase() === t || String(label).replace(/\s+/g, "").toLowerCase() === t) return key;
  }
  return null;
}

/**
 * 상담 과목 판정(순수) — 근거가 하나로 좁혀질 때만 과목을 낸다.
 *  1) 원천에 과목 글자가 있고 설정 과목과 맞으면 그것             → reason "source"
 *  2) 상담사 담당 과목(설정에 있는 것)이 하나                    → "counselor_single"
 *     🔴 단 그날 학생 수강 과목을 알고 있는데 그 과목이 없으면 비운다(수학 강사가 영어만 듣는 학생을 상담 — 수학을 박지 않는다).
 *  3) 상담사 담당 과목이 여럿 → 그날 학생 수강 과목과 교집합이 하나 → "counselor_enrollment_overlap"
 *  4) 상담사를 모르거나 담당 과목이 없음 → 그날 학생 수강 과목이 하나 → "student_single_enrollment"
 *  그 밖(교집합 0·2+, 수강 과목 2+)은 null.
 * @returns {{ key: string, label: string, reason: string } | null}
 */
function resolveConsultationSubject({ sourceSubject = null, counselor = null, enrolledSubjects = [], labels }) {
  const out = (key, reason) => ({ key, label: labels[key], reason });
  const fromSource = subjectKeyOf(sourceSubject, labels);
  if (fromSource) return out(fromSource, "source");
  const staff = [...new Set((counselor?.subjects || []).filter((k) => labels[k]))];
  const enrolled = [...new Set((enrolledSubjects || []).filter((k) => labels[k]))];
  if (staff.length === 1) {
    return enrolled.length === 0 || enrolled.includes(staff[0]) ? out(staff[0], "counselor_single") : null;
  }
  if (staff.length > 1) {
    const overlap = staff.filter((k) => enrolled.includes(k));
    return overlap.length === 1 ? out(overlap[0], "counselor_enrollment_overlap") : null;
  }
  return enrolled.length === 1 ? out(enrolled[0], "student_single_enrollment") : null;
}

/** 옛 호출부 호환 — 상담사 담당 과목이 하나일 때의 라벨. 새 코드는 resolveConsultationSubject. */
function singleCounselorSubject(user, labels) {
  const subjects = user?.subjects;
  if (!Array.isArray(subjects) || subjects.length !== 1) return null;
  return labels[subjects[0]] || null;
}

/**
 * (학생, 상담일) 쌍마다 그날 수강 중인 반의 과목 키. 키 = `${studentId}|${YYYY-MM-DD}`.
 * 한 번의 쿼리(unnest)로 — 쌍이 수백이어도 URL·청크 문제 없음(직접 SQL).
 * 그날 수강 = 시작 ≤ 그날, 종료는 일반 종료면 그날 포함·반이동이면 반열림(isEnrollmentEndedOn과 같은 규약, [[#125]]).
 * 조회가 실패하면 빈 Map(= 수강 근거 없음)으로 두고 동기화는 계속한다 — 과목 판정 보조 때문에 상담 적재가 멈추면 안 된다.
 */
async function loadEnrolledSubjects(sql, tenantId, pairs) {
  const uniq = [...new Map(pairs.filter((p) => p.studentId && p.date).map((p) => [`${p.studentId}|${p.date}`, p])).values()];
  const result = new Map();
  if (uniq.length === 0) return result;
  let rows;
  try {
    rows = await sql`
    select x.sid::text as sid, x.d::text as d,
      array_agg(distinct cl.subject) filter (where cl.subject is not null) as subjects
    from unnest(${uniq.map((p) => p.studentId)}::uuid[], ${uniq.map((p) => p.date)}::date[]) as x(sid, d)
    join enrollments e on e.tenant_id = ${tenantId} and e.student_id = x.sid
      and e.start_date <= x.d
      and (e.end_date is null or e.end_date > x.d or (e.end_date = x.d and not coalesce(e.is_transferred, false)))
    join classes cl on cl.id = e.class_id and cl.tenant_id = ${tenantId}
    group by 1, 2`;
  } catch (e) {
    console.warn("그날 수강 과목 조회 실패 — 수강 근거 없이 과목을 판정합니다:", e.message);
    return result;
  }
  for (const r of rows) result.set(`${r.sid}|${r.d}`, r.subjects || []);
  return result;
}

/** 이유 코드 → 한글(로그·감사 metadata 표시용). */
const SUBJECT_REASON_LABEL = {
  source: "원천 과목",
  counselor_single: "상담사 담당 과목 하나",
  counselor_enrollment_overlap: "상담사 담당 ∩ 학생 수강 과목 하나",
  student_single_enrollment: "학생 수강 과목 하나",
};

module.exports = {
  makeCounselorMatcher,
  registrantFromSummary,
  loadSubjectLabels,
  singleCounselorSubject,
  resolveConsultationSubject,
  subjectKeyOf,
  loadEnrolledSubjects,
  SUBJECT_REASON_LABEL,
};
