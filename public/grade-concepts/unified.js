const navLinks = [...document.querySelectorAll('.section-nav a')];
const sections = [...document.querySelectorAll('.screen-section')];
const observer = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
  if (!visible.length) return;
  const id = visible[0].target.id;
  navLinks.forEach((link) => link.classList.toggle('active', link.hash === `#${id}`));
}, { rootMargin: '-85px 0px -65% 0px' });
sections.forEach((section) => observer.observe(section));

const recordRows = [...document.querySelectorAll('.score-table tbody tr')];
const typeFilter = document.querySelector('#type-filter');
const subjectFilter = document.querySelector('#subject-filter');
const typeButtons = [...document.querySelectorAll('.segmented button')];
const fromInput = document.querySelector('#period-from');
const toInput = document.querySelector('#period-to');
const showMissing = document.querySelector('#show-missing');

function filterRecords() {
  const type = typeFilter.value;
  const subject = subjectFilter.value;
  const from = fromInput.value;
  const to = toInput.value;
  let shown = 0;
  recordRows.forEach((row) => {
    const date = row.dataset.date;
    const inPeriod = date ? (!from || date >= from) && (!to || date <= to) : showMissing.checked;
    const rowSubject = row.querySelector('.class-cell').textContent.includes('영어') ? '영어' : '수학';
    const visible = inPeriod && (type === 'all' || row.dataset.type === type) && (subject === '전체' || subject === rowSubject);
    row.hidden = !visible;
    if (visible) shown++;
  });
  document.querySelector('#record-count').textContent = `${shown}개 기록`;
  typeButtons.forEach((button) => button.classList.toggle('active', button.dataset.type === type));
}

typeFilter.addEventListener('change', filterRecords);
subjectFilter.addEventListener('change', filterRecords);
fromInput.addEventListener('change', filterRecords);
toInput.addEventListener('change', filterRecords);
showMissing.addEventListener('change', filterRecords);
typeButtons.forEach((button) => button.addEventListener('click', () => {
  typeFilter.value = button.dataset.type;
  filterRecords();
}));
recordRows.forEach((row) => {
  const dateInput = row.querySelector('td:first-child input[type=date]');
  const scoreInput = row.querySelector('.score-entry');
  dateInput?.addEventListener('change', () => {
    row.dataset.date = dateInput.value;
    row.classList.toggle('missing-row', !dateInput.value || (scoreInput && !scoreInput.value));
    filterRecords();
  });
  scoreInput?.addEventListener('input', () => {
    row.classList.toggle('missing-row', !dateInput.value || !scoreInput.value);
  });
  const checkbox = row.querySelector('.consult input[type=checkbox]');
  const consultDate = row.querySelector('.consult input[type=date]');
  checkbox?.addEventListener('change', () => {
    consultDate.hidden = !checkbox.checked;
    if (!checkbox.checked) consultDate.value = '';
    if (checkbox.checked) consultDate.showPicker?.();
  });
});
filterRecords();

const students = {
  seo: { name: '김서아', meta: '중등 수학 A 월·수 · 중등 수학 심화 금 / 담임 최민정', score: '66점', previous: '78점', delta: '↓12', consultation: '9월 22일', path: 'M0 75L125 67L250 56L375 88L500 54L640 120', y: 120, timeline: [['09.22','성적 상담','월말평가 하락 관련 상담 기록','consultation'],['09.21','월말평가 66점 ↓12','직전 월말평가 78점','monthly-dot'],['08.26','월말평가 78점 ↑4','직전 월말평가 74점','monthly-dot'],['07.18','내신 82점','같은 카테고리 이전 점수와 비교','school-dot']] },
  lee: { name: '이하은', meta: '중등 수학 C 월·목 / 담임 서유진', score: '91점', previous: '84점', delta: '↑7', consultation: '기록 없음', path: 'M0 133L125 119L250 105L375 89L500 70L640 42', y: 42, timeline: [['09.19','내신 91점 ↑7','직전 내신 84점','school-dot'],['08.23','월말평가 88점 ↑5','직전 월말평가 83점','monthly-dot'],['07.15','내신 84점 ↑4','직전 내신 80점','school-dot']] },
  kang: { name: '강민재', meta: '초등 수학 A 월·수 / 담임 최민정', score: '83점', previous: '79점', delta: '↑4', consultation: '기록 없음', path: 'M0 117L125 112L250 96L375 107L500 88L640 75', y: 75, timeline: [['09.13','월말평가 83점 ↑4','직전 월말평가 79점','monthly-dot'],['08.20','월말평가 79점 ↑3','직전 월말평가 76점','monthly-dot'],['07.16','일일테스트 18/20','수업 중 확인','school-dot']] }
};
document.querySelector('#student-picker').addEventListener('change', (event) => {
  const student = students[event.target.value];
  document.querySelector('#student-name').textContent = `${student.name}의 성적 흐름`;
  document.querySelector('#student-meta').textContent = student.meta;
  document.querySelector('#student-score').textContent = student.score;
  document.querySelector('#student-previous').textContent = student.previous;
  document.querySelector('#student-consult').textContent = student.consultation;
  const delta = document.querySelector('#student-delta');
  delta.textContent = student.delta;
  delta.className = `${student.delta.startsWith('↑') ? 'positive' : 'negative'} strong-delta`;
  document.querySelector('#student-line').setAttribute('d', student.path);
  document.querySelector('#student-area').setAttribute('d', `${student.path}V170H0Z`);
  document.querySelector('#student-dot').setAttribute('cy', student.y);
  document.querySelector('#student-timeline').innerHTML = student.timeline.map(([date,title,detail,tone]) => `<div><time>${date}</time><span class="timeline-dot ${tone}"></span><p><b>${title}</b><small>${detail}</small></p></div>`).join('');
});

const classes = {
  a: {name:'중등 수학 A',info:'월·수 · 22명 · 최민정',average:'89점',delta:'↑5점',completion:'95%',insight:'평균이 세 달 연속 상승했습니다. 최근 하락 학생 2명을 확인해 주세요.',heights:[41,48,56,62,76,89]},
  b: {name:'중등 수학 B',info:'화·목 · 18명 · 이세영',average:'73점',delta:'↓4점',completion:'83%',insight:'전월 대비 4점 하락했습니다. 확인테스트 누락과 하락 학생을 확인해 주세요.',heights:[61,67,71,78,77,73]},
  c: {name:'중등 수학 C',info:'월·목 · 20명 · 서유진',average:'84점',delta:'↑3점',completion:'100%',insight:'입력은 모두 완료됐고 평균은 지난달보다 3점 상승했습니다.',heights:[65,69,72,74,81,84]},
  d: {name:'초등 수학 6A',info:'화·목 · 16명 · 최민정',average:'82점',delta:'↑2점',completion:'94%',insight:'평균은 소폭 상승했습니다. 미입력 기록 1건을 확인해 주세요.',heights:[66,68,74,73,80,82]}
};
document.querySelectorAll('.class-row').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.class-row').forEach((row) => row.classList.toggle('selected', row === button));
  const selected = classes[button.dataset.class];
  document.querySelector('#class-name').textContent = selected.name;
  document.querySelector('#class-info').textContent = selected.info;
  document.querySelector('#class-average').textContent = selected.average;
  document.querySelector('#class-completion').textContent = selected.completion;
  document.querySelector('#class-insight').textContent = selected.insight;
  const delta = document.querySelector('#class-delta');
  delta.textContent = selected.delta;
  delta.className = selected.delta.startsWith('↑') ? 'positive' : 'negative';
  document.querySelectorAll('.mini-trend i').forEach((bar, index) => bar.style.height = `${selected.heights[index]}%`);
}));

document.querySelectorAll('.heat[data-cohort]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('.heat').forEach((cell) => cell.classList.toggle('selected', cell === button));
  const [name, count, average, delta] = button.dataset.cohort.split('|');
  document.querySelector('#cohort-name').textContent = name;
  document.querySelector('#cohort-size').textContent = `${count} · 수학 평균`;
  document.querySelector('#cohort-average').textContent = average;
  const change = document.querySelector('#cohort-delta');
  change.textContent = `${delta} 이전 대비`;
  change.className = delta.startsWith('↑') ? 'positive' : 'negative';
}));
