import { useEffect, useRef } from 'react'

interface TurnstileApi {
  render: (container: HTMLElement, options: {
    sitekey: string
    action: string
    theme: 'light'
    size: 'flexible'
    callback: (token: string) => void
    'error-callback': () => void
    'expired-callback': () => void
    'timeout-callback': () => void
  }) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-turnstile-script]')
    const script = existing ?? document.createElement('script')
    const loaded = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile API did not initialize.'))
    const failed = () => reject(new Error('Turnstile API could not be loaded.'))

    script.addEventListener('load', loaded, { once: true })
    script.addEventListener('error', failed, { once: true })
    if (!existing) {
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.dataset.turnstileScript = 'true'
      document.head.appendChild(script)
    }
  })

  return scriptPromise
}

interface TurnstileWidgetProps {
  siteKey: string
  action: 'login' | 'register'
  onToken: (token: string) => void
  onExpired: () => void
  onError: () => void
}

export function TurnstileWidget({ siteKey, action, onToken, onExpired, onError }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const callbacks = useRef({ onToken, onExpired, onError })

  useEffect(() => {
    callbacks.current = { onToken, onExpired, onError }
  }, [onError, onExpired, onToken])

  useEffect(() => {
    let active = true
    let widgetId: string | null = null

    void loadTurnstile()
      .then((turnstile) => {
        if (!active || !containerRef.current) return
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          action,
          theme: 'light',
          size: 'flexible',
          callback: (token) => callbacks.current.onToken(token),
          'error-callback': () => callbacks.current.onError(),
          'expired-callback': () => callbacks.current.onExpired(),
          'timeout-callback': () => callbacks.current.onExpired(),
        })
      })
      .catch(() => { if (active) callbacks.current.onError() })

    return () => {
      active = false
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [action, siteKey])

  return <div className="turnstile-widget" ref={containerRef} />
}
