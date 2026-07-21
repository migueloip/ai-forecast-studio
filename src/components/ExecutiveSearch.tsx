import { ArrowRight, Command, Search, Sparkles, X } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { executiveSearch, type ExecutiveSearchResult } from '../api'
import { safeErrorMessage } from '../errors'

const suggestions = ['What is my highest business risk?', 'Show all pricing simulations.', 'What did Maya recommend?', 'Which dataset has the highest confidence score?']
const commandCatalog: ExecutiveSearchResult[] = [
  { id: 'page:team', type: 'Pages', title: 'AI Team OS', detail: 'Open executive consensus and specialist work', actionUrl: '/app', createdAt: '' },
  { id: 'page:forecast', type: 'Pages', title: 'Forecast Intelligence', detail: 'Open forecasts and model tournament', actionUrl: '/app/forecasts', createdAt: '' },
  { id: 'page:decision', type: 'Pages', title: 'Decision Room', detail: 'Evaluate a business proposal', actionUrl: '/app/simulator', createdAt: '' },
  { id: 'page:meetings', type: 'Pages', title: 'Team Meetings', detail: 'Search specialist conversations', actionUrl: '/app/meetings', createdAt: '' },
  { id: 'page:insights', type: 'Pages', title: 'Insights', detail: 'Open verified business findings', actionUrl: '/app/insights', createdAt: '' },
  { id: 'page:reports', type: 'Pages', title: 'Reports', detail: 'Open executive and public reports', actionUrl: '/app/reports', createdAt: '' },
  { id: 'action:upload', type: 'Actions', title: 'Upload dataset', detail: 'Connect CSV, Excel, or JSON business data', actionUrl: '/onboarding', createdAt: '' },
  { id: 'action:settings', type: 'Actions', title: 'Open AI Team preferences', detail: 'Configure instructions, risk tolerance and language', actionUrl: '/app/settings', createdAt: '' },
]

function commandsFor(query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return commandCatalog.filter((item)=>words.every((word)=>`${item.title} ${item.detail}`.toLowerCase().includes(word))).slice(0,6)
}

export function ExecutiveSearch() {
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState('')
  const [results, setResults] = useState<ExecutiveSearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => { if (open) window.setTimeout(() => input.current?.focus(), 20) }, [open])

  const run = async (event?: FormEvent, supplied?: string) => {
    event?.preventDefault()
    const next = (supplied ?? query).trim()
    if (next.length < 2) return
    setQuery(next)
    setLoading(true)
    setError('')
    try {
      const response = await executiveSearch(next, localStorage.getItem('forecast-studio-active-context') ?? undefined)
      setAnswer(response.answer)
      const local = commandsFor(next)
      setResults([...local, ...response.results.filter((result)=>!local.some((item)=>item.actionUrl===result.actionUrl&&item.title===result.title))])
    } catch (cause) {
      setError(safeErrorMessage(cause, 'Executive Search is temporarily unavailable.'))
    } finally {
      setLoading(false)
    }
  }

  const visit = (url: string) => {
    setOpen(false)
    if (url.includes('context=')) { window.location.assign(url); return }
    navigate(url)
  }
  return <>
    <button className="search-button" onClick={() => setOpen(true)}><Search size={15}/><span>Search the Executive OS...</span><kbd><Command size={11}/> K</kbd></button>
    {open && <div className="executive-search-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setOpen(false) }}><section className="executive-search-modal" role="dialog" aria-modal="true" aria-label="Executive Search">
      <form onSubmit={(event) => { void run(event) }}><Search size={17}/><input ref={input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ask about risks, forecasts, decisions or specialist memory..."/><button type="button" onClick={() => setOpen(false)}><X size={15}/></button></form>
      {!results.length&&!answer&&!loading&&!error&&<div className="executive-search-start"><span><Sparkles size={15}/> ASK YOUR OPERATING SYSTEM</span>{suggestions.map((item) => <button key={item} onClick={() => { void run(undefined, item) }}>{item}<ArrowRight size={12}/></button>)}</div>}
      {loading&&<div className="executive-search-state"><span className="spinner"/> Searching persisted business memory...</div>}
      {error&&<div className="executive-search-state error">{error}</div>}
      {!loading&&(answer||results.length>0)&&<div className="executive-search-results">{answer&&<article><span><Sparkles size={12}/> EXECUTIVE ANSWER</span><p>{answer}</p></article>}{[...new Set(results.map((result)=>result.type))].map((category)=><section key={category}><header>{category}</header>{results.filter((result)=>result.type===category).map((result) => <button key={result.id} onClick={() => visit(result.actionUrl)}><em>{result.type}</em><span><b>{result.title}</b><small>{result.detail}</small></span><ArrowRight size={12}/></button>)}</section>)}</div>}
      {!loading&&!error&&query.length>=2&&!answer&&!results.length&&<div className="executive-search-state">No matching evidence was found in this business context.</div>}
    </section></div>}
  </>
}
