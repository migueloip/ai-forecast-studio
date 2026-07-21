import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Check, CheckCheck, CircleX, LoaderCircle, Sparkles, TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getNotifications, markAllNotificationsRead, markNotificationRead, type AppNotification } from '../api'
import { safeErrorMessage } from '../errors'

function timeAgo(value: string) {
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime())
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'Now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return days < 7 ? `${days}d` : new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function NotificationIcon({ severity }: { severity: AppNotification['severity'] }) {
  if (severity === 'success') return <Check size={14}/>
  if (severity === 'warning') return <TriangleAlert size={14}/>
  if (severity === 'error') return <CircleX size={14}/>
  return <Sparkles size={14}/>
}

export function NotificationCenter() {
  const navigate = useNavigate()
  const container = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState<AppNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const result = await getNotifications(30)
      setNotifications(result.notifications)
      setUnreadCount(result.unreadCount)
      setError('')
    } catch (caught) {
      if (!silent) setError(safeErrorMessage(caught, 'Notifications could not be loaded.'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const initial = window.setTimeout(() => { void refresh(true) }, 0)
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(true) }, 20_000)
    return () => { window.clearTimeout(initial); window.clearInterval(interval) }
  }, [refresh])

  useEffect(() => {
    const closeOutside = (event: MouseEvent) => { if (open && !container.current?.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [open])

  const openNotification = async (notification: AppNotification) => {
    if (!notification.read_at) {
      try {
        const result = await markNotificationRead(notification.id)
        setNotifications((current) => current.map((item) => item.id === notification.id ? result.notification : item))
        setUnreadCount((count) => Math.max(0, count - 1))
      } catch {
        // Navigation remains available if the read receipt cannot be persisted.
      }
    }
    setOpen(false)
    if (notification.action_url?.includes('context=')) window.location.assign(notification.action_url)
    else if (notification.action_url) navigate(notification.action_url)
  }

  const markAll = async () => {
    try {
      await markAllNotificationsRead()
      const readAt = new Date().toISOString()
      setNotifications((current) => current.map((notification) => ({ ...notification, read_at: notification.read_at ?? readAt })))
      setUnreadCount(0)
    } catch (caught) {
      setError(safeErrorMessage(caught, 'Read state could not be updated.'))
    }
  }

  return <div className="notification-center" ref={container}>
    <button className={`notification ${open ? 'is-open' : ''}`} aria-label={`${unreadCount} unread notifications`} aria-expanded={open} onClick={() => { const next = !open; setOpen(next); if (next) void refresh() }}><Bell size={16}/>{unreadCount > 0 && <><i/><span>{unreadCount > 9 ? '9+' : unreadCount}</span></>}</button>
    {open&&<section className="notification-popover" aria-label="Notifications">
      <header><div><small>AI TEAM OS</small><h2>Notifications</h2></div><button onClick={()=>{void markAll()}} disabled={!unreadCount}><CheckCheck size={14}/> Mark all read</button></header>
      <div className="notification-list">
        {loading&&<div className="notification-loading"><LoaderCircle size={16}/> Syncing with Neon...</div>}
        {!loading&&error&&<div className="notification-error"><TriangleAlert size={15}/><p>{error}</p><button onClick={()=>{void refresh()}}>Retry</button></div>}
        {!loading&&!error&&!notifications.length&&<div className="notification-empty"><Bell size={19}/><b>You're all caught up.</b><span>Agent alerts and workspace events will appear here.</span></div>}
        {!loading&&!error&&notifications.map((notification)=><button key={notification.id} className={`notification-item severity-${notification.severity} ${notification.read_at?'is-read':'is-unread'}`} onClick={()=>{void openNotification(notification)}}><span className="notification-type"><NotificationIcon severity={notification.severity}/></span><div><div><b>{notification.title}</b><time>{timeAgo(notification.created_at)}</time></div><p>{notification.message}</p></div>{!notification.read_at&&<i/>}</button>)}
      </div>
      <footer><span><i/> Live updates every 20 seconds</span><button onClick={()=>{void refresh()}}>Refresh now</button></footer>
    </section>}
  </div>
}
