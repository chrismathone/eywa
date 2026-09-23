const concepts = [
  { title: "학원 전체를 한눈에 보는 관제 화면", description: "원장이 오늘 먼저 확인할 변화와 미입력 항목을 위에 두고, 시험 유형과 반 추이를 아래로 내려 읽습니다." },
  { title: "점수 입력을 빠르게 끝내는 성적 원장", description: "날짜·점수·직전 기록·상담 여부를 같은 행에서 확인합니다. 긴 반 이름은 잘라 표시하고 마우스를 올리면 전체를 볼 수 있습니다." },
  { title: "한 학생의 변화를 따라가는 성장 기록", description: "학생별 시험 유형을 분리한 추이, 이전 점수와의 차이, 상담 기록을 한 화면에서 이어 봅니다." },
  { title: "반마다 다른 흐름을 비교하는 화면", description: "반별 평균과 상승·하락 학생 수를 작은 그래프에 나란히 놓고, 반을 고르면 긴 추이를 펼칩니다." },
  { title: "학교와 학년의 차이를 찾는 분석 화면", description: "학교×학년 표에서 평균과 변화량을 훑은 뒤, 선택한 집단의 반과 학생을 확인합니다." },
  { title: "시험 일정에서 입력 현황으로 들어가는 화면", description: "기간 검색과 미입력 표시를 일정에 결합해, 날짜별 시험 기록과 남은 입력을 처리합니다." },
];

function showConcept(number, updateHash = true) {
  const n = Math.max(1, Math.min(6, Number(number) || 1));
  document.querySelectorAll(".concept").forEach((screen) => {
    const active = Number(screen.dataset.screen) === n;
    screen.hidden = !active;
    screen.classList.toggle("active", active);
  });
  document.querySelectorAll(".concept-tab").forEach((tab) => {
    const active = Number(tab.dataset.concept) === n;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  document.querySelector("#current-number").textContent = String(n);
  document.querySelector("#concept-title").textContent = concepts[n - 1].title;
  document.querySelector("#concept-description").textContent = concepts[n - 1].description;
  if (updateHash && location.hash !== `#concept-${n}`) history.replaceState(null, "", `#concept-${n}`);
}

document.querySelectorAll(".concept-tab").forEach((tab) => {
  tab.addEventListener("click", () => showConcept(tab.dataset.concept));
  tab.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = ((Number(tab.dataset.concept) - 1 + (event.key === "ArrowRight" ? 1 : 5)) % 6) + 1;
    showConcept(next);
    document.querySelector(`[data-concept="${next}"]`).focus();
  });
});
window.addEventListener("hashchange", () => showConcept(location.hash.match(/concept-(\d+)/)?.[1], false));
showConcept(location.hash.match(/concept-(\d+)/)?.[1], false);

document.querySelectorAll(".seg,.source-pills").forEach((group) => {
  group.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => {
    group.querySelectorAll("button").forEach((other) => other.classList.remove("on", "selected"));
    button.classList.add(group.classList.contains("source-pills") ? "selected" : "on");
  }));
});

const people = {
  서아: { name: "김서아", school: "칠성중2", meta: "중등 수학 A 월·수 · 중등 수학 심화 금 / 담임 최민정", score: "66", delta: "↓12 이전 대비", decline: true },
  하은: { name: "이하은", school: "경명여중1", meta: "중등 수학 C 월·목 / 담임 서유진", score: "91", delta: "↑7 이전 대비", decline: false },
  준호: { name: "박준호", school: "침산중3", meta: "중등 영어 B 화·금 / 담임 정다연", score: "74", delta: "↓8 이전 대비", decline: true },
  민재: { name: "강민재", school: "침산중2", meta: "중등 수학 A 월·수 / 담임 최민정", score: "83", delta: "↑4 이전 대비", decline: false },
};
document.querySelectorAll(".student-option").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".student-option").forEach((other) => other.classList.remove("selected"));
  button.classList.add("selected");
  const person = people[button.dataset.student];
  document.querySelector("#portrait-name").innerHTML = `${person.name} <span>${person.school}</span>`;
  document.querySelector("#portrait-meta").textContent = person.meta;
  document.querySelector("#portrait-score").innerHTML = `${person.score}<small>점</small>`;
  const delta = document.querySelector("#portrait-delta");
  delta.textContent = person.delta;
  delta.className = person.decline ? "down" : "up";
}));

document.querySelectorAll(".class-card").forEach((card) => card.addEventListener("click", () => {
  document.querySelectorAll(".class-card").forEach((other) => other.classList.remove("selected"));
  card.classList.add("selected");
  document.querySelector(".class-detail h3").textContent = card.querySelector(".class-card-head span").textContent;
  document.querySelector(".class-detail .panel-head p").textContent = card.querySelector("p").textContent;
}));

document.querySelectorAll(".heat:not(.blank)").forEach((cell) => cell.addEventListener("click", () => {
  document.querySelectorAll(".heat").forEach((other) => other.classList.remove("selected"));
  cell.classList.add("selected");
  const row = cell.parentElement;
  const grade = document.querySelectorAll(".heat-label b")[[...row.children].indexOf(cell) - 1].textContent;
  const school = row.querySelector("strong").textContent;
  const score = cell.childNodes[0].textContent.trim();
  document.querySelector(".detail-head h3").textContent = `${school} ${grade.replace(/([초중고])(\d)/, "$1학교 $2학년")}`;
  document.querySelector(".cohort-kpis>div:first-child b").textContent = score;
}));
