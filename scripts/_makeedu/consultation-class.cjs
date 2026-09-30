/**
 * 원생상담 → **반** 매핑 판정(원장 2026-09-30 *"상담자와 매핑되는 반으로 알아서 스마트하게. 없으면 미매핑. 관리자도 미매핑."*).
 *
 * 한 벌의 판정을 모두가 쓴다 — makeedu 워커(증분·전체·엑셀 부트스트랩)·앱(상담 저장·목록·엑셀 가져오기)·백필 스크립트.
 * 워커가 CommonJS라 이 파일이 원천이고, 앱은 이 파일을 그대로 import한다(`src/features/consultations/class-mapping.ts`).
 * 규칙을 바꿀 땐 **여기 한 곳**만 고친다. 후보를 읽는 SQL은 두 벌(워커 = 아래 `loadClassCandidates`, 앱 = 0318a RPC
 * `consultation_class_candidates`)이라 가드 테스트(`consultation-class.test.ts`)가 두 SQL의 조건을 대조한다.
 *
 * 판정(추측 금지 — 하나로 좁혀질 때만 반을 낸다):
 *   후보 = 상담일(KST)에 그 학생이 수강 중인 반. 수강 창은 동기화의 과목 판정(`loadEnrolledSubjects`)과 같다 —
 *          시작 ≤ 그날, 일반 종료는 그날 포함·반이동 종료는 반열림([[#125]]). 종강 반(closed_at < 그날)은 뺀다.
 *          ⚠️ 폐지 반(is_active=false)은 **빼지 않는다** — 그날 수강이 살아 있었다면 그날의 사실이다(실측 2026-09-30:
 *          빼면 1~6월 상담 171건이 통째로 미매핑. 오늘 열린 폐지 반 수강은 1건뿐이라 새 상담의 선택지는 거의 안 바뀐다).
 *   그 반을 가르치는 사람 = 반 담임(`classes.teacher_id`, **현재 값**) ∪ 그날 살아 있는 교시 담당(`class_schedules.teacher_id`,
 *          valid_from ≤ 그날 ≤ valid_to — 요일 무관). 자리(LAB·JJ) 교시는 teacher_id가 구조적으로 null이라 안 들어온다
 *          (teacher-axis.ts `classTeacherIdsInRange`의 가시성 합집합과 같은 결).
 *   ① 상담사 없음 → 미매핑 ② 그날 수강 반 없음 → 미매핑 ③ 상담사가 가르치는 반 없음(관리자·상담 전담 등) → 미매핑
 *   ④ 상담 과목이 설정 과목으로 풀리면 그 과목 반만 남긴다(0개 → 미매핑) ⑤ 남은 반이 정확히 하나면 그 반, 여럿이면 미매핑.
 *   ⚠️ 과목 글자가 설정 과목이 아니면(자유 입력) 좁히지 않는다 — 반 정보가 아니다.
 *   ⚠️ 담임은 현재 값이다 — 인계 전 날짜의 상담은 새 담임 이름으로 붙을 수 있다(실측 2026-09-30: 1,902건 중 6건).
 *      인계 감사로그는 6월 이후만 있어 그 앞을 되살릴 근거가 없다(teacher-as-of.ts 주석).
 */
const { subjectKeyOf } = require("./consultation-counselor.cjs");

/** 판정 이유 코드 → 한글(로그·감사 metadata·드라이런 보고). */
const CLASS_REASON_LABEL = {
  matched: "반 하나로 좁혀짐",
  no_counselor: "상담사 없음",
  no_enrollment: "그날 수강 반 없음",
  not_teaching: "상담사가 가르치는 반 없음",
  subject_mismatch: "상담 과목과 맞는 반 없음",
  ambiguous: "반이 둘 이상",
};

/**
 * @typedef {{ classId: string, className?: string | null, subject?: string | null, teacherIds?: string[] | null }} ClassCandidate
 * @param {{ counselorId?: string | null, subject?: string | null, labels?: Record<string, string>, candidates?: ClassCandidate[] | null }} input
 * @returns {{ classId: string | null, reason: "matched" | "no_counselor" | "no_enrollment" | "not_teaching" | "subject_mismatch" | "ambiguous" }}
 */
function resolveConsultationClass({ counselorId = null, subject = null, labels = {}, candidates = [] }) {
  const byId = new Map();
  for (const c of candidates || []) if (c && c.classId && !byId.has(c.classId)) byId.set(c.classId, c);
  const list = [...byId.values()];
  if (!counselorId) return { classId: null, reason: "no_counselor" };
  if (list.length === 0) return { classId: null, reason: "no_enrollment" };
  const teaching = list.filter((c) => (c.teacherIds || []).includes(counselorId));
  if (teaching.length === 0) return { classId: null, reason: "not_teaching" };
  const key = subjectKeyOf(subject, labels || {});
  const narrowed = key ? teaching.filter((c) => c.subject === key) : teaching;
  if (narrowed.length === 0) return { classId: null, reason: "subject_mismatch" };
  if (narrowed.length > 1) return { classId: null, reason: "ambiguous" };
  return { classId: narrowed[0].classId, reason: "matched" };
}

/**
 * 저장할 반 결정 — **사람이 고른 값은 자동 판정이 덮지 않는다**(원장 2026-09-30).
 *   · 저장된 출처가 manual이면 그대로(반이 비어 있어도 = 사람이 '미매핑'을 고른 것)
 *   · 그 밖(auto·아직 판정 안 함)이면 새 판정
 * @param {{ stored?: { classId: string | null, source: string | null } | null, judged: { classId: string | null } }} input
 * @returns {{ classId: string | null, source: "auto" | "manual" }}
 */
function keepManualClass({ stored = null, judged }) {
  if (stored && stored.source === "manual") return { classId: stored.classId ?? null, source: "manual" };
  return { classId: judged.classId ?? null, source: "auto" };
}

/**
 * (학생, 상담일) 쌍마다 그날의 반 후보 — 워커·백필용(직접 SQL). 앱은 같은 조건의 0318a RPC를 쓴다.
 * 한 번의 쿼리(unnest)라 쌍이 수백이어도 URL·청크 문제가 없다. 키 = `${studentId}|${YYYY-MM-DD}`.
 * 🔴 조회가 실패하면 **null**(= 판정 못 함)이다 — 빈 Map을 주면 "그날 수강 반 없음 → 미매핑"이라는 거짓 판정이 저장돼
 *    다시는 판정되지 않는다. 워커는 null이면 반을 비운 채 '아직 판정 안 함'으로 적재하고(상담 적재는 멈추지 않는다) 백필은 멈춘다.
 * @returns {Promise<Map<string, ClassCandidate[]> | null>}
 */
async function loadClassCandidates(sql, tenantId, pairs) {
  const uniq = [...new Map((pairs || []).filter((p) => p && p.studentId && p.date).map((p) => [`${p.studentId}|${p.date}`, p])).values()];
  const result = new Map();
  if (uniq.length === 0) return result;
  let rows;
  try {
    rows = await sql`
    select x.sid::text as student_id, x.d::text as on_date, cl.id::text as class_id, cl.class_name, cl.subject,
      array_remove(array_cat(array[cl.teacher_id],
        coalesce((select array_agg(distinct cs.teacher_id) from class_schedules cs
          where cs.tenant_id = ${tenantId} and cs.class_id = cl.id and cs.teacher_id is not null
            and cs.valid_from <= x.d and (cs.valid_to is null or cs.valid_to >= x.d)), '{}')), null)::text[] as teacher_ids
    from unnest(${uniq.map((p) => p.studentId)}::uuid[], ${uniq.map((p) => p.date)}::date[]) as x(sid, d)
    join enrollments e on e.tenant_id = ${tenantId} and e.student_id = x.sid
      and e.start_date <= x.d
      and (e.end_date is null or e.end_date > x.d or (e.end_date = x.d and not coalesce(e.is_transferred, false)))
    join classes cl on cl.id = e.class_id and cl.tenant_id = ${tenantId}
      and (cl.closed_at is null or cl.closed_at >= x.d)`;
  } catch (e) {
    console.warn("그날 반 후보 조회 실패 — 반을 판정하지 않고 계속합니다:", e.message);
    return null;
  }
  for (const r of rows) {
    const key = `${r.student_id}|${r.on_date}`;
    (result.get(key) ?? result.set(key, []).get(key)).push({
      classId: r.class_id,
      className: r.class_name,
      subject: r.subject,
      teacherIds: r.teacher_ids || [],
    });
  }
  return result;
}

/**
 * 0318a(`student_consultations.class_id`·`class_source`)가 DB에 있나 — 워커가 SQL 적용보다 먼저 배포돼도 죽지 않게([[#95]]).
 * 못 읽으면 없다고 본다(반 칸 없이 적재 = 종전 동작).
 */
async function hasClassColumns(sql) {
  try {
    const rows = await sql`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'student_consultations' and column_name in ('class_id', 'class_source')`;
    return rows[0]?.n === 2;
  } catch {
    return false;
  }
}

/**
 * 워커 공용 — 적재할 상담마다 반을 판정해 `it.classId`·`it.classSource`에 적는다(후보 조회는 한 번). 반환 = 이유별 건수(로그·감사용).
 * 후보 조회가 실패하면 판정하지 않는다 — `classSource = null`(아직 판정 안 함)로 두어 목록·백필이 나중에 판정하게 한다.
 * @param {{ studentId: string, date: string, counselorId: string | null, subject: string | null, classId?: string | null, classSource?: string | null }[]} items
 */
async function assignClasses(sql, tenantId, items, labels) {
  const candidates = await loadClassCandidates(sql, tenantId, items.map((it) => ({ studentId: it.studentId, date: it.date })));
  if (!candidates) {
    for (const it of items) {
      it.classId = null;
      it.classSource = null;
    }
    return { "판정 못 함(후보 조회 실패)": items.length };
  }
  const judged = [];
  for (const it of items) {
    const j = resolveConsultationClass({
      counselorId: it.counselorId,
      subject: it.subject,
      labels,
      candidates: candidates.get(`${it.studentId}|${it.date}`) || [],
    });
    it.classId = j.classId;
    it.classSource = "auto";
    judged.push(j);
  }
  return tallyClassReasons(judged);
}

/** 판정 이유별 건수 `{ 한글 이유: 건수 }` — 감사 metadata·로그용. */
function tallyClassReasons(judgements) {
  const out = {};
  for (const j of judgements || []) {
    const label = CLASS_REASON_LABEL[j.reason] || j.reason;
    out[label] = (out[label] || 0) + 1;
  }
  return out;
}

module.exports = {
  resolveConsultationClass,
  keepManualClass,
  loadClassCandidates,
  assignClasses,
  hasClassColumns,
  tallyClassReasons,
  CLASS_REASON_LABEL,
};
