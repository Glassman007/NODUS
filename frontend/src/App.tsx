import { useEffect, useRef, useState } from 'react'
import { graphRequest, ApiFailure } from './api/graphClient'

type Entity = {
  id: string; type: string | null; name: string | null; description: string | null
  conflicts: Record<string, string[]>
}
type Relationship = {
  id: string; source_id: string; target_id: string; type: string; active: boolean
  observed_at?: string; valid_from?: string; valid_to?: string
  source_id_ref?: string; record_id?: string
}
type Evidence = { source_id: string; record_id: string; title: string; uri?: string; observed_at?: string }
type Assertion = { source_id: string; record_id: string; name?: string; type?: string; description?: string; current: boolean; observed_at?: string }
type Workspace = { id: string; name: string }
type Page<T> = { items: T[]; has_more?: boolean; truncated?: boolean }
type Neighborhood = { nodes: Entity[]; relationships: Relationship[]; truncated: boolean }
type Session = { subject: string; tenant_id: string; permissions: string[] }

const stored = (key: string) => { try { return localStorage.getItem(`graphhacks.${key}`) || '' } catch { return '' } }
const message = (cause: unknown) => cause instanceof ApiFailure ? cause.message : cause instanceof Error ? cause.message : 'Request failed.'

export function App() {
  const [baseUrl, setBaseUrl] = useState(stored('apiUrl'))
  const [token, setToken] = useState(stored('token'))
  const [session, setSession] = useState<Session | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspace, setWorkspace] = useState('')
  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [searched, setSearched] = useState(false)
  const [results, setResults] = useState<Entity[]>([])
  const [selected, setSelected] = useState<Entity | null>(null)
  const [graph, setGraph] = useState<Neighborhood | null>(null)
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [assertions, setAssertions] = useState<Assertion[]>([])
  const [sources, setSources] = useState<{ id: string; records: number }[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const scopeGeneration = useRef(0)
  const controllers = useRef(new Set<AbortController>())
  const searchGeneration = useRef(0)
  const detailGeneration = useRef(0)
  const searchController = useRef<AbortController | null>(null)
  const detailController = useRef<AbortController | null>(null)

  function invalidate() {
    scopeGeneration.current += 1
    searchGeneration.current += 1
    detailGeneration.current += 1
    controllers.current.forEach(controller => controller.abort())
    controllers.current.clear()
    searchController.current = null
    detailController.current = null
    setLoading(false)
    setError('')
  }

  function resetGraph() {
    setQuery(''); setOffset(0); setHasMore(false); setSearched(false)
    setResults([]); setSelected(null); setGraph(null); setEvidence([]); setAssertions([])
    setSources([]); setShowHistory(false)
  }

  function updateConnection(value: string, kind: 'url' | 'token') {
    invalidate()
    resetGraph()
    setSession(null); setWorkspaces([]); setWorkspace('')
    if (kind === 'url') setBaseUrl(value)
    else setToken(value)
  }

  async function connect() {
    invalidate()
    resetGraph()
    const generation = scopeGeneration.current
    const controller = new AbortController()
    controllers.current.add(controller)
    setLoading(true)
    try {
      const current = await graphRequest<Session>(baseUrl, token, '/api/v1/session', controller.signal)
      const available = await graphRequest<Page<Workspace>>(baseUrl, token, '/api/v1/workspaces', controller.signal)
      if (generation !== scopeGeneration.current) return
      setSession(current); setWorkspaces(available.items)
      setWorkspace(available.items[0]?.id || '')
      try { localStorage.setItem('graphhacks.apiUrl', baseUrl); localStorage.setItem('graphhacks.token', token) } catch { /* storage disabled */ }
    } catch (cause) {
      if (generation === scopeGeneration.current && !controller.signal.aborted) setError(message(cause))
    } finally {
      controllers.current.delete(controller)
      if (generation === scopeGeneration.current) setLoading(false)
    }
  }

  function selectWorkspace(id: string) {
    if (!workspaces.some(item => item.id === id)) return
    invalidate()
    resetGraph()
    setWorkspace(id)
  }

  const prefix = workspace ? `/api/v1/workspaces/${encodeURIComponent(workspace)}` : ''
  const canEvidence = Boolean(session?.permissions.includes('READ_EVIDENCE') || session?.permissions.includes('ADMIN'))

  useEffect(() => {
    if (!session || !workspace || !canEvidence) return
    const generation = scopeGeneration.current
    const controller = new AbortController()
    controllers.current.add(controller)
    graphRequest<Page<{ id: string; records: number }>>(baseUrl, token, `${prefix}/sources`, controller.signal)
      .then(page => { if (generation === scopeGeneration.current) setSources(page.items) })
      .catch(cause => {
        if (generation === scopeGeneration.current && !controller.signal.aborted && canEvidence) setError(message(cause))
      })
      .finally(() => controllers.current.delete(controller))
    return () => { controller.abort(); controllers.current.delete(controller) }
  }, [baseUrl, token, session, workspace, canEvidence])

  async function searchAt(nextOffset: number) {
    if (!workspace || !query.trim()) return
    searchController.current?.abort()
    const controller = new AbortController()
    searchController.current = controller
    controllers.current.add(controller)
    const scope = scopeGeneration.current
    const operation = ++searchGeneration.current
    setLoading(true); setError('')
    try {
      const page = await graphRequest<Page<Entity>>(baseUrl, token,
        `${prefix}/search?q=${encodeURIComponent(query.trim())}&offset=${nextOffset}&limit=25`,
        controller.signal)
      if (scope !== scopeGeneration.current || operation !== searchGeneration.current) return
      setResults(page.items); setHasMore(Boolean(page.has_more)); setOffset(nextOffset); setSearched(true)
      setSelected(null); setGraph(null); setEvidence([]); setAssertions([])
    } catch (cause) {
      if (scope === scopeGeneration.current && operation === searchGeneration.current && !controller.signal.aborted) setError(message(cause))
    } finally {
      controllers.current.delete(controller)
      if (scope === scopeGeneration.current && operation === searchGeneration.current) setLoading(false)
    }
  }

  async function selectEntity(id: string, history = showHistory) {
    if (!workspace) return
    detailController.current?.abort()
    const controller = new AbortController()
    detailController.current = controller
    controllers.current.add(controller)
    const scope = scopeGeneration.current
    const operation = ++detailGeneration.current
    setLoading(true); setError('')
    try {
      const path = `${prefix}/entities/${encodeURIComponent(id)}`
      const detail = await graphRequest<Entity>(baseUrl, token, path, controller.signal)
      const neighbors = await graphRequest<Neighborhood>(baseUrl, token,
        `${path}/neighborhood?history=${history}`, controller.signal)
      const refs = canEvidence
        ? await graphRequest<Page<Evidence>>(baseUrl, token, `${path}/evidence`, controller.signal)
        : { items: [] }
      const claims = canEvidence
        ? await graphRequest<Page<Assertion>>(baseUrl, token, `${path}/assertions`, controller.signal)
        : { items: [] }
      if (scope !== scopeGeneration.current || operation !== detailGeneration.current) return
      setSelected(detail); setGraph(neighbors); setEvidence(refs.items); setAssertions(claims.items)
    } catch (cause) {
      if (scope === scopeGeneration.current && operation === detailGeneration.current && !controller.signal.aborted) setError(message(cause))
    } finally {
      controllers.current.delete(controller)
      if (scope === scopeGeneration.current && operation === detailGeneration.current) setLoading(false)
    }
  }

  return <div className="app">
    <header><strong>GraphHacks</strong><span>Source backed graph explorer</span></header>
    <main>
      <section className="settings">
        <h1>Explore your graph</h1>
        <p>Connect with an authorized API token, then select a workspace.</p>
        <div className="row"><label>API URL<input value={baseUrl} onChange={event => updateConnection(event.target.value, 'url')} placeholder="http://localhost:8000" /></label>
          <label>Bearer token<input type="password" value={token} onChange={event => updateConnection(event.target.value, 'token')} /></label>
          <button onClick={() => void connect()} disabled={loading || !token}>Connect</button></div>
        {session && <div className="row"><span>Signed in as {session.subject} · {session.tenant_id}</span>
          <label>Workspace<select value={workspace} onChange={event => selectWorkspace(event.target.value)}>
            {workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label></div>}
      </section>
      {error && <div className="error" role="alert">{error}</div>}
      {loading && <p role="status">Loading graph data…</p>}
      {session && workspace && <>
        <section><h2>Search</h2><form className="row" onSubmit={event => { event.preventDefault(); void searchAt(0) }}>
          <input aria-label="Search entities" value={query} onChange={event => { setQuery(event.target.value); setSearched(false); setOffset(0) }} placeholder="Name or external ID" />
          <button disabled={loading || !query.trim()}>Search</button></form>
          {searched && !loading && results.length === 0 && <p className="muted">No matching entities. A fresh workspace stays empty until authorized records are imported.</p>}
          <div className="cards">{results.map(entity => <button className="card" key={entity.id} onClick={() => void selectEntity(entity.id)}>
            <small>{entity.type || 'Type conflict'}</small><strong>{entity.name || entity.id}</strong><span>{entity.id}</span></button>)}</div>
          {searched && (offset > 0 || hasMore) && <div className="row">
            <button disabled={loading || offset === 0} onClick={() => void searchAt(Math.max(0, offset - 25))}>Previous</button>
            <span>Page {Math.floor(offset / 25) + 1}</span>
            <button disabled={loading || !hasMore} onClick={() => void searchAt(offset + 25)}>Next</button>
          </div>}</section>
        {selected && <section><button onClick={() => { setSelected(null); setGraph(null); setEvidence([]); setAssertions([]) }}>Back to search results</button>
          <h2>{selected.name || selected.id}</h2>
          <p>{selected.description || 'No unambiguous description supplied.'}</p>
          <p className="muted">{selected.type || 'Type conflict'} · {selected.id}</p>
          {Object.entries(selected.conflicts).map(([field, values]) => <p key={field} className="error">Conflicting {field}: {values.join(' / ')}</p>)}
          <label className="check"><input type="checkbox" checked={showHistory} onChange={event => {
            setShowHistory(event.target.checked); void selectEntity(selected.id, event.target.checked)
          }} /> Include historical relationships</label>
          <h3>Connected entities</h3>{graph?.relationships.length ? <div className="edges">{graph.relationships.map(rel => <div className="edge" key={rel.id}>
            <button onClick={() => void selectEntity(rel.source_id)}>{rel.source_id}</button><span>{rel.type}{!rel.active ? ' · historical' : ''}</span>
            <button onClick={() => void selectEntity(rel.target_id)}>{rel.target_id}</button>
            {rel.valid_from && <small>From {rel.valid_from}</small>}{rel.valid_to && <small>To {rel.valid_to}</small>}
          </div>)}</div> : <p className="muted">No relationships found for this entity.</p>}
          {graph?.truncated && <p className="muted">Additional relationships were omitted by the query limit.</p>}
          {canEvidence && <><h3>Evidence and provenance</h3>{evidence.length ? <ul>{evidence.map(item => <li key={`${item.source_id}/${item.record_id}`}>
            {item.uri ? <a href={item.uri} target="_blank" rel="noreferrer">{item.title}</a> : item.title}
            <span className="muted"> · {item.source_id} / {item.record_id}{item.observed_at ? ` · ${item.observed_at}` : ''}</span></li>)}</ul>
            : <p className="muted">No accessible evidence for this entity.</p>}
            <h3>Source assertions</h3>{assertions.length ? <ul>{assertions.map((item, index) => <li key={`${item.source_id}/${item.record_id}/${index}`}>
              {item.current ? 'Current' : 'Historical'} · {item.name || 'Unnamed'} · {item.source_id} / {item.record_id}
            </li>)}</ul> : <p className="muted">No accessible assertions.</p>}</>}</section>}
        {canEvidence && <section><h2>Sources</h2>{sources.length ? <ul>{sources.map(source => <li key={source.id}>{source.id} · {source.records} records</li>)}</ul>
          : <p className="muted">No accessible source records in this workspace.</p>}</section>}
      </>}
    </main>
  </div>
}
