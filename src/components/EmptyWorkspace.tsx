import { ArrowRight, Database, ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

export function EmptyWorkspace({ title = 'The AI Team is waiting for business data.', description = 'Upload a dataset to assemble your Executive AI Team and build the first validated business forecast.' }: { title?: string; description?: string }) {
  return <section className="empty-workspace panel"><span><Database size={22}/></span><small>WORKSPACE SETUP</small><h2>{title}</h2><p>{description}</p><Link className="button button-app" to="/onboarding">Connect data <ArrowRight size={14}/></Link><em><ShieldAlert size={12}/> Your source records stay in your private Neon workspace.</em></section>
}
