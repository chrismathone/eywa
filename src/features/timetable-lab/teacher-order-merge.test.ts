import { expect, it } from 'vitest';
import { mergeMovedTeacherOrder as merge } from './teacher-order-merge';
it('편집하지 않은 개인 순서를 보존한다',()=>expect(merge(['숨은 강사','B','A','C'],['A','B','C'],['A','B','C'])).toEqual(['숨은 강사','B','A','C']));
it('이동한 강사만 새 위치에 놓고 화면 밖 강사를 유지한다',()=>expect(merge(['숨은 강사','A','B','C'],['A','B','C'],['C','A','B'])).toEqual(['숨은 강사','C','A','B']));
it('새 강사를 추가하고 다른 목록을 지우지 않는다',()=>expect(merge(['A','B','숨은 강사'],['A','B'],['A','새 강사','B'])).toEqual(['A','새 강사','B','숨은 강사']));
