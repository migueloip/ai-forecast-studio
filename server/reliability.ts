export const meetingDependencyGraph = {
  parallelSpecialists: ['data_engineer', 'data_scientist', 'forecast_specialist', 'risk_analyst', 'strategy_lead'],
  finalSynthesis: 'team_lead',
  synthesisDependsOn: ['data_engineer', 'data_scientist', 'forecast_specialist', 'risk_analyst', 'strategy_lead'],
} as const

export function isActiveMeetingStatus(status: string) {
  return ['queued', 'preparing', 'running', 'synthesizing'].includes(status)
}

export function meetingCancellationOutcome(status: string, completedAgents: string[]) {
  return {
    status: status === 'queued' ? 'cancelled' : status,
    stage: status === 'queued' ? 'cancelled' : 'cancellation_requested',
    completedAgents: [...completedAgents],
  }
}

export function resumableStages<T extends { agent_key: string; status: string }>(runs: T[]) {
  return runs.filter((run) => run.status !== 'completed').map((run) => run.agent_key)
}

export function completedStageCount<T extends { agent_key: string; status: string }>(runs: T[]) {
  return runs.filter((run) => run.agent_key !== 'team_lead' && run.status === 'completed').length
}
