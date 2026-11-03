import { useEffect, useRef, useState } from 'react'
import { projectLabel } from '../workspace/projectNames'

interface DemoIdentity {
  token: string
  display_name: string
  role_code: string
  project_id: string | null
}

const ROLE_LABELS: Readonly<Record<string, string>> = {
  ADMIN: 'Administrator',
  DEVELOPER: 'Developer',
  INTERN: 'Intern',
}

function isDemoIdentity(value: unknown): value is DemoIdentity {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.token === 'string' && typeof item.display_name === 'string' &&
    typeof item.role_code === 'string' && (item.project_id === null || typeof item.project_id === 'string')
}

interface Props { onUseToken: (token: string) => void }

export function DemoAccessPanel({ onUseToken }: Props) {
  const [items, setItems] = useState<DemoIdentity[] | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/v1/nexus/demo-identities', { signal: controller.signal, cache: 'no-store', credentials: 'omit' })
      .then(response => (response.ok ? response.json() : null))
      .then(data => {
        const list = data && Array.isArray(data.items) ? data.items.filter(isDemoIdentity) : []
        setItems(list.length ? list : null)
      })
      .catch(() => setItems(null))
    return () => controller.abort()
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  if (!items) return null

  async function copyToken(token: string) {
    onUseToken(token)
    try {
      await navigator.clipboard.writeText(token)
    } catch {
      // Clipboard permission may be unavailable; the token is still shown and usable in the input.
    }
    setCopied(token)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), 1500)
  }

  return (
    <section className="demo-access" aria-label="Demo access">
      <p className="demo-access-heading">Demo Access</p>
      <div className="demo-access-cards">
        {items.map(item => (
          <div className="demo-card" key={item.token}>
            <div className="demo-card-top">
              <strong>{item.display_name}</strong>
              <span className="badge">{ROLE_LABELS[item.role_code] ?? item.role_code}</span>
            </div>
            <small>{item.project_id ? projectLabel(item.project_id) : 'Company-wide administration'}</small>
            <button type="button" className="text-button demo-copy" onClick={() => void copyToken(item.token)}>
              {copied === item.token ? 'Copied' : 'Copy Token'}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
