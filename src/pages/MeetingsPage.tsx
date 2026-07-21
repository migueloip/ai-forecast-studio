import { useEffect, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowUp, Check, ChevronRight, CircleStop, Clock3, Database, GitCompareArrows, Layers3, MessageSquareText, Plus, RotateCcw, Sparkles, Users } from 'lucide-react'
import {
  askTeam,
  cancelMeetingJob,
  getTeamConversation,
  getTeamConversations,
  retryMeetingJob,
  type Analysis,
  type MeetingAgentKey,
  type MeetingTarget,
  type MeetingJob,
  type TeamConversation,
  type TeamMeetingContext,
} from '../api'
import { EmptyWorkspace } from '../components/EmptyWorkspace'
import { safeErrorMessage } from '../errors'
import { frequencyLabel } from '../format'

const people: Array<{ key: MeetingAgentKey; initials: string; name: string; role: string; color: string }> = [
  { key: 'data_engineer', initials: 'E', name: 'Elena', role: 'Data Engineer', color: '#7b6cf6' },
  { key: 'data_scientist', initials: 'N', name: 'Noah', role: 'Data Scientist', color: '#ee7c58' },
  { key: 'forecast_specialist', initials: 'M', name: 'Maya', role: 'Forecast Specialist', color: '#31a97a' },
  { key: 'risk_analyst', initials: 'O', name: 'Owen', role: 'Risk Analyst', color: '#dc9f35' },
  { key: 'strategy_lead', initials: 'A', name: 'Ava', role: 'Strategy Lead', color: '#4289e8' },
]

type ConversationWithMessages = TeamConversation & { messages: NonNullable<TeamConversation['messages']> }

function relativeTime(value: string) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000))
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

function targetName(target: MeetingTarget) {
  return target === 'all' ? 'Entire AI Team' : people.find((person) => person.key === target)?.name ?? 'Specialist'
}

function contextName(names: string[]) {
  return names.join(' + ')
}

function groupConversations(conversations: TeamConversation[]) {
  const groups = new Map<string, { key: string; names: string[]; mode: TeamConversation['context_mode']; conversations: TeamConversation[] }>()
  for (const conversation of conversations) {
    const group = groups.get(conversation.context_key)
    if (group) group.conversations.push(conversation)
    else groups.set(conversation.context_key, {
      key: conversation.context_key,
      names: conversation.dataset_names,
      mode: conversation.context_mode,
      conversations: [conversation],
    })
  }
  return [...groups.values()]
}

const activeJobStatuses = new Set(['queued', 'preparing', 'running', 'synthesizing'])

function jobProgress(job: MeetingJob) {
  if (job.status === 'queued') return { title: 'Waiting for the AI Team…', detail: 'Your question is safely stored and queued.' }
  if (job.status === 'preparing') return { title: 'Preparing business context…', detail: 'Loading validated analytics and dataset-specific memory.' }
  if (job.status === 'synthesizing') return { title: 'Atlas is preparing the team synthesis.', detail: `${job.completed_agents.length} of ${job.expected_agents.length} specialists have responded.` }
  if (job.status === 'running') {
    if (job.expected_agents.length === 1) {
      const name = targetName(job.expected_agents[0]!)
      return { title: `${name} is reviewing the validated evidence…`, detail: 'The response will appear here as soon as it is persisted.' }
    }
    return {
      title: job.completed_agents.length ? `${job.completed_agents.length} of ${job.expected_agents.length} specialists have responded.` : 'The specialists are reviewing the business evidence…',
      detail: job.completed_agents.length ? 'Completed perspectives are already visible above.' : 'Elena, Noah, Maya, Owen and Ava are working in parallel.',
    }
  }
  return { title: 'Meeting interrupted', detail: job.error_message ?? 'The team could not complete this response.' }
}

function conversationStatus(conversation: TeamConversation) {
  if (!conversation.job_status) return null
  if (conversation.job_status === 'completed') return 'Completed'
  if (conversation.job_status === 'cancelled') return 'Cancelled'
  if (conversation.job_status === 'failed' || conversation.job_status === 'timed_out') return 'Failed'
  if (conversation.job_status === 'synthesizing') return 'Synthesis pending'
  if (conversation.job_completed_count > 0) return `${conversation.job_completed_count} specialists responded`
  return 'Waiting'
}

export function MeetingsPage({ analysis }: { analysis: Analysis | null }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTarget = searchParams.get('target')
  const initialTarget: MeetingTarget = requestedTarget === 'all' || people.some((person) => person.key === requestedTarget)
    ? requestedTarget as MeetingTarget
    : 'all'
  const [question, setQuestion] = useState('')
  const [target, setTarget] = useState<MeetingTarget>(initialTarget)
  const [thinking, setThinking] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(true)
  const [conversationLoading, setConversationLoading] = useState(false)
  const [conversations, setConversations] = useState<TeamConversation[]>([])
  const [context, setContext] = useState<TeamMeetingContext | null>(null)
  const [activeConversation, setActiveConversation] = useState<ConversationWithMessages | null>(null)
  const [error, setError] = useState('')
  const [cancellingJobId, setCancellingJobId] = useState('')

  const refreshHistory = async () => {
    if (!analysis) return
    try {
      const result = await getTeamConversations(analysis.id)
      setConversations(result.conversations)
      setContext(result.context)
    } catch (caught) {
      setError(safeErrorMessage(caught, 'Conversation history for this business could not be loaded.'))
    } finally {
      setHistoryLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    if (!analysis) {
      return () => { cancelled = true }
    }
    void getTeamConversations(analysis.id)
      .then((result) => {
        if (cancelled) return
        setConversations(result.conversations)
        setContext(result.context)
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(safeErrorMessage(caught, 'Conversation history for this business could not be loaded.'))
      })
      .finally(() => { if (!cancelled) setHistoryLoading(false) })
    return () => { cancelled = true }
  }, [analysis])

  const openConversation = async (conversationId: string, updateUrl = true) => {
    if (!analysis) return
    try {
      setConversationLoading(true)
      setError('')
      const result = await getTeamConversation(conversationId, analysis.id)
      setActiveConversation(result.conversation)
      setTarget(result.conversation.target_agent_key)
      if (updateUrl) setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set('conversation', conversationId)
        next.set('context', analysis.id)
        return next
      })
    } catch (caught) {
      setError(safeErrorMessage(caught, 'This conversation is not available in the current business context.'))
    } finally {
      setConversationLoading(false)
    }
  }

  useEffect(() => {
    const conversationId = searchParams.get('conversation')
    if (!analysis) return
    if (!conversationId) {
      if (!activeConversation) return
      const clearTimer = window.setTimeout(() => setActiveConversation(null), 0)
      return () => window.clearTimeout(clearTimer)
    }
    if (activeConversation?.id === conversationId) return
    const timer = window.setTimeout(() => { void openConversation(conversationId, false) }, 0)
    return () => window.clearTimeout(timer)
    // Opening is intentionally keyed to the URL and active business context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, searchParams, activeConversation?.id])

  useEffect(() => {
    const job = activeConversation?.job
    if (!analysis || !activeConversation || !job || !activeJobStatuses.has(job.status)) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const result = await getTeamConversation(activeConversation.id, analysis.id)
        if (stopped) return
        setActiveConversation(result.conversation)
        if (!result.conversation.job || !activeJobStatuses.has(result.conversation.job.status)) {
          await refreshHistory()
          return
        }
      } catch (caught) {
        if (!stopped) setError(safeErrorMessage(caught, 'Meeting progress could not be refreshed. Retrying…'))
      }
      if (!stopped) timer = setTimeout(() => { void poll() }, 1800)
    }
    timer = setTimeout(() => { void poll() }, 900)
    return () => { stopped = true; if (timer) clearTimeout(timer) }
    // refreshHistory is stable enough for terminal refresh and must not restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, activeConversation?.id, activeConversation?.job?.status])

  const newConversation = () => {
    setActiveConversation(null)
    setTarget('all')
    setQuestion('')
    setError('')
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      next.delete('conversation')
      return next
    })
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next = question.trim()
    if (!next || thinking || !analysis) return
    setThinking(true)
    setError('')
    setQuestion('')
    try {
      const result = await askTeam(next, target, analysis.id, activeConversation?.id)
      setActiveConversation(result.conversation)
      setTarget(result.conversation.target_agent_key)
      setSearchParams((current) => {
        const updated = new URLSearchParams(current)
        updated.set('conversation', result.conversation.id)
        updated.set('context', analysis.id)
        return updated
      })
      await refreshHistory()
    } catch (caught) {
      setQuestion(next)
      setError(safeErrorMessage(caught, 'The selected specialist could not answer this question.'))
    } finally {
      setThinking(false)
    }
  }

  const retryActiveJob = async () => {
    const job = activeConversation?.job
    if (!job || !analysis) return
    try {
      setThinking(true)
      setError('')
      await retryMeetingJob(job.id)
      const result = await getTeamConversation(activeConversation.id, analysis.id)
      setActiveConversation(result.conversation)
    } catch (caught) {
      setError(safeErrorMessage(caught, 'The meeting could not be resumed.'))
    } finally {
      setThinking(false)
    }
  }

  const cancelActiveJob = async () => {
    const job = activeConversation?.job
    if (!job || !analysis || cancellingJobId || !activeJobStatuses.has(job.status)) return
    try {
      setCancellingJobId(job.id)
      setError('')
      const cancelled = await cancelMeetingJob(job.id)
      setActiveConversation((current) => current ? { ...current, job: cancelled.job } : current)
      if (cancelled.job.status === 'cancelled') await refreshHistory()
    } catch (caught) {
      setError(safeErrorMessage(caught, 'The meeting could not be cancelled.'))
    } finally {
      setCancellingJobId('')
    }
  }

  if (!analysis?.briefing || analysis.status !== 'completed') return <><header className="app-header"><div><span>DATASET-SCOPED MEMORY</span><h1>Team Meetings</h1></div></header><EmptyWorkspace title="Complete an AI analysis before entering this business room." description="Every meeting is isolated to the datasets used by a completed analysis." /></>

  const messages = activeConversation?.messages ?? []
  const activeJob = activeConversation?.job ?? null
  const jobIsActive = Boolean(activeJob && activeJobStatuses.has(activeJob.status))
  const jobFailed = Boolean(activeJob && ['failed', 'timed_out', 'cancelled'].includes(activeJob.status))
  const cancellationPending = Boolean(activeJob?.cancel_requested_at && activeJob.status !== 'cancelled')
  const groups = groupConversations(conversations)
  const comparative = context?.mode === 'comparative'
  const activeNames = activeConversation?.dataset_names ?? context?.datasets.map((dataset) => dataset.name) ?? []
  const activeComparative = activeConversation ? activeConversation.context_mode === 'comparative' : comparative
  const totalPeriods = context?.datasets.reduce((sum, dataset) => sum + dataset.periods, 0) ?? 0
  const contextualConversationCount = conversations.filter((conversation) => conversation.context_key === context?.contextKey).length
  const memoryCounts = new Map<string, number>()
  for (const conversation of conversations) {
    for (const datasetId of conversation.dataset_ids) memoryCounts.set(datasetId, (memoryCounts.get(datasetId) ?? 0) + 1)
  }

  return <>
    <header className="app-header meeting-page-header"><div><span>DATASET-AWARE SPECIALIST MEMORY</span><h1>Team Meetings</h1></div><div className="header-status"><i /> {context?.specialistPerspectives ?? 5} specialist perspectives available</div></header>

    <section className={`meeting-business-context ${comparative ? 'comparative' : ''}`}>
      <div className="meeting-context-icon">{comparative ? <GitCompareArrows size={20} /> : <Database size={20} />}</div>
      <div className="meeting-context-copy"><span>CURRENT MEETING CONTEXT</span><h2>{context ? contextName(context.datasets.map((dataset) => dataset.name)) : 'Loading business context...'}</h2><div>{context?.datasets.map((dataset) => <em key={dataset.id}><Database size={10} /> {dataset.name}</em>)}</div></div>
      <div className="meeting-context-stat"><span>Coverage</span><b>{context?.datasets.length === 1 ? frequencyLabel(context.datasets[0]!.frequency, totalPeriods) : `${context?.datasets.length ?? 0} source frequencies`}</b><small>{context?.datasets.length === 1 ? `${context.datasets[0]!.rowCount.toLocaleString()} records` : context?.datasets.map((item)=>`${item.name}: ${frequencyLabel(item.frequency,item.periods)}`).join(' · ')}</small></div>
      <div className="meeting-context-stat"><span>Forecast confidence</span><b>{context?.forecastConfidence === null || context?.forecastConfidence === undefined ? 'Unavailable' : `${Math.round(context.forecastConfidence)}%`}</b><small>Validated current analysis</small></div>
      <div className="meeting-context-stat"><span>Assignment</span><b>{context?.specialistPerspectives ?? 5} perspectives</b><small>{comparative ? 'Comparative analysis mode' : '5 specialists assigned'}</small></div>
      <span className="meeting-context-mode">{comparative ? <><Layers3 size={11} /> COMPARATIVE BUSINESS ANALYSIS</> : <><Check size={11} /> BUSINESS MEMORY ACTIVE</>}</span>
    </section>

    <section className="meeting-workspace">
      <aside className="meeting-history panel">
        <div className="meeting-history-head"><div><small>BUSINESS MEMORY</small><h2>Conversations</h2></div><button onClick={newConversation} aria-label="New conversation"><Plus size={15} /></button></div>
        <div className="meeting-history-list grouped-history">
          {historyLoading && <div className="history-chat-empty"><span className="spinner" /> Loading this business room...</div>}
          {!historyLoading && !conversations.length && <div className="history-chat-empty"><MessageSquareText size={18} /><b>Your Executive Team is ready for its first meeting</b><span>Start a conversation and the specialists will remember this business context.</span></div>}
          {groups.map((group) => <section className="meeting-history-group" key={group.key}>
            <header><span>{group.mode === 'comparative' ? <GitCompareArrows size={11} /> : <Database size={11} />}{contextName(group.names)}</span><em>{group.conversations.length}</em></header>
            {group.conversations.map((conversation) => <button key={conversation.id} className={activeConversation?.id === conversation.id ? 'active' : ''} onClick={() => { void openConversation(conversation.id) }}><span className="history-target">{conversation.target_agent_key === 'all' ? <Users size={13} /> : targetName(conversation.target_agent_key)[0]}</span><span><b title={conversation.title}>{conversation.title}</b><small>{targetName(conversation.target_agent_key)} · {conversation.message_count} {conversation.message_count === 1 ? 'message' : 'messages'}</small>{conversationStatus(conversation) && <em className={`conversation-job-status ${conversation.job_status}`}>{conversationStatus(conversation)}</em>}</span><time>{relativeTime(conversation.updated_at)}</time></button>)}
          </section>)}
        </div>
        <button className="new-meeting-button" onClick={newConversation}><Plus size={13} /> New conversation in {context?.datasets.length === 1 ? context.datasets[0]?.name : 'comparative context'}</button>
      </aside>

      <article className="meeting-main meeting-chat panel">
        <div className="meeting-title"><span>{target === 'all' ? <Users size={18} /> : targetName(target)[0]}</span><div><small>{activeConversation ? 'PERSISTED BUSINESS CONVERSATION' : activeComparative ? 'NEW COMPARATIVE MEETING' : 'NEW BUSINESS MEETING'}</small><h2>{activeConversation?.title ?? `Talk with ${targetName(target)}`}</h2><div className="meeting-title-datasets">{activeNames.map((name) => <em key={name}><Database size={9} /> {name}</em>)}</div></div><em>{targetName(target)}</em></div>
        <div className={`meeting-thread chat-thread ${conversationLoading ? 'is-thinking' : ''}`}>
          {conversationLoading ? <div className="team-thinking"><span className="spinner" /> Entering this business room...</div> : <>
            {!messages.length && <div className="meeting-welcome"><Sparkles size={22} /><h3>{activeComparative ? 'Your comparative board is assembled.' : target === 'all' ? `Your team is assigned to ${activeNames[0] ?? 'this business'}.` : `Ask ${targetName(target)} about ${activeNames[0] ?? 'this business'}.`}</h3><p>{activeComparative ? `The team may use ${contextualConversationCount} cross-dataset conversations plus isolated memory from each selected business. Every comparison must keep its source attributed.` : 'Responses use only this dataset’s completed analysis and specialist memory. Information from every other business is excluded.'}</p>{activeComparative && <div className="meeting-suggestions"><button onClick={() => setQuestion('Compare forecast reliability across these businesses.')}>Compare forecast reliability</button><button onClick={() => setQuestion('Which business has the highest inventory risk?')}>Compare inventory risk</button><button onClick={() => setQuestion('Compare their growth opportunities and strategic priorities.')}>Compare growth strategy</button></div>}</div>}
            {messages.map((message) => {
              if (message.role === 'user') return <div className="chat-user-message" key={message.id}><small>YOU · {contextName(activeNames)}</small><p>{message.content}</p></div>
              if (message.role === 'synthesis') return <div className="meeting-synthesis" key={message.id}><Sparkles size={14} /><p><small>TEAM SYNTHESIS · {contextName(activeNames)}</small>{message.content}</p></div>
              const person = people.find((item) => item.key === message.agent_key) ?? people[0]!
              return <div className="agent-response" key={message.id} style={{ '--meeting-color': person.color } as React.CSSProperties}><span className="meeting-avatar">{person.initials}</span><div><header><b>{person.name}</b><span>{person.role}</span><em><Check size={10} /> {message.confidence === null ? 'Evidence reviewed' : `${Math.round(message.confidence)}% confidence`}</em></header><p>{message.content}</p>{message.evidence && <small>Evidence: {message.evidence}</small>}</div></div>
            })}
            {jobIsActive && activeJob && <div className="meeting-job-progress"><span className="spinner" /><div><b>{cancellationPending ? 'Cancelling meeting…' : jobProgress(activeJob).title}</b><small>{cancellationPending ? `${activeJob.completed_agents.length} completed specialist response${activeJob.completed_agents.length === 1 ? '' : 's'} will be preserved.` : jobProgress(activeJob).detail}</small></div><button className="meeting-cancel-job" onClick={() => { void cancelActiveJob() }} disabled={cancellationPending || cancellingJobId === activeJob.id}><CircleStop size={12} /> {cancellationPending || cancellingJobId === activeJob.id ? 'Cancelling…' : 'Cancel'}</button></div>}
            {jobFailed && activeJob && <div className={`meeting-job-failed ${activeJob.status === 'cancelled' ? 'is-cancelled' : ''}`}><div><b>{activeJob.status === 'cancelled' ? 'Meeting cancelled.' : activeJob.status === 'timed_out' ? 'The provider timed out.' : 'The meeting was interrupted.'}</b><small>{activeJob.status === 'cancelled' ? `${activeJob.completed_agents.length} completed specialist response${activeJob.completed_agents.length === 1 ? '' : 's'} preserved.` : activeJob.error_message ?? 'Completed specialist responses were preserved.'}</small></div>{activeJob.status !== 'cancelled' && activeJob.attempt < 2 && <button onClick={() => { void retryActiveJob() }} disabled={thinking}><RotateCcw size={12} /> Resume</button>}</div>}
          </>}
        </div>
        {error && <div className="auth-error meeting-error">{error}</div>}
        <form className="meeting-composer" onSubmit={(event) => { void submit(event) }}><Sparkles size={16} /><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={jobIsActive ? 'Wait for this response before sending another question…' : activeComparative ? 'Ask the team to compare these businesses...' : target === 'all' ? `Ask the team about ${activeNames[0] ?? 'this business'}...` : `Ask ${targetName(target)} about ${activeNames[0] ?? 'this business'}...`} disabled={jobIsActive} /><button aria-label="Send question" disabled={thinking || jobIsActive || conversationLoading || question.trim().length < 3}><ArrowUp size={15} /></button></form>
      </article>

      <aside className="meeting-context meeting-participants panel">
        <span className="section-kicker">SPECIALIST ASSIGNMENTS</span><h3>{activeNames.length > 1 ? 'Comparative board' : `${activeNames[0] ?? 'Business'} team`}</h3>
        <div className="meeting-memory-scope"><span>{activeConversation ? 'CONVERSATION SCOPE' : 'NEW MEETING SCOPE'}</span><div>{activeNames.map((name) => <em key={name}><Database size={9} /> {name}</em>)}</div><small>{activeConversation ? 'Scope is locked to prevent cross-business leakage.' : 'New messages will be stored only in this context.'}</small></div>
        <button className={target === 'all' ? 'selected' : ''} disabled={Boolean(activeConversation)} onClick={() => setTarget('all')}><span className="participant-team"><Users size={14} /></span><div><b>Entire AI Team</b><small>{activeComparative ? `${activeNames.length * 5} contextual perspectives` : '5 specialist perspectives'}</small></div>{target === 'all' && <Check size={13} />}</button>
        {people.map((person) => <button key={person.key} className={target === person.key ? 'selected' : ''} disabled={Boolean(activeConversation)} onClick={() => setTarget(person.key)}><span className="participant-avatar" style={{ '--participant-color': person.color } as React.CSSProperties}>{person.initials}</span><div><b>{person.name}</b><small>{person.role} · dataset memory</small></div>{target === person.key && <Check size={13} />}</button>)}
        {activeConversation ? <p>This specialist room is permanently assigned to <b>{contextName(activeNames)}</b>. Start a new conversation to change participants.</p> : <p>{activeComparative ? 'Each specialist receives current comparative findings plus isolated prior conclusions from each selected business.' : 'Each specialist recalls only conclusions previously produced for this dataset.'}</p>}
        <div className="meeting-dataset-memory"><span>DATASET MEMORY</span>{context?.datasets.map((dataset) => <div key={dataset.id}><i>{dataset.name[0]?.toUpperCase()}</i><p><b>{dataset.name}</b><small>{memoryCounts.get(dataset.id) ?? 0} conversations · {frequencyLabel(dataset.frequency,dataset.periods)}</small></p></div>)}</div>
        <div className="meeting-analysis-context"><span>Analysis context</span><b>{context?.forecastConfidence === null || context?.forecastConfidence === undefined ? 'Forecast unavailable' : `${Math.round(context.forecastConfidence)}% confidence`}</b><ChevronRight size={13} /></div>
        <div className="meeting-history-status"><Clock3 size={13} /> Dataset-scoped memory in Neon</div>
      </aside>
    </section>
  </>
}
