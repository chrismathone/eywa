import { describe, expect, it } from 'vitest';
import { buildApplyPlan } from './apply-plan';
import { importSource } from './editor/import-source';
import { defaultAppearance } from './editor/appearance';
import { moveClassStudent } from './editor/class-commands';
import type { ApplyContext } from './server/apply-context';
import type { LabSource } from './types';
export const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export function applyFixture() {
  const context: ApplyContext = { classes: [1,2].map(n => ({ id: uid(n), name: `반 ${n}`, teacherId: uid(10), roomId: uid(20), active: true, closedAt: null, bg: '#abcdef', text: '#121212' })),
    schedules: [1,2].map(n => ({ id: uid(30+n), classId: uid(n), day: 'mon', start: `1${n}:00`, end: `1${n}:40`, teacherId: null, roomId: null, teacherLabel: null, roomLabel: null, validFrom: '2026-01-01', validTo: null, labSeparate: false, mergeGroup: null, periodLabel: null })),
    enrollments: [{ id: uid(40), studentId: uid(50), classId: uid(1), start: '2026-01-01', end: null, hold: false, transferred: false, days: null, salaryTier: 'A' }],
    people: [{ id: uid(10), name: '강사', englishName: null, role: 'teacher', status: 'active', bg: null, text: null }],
    students: [{ id: uid(50), name: '학생', school: '학교', grade: '중1', status: 'enrolled' }], rooms: [{ id: uid(20), name: '301' }], blocks: [], outside: [], settings: {} };
  const source: LabSource = { version: 1, tenantId: uid(100), referenceDate: '2026-10-08', fetchedAt: '2026-10-08T00:00:00Z', subject: 'english', academy: '테스트', stepMinutes: 10, teacherOrder: ['강사'], notices: [], outside: [], appearance: structuredClone(defaultAppearance), baselineHash: 'a'.repeat(64),
    slots: context.schedules.map(row => ({ id: row.id, classId: row.classId, name: `반 ${row.classId===uid(1)?1:2}`, subject: 'english', day: 'mon', start: row.start, end: row.end, teacher: '강사', teacherId: uid(10), room: '301', roomId: uid(20), kind: 'lesson', homeroomTeacher: '강사', classColor: { bg: '#abcdef', text: '#121212' }, students: row.classId===uid(1) ? [{ id: uid(50), name: '학생', school: '학교', grade: '중1', attendanceDays: ['mon'] }] : [] })) };
  return { context, draft: importSource(source) };
}
describe('운영 적용 계획', () => {
  it('변경 없는 불러오기는 FK 상속값 때문에 수업을 다시 만들지 않는다', () => {
    const { draft, context } = applyFixture();
    expect(buildApplyPlan(draft, context, '2026-10-08').summary).toEqual({ schedules: 0, blocks: 0, classes: 0, students: 0, enrollments: 0, teacherNames: 0 });
  });
  it('학생 이동은 원반 수강 종료와 새 반 배정을 함께 계획하고 급여 티어를 유지한다', () => {
    const { draft, context } = applyFixture();
    const next = moveClassStudent(draft, uid(50), uid(1), uid(2));
    const plan = buildApplyPlan(next, context, '2026-10-08');
    expect(plan.enrollments).toHaveLength(2);
    expect(plan.enrollments.find(row=>row.remove)?.before?.salaryTier).toBe('A');
    expect(plan.enrollments.find(row=>!row.remove)).toMatchObject({ classId: uid(2), studentId: uid(50), days: ['mon'], before: null });
  });
  it('화면에 없는 휴원 수강은 종료하지 않는다', () => {
    const { draft, context } = applyFixture();
    context.enrollments.push({ ...context.enrollments[0], id: uid(41), studentId: uid(51), hold: true });
    expect(buildApplyPlan(draft, context, '2026-10-08').enrollments).toHaveLength(0);
  });
  it('요일 변경은 명시된 옛 등원 요일도 새 요일로 갱신한다', () => {
    const { draft, context } = applyFixture(); context.enrollments[0].days=['mon']; draft.cells[1][1].text='화'; draft.cells[1][2].text='14:20'; draft.cells[1][3].text='15:00';
    expect(buildApplyPlan(draft, context, '2026-10-08').enrollments[0].days).toEqual(['tue']);
  });
  it('변조한 다른 과목 스냅샷을 무시하고 현재 자료의 겹침을 검사한다', () => {
    const { draft, context } = applyFixture();
    context.outside=[{ ...context.schedules[0], id: uid(99), name:'수학', teacher:'다른 강사', room:'302', roomId:null, students:[uid(50)] }];
    expect(buildApplyPlan(draft, context, '2026-10-08').warnings.some(warning=>warning.includes('학생 겹침'))).toBe(true);
  });
  it('다른 지점 식별자와 중복 원본 식별자를 거절한다', () => {
    const { draft, context } = applyFixture(); draft.source!.importedIds!.push(uid(999));
    expect(()=>buildApplyPlan(draft,context,'2026-10-08')).toThrow('다른 학원');
    draft.source!.importedIds!.pop(); draft.placements[1].sourceScheduleId=draft.placements[0].sourceScheduleId;
    expect(()=>buildApplyPlan(draft,context,'2026-10-08')).toThrow('중복');
  });
  it('이미 종료된 원본과 미래 수강 예약을 덮어쓰지 않는다', () => {
    const { draft, context } = applyFixture(); context.schedules[0].validTo='2026-10-07';draft.cells[1][2].text='11:10';
    expect(()=>buildApplyPlan(draft,context,'2026-10-08')).toThrow('종료');
    const moved = applyFixture(); moved.context.enrollments.push({ ...moved.context.enrollments[0], id:uid(41), studentId:uid(51), classId:uid(2), start:'2026-10-09' });
    expect(()=>buildApplyPlan(moveClassStudent(moved.draft,uid(50),uid(1),uid(2)),moved.context,'2026-10-08')).toThrow('예약');
  });
  it('수업만 바뀌는 반은 시작 전 수강이 있어도 막지 않는다 — 예약 뒤 시작일을 고쳐도 적용된다', () => {
    const { draft, context } = applyFixture(); draft.cells[1][2].text='11:10';
    context.enrollments.push({ ...context.enrollments[0], id:uid(41), studentId:uid(51), start:'2026-10-09' });
    expect(buildApplyPlan(draft,context,'2026-10-08').schedules).toHaveLength(1);
    context.enrollments[1].days = ['mon'];
    expect(buildApplyPlan(draft,context,'2026-10-08').schedules).toHaveLength(1);
  });
  it('시작 전 수강의 등원 요일이 시간표에서 사라지면 막는다', () => {
    const { draft, context } = applyFixture(); draft.cells[2][2].text='12:10';
    context.enrollments.push({ ...context.enrollments[0], id:uid(41), studentId:uid(51), classId:uid(2), start:'2026-10-09', days:['tue'] });
    expect(()=>buildApplyPlan(draft,context,'2026-10-08')).toThrow('예약');
    context.enrollments[1].days = null;
    expect(buildApplyPlan(draft,context,'2026-10-08').schedules).toHaveLength(1);
  });
  it('영어 마지막 수업을 연습본으로 끝내면 반이동·퇴원보고서를 안내하고 막는다', () => {
    const { draft, context } = applyFixture();
    draft.placements[0].studentIds = []; draft.students[uid(1)] = [];
    expect(() => buildApplyPlan(draft, context, '2026-10-08')).toThrow('학생: 이 과목의 마지막 수업');
    expect(() => buildApplyPlan(draft, context, '2026-10-08')).toThrow("'반 이동' 메뉴");
  });
  it('다른 영어 수강이 남거나 새 반으로 옮기면 막지 않는다', () => {
    const left = applyFixture();
    left.draft.placements[0].studentIds = []; left.draft.students[uid(1)] = [];
    left.context.enrollments.push({ ...left.context.enrollments[0], id: uid(41), classId: uid(3) });
    expect(buildApplyPlan(left.draft, left.context, '2026-10-08').enrollments.filter(row => row.remove)).toHaveLength(1);
    const moved = applyFixture();
    expect(buildApplyPlan(moveClassStudent(moved.draft, uid(50), uid(1), uid(2)), moved.context, '2026-10-08').enrollments).toHaveLength(2);
  });
  it('이미 퇴원한 학생의 남은 수강 정리와 특강 종료는 막지 않는다', () => {
    const gone = applyFixture(); gone.context.students[0].status = 'withdrawn';
    gone.draft.placements[0].studentIds = []; gone.draft.students[uid(1)] = [];
    expect(buildApplyPlan(gone.draft, gone.context, '2026-10-08').enrollments).toHaveLength(1);
    const special = applyFixture(); special.context.classes[0].special = true;
    special.draft.placements[0].studentIds = []; special.draft.students[uid(1)] = [];
    expect(buildApplyPlan(special.draft, special.context, '2026-10-08').enrollments).toHaveLength(1);
  });
  it('*LAB의 별도 수업 표시는 운영 배치 변경에 포함된다', () => {
    const { draft, context } = applyFixture(); draft.cells[1][4].text='LAB'; draft.placements[0].kind='seat'; draft.placements[0].labSeparate=true;
    expect(buildApplyPlan(draft,context,'2026-10-08').schedules[0]).toMatchObject({ teacherId:null, item:{labSeparate:true} });
  });
  it('클라이언트가 운영시간을 넓혀도 실제 학원 운영시간 밖 수업을 거절한다',()=>{
    const {draft,context}=applyFixture();draft.cells[1][2].text='00:00';draft.cells[1][3].text='01:00';draft.operatingHours={'월':[{start:0,end:1440}]};
    expect(()=>buildApplyPlan(draft,context,'2026-10-08')).toThrow('운영시간');
  });
  it('그 주 초의 수강 이력이 남아 있어도 학생을 원래 반에 다시 넣지 않는다',()=>{
    const {draft,context}=applyFixture();context.enrollments[0].end='2026-10-07';context.enrollments[0].transferred=true;
    context.enrollments.push({...context.enrollments[0],id:uid(41),classId:uid(2),start:'2026-10-07',end:null,transferred:false});
    draft.appearance!.hidePeriods=true;
    expect(buildApplyPlan(draft,context,'2026-10-08').enrollments).toHaveLength(0);
  });
  it('보기만 바꾸면 이전 주의 담임 표시를 현재 담임에 덮어쓰지 않는다',()=>{
    const {draft,context}=applyFixture();context.people.push({...context.people[0],id:uid(11),name:'새 강사'});context.classes[0].teacherId=uid(11);
    draft.appearance!.hidePeriods=true;
    expect(buildApplyPlan(draft,context,'2026-10-08').summary).toMatchObject({classes:0,schedules:0});
  });
  it('시간만 바꾸면 현재 담임과 강의실 상속을 그대로 보존한다',()=>{
    const {draft,context}=applyFixture();context.people.push({...context.people[0],id:uid(11),name:'새 강사'});context.classes[0].teacherId=uid(11);draft.cells[1][2].text='11:10';
    const row=buildApplyPlan(draft,context,'2026-10-08').schedules[0];
    expect(row).toMatchObject({teacherId:null,teacherLabel:null,roomId:null,roomLabel:null,item:{teacher:'새 강사'}});
  });
  it('담임만 바꿔도 교시 강사는 화면에서 지정한 기존 강사로 유지한다',()=>{
    const {draft,context}=applyFixture();context.people.push({...context.people[0],id:uid(11),name:'새 강사'});draft.classes![uid(1)].homeroomTeacher='새 강사';
    const plan=buildApplyPlan(draft,context,'2026-10-08');
    expect(plan.classes[0].teacherId).toBe(uid(11));expect(plan.schedules[0]).toMatchObject({teacherId:uid(10),teacherLabel:'강사'});
  });
  it('비수업 일정 시간만 바꾸면 원래 강사 별칭과 연결을 보존한다',()=>{
    const {draft,context}=applyFixture();context.people[0].englishName='Teacher';
    context.blocks.push({id:uid(90),teacherLabel:'Teacher',teacherId:null,day:'mon',start:'11:00',end:'11:40',kind:'meeting',label:'회의',validFrom:'2026-01-01',validTo:null});
    const id=`block:${uid(90)}`,row=draft.cells.length;
    draft.cells.push(['회의','월','11:10','11:40','강사',''].map(text=>({text})));
    draft.placements.push({id:`source:${id}`,sourceScheduleId:id,classId:'',row,kind:'block',teacherId:uid(10),studentIds:[]});
    draft.source!.importedIds!.push(id);
    draft.source!.initialPlacements![id]={name:'회의',classId:'',day:'월',start:660,end:700,teacher:'강사',room:'',labSeparate:false,students:[]};
    expect(buildApplyPlan(draft,context,'2026-10-08').blocks[0]).toMatchObject({teacherLabel:'Teacher',teacherId:null});
  });
});
