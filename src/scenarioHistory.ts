export interface ComparableDecisionEvaluation {
  revenueChange: number | null
  verdictLabel: string
  risk: string
  score: { final: number }
}

export interface ScenarioSnapshot<Proposal, Evaluation extends ComparableDecisionEvaluation> {
  proposal: Proposal
  evaluation: Evaluation
  reviewedAt: string
}

export interface ScenarioComparison<Proposal, Evaluation extends ComparableDecisionEvaluation> {
  previous: ScenarioSnapshot<Proposal, Evaluation>
  current: ScenarioSnapshot<Proposal, Evaluation>
  revenueDelta: number | null
  decisionScoreDelta: number
  verdictChanged: boolean
  riskChanged: boolean
}

export interface ScenarioPresentationState<Proposal, Evaluation extends ComparableDecisionEvaluation> {
  current: ScenarioSnapshot<Proposal, Evaluation> | null
  comparison: ScenarioComparison<Proposal, Evaluation> | null
  recalculating: boolean
  draftDirty: boolean
  error: string
}

export function initialScenarioPresentationState<Proposal, Evaluation extends ComparableDecisionEvaluation>(): ScenarioPresentationState<Proposal, Evaluation> {
  return { current: null, comparison: null, recalculating: false, draftDirty: false, error: '' }
}

export function editScenarioDraft<Proposal, Evaluation extends ComparableDecisionEvaluation>(
  state: ScenarioPresentationState<Proposal, Evaluation>,
): ScenarioPresentationState<Proposal, Evaluation> {
  return { ...state, draftDirty: true, error: '' }
}

export function beginScenarioRecalculation<Proposal, Evaluation extends ComparableDecisionEvaluation>(
  state: ScenarioPresentationState<Proposal, Evaluation>,
): ScenarioPresentationState<Proposal, Evaluation> {
  if (state.recalculating) return state
  return { ...state, recalculating: true, error: '' }
}

export function completeScenarioRecalculation<Proposal, Evaluation extends ComparableDecisionEvaluation>(
  state: ScenarioPresentationState<Proposal, Evaluation>,
  proposal: Proposal,
  evaluation: Evaluation,
  reviewedAt: string,
): ScenarioPresentationState<Proposal, Evaluation> {
  const current: ScenarioSnapshot<Proposal, Evaluation> = { proposal, evaluation, reviewedAt }
  const comparison = state.current ? {
    previous: state.current,
    current,
    revenueDelta: evaluation.revenueChange === null || state.current.evaluation.revenueChange === null
      ? null
      : Number((evaluation.revenueChange - state.current.evaluation.revenueChange).toFixed(10)),
    decisionScoreDelta: evaluation.score.final - state.current.evaluation.score.final,
    verdictChanged: evaluation.verdictLabel !== state.current.evaluation.verdictLabel,
    riskChanged: evaluation.risk !== state.current.evaluation.risk,
  } : null
  return { current, comparison, recalculating: false, draftDirty: false, error: '' }
}

export function failScenarioRecalculation<Proposal, Evaluation extends ComparableDecisionEvaluation>(
  state: ScenarioPresentationState<Proposal, Evaluation>,
  error: string,
): ScenarioPresentationState<Proposal, Evaluation> {
  return { ...state, recalculating: false, error }
}
