import { makeFixture } from './model';
import { defaultAppearance } from './appearance';
export function makeNativeFixture() {
  const draft = makeFixture();
  draft.appearance = { ...structuredClone(defaultAppearance), teacherColors: {
    '강사 가': { bg: '#f6b26b', text: '#121212' }, '강사 나': { bg: '#674ea7', text: '#ffffff' },
  }, sectionLines: [980, 1100, 1160] };
  draft.classes = { 'class-1': { color: { bg: '#d9ead3', text: '#274e13' } },
    'class-2': { color: { bg: '#cfe2f3', text: '#153e75' } }, 'class-3': { color: { bg: '#fce5cd', text: '#783f04' } } };
  return draft;
}
