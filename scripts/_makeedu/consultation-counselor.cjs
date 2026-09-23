/** Match Makeedu's registrant labels to one tenant's staff without guessing homonyms. */
function uniqueMap(users, key) {
  const map = new Map();
  for (const user of users) {
    const value = String(user[key] || "").trim().toLowerCase();
    if (!value) continue;
    map.set(value, map.has(value) ? null : user);
  }
  return map;
}

function makeCounselorMatcher(users) {
  const byDisplay = uniqueMap(users, "display_name");
  const byEnglish = uniqueMap(users, "english_name");
  return (registrant) => {
    const label = String(registrant || "").trim().replace(/\s+/g, " ");
    if (!label) return null;
    const direct = byDisplay.get(label.toLowerCase());
    if (direct) return direct;

    // Makeedu uses all of 송지혜 Jennifer, 이지은(Amy), 조희연 (Hailey).
    // The Korean staff name is authoritative even when the English alias differs in users.
    const koreanWithAlias = label.match(/^([가-힣]+(?:\s+[가-힣]+)*)\s*(?:[（(]\s*([A-Za-z][A-Za-z .'-]*)\s*[）)]|\s+([A-Za-z][A-Za-z .'-]*))$/);
    if (koreanWithAlias) {
      const korean = byDisplay.get(koreanWithAlias[1].toLowerCase());
      return korean || null;
    }
    return byEnglish.get(label.toLowerCase()) || null;
  };
}

function registrantFromSummary(summary) {
  const lines = String(summary || "").split(/\r?\n/).map((line) => line.replace(/[\u200b-\u200d\ufeff]/g, "").trim()).filter(Boolean);
  const dateLine = lines.findIndex((line) => /^20\d\d년\s+\d{1,2}월\s+\d{1,2}일$/.test(line));
  return dateLine >= 0 ? lines[dateLine + 1] || null : null;
}

async function loadSubjectLabels(sql, tenantId) {
  const rows = await sql`select data #> '{operations,subjects}' as subjects from tenant_settings where tenant_id = ${tenantId}`;
  const labels = { math: "수학", english: "영어", science: "과학" };
  for (const item of rows[0]?.subjects || []) {
    if (item?.key && item?.label) labels[item.key] = item.label;
  }
  return labels;
}

function singleCounselorSubject(user, labels) {
  const subjects = user?.subjects;
  if (!Array.isArray(subjects) || subjects.length !== 1) return null;
  return labels[subjects[0]] || null;
}

module.exports = { makeCounselorMatcher, registrantFromSummary, loadSubjectLabels, singleCounselorSubject };
