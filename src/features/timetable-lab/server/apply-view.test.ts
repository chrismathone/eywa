import { expect, it } from 'vitest';
import { appliedViewPatch } from './apply-store';
import { emptyDraft } from '../editor/model';
import { defaultAppearance } from '../editor/appearance';
import { parseViewPrefs,mergeViewPrefs } from '@/features/timetable/lib/view-prefs';
function draftWithSource(){
  const draft=emptyDraft();draft.appearance=structuredClone(defaultAppearance);
  draft.cells.push(['반','월','14:20','15:00','A','301'].map(text=>({text})));
  draft.placements.push({id:'item',sourceScheduleId:'slot',classId:'class',row:1});
  draft.source={kind:'live',date:'2026-10-08',tenantId:'00000000-0000-4000-8000-000000000001',loadedAt:'2026-10-08T00:00:00Z',academy:'',notices:[],step:10,teacherOrder:['A','B'],initialTeacherOrder:['A','B'],initialAppearance:structuredClone(draft.appearance),initialSlotMetadata:{slot:{note:'',locked:false}}};
  return draft;
}
it('시간 변경으로 식별자가 바뀌면 나중에 수정한 개인 메모도 새 배치로 이어진다',()=>{
  const draft=draftWithSource(),raw={timetable:{editorView:{english:{slotMetadata:{slot:{note:'나중에 적은 메모',locked:true}}}}}};
  const patch=appliedViewPatch(draft,raw,new Map([['item','new-slot']]));
  expect(patch.editorView?.english.slotMetadata?.['new-slot']).toEqual({note:'나중에 적은 메모',locked:true});
  expect(appliedViewPatch(draft,raw,new Map()).editorView).toBeUndefined();
});
it('강사 위치를 옮겨도 다른 과목·요일 그룹·화면 밖 강사와 기존 표시 항목이 남는다',()=>{
  const draft=draftWithSource();draft.teachers=['B','A'];draft.appearance!.hidePeriods=true;
  const raw={timetable:{hideStudents:true,teacherOrder:{english:{teacherview:['숨은 강사','A','B'],'mon-thu':['요일 강사']},math:{teacherview:['수학 강사']}}}};
  const merged=mergeViewPrefs(parseViewPrefs(raw),appliedViewPatch(draft,raw,new Map()));
  expect(merged.teacherOrder?.english.teacherview).toEqual(['숨은 강사','B','A']);expect(merged.teacherOrder?.english['mon-thu']).toEqual(['요일 강사']);expect(merged.teacherOrder?.math.teacherview).toEqual(['수학 강사']);expect(merged.hideStudents).toBe(true);
});
it('저장할 수 없는 표시 설정을 조용히 버리지 않는다',()=>{
  const draft=draftWithSource();draft.appearance!.teacherColors.A={bg:'잘못된 색',text:'#000000'};
  expect(()=>appliedViewPatch(draft,{},new Map())).toThrow('형식');
});
