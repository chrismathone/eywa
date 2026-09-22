const L = require("./lib.cjs");

// 앱의 src/features/students/merged.ts와 같은 판정. CJS 워커는 TS를 읽지 못하므로 동등성 테스트로 잠근다.
function isMergedStudent(notes) {
  return typeof notes === "string" && /^중복 병합:\s*\S+와 통합됨/.test(notes.trimStart());
}

function invoiceStudentMatcher(students) {
  // 실제 퇴원생의 과거 수납은 계속 매칭한다. 중복 병합으로 흡수된 기록만 제외한다.
  const candidates = students.filter((s) => !isMergedStudent(s.notes));
  const byMkid = L.tieredMatcher(candidates, [(s) => s.makeedu_id ? String(s.makeedu_id) : null]);
  const mergedMkids = new Set(students.filter((s) => isMergedStudent(s.notes) && s.makeedu_id).map((s) => String(s.makeedu_id)));
  const byName = L.tieredMatcher(candidates, [
    (s) => `${L.normalizeName(s.name)}|${s.grade || ""}`,
    (s) => L.normalizeName(s.name),
  ]);
  return (line) => {
    const mkid = line.mkid ? String(line.mkid) : null;
    const exact = mkid ? byMkid({ makeedu_id: mkid }) : null;
    if (exact) return exact;
    // 병합된 원생 번호가 명시됐다면 이름만으로 다른 사람에게 수납을 붙이지 않는다.
    if (mkid && mergedMkids.has(mkid)) return null;
    return byName(line);
  };
}

module.exports = { isMergedStudent, invoiceStudentMatcher };
