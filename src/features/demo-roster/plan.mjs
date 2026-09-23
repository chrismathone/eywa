/**
 * 데모 지점(slug `demo`) 가상 재원 계획 — 순수 계산. DB에 쓰지 않는다.
 *
 * 네 갈래가 같은 뼈대(영어 100 · 수학 100 · 학교 10 · 타겟 4 · 초3~중3)를 쓰고
 * 배분·반 이름·요일만 다르다. 고른 뒤 넣는 일은 별도다.
 *
 * 🔴 2026-09-19에 뺀 `scripts/seed.ts` 가 아니다. 테넌트를 지우지 않고, 침산(cs)을
 *    대상으로 삼지도 않는다. 학교 이름은 실재 침산 학군이 아닌 가상 이름이다.
 * 교시 시각은 일반판이 물려 받는 평일 8교시(55분, 14:30~)와 같다.
 * 일반판 교시 방식은 교시마다 한 줄이라, 한 수업은 연속 교시 두 행으로 둔다
 * (시간표가 연속 교시를 한 칸으로 묶는다).
 */

const PERIODS = [
  { label: "1교시", start: "14:30", end: "15:25" },
  { label: "2교시", start: "15:25", end: "16:20" },
  { label: "3교시", start: "16:20", end: "17:15" },
  { label: "4교시", start: "17:15", end: "18:10" },
  { label: "5교시", start: "18:20", end: "19:15" },
  { label: "6교시", start: "19:15", end: "20:10" },
  { label: "7교시", start: "20:10", end: "21:05" },
  { label: "8교시", start: "21:05", end: "22:00" },
];

/** 학년별 시간대. 저학년은 하교 직후, 중3은 가장 늦게. 4교시·5교시 사이 휴식(18:10~18:20)은 건너뛴다. */
const BANDS = {
  초3: [0, 1],
  초4: [0, 1],
  초5: [2, 3],
  초6: [2, 3],
  중1: [4, 5],
  중2: [4, 5],
  중3: [6, 7],
};

/** 과목별 100명을 나누는 학년 정원. 초5~중2가 두껍다. 합 100. */
const GRADES = [
  { grade: "초3", kind: "elem", quota: 10 },
  { grade: "초4", kind: "elem", quota: 12 },
  { grade: "초5", kind: "elem", quota: 16 },
  { grade: "초6", kind: "elem", quota: 16 },
  { grade: "중1", kind: "middle", quota: 18 },
  { grade: "중2", kind: "middle", quota: 16 },
  { grade: "중3", kind: "middle", quota: 12 },
];

const SCHOOLS = [
  { id: "hanbit", name: "한빛초", kind: "elem", target: true },
  { id: "saesol", name: "새솔초", kind: "elem", target: true },
  { id: "garam", name: "가람초", kind: "elem", target: false },
  { id: "daon", name: "다온초", kind: "elem", target: false },
  { id: "bada", name: "바다초", kind: "elem", target: false },
  { id: "sollip", name: "솔잎초", kind: "elem", target: false },
  { id: "pureun", name: "푸른중", kind: "middle", target: true },
  { id: "noeul", name: "노을중", kind: "middle", target: true },
  { id: "mirinae", name: "미리내중", kind: "middle", target: false },
  { id: "eunha", name: "은하중", kind: "middle", target: false },
];

const ROOMS = ["1강의실", "2강의실", "3강의실", "4강의실"];

const SURNAMES = ["김", "이", "박", "최", "정", "강", "조", "윤", "장", "임", "한", "오", "서", "신", "권"];
const FEMALE = ["서연", "하은", "지우", "수아", "지민", "하윤", "서윤", "지유", "채원", "수빈", "예은", "다은", "지아", "소율", "하린", "예린", "수연", "민서", "윤서", "채은", "서현", "유진", "나연", "다인", "소은", "가은", "하영", "예나", "지원", "시은"];
const MALE = ["민준", "서준", "도윤", "예준", "시우", "하준", "주원", "지호", "준서", "건우", "우진", "선우", "연우", "유준", "정우", "시윤", "민재", "현우", "지후", "은우", "준혁", "도현", "이안", "태윤", "승우", "지한", "로운", "시후", "윤우", "하율"];
const PARENT_GIVEN = ["미경", "성호", "지연", "민수", "은정", "재훈", "수진", "태호", "현정", "상민"];

const SUBJECT_LABEL = { math: "수학", english: "영어" };

const START = "2026-09-01";

export const SCENARIOS = {
  neighborhood: {
    title: "동네형",
    blurb: "학년마다 수학·영어 한 반. 타겟 학교 4곳이 약 64%. 둘 다 듣는 학생 40명. 수학은 월·수, 영어는 화·목.",
    targetShare: 0.64,
    both: 40,
    classMode: "byGrade",
    days: { math: ["mon", "wed"], english: ["tue", "thu"], flip: false },
  },
  targetHeavy: {
    title: "타겟학교 반",
    blurb: "타겟 학교에 그 학년 수강생이 4명 이상이면 학교 이름 반(한빛초 초5 수학). 학년당 반은 2개까지라 같은 시간대 강의실 4개를 안 넘긴다. 타겟 비중 약 78%. 요일은 동네형과 같다.",
    targetShare: 0.78,
    both: 36,
    classMode: "targetSection",
    minSection: 4,
    days: { math: ["mon", "wed"], english: ["tue", "thu"], flip: false },
  },
  dual: {
    title: "동시수강",
    blurb: "70명이 수학과 영어를 같이 듣는다. 수학은 월·화, 영어는 수·목이라 같은 날 두 과목이 겹치지 않는다. 학년마다 한 반.",
    targetShare: 0.62,
    both: 70,
    classMode: "byGrade",
    days: { math: ["mon", "tue"], english: ["wed", "thu"], flip: false },
  },
  split: {
    title: "반 나눔",
    blurb: "한 학년이 14명 이상이면 A/B로 나눈다. A는 월수 수학·화목 영어, B는 그 반대라 주 4일이 채워진다. 동시수강 학생은 같은 분반을 탄다.",
    targetShare: 0.58,
    both: 48,
    classMode: "split",
    splitAt: 14,
    days: { math: ["mon", "wed"], english: ["tue", "thu"], flip: true },
  },
};

function hamilton(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) throw new Error("가중치 합이 0");
  const raw = weights.map((w) => (total * w) / sum);
  const base = raw.map((x) => Math.floor(x));
  let left = total - base.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < left; k++) base[order[k].i] += 1;
  return base;
}

function schoolQuotas(n, schools, targetShare) {
  let min = 4;
  while (min > 1 && min * schools.length > n) min -= 1;
  if (min * schools.length > n) throw new Error(`학생 ${n}명으로 학교 ${schools.length}곳을 채울 수 없습니다`);
  const counts = schools.map(() => min);
  let left = n - min * schools.length;
  const targetIdx = [];
  const otherIdx = [];
  schools.forEach((s, i) => (s.target ? targetIdx : otherIdx).push(i));
  const targetGoal = Math.round(n * targetShare);
  const targetHave = targetIdx.reduce((s, i) => s + counts[i], 0);
  const toTargets = Math.max(0, Math.min(left, targetGoal - targetHave));
  for (let k = 0; k < toTargets; k++) counts[targetIdx[k % targetIdx.length]] += 1;
  left -= toTargets;
  for (let k = 0; k < left; k++) counts[otherIdx[k % otherIdx.length]] += 1;
  return counts;
}

/**
 * 학년 칸이 빈 학교는, 그 학년에 3명 이상인 학교에서 한 명씩 받는다.
 * 타겟 학교가 비타겟보다 적어지면 그 이동은 하지 않는다.
 */
function fillHoles(matrix, schools) {
  // matrix[학년][학교]. 빈 칸은 같은 학년에서 3명 이상인 학교가 한 명을 넘긴다.
  const schoolTotal = (s) => matrix.reduce((sum, row) => sum + row[s], 0);
  const ok = (donor, recv) => {
    const n = schools.map((_, i) => schoolTotal(i));
    n[donor] -= 1;
    n[recv] += 1;
    for (let t = 0; t < schools.length; t++) {
      if (!schools[t].target) continue;
      for (let o = 0; o < schools.length; o++) {
        if (schools[o].target) continue;
        if (n[t] <= n[o]) return false;
      }
    }
    return true;
  };
  for (let guard = 0; guard < 200; guard++) {
    let grade = -1;
    let recv = -1;
    let donor = -1;
    let bestN = 2;
    for (let g = 0; g < matrix.length; g++) {
      for (let school = 0; school < schools.length; school++) {
        if (matrix[g][school] !== 0) continue;
        for (let d = 0; d < schools.length; d++) {
          if (matrix[g][d] > bestN && ok(d, school)) {
            donor = d;
            recv = school;
            grade = g;
            bestN = matrix[g][d];
          }
        }
      }
    }
    if (grade < 0) break;
    matrix[grade][donor] -= 1;
    matrix[grade][recv] += 1;
  }
  return matrix;
}

/** 학년 인원(행)과 학교 정원(열)을 동시에 맞춘다. 행 합은 이동으로 안 깨진다. */
function spreadMatrix(rowTargets, colTargets) {
  const rows = rowTargets.length;
  const cols = colTargets.length;
  const m = rowTargets.map((r) => hamilton(r, colTargets));
  const colSum = (c) => m.reduce((s, row) => s + row[c], 0);
  for (let guard = 0; guard < 10000; guard++) {
    let over = -1;
    let under = -1;
    for (let c = 0; c < cols; c++) {
      const d = colSum(c) - colTargets[c];
      if (d > 0 && over < 0) over = c;
      if (d < 0 && under < 0) under = c;
    }
    if (over < 0 && under < 0) return m;
    if (over < 0 || under < 0) break;
    let moved = false;
    for (let r = 0; r < rows; r++) {
      if (m[r][over] > 0) {
        m[r][over] -= 1;
        m[r][under] += 1;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  throw new Error("학교·학년 배분이 맞지 않습니다");
}

const GIVEN = [...FEMALE, ...MALE];

export function personName(i) {
  // 15×60 = 900가지. 17은 900과 서로소라 0..159 안에서는 이름·성이 겹치지 않고, 옆 번호와 성·이름이 바로 겹치지도 않는다.
  const idx = (i * 17) % (SURNAMES.length * GIVEN.length);
  const surname = SURNAMES[idx % SURNAMES.length];
  const given = GIVEN[Math.floor(idx / SURNAMES.length)];
  const female = FEMALE.includes(given);
  return { name: surname + given, gender: female ? "female" : "male", surname };
}

/** 학교마다 수학만·영어만으로 치우치지 않게, 과목 인원 합은 유지한 채 맞바꾼다. */
function balanceSubjects(roleGrid) {
  const engOf = (row) => row[0] + row[1];
  const mathOf = (row) => row[0] + row[2];
  const nOf = (row) => row[0] + row[1] + row[2];
  for (let guard = 0; guard < 80; guard++) {
    let changed = false;
    for (let s = 0; s < roleGrid.length; s++) {
      const row = roleGrid[s];
      if (nOf(row) < 4) continue;
      if (engOf(row) === 0) {
        const donor = roleGrid.findIndex((r, i) => i !== s && r[1] >= 2);
        if (donor >= 0 && row[2] >= 1) {
          row[2] -= 1;
          row[1] += 1;
          roleGrid[donor][1] -= 1;
          roleGrid[donor][2] += 1;
          changed = true;
        }
      }
      if (mathOf(row) === 0) {
        const donor = roleGrid.findIndex((r, i) => i !== s && r[2] >= 2);
        if (donor >= 0 && row[1] >= 1) {
          row[1] -= 1;
          row[2] += 1;
          roleGrid[donor][2] -= 1;
          roleGrid[donor][1] += 1;
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  return roleGrid;
}

function daysFor(subject, section, pattern) {
  if (pattern.flip && section === 1) {
    return pattern[subject === "math" ? "english" : "math"];
  }
  return pattern[subject];
}

function clockOf(bandIdxs) {
  const ps = bandIdxs.map((i) => PERIODS[i]);
  return { periods: ps, label: `${ps[0].label}–${ps[ps.length - 1].label}`, clock: `${ps[0].start}–${ps[ps.length - 1].end}` };
}

function toMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

/** 같은 학년 안에서 영어만↔수학만을 바꿔, 4명 이상인 학교가 두 과목을 모두 갖게 한다. */
function nudgeSchoolSubjects(students) {
  const engN = (schoolId, grade) =>
    students.filter((s) => s.school.id === schoolId && (!grade || s.grade === grade) && s.role !== "math").length;
  const mathN = (schoolId, grade) =>
    students.filter((s) => s.school.id === schoolId && (!grade || s.grade === grade) && s.role !== "eng").length;
  for (let guard = 0; guard < 60; guard++) {
    let changed = false;
    for (const school of SCHOOLS) {
      const list = students.filter((s) => s.school.id === school.id);
      if (list.length < 4) continue;
      const needEng = engN(school.id) === 0;
      const needMath = mathN(school.id) === 0;
      if (!needEng && !needMath) continue;
      const want = needEng ? "eng" : "math";
      const have = needEng ? "math" : "eng";
      const victim = list.find((s) => s.role === have);
      if (!victim) continue;
      const donor = students.find(
        (s) =>
          s.grade === victim.grade &&
          s.role === want &&
          s.school.id !== school.id &&
          (want === "eng" ? engN(s.school.id, s.grade) : mathN(s.school.id, s.grade)) >= 2,
      );
      if (!donor) continue;
      victim.role = want;
      donor.role = have;
      changed = true;
    }
    if (!changed) break;
  }
}

function buildPeople(scenario) {
  if (GRADES.reduce((s, g) => s + g.quota, 0) !== 100) throw new Error("학년 정원 합이 100이 아닙니다");
  const bothByGrade = hamilton(scenario.both, GRADES.map((g) => g.quota));
  bothByGrade.forEach((b, i) => {
    if (b > GRADES[i].quota) throw new Error(`${GRADES[i].grade} 동시수강이 정원을 넘습니다`);
  });
  const byKind = { elem: [], middle: [] };
  for (let gi = 0; gi < GRADES.length; gi++) {
    const g = GRADES[gi];
    const only = g.quota - bothByGrade[gi];
    byKind[g.kind].push({ grade: g.grade, kind: g.kind, both: bothByGrade[gi], only, n: bothByGrade[gi] + only * 2 });
  }
  const students = [];
  const ROLES = ["both", "eng", "math"];
  for (const kind of ["elem", "middle"]) {
    const schools = SCHOOLS.filter((s) => s.kind === kind);
    const groups = byKind[kind];
    const quotas = schoolQuotas(
      groups.reduce((s, g) => s + g.n, 0),
      schools,
      scenario.targetShare,
    );
    const matrix = fillHoles(
      spreadMatrix(
        groups.map((g) => g.n),
        quotas,
      ),
      schools,
    );
    groups.forEach((g, ri) => {
      const roleGrid = balanceSubjects(spreadMatrix(matrix[ri], [g.both, g.only, g.only]));
      roleGrid.forEach((counts, si) => {
        counts.forEach((n, roleIdx) => {
          for (let k = 0; k < n; k++) {
            students.push({
              role: ROLES[roleIdx],
              grade: g.grade,
              kind: g.kind,
              school: schools[si],
              section: 0,
            });
          }
        });
      });
    });
  }
  nudgeSchoolSubjects(students);
  students.sort((a, b) => {
    const ga = GRADES.findIndex((g) => g.grade === a.grade);
    const gb = GRADES.findIndex((g) => g.grade === b.grade);
    if (ga !== gb) return ga - gb;
    const sa = SCHOOLS.findIndex((s) => s.id === a.school.id);
    const sb = SCHOOLS.findIndex((s) => s.id === b.school.id);
    if (sa !== sb) return sa - sb;
    const role = { both: 0, eng: 1, math: 2 };
    return role[a.role] - role[b.role];
  });
  students.forEach((s, i) => {
    const named = personName(i);
    s.seq = i;
    s.name = named.name;
    s.gender = named.gender;
    s.parentName = named.surname + PARENT_GIVEN[i % PARENT_GIVEN.length];
    s.parentPhone = `010-5550-${String(i + 1).padStart(4, "0")}`;
    s.code = `DMO-${String(i + 1).padStart(4, "0")}`;
    s.subjects = s.role === "both" ? ["math", "english"] : s.role === "math" ? ["math"] : ["english"];
    s.classes = [];
    s.enrolledAt = START;
  });
  const seen = new Set();
  for (const s of students) {
    const key = `${s.name}|${s.school.name}|${s.grade}`;
    if (seen.has(key) || seen.has(s.name)) throw new Error(`이름 중복 ${s.name}`);
    seen.add(key);
    seen.add(s.name);
    if (s.parentName === s.name) throw new Error("보호자 이름이 학생과 같습니다");
    if ((s.kind === "elem") !== s.grade.startsWith("초")) throw new Error("학교급과 학년이 안 맞습니다");
  }
  for (const g of GRADES) {
    const list = students.filter((s) => s.grade === g.grade);
    for (const role of ["both", "eng", "math"]) {
      list.filter((s) => s.role === role).forEach((s, i) => {
        s.section = i % 2;
      });
    }
  }
  return students;
}

function makeClass(spec, members) {
  const band = clockOf(BANDS[spec.grade]);
  return {
    ...spec,
    members,
    days: spec.days,
    periods: band.periods,
    timeLabel: band.label,
    clock: band.clock,
    room: null,
  };
}

function buildClasses(students, scenario) {
  const classes = [];
  for (const subject of ["math", "english"]) {
    for (const g of GRADES) {
      const roster = students.filter((s) => s.grade === g.grade && s.subjects.includes(subject));
      const label = SUBJECT_LABEL[subject];
      if (scenario.classMode === "targetSection") {
        // 학년당 반 2개까지. 초3·초4처럼 같은 시간대를 나누는 학년 둘이 강의실 4개를 넘지 않게.
        const taken = new Set();
        const named = [];
        for (const school of SCHOOLS.filter((s) => s.kind === g.kind && s.target)) {
          const members = roster.filter((s) => s.school.id === school.id);
          if (members.length >= scenario.minSection) {
            members.forEach((s) => taken.add(s));
            named.push({
              name: `${school.name} ${g.grade} ${label}`,
              schoolId: school.id,
              named: true,
              members: members.slice(),
              folded: 0,
            });
          }
        }
        named.sort((a, b) => b.members.length - a.members.length);
        const rest = roster.filter((s) => !taken.has(s));
        const sections = [];
        if (named.length >= 2 && rest.length < 4) {
          rest.forEach((s) => named[1].members.push(s));
          named[1].folded = rest.length;
          sections.push(named[0], named[1]);
        } else if (named.length >= 1) {
          const overflow = named.slice(1).flatMap((n) => n.members).concat(rest);
          sections.push(named[0]);
          if (overflow.length > 0) {
            sections.push({ name: `${g.grade} ${label}`, schoolId: null, named: false, members: overflow, folded: 0 });
          }
        } else {
          sections.push({ name: `${g.grade} ${label}`, schoolId: null, named: false, members: roster.slice(), folded: 0 });
        }
        sections.forEach((sec, i) => {
          if (sec.members.length === 0) return;
          classes.push(
            makeClass(
              {
                subject,
                grade: g.grade,
                name: sec.name,
                section: i,
                named: sec.named,
                folded: sec.folded ?? 0,
                days: daysFor(subject, 0, scenario.days),
              },
              sec.members,
            ),
          );
        });
      } else if (scenario.classMode === "split" && roster.length >= scenario.splitAt) {
        const buckets = [[], []];
        for (const s of roster) buckets[s.section].push(s);
        if (buckets.some((b) => b.length < 3)) {
          classes.push(
            makeClass(
              {
                subject,
                grade: g.grade,
                name: `${g.grade} ${label}`,
                section: 0,
                named: false,
                folded: 0,
                days: daysFor(subject, 0, scenario.days),
              },
              roster,
            ),
          );
        } else {
          buckets.forEach((members, i) => {
            classes.push(
              makeClass(
                {
                  subject,
                  grade: g.grade,
                  name: `${g.grade} ${label} ${i === 0 ? "A" : "B"}`,
                  section: i,
                  named: false,
                  folded: 0,
                  days: daysFor(subject, i, scenario.days),
                },
                members,
              ),
            );
          });
        }
      } else {
        classes.push(
          makeClass(
            {
              subject,
              grade: g.grade,
              name: `${g.grade} ${label}`,
              section: 0,
              named: false,
              folded: 0,
              days: daysFor(subject, 0, scenario.days),
            },
            roster,
          ),
        );
      }
    }
  }
  const gradeRank = (grade) => GRADES.findIndex((g) => g.grade === grade);
  classes.sort((a, b) => {
    const d = gradeRank(a.grade) - gradeRank(b.grade);
    if (d !== 0) return d;
    if (a.subject !== b.subject) return a.subject === "math" ? -1 : 1;
    return a.section - b.section || a.name.localeCompare(b.name, "ko");
  });
  const used = new Map();
  for (const cls of classes) {
    const room = ROOMS.find((r) =>
      cls.days.every((d) => cls.periods.every((p) => !used.get(`${d}|${p.start}`)?.has(r))),
    );
    if (!room) throw new Error(`강의실이 부족합니다: ${cls.name}`);
    cls.room = room;
    for (const d of cls.days) {
      for (const p of cls.periods) {
        const k = `${d}|${p.start}`;
        if (!used.has(k)) used.set(k, new Set());
        used.get(k).add(room);
      }
    }
    for (const s of cls.members) s.classes.push(cls);
  }
  return classes;
}

function conflictsOf(students) {
  const out = [];
  for (const s of students) {
    const cells = [];
    for (const cls of s.classes) {
      for (const d of cls.days) {
        for (const p of cls.periods) {
          cells.push({ d, start: toMin(p.start), end: toMin(p.end), name: cls.name });
        }
      }
    }
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        if (cells[i].d === cells[j].d && overlaps(cells[i], cells[j])) {
          out.push(`${s.name} ${s.grade} ${cells[i].name} × ${cells[j].name} (${cells[i].d})`);
        }
      }
    }
  }
  return out;
}

function summarize(students, classes, scenario) {
  const eng = students.filter((s) => s.subjects.includes("english")).length;
  const math = students.filter((s) => s.subjects.includes("math")).length;
  const both = students.filter((s) => s.role === "both").length;
  const targetN = students.filter((s) => s.school.target).length;
  const bySchool = SCHOOLS.map((school) => {
    const list = students.filter((s) => s.school.id === school.id);
    return {
      ...school,
      n: list.length,
      math: list.filter((s) => s.subjects.includes("math")).length,
      english: list.filter((s) => s.subjects.includes("english")).length,
      both: list.filter((s) => s.role === "both").length,
    };
  });
  const byGrade = GRADES.map((g) => {
    const list = students.filter((s) => s.grade === g.grade);
    return {
      grade: g.grade,
      n: list.length,
      math: list.filter((s) => s.subjects.includes("math")).length,
      english: list.filter((s) => s.subjects.includes("english")).length,
      both: list.filter((s) => s.role === "both").length,
    };
  });
  const matrix = SCHOOLS.map((school) =>
    GRADES.map((g) => students.filter((s) => s.school.id === school.id && s.grade === g.grade).length),
  );
  const scheduleRows = classes.reduce((s, c) => s + c.days.length * c.periods.length, 0);
  return {
    students: students.length,
    eng,
    math,
    both,
    targetN,
    targetShare: targetN / students.length,
    bySchool,
    byGrade,
    matrix,
    classes: classes.length,
    namedClasses: classes.filter((c) => c.named).length,
    scheduleRows,
    rooms: [...new Set(classes.map((c) => c.room))],
  };
}

function assertPlan(students, classes, scenario, stats, conflicts) {
  const fail = [];
  if (stats.eng !== 100) fail.push(`영어 ${stats.eng}명`);
  if (stats.math !== 100) fail.push(`수학 ${stats.math}명`);
  if (stats.both !== scenario.both) fail.push(`동시수강 ${stats.both} ≠ ${scenario.both}`);
  if (stats.students !== 200 - scenario.both) fail.push(`재원 ${stats.students}`);
  if (stats.bySchool.some((s) => s.n === 0)) fail.push("빈 학교가 있습니다");
  for (const s of stats.bySchool) {
    if (s.n >= 4 && (s.math === 0 || s.english === 0)) fail.push(`${s.name}: 한 과목만`);
  }
  for (const kind of ["elem", "middle"]) {
    const targets = stats.bySchool.filter((s) => s.kind === kind && s.target);
    const others = stats.bySchool.filter((s) => s.kind === kind && !s.target);
    for (const t of targets) {
      for (const o of others) {
        if (t.n <= o.n) fail.push(`${t.name} ${t.n}명이 ${o.name} ${o.n}명보다 많지 않습니다`);
      }
    }
  }
  const drift = Math.abs(stats.targetShare - scenario.targetShare);
  if (drift > 0.04) fail.push(`타겟 비중 ${(stats.targetShare * 100).toFixed(1)}% (목표 ${scenario.targetShare * 100}%)`);
  if (conflicts.length) fail.push(`시간 겹침 ${conflicts.length}건`);
  if (classes.some((c) => c.members.length === 0 || c.members.length > 20)) fail.push("반 인원이 0 또는 20 초과");
  if (scenario.classMode === "targetSection" && stats.namedClasses < 8) {
    fail.push(`학교 이름 반이 ${stats.namedClasses}개뿐입니다`);
  }
  if (scenario.classMode === "split" && !classes.some((c) => c.name.endsWith(" B"))) {
    fail.push("A/B 분반이 없습니다");
  }
  const names = new Set(classes.map((c) => `${c.subject}|${c.name}`));
  if (names.size !== classes.length) fail.push("반 이름 중복");
  if (fail.length) {
    const err = new Error(fail.join("\n"));
    err.failures = fail;
    throw err;
  }
}

export function buildScenario(id) {
  const scenario = SCENARIOS[id];
  if (!scenario) throw new Error(`없는 갈래: ${id}`);
  const students = buildPeople(scenario);
  const classes = buildClasses(students, scenario);
  const conflicts = conflictsOf(students);
  const stats = summarize(students, classes, scenario);
  assertPlan(students, classes, scenario, stats, conflicts);
  return { id, scenario, students, classes, stats, conflicts, periods: PERIODS, grades: GRADES, schools: SCHOOLS, start: START };
}

export const DAY_KO = { mon: "월", tue: "화", wed: "수", thu: "목", fri: "금" };
