export type DiagnosticAnswer = 'fixed' | 'not-fixed' | 'skip';
export interface DiagnosticState {
  deviceId: string;
  step: number;
  result: 'active' | 'resolved' | 'unresolved';
  answers: { step: number; answer: DiagnosticAnswer }[];
}
export const diagnosticSteps = [
  {
    title: '전원과 입력 소스 확인',
    text: '모니터 전원과 입력 소스(HDMI 또는 DisplayPort)가 실제 연결과 일치하는지 확인해 주세요. 화면이 나오는지 직접 확인합니다.',
    note: '전원이나 입력이 원인이라고 확정한 것은 아닙니다.',
  },
  {
    title: '현재 케이블 연결 확인',
    text: '노트북과 모니터 사이의 케이블이 단단히 연결되어 있는지 확인해 주세요. Dock에 저장장치가 있다면 사용 중인 파일을 닫고 안전하게 분리한 뒤 케이블을 다시 연결하세요.',
    note: '저장장치를 쓰는 중에 Dock을 갑자기 분리하지 마세요.',
  },
  {
    title: '가능하면 Dock 우회 테스트',
    text: '기기 설명서에서 지원을 확인한 케이블·포트가 있다면 노트북과 모니터를 직접 연결해 보세요. 호환 여부가 불확실하거나 케이블이 없으면 건너뛰세요.',
    note: '직접 연결 성공만으로 Dock 고장을 단정할 수 없습니다.',
  },
] as const;
export function startDiagnosis(deviceId: string): DiagnosticState {
  return { deviceId, step: 0, result: 'active', answers: [] };
}
export function answerDiagnosis(state: DiagnosticState, answer: DiagnosticAnswer): DiagnosticState {
  if (state.result !== 'active') return state;
  const answers = [...state.answers, { step: state.step, answer }];
  if (answer === 'fixed') return { ...state, result: 'resolved', answers };
  if (state.step >= diagnosticSteps.length - 1) return { ...state, result: 'unresolved', answers };
  return { ...state, step: state.step + 1, answers };
}
export function diagnosisNote(state: DiagnosticState): string {
  if (state.result === 'resolved')
    return `사용자 테스트: ${diagnosticSteps[state.step].title} 후 화면이 나온다고 보고함. 원인은 확정하지 않음.`;
  return '사용자 안내 테스트를 마쳤으나 해결 여부나 원인을 확정하지 못함.';
}
