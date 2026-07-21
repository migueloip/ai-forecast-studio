import { useState, type FormEvent } from 'react'
import { ArrowRight, BarChart3, Check, Eye, EyeOff, LockKeyhole, Sparkles } from 'lucide-react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import { safeErrorMessage } from '../errors'

export function LoginPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, login, register } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (user) return <Navigate to="/app" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      if (mode === 'register') await register(fullName, email, password)
      else await login(email, password)
      const from = (location.state as { from?: string } | null)?.from
      navigate(from?.startsWith('/app') ? from : mode === 'register' ? '/onboarding' : '/app', { replace: true })
    } catch (caught) {
      setError(safeErrorMessage(caught, 'We could not access your workspace.'))
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="auth-page">
    <section className="auth-story">
      <Link className="auth-brand" to="/"><span className="auth-brand-mark"><BarChart3 size={18} /></span>Forecast<span>Studio</span></Link>
      <div className="auth-story-copy"><span className="live-pill"><i /> AI TEAM OS</span><h1>Your AI Data Science Team is ready.</h1><p>One secure workspace for forecasts, risks, executive reviews, and decisions grounded in your business data.</p><ul><li><Check size={14} /> Five specialized agents</li><li><Check size={14} /> Private workspace in Neon</li><li><Check size={14} /> Evidence behind every recommendation</li></ul></div>
      <div className="auth-signal"><Sparkles size={16} /><div><small>TEAM SIGNAL</small><b>Inventory risk detected 12 days early</b></div><em>94%</em></div>
    </section>
    <section className="auth-form-side">
      <form className="auth-card" onSubmit={(event) => { void submit(event) }}>
        <div className="auth-lock"><LockKeyhole size={18} /></div>
        <span className="section-kicker">{mode === 'login' ? 'WELCOME BACK' : 'CREATE YOUR WORKSPACE'}</span>
        <h2>{mode === 'login' ? 'Sign in to your studio.' : 'Deploy your AI Team.'}</h2>
        <p>{mode === 'login' ? 'Continue to your live decision workspace.' : 'Start with a private account, then connect your first dataset.'}</p>
        {mode === 'register' && <label><span>Full name</span><input autoComplete="name" required minLength={2} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Alex Morgan" /></label>}
        <label><span>Work email</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="alex@company.com" /></label>
        <label><span>Password</span><div className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" /><button type="button" onClick={() => setShowPassword((shown) => !shown)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>
        {error && <div className="auth-error">{error}</div>}
        <button className="button button-dark auth-submit" disabled={submitting}>{submitting ? <><span className="spinner" /> Securing workspace...</> : <>{mode === 'login' ? 'Enter Command Center' : 'Create secure workspace'} <ArrowRight size={15} /></>}</button>
        <div className="auth-switch">{mode === 'login' ? <>New to Forecast Studio? <Link to="/register">Create an account</Link></> : <>Already have a workspace? <Link to="/login">Sign in</Link></>}</div>
      </form>
    </section>
  </main>
}
