import { useEffect, useMemo, useState } from 'react'
import { getWarList, getSource, getServantList, groupWars, warTitle } from './api.js'
import { useStore, setSettings, progressKey } from './store.js'
import { CoffeeButton } from './Coffee.jsx'

function useWarProgress(progress, region) {
  return useMemo(() => {
    const byWar = {}
    for (const [k, v] of Object.entries(progress)) {
      if (!k.startsWith(region + ':') || !v.warId) continue
      const w = (byWar[v.warId] ||= { done: 0, started: 0 })
      if (v.done) w.done++
      else w.started++
    }
    return byWar
  }, [progress, region])
}

function WarLink({ w, active, prog, navigate }) {
  const { title, kicker } = warTitle(w)
  return (
    <button className={`war-link ${active ? 'active' : ''}`} onClick={() => navigate(`#/war/${w.id}`)}>
      <span className="war-link-text">
        {kicker && <small>{kicker}</small>}
        <span>{title}</span>
      </span>
      {prog && <span className="war-badge">{prog.done || '•'}</span>}
    </button>
  )
}

function Sidebar({ wars, warId, navigate, open, setOpen }) {
  const { settings, progress } = useStore()
  const [q, setQ] = useState('')
  const [showEvents, setShowEvents] = useState(true)
  const [showSettings, setShowSettings] = useState(false)
  const prog = useWarProgress(progress, settings.region)
  const { groups, events, other } = useMemo(() => groupWars(wars || [], settings.region), [wars, settings.region])
  const match = (w) => !q || (w.longName + ' ' + w.name + ' ' + w.eventName).toLowerCase().includes(q.toLowerCase())

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`}>
      <div className="brand" onClick={() => navigate('#/')}>
        <div className="brand-mark">◈</div>
        <div>
          <div className="brand-name">Chaldea Archive</div>
          <div className="brand-sub">FGO story reader</div>
        </div>
      </div>
      <div className="side-controls">
        <div className="seg">
          {['NA', 'JP'].map((r) => (
            <button key={r} className={settings.region === r ? 'on' : ''} onClick={() => setSettings({ region: r })}>
              {r}
            </button>
          ))}
        </div>
        <input className="search" placeholder="Search chapters & events…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <nav className="side-nav" onClick={() => setOpen(false)}>
        {!wars && <div className="muted pad">Loading chapters…</div>}
        {groups.map((g) => {
          const list = g.wars.filter(match)
          if (!list.length) return null
          return (
            <section key={g.name}>
              <h3>{g.name}</h3>
              {list.map((w) => (
                <WarLink key={w.id} w={w} active={String(w.id) === warId} prog={prog[w.id]} navigate={navigate} />
              ))}
            </section>
          )
        })}
        <section>
          <h3>Servant Stories</h3>
          <button className={`war-link ${warId === 'servants' || warId?.startsWith('svt-') ? 'active' : ''}`} onClick={() => navigate('#/servants')}>
            <span className="war-link-text">
              <small>Every servant</small>
              <span>Interludes & Valentine scenes</span>
            </span>
          </button>
        </section>
        {other.filter(match).length > 0 && (
          <section>
            <h3>Other Stories</h3>
            {other.filter(match).map((w) => (
              <WarLink key={w.id} w={w} active={String(w.id) === warId} prog={prog[w.id]} navigate={navigate} />
            ))}
          </section>
        )}
        <section>
          <h3 className="toggle" onClick={(e) => (e.stopPropagation(), setShowEvents((v) => !v))}>
            Events ({events.reduce((n, t) => n + t.wars.length, 0)}) <span>{showEvents || q ? '▾' : '▸'}</span>
          </h3>
          {(showEvents || q) &&
            events.map((t) => {
              const list = t.wars.filter(match)
              if (!list.length) return null
              return (
                <div key={t.name}>
                  <div className="tier-label">{t.name}</div>
                  {list.map((w) => (
                    <WarLink key={w.id} w={w} active={String(w.id) === warId} prog={prog[w.id]} navigate={navigate} />
                  ))}
                </div>
              )
            })}
        </section>
      </nav>
      <div className="side-foot">
        <div className="side-foot-row">
          <button className="btn ghost small" onClick={() => setShowSettings((v) => !v)}>
            ⚙ Settings
          </button>
          <CoffeeButton small />
        </div>
        {showSettings && <Settings />}
      </div>
    </aside>
  )
}

function Settings() {
  const { settings } = useStore()
  return (
    <div className="settings">
      <label>
        Master name
        <input value={settings.playerName} onChange={(e) => setSettings({ playerName: e.target.value })} />
      </label>
      <label>
        Master
        <div className="seg">
          {[
            ['male', 'Gudao'],
            ['female', 'Gudako'],
          ].map(([v, l]) => (
            <button key={v} className={settings.gender === v ? 'on' : ''} onClick={() => setSettings({ gender: v })}>
              {l}
            </button>
          ))}
        </div>
      </label>
      <label>
        Text speed <span>{settings.textSpeed >= 200 ? 'Instant' : settings.textSpeed}</span>
        <input type="range" min="10" max="200" value={settings.textSpeed} onChange={(e) => setSettings({ textSpeed: +e.target.value })} />
      </label>
      <label>
        Auto delay <span>{settings.autoDelay.toFixed(1)}s</span>
        <input type="range" min="0.3" max="4" step="0.1" value={settings.autoDelay} onChange={(e) => setSettings({ autoDelay: +e.target.value })} />
      </label>
      <label>
        Music
        <input type="range" min="0" max="1" step="0.05" value={settings.bgmVol} onChange={(e) => setSettings({ bgmVol: +e.target.value })} />
      </label>
      <label>
        Sound effects
        <input type="range" min="0" max="1" step="0.05" value={settings.seVol} onChange={(e) => setSettings({ seVol: +e.target.value })} />
      </label>
    </div>
  )
}

function Home({ wars, navigate }) {
  const { last, progress, settings } = useStore()
  const [lastWar, setLastWar] = useState(null)
  useEffect(() => {
    if (last.warId && last.region === settings.region) getSource(last.region, last.warId).then(setLastWar).catch(() => {})
    else setLastWar(null)
  }, [last.warId, last.region, settings.region])
  const lastItem = lastWar && lastWar.playlist.find((p) => p.scriptId === last.scriptId)
  const lp = last.scriptId && progress[progressKey(last.region, last.scriptId)]
  const read = Object.entries(progress).filter(([k, v]) => k.startsWith(settings.region + ':') && v.done).length

  return (
    <div className="home">
      <div className="hero">
        <div className="hero-kicker">Humanity's Last Master — your reading log</div>
        <h1>Read Fate/Grand Order<br />the way it was meant to be seen.</h1>
        <p>
          Every main story chapter, interlude and event, played back in a proper visual-novel interface — sprites, expressions,
          backgrounds, music and all. Pulled live from the Atlas Academy archive.
        </p>
        <div className="hero-actions">
          {lastItem ? (
            <button className="btn primary" onClick={() => navigate(`#/read/${last.warId}/${last.scriptId}`)}>
              Continue: {lastItem.questName}
              {lp && !lp.done ? ` · ${Math.round(((lp.ord || 0) / (lp.total || 1)) * 100)}%` : ''}
            </button>
          ) : (
            <button className="btn primary" onClick={() => navigate('#/war/100')}>
              Begin at Singularity F
            </button>
          )}
          <button className="btn ghost" onClick={() => navigate('#/war/301')}>Jump to Lostbelt 1</button>
        </div>
        <div className="hero-support">
          <span>Enjoying the archive? This reader is free — a coffee keeps it running.</span>
          <CoffeeButton />
        </div>
        <div className="hero-stats">
          <div><b>{wars ? wars.length : '—'}</b><span>chapters & events</span></div>
          <div><b>{read}</b><span>sections read</span></div>
          <div><b>{settings.region}</b><span>server</span></div>
        </div>
      </div>
      <div className="keys">
        <h3>Controls</h3>
        <div className="key-grid">
          <span><kbd>Click</kbd><kbd>Space</kbd> advance</span>
          <span><kbd>A</kbd> auto</span>
          <span><kbd>S</kbd> / hold <kbd>Ctrl</kbd> skip</span>
          <span><kbd>L</kbd> / scroll up log</span>
          <span><kbd>H</kbd> / right-click hide UI</span>
          <span><kbd>M</kbd> mute</span>
          <span><kbd>G</kbd> English ⇄ 日本語</span>
          <span><kbd>Y</kbd> furigana on/off</span>
        </div>
      </div>
    </div>
  )
}

function WarPage({ warId, navigate }) {
  const { settings, progress } = useStore()
  const region = settings.region
  const [war, setWar] = useState(null)
  const [err, setErr] = useState(null)
  useEffect(() => {
    setWar(null)
    setErr(null)
    getSource(region, warId).then(setWar).catch((e) => setErr(String(e.message || e)))
  }, [region, warId])

  if (err) return <div className="pad muted">Couldn't load chapter: {err}</div>
  if (!war) return <div className="pad muted">Loading…</div>

  const list = war.playlist
  const { title, kicker } = war
  const quests = []
  for (const it of list) {
    let q = quests[quests.length - 1]
    if (!q || q.questId !== it.questId) quests.push((q = { questId: it.questId, name: it.questName, type: it.questType, items: [] }))
    q.items.push(it)
  }
  const pr = (s) => progress[progressKey(region, s)]
  const doneCount = list.filter((i) => pr(i.scriptId)?.done).length
  const nextUp = list.find((i) => !pr(i.scriptId)?.done)

  return (
    <div className="war-page">
      <header className="war-head">
        {war.banner && <img className="war-banner" src={war.banner} alt="" onError={(e) => (e.target.style.display = 'none')} />}
        {war.face && <img className="svt-face-lg" src={war.face} alt="" />}
        <div className="war-head-text">
          {kicker && <div className="kicker">{kicker}</div>}
          <h1>{title}</h1>
          {war.sub.map((t) => <div className="age" key={t}>{t}</div>)}
          <div className="war-progress">
            <div className="bar"><div style={{ width: `${list.length ? (doneCount / list.length) * 100 : 0}%` }} /></div>
            <span>{doneCount} / {list.length} sections</span>
          </div>
          {nextUp && (
            <button className="btn primary" onClick={() => navigate(`#/read/${warId}/${nextUp.scriptId}`)}>
              {doneCount ? 'Continue' : 'Start reading'} · {nextUp.questName}
            </button>
          )}
        </div>
      </header>
      {!list.length && <div className="pad muted">No story scenes here yet.</div>}
      <div className="quest-list">
        {quests.map((q, qi) => (
          <div className="quest" key={q.questId + '-' + qi}>
            <div className="quest-head">
              <span className="quest-no">{String(qi + 1).padStart(2, '0')}</span>
              <span className="quest-name">{q.name}</span>
              {q.type && q.type !== 'main' && <span className="tag">{q.type}</span>}
            </div>
            <div className="quest-items">
              {q.items.map((it) => {
                const p = pr(it.scriptId)
                const pct = p?.done ? 100 : p?.total ? Math.round(((p.ord || 0) / p.total) * 100) : 0
                return (
                  <button key={it.scriptId} className={`script-item ${p?.done ? 'done' : ''}`} onClick={() => navigate(`#/read/${warId}/${it.scriptId}`)}>
                    <span className="check">{p?.done ? '✓' : pct ? `${pct}%` : '▸'}</span>
                    <span>{it.label}</span>
                    {pct > 0 && !p?.done && <span className="mini-bar"><span style={{ width: pct + '%' }} /></span>}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const CLASS_ORDER = ['saber', 'archer', 'lancer', 'rider', 'caster', 'assassin', 'berserker', 'shielder', 'ruler', 'avenger', 'alterEgo', 'moonCancer', 'foreigner', 'pretender', 'beast']

function Servants({ navigate }) {
  const { settings, progress } = useStore()
  const [list, setList] = useState(null)
  const [q, setQ] = useState('')
  const [cls, setCls] = useState('all')
  useEffect(() => {
    setList(null)
    getServantList(settings.region).then(setList).catch(() => setList([]))
  }, [settings.region])
  const read = useMemo(() => {
    const m = {}
    for (const [k, v] of Object.entries(progress))
      if (k.startsWith(settings.region + ':') && v.done && String(v.warId).startsWith('svt-')) m[v.warId] = (m[v.warId] || 0) + 1
    return m
  }, [progress, settings.region])
  const svts = (list || [])
    .filter((s) => (s.type === 'normal' || s.type === 'heroine') && s.collectionNo > 0)
    .filter((s) => cls === 'all' || s.className === cls)
    .filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.collectionNo - b.collectionNo)
  const classes = CLASS_ORDER.filter((c) => (list || []).some((s) => s.className === c))
  return (
    <div className="war-page">
      <header className="svt-head">
        <div>
          <div className="kicker">Servant Stories</div>
          <h1>Interludes & Valentine scenes</h1>
          <div className="age">Pick a servant to read their personal stories.</div>
        </div>
        <input className="search" placeholder="Search servants…" value={q} onChange={(e) => setQ(e.target.value)} />
      </header>
      <div className="class-filter">
        {['all', ...classes].map((c) => (
          <button key={c} className={cls === c ? 'on' : ''} onClick={() => setCls(c)}>
            {c === 'all' ? 'All' : c}
          </button>
        ))}
      </div>
      {!list && <div className="pad muted">Loading servants…</div>}
      <div className="svt-grid">
        {svts.map((s) => (
          <button key={s.id} className="svt-card" onClick={() => navigate(`#/war/svt-${s.id}`)} title={s.name}>
            <img src={s.face} alt="" loading="lazy" />
            <span className="svt-no">No.{s.collectionNo}</span>
            <span className="svt-name">{s.name}</span>
            {read['svt-' + s.id] && <span className="svt-read">✓ {read['svt-' + s.id]}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Library({ route, navigate }) {
  const { settings } = useStore()
  const [wars, setWars] = useState(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    setWars(null)
    getWarList(settings.region).then(setWars).catch(() => setWars([]))
  }, [settings.region])
  const warId = route.name === 'war' ? route.warId : route.name === 'servants' ? 'servants' : null
  return (
    <div className="library">
      <button className="menu-btn" onClick={() => setOpen((v) => !v)}>☰</button>
      <Sidebar wars={wars} warId={warId} navigate={navigate} open={open} setOpen={setOpen} />
      <main className="main">
        {route.name === 'war' ? <WarPage warId={warId} navigate={navigate} /> : route.name === 'servants' ? <Servants navigate={navigate} /> : <Home wars={wars} navigate={navigate} />}
      </main>
    </div>
  )
}
