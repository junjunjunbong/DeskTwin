export type DiagnosticAnswer = 'fixed' | 'not-fixed' | 'skip';
export interface DiagnosticState {
  deviceId: string;
  step: number;
  result: 'active' | 'resolved' | 'unresolved';
  answers: { step: number; answer: DiagnosticAnswer }[];
}
export const diagnosticSteps = [
  {
    title: 'Check power and input source',
    text: 'Check that the monitor is powered on and its input source (HDMI or DisplayPort) matches the cable in use. Check the screen yourself.',
    note: 'This does not establish that power or input is the cause.',
  },
  {
    title: 'Check the current cable connection',
    text: 'Check that the cable between your laptop and monitor is firmly connected. If a storage device is attached to the dock, close any files in use and safely eject it before reconnecting cables.',
    note: 'Do not abruptly disconnect the dock while using a storage device.',
  },
  {
    title: 'Test a direct connection if possible',
    text: 'If your device manuals confirm support for the cable and ports, try connecting the laptop and monitor directly. Skip this step if compatibility is uncertain or you do not have the cable.',
    note: 'A successful direct connection alone does not prove the dock is faulty.',
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
    return `User test: Display reported working after ${diagnosticSteps[state.step].title.toLowerCase()}. Cause not determined.`;
  return 'The guided user test is complete, but the outcome and cause are undetermined.';
}
