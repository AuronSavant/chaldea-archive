import { useCallback, useEffect, useRef, useState } from 'react'
import { getSource, getScriptText, getCharaScript, asset } from './api.js'
import { compile, collectAssets } from './parser.js'
import { Engine } from './engine.js'
import { AudioManager } from './audio.js'
import { loadTokenizer, tokenizerReady } from './furigana.js'
import { CoffeeButton } from './Coffee.jsx'
import { Stage } from './Stage.jsx'
import { getProgress, setProgress, setLast, clearProgress, useStore, setSettings } from './store.js'

function Units({ units, count }) {
  const out = []
  let line = []
  const flush = (k) => {
    out.push(<span className="line" key={k}>{line}</span>)
    line = []
  }
  const n = Math.min(count, units.length)
  for (let i = 0; i < n; i++) {
    const u = units[i]
    if (u.br) {
      flush(i)
      continue
    }
    const style = u.color || u.size !== 1 ? { color: u.color, fontSize: u.size !== 1 ? `${u.size}em` : undefined } : undefined
    line.push(
      u.ruby ? (
        <ruby key={i} style={style}>
          {u.ruby}
          <rt>{u.rt}</rt>
        </ruby>
      ) : (
        <span key={i} style={style}>
          {u.ch}
        </span>
      ),
    )
  }
  flush('end')
  return out
}

function MessageBox({ msg, visible, speed, instant, shake, onTyped, typingRef }) {
  const [count, setCount] = useState(0)
  const total = msg ? msg.units.length : 0
  useEffect(() => {
    if (!msg) return
    if (instant || speed >= 200) {
      setCount(Infinity)
      return
    }
    setCount(0)
    let c = 0
    const step = Math.max(1, Math.round(speed / 60))
    const id = setInterval(() => {
      c += step
      setCount(c)
      if (c >= total) clearInterval(id)
    }, 1000 / Math.min(speed, 60))
    return () => clearInterval(id)
  }, [msg?.key, instant, speed])

  const typing = !!msg && count < total
  useEffect(() => {
    typingRef.current = typing ? () => setCount(Infinity) : null
    if (msg && !typing) onTyped(msg.key)
  }, [typing, msg?.key])

  if (!msg) return null
  return (
    <div
      className={`msgbox ${visible ? '' : 'hidden'}`}
      key={shake?.key}
      style={shake ? { '--sx': `${shake.x}px`, '--sy': `${shake.y}px`, animation: `shake 0.06s linear ${Math.ceil(shake.dur / 0.06)}` } : undefined}
    >
      {msg.name && <div className="nameplate">{msg.name}</div>}
      <div className="msgtext">
        <Units units={msg.units} count={count} />
      </div>
      {!typing && <div className="next-indicator">▼</div>}
    </div>
  )
}

function Backlog({ log, onClose }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current?.scrollTo(0, ref.current.scrollHeight)
  }, [])
  // Scrolling down past the newest line returns to the story (mirror of wheel-up opening it).
  const onWheel = (e) => {
    const el = ref.current
    if (e.deltaY > 0 && el && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) onClose()
  }
  return (
    <div className="backlog" onClick={(e) => e.stopPropagation()} onWheel={onWheel}>
      <div className="backlog-head">
        <span>Log</span>
        <button className="icon-btn" onClick={onClose}>Close ✕</button>
      </div>
      <div className="backlog-list" ref={ref}>
        {log.map((e, i) =>
          e.choice ? (
            <div className="log-choice" key={i}>
              ▸ {e.choice}
            </div>
          ) : (
            <div className="log-entry" key={i}>
              {e.name && <div className="log-name">{e.name}</div>}
              <div className="log-text">{e.text}</div>
            </div>
          ),
        )}
      </div>
    </div>
  )
}

export function Reader({ warId, scriptId, navigate }) {
  const { settings } = useStore()
  const region = settings.region
  const [source, setSource] = useState(null)
  const [compiled, setCompiled] = useState(null)
  const [error, setError] = useState(null)
  const [phase, setPhase] = useState('loading') // loading | title | playing
  const [state, setState] = useState(null)
  const [auto, setAuto] = useState(false)
  const [skip, setSkip] = useState(false)
  const [hidden, setHidden] = useState(false)
  const [showLog, setShowLog] = useState(false)
  const [typedKey, setTypedKey] = useState(null)
  const engineRef = useRef(null)
  const audioRef = useRef(null)
  const typingRef = useRef(null)
  const [lang, setLang] = useState(region === 'JP' ? 'JA' : 'EN')
  const [toast, setToast] = useState(null)
  const byLang = useRef({})
  const switching = useRef(false)
  const ctxRef = useRef({})

  const playlist = source ? source.playlist : []
  const idx = playlist.findIndex((p) => p.scriptId === scriptId)
  const item = playlist[idx]
  const next = idx >= 0 ? playlist[idx + 1] : null
  const saved = getProgress(region, scriptId)

  // load war + script, preload face data
  useEffect(() => {
    let alive = true
    setPhase('loading')
    setCompiled(null)
    setError(null)
    setState(null)
    ;(async () => {
      try {
        const src = await getSource(region, warId)
        if (!alive) return
        setSource(src)
        const it = src.playlist.find((p) => p.scriptId === scriptId)
        if (!it) throw new Error('Script not found in this chapter')
        const text = await getScriptText(it.url)
        const c = compile(text)
        const assets = collectAssets(c.prog)
        await Promise.race([
          Promise.all(assets.figures.map((id) => getCharaScript(region, id))),
          new Promise((r) => setTimeout(r, 4000)),
        ])
        // warm the image cache for the first few scenes / figures
        assets.scenes.slice(0, 4).forEach((id) => (new Image().src = asset.bg(region, id)))
        assets.figures.slice(0, 6).forEach((id) => (new Image().src = asset.figure(region, id)))
        if (!alive) return
        const l = region === 'JP' ? 'JA' : 'EN'
        byLang.current = { [l]: c }
        setLang(l)
        setCompiled(c)
        setPhase('title')
      } catch (e) {
        if (alive) setError(String(e.message || e))
      }
    })()
    return () => {
      alive = false
    }
  }, [region, warId, scriptId])

  // teardown
  useEffect(
    () => () => {
      engineRef.current?.destroy()
      audioRef.current?.dispose()
    },
    [scriptId],
  )

  useEffect(() => {
    audioRef.current?.setVolumes({ bgm: settings.bgmVol, se: settings.seVol, muted: settings.muted })
  }, [settings.bgmVol, settings.seVol, settings.muted])

  // resumeOrd: message ordinal to fast-forward to (null = from the top)
  const begin = (resumeOrd, comp = compiled, keepAudio = false) => {
    if (!comp) return
    if (resumeOrd == null) clearProgress(region, scriptId)
    engineRef.current?.destroy()
    let audio = keepAudio ? audioRef.current : null
    if (!audio) {
      audioRef.current?.dispose()
      audio = new AudioManager(region)
      audio.setVolumes({ bgm: settings.bgmVol, se: settings.seVol, muted: settings.muted })
      audioRef.current = audio
    }
    const compiled = comp
    const compLang = Object.keys(byLang.current).find((k) => byLang.current[k] === comp) || lang
    ctxRef.current = {
      playerName: settings.playerName,
      gender: settings.gender,
      autoRuby: compLang === 'JA' && settings.furigana && tokenizerReady(),
    }
    const eng = new Engine(compiled, {
      region,
      ctx: ctxRef.current,
      audio,
      onState: setState,
      onMessage: (ins, at) => {
        setProgress(region, scriptId, { pc: at, ord: ins.ord, total: compiled.msgCount, warId })
      },
      onEnd: () => {
        setProgress(region, scriptId, { done: true, ord: compiled.msgCount, total: compiled.msgCount, pc: 0, warId })
        setAuto(false)
        setSkip(false)
      },
    })
    engineRef.current = eng
    setLast({ region, warId, scriptId })
    setPhase('playing')
    setState({ ...eng.state })
    const pc = resumeOrd ? compiled.prog.findIndex((i) => i.op === 'msg' && i.ord === resumeOrd) : -1
    eng.start(pc > 0 ? pc : null)
  }

  // G: swap the script text between English (NA) and Japanese (JP) in place.
  const textUrl = (l) => (l === 'JA' ? item.url.replace('/NA/', '/JP/') : item.url.replace('/JP/', '/NA/'))
  const toggleLang = async () => {
    if (!item || !compiled || switching.current) return
    const target = lang === 'EN' ? 'JA' : 'EN'
    switching.current = true
    try {
      let c = byLang.current[target]
      if (!c) {
        try {
          c = compile(await getScriptText(textUrl(target)))
        } catch {
          return flash(target === 'EN' ? 'No English version of this scene yet' : 'Japanese text unavailable')
        }
        byLang.current[target] = c
      }
      const cur = state?.msg ? compiled.prog[state.msg.key]?.ord ?? 0 : 0
      const ord = c.msgCount === compiled.msgCount ? cur : Math.round((cur * c.msgCount) / (compiled.msgCount || 1))
      setLang(target)
      setCompiled(c)
      if (phase === 'playing' && !state?.ended) begin(ord, c, true)
      flash(target === 'JA' ? '日本語' : 'English')
    } finally {
      switching.current = false
    }
  }
  // Furigana: fetch the dictionary on demand, then re-render the current line.
  useEffect(() => {
    const want = phase === 'playing' && lang === 'JA' && settings.furigana
    if (!want) {
      ctxRef.current.autoRuby = false
      return
    }
    let alive = true
    if (!tokenizerReady()) flash('Loading furigana dictionary…')
    loadTokenizer()
      .then(() => {
        if (!alive) return
        ctxRef.current.autoRuby = true
        engineRef.current?.refreshText()
      })
      .catch(() => alive && flash("Couldn't load the furigana dictionary"))
    return () => {
      alive = false
    }
  }, [phase, lang, settings.furigana, compiled])

  const toggleFurigana = () => {
    setSettings({ furigana: !settings.furigana })
    flash(settings.furigana ? 'Furigana off' : 'Furigana on')
  }

  const flash = (msg) => {
    setToast({ msg, key: Date.now() })
  }
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1400)
    return () => clearTimeout(t)
  }, [toast])

  const advance = useCallback(() => {
    const eng = engineRef.current
    if (!eng) return
    if (typingRef.current) return typingRef.current()
    eng.advance()
  }, [])

  const goNext = () => next && navigate(`#/read/${warId}/${next.scriptId}`)
  const exit = () => navigate(`#/war/${warId}`)

  // auto / skip timers
  useEffect(() => {
    if (phase !== 'playing' || !state || state.choices || state.ended || showLog) return
    if (!(auto || skip)) return
    if (state.msg && typedKey !== state.msg.key && !skip) return
    const len = state.msg ? state.msg.units.length : 0
    const delay = skip ? 70 : settings.autoDelay * 1000 + len * 28
    const t = setTimeout(advance, delay)
    return () => clearTimeout(t)
  }, [auto, skip, typedKey, state?.msg?.key, state?.choices, state?.ended, state?.msgVisible, phase, showLog])

  useEffect(() => {
    if (state?.choices || state?.ended) setSkip(false)
  }, [state?.choices, state?.ended])

  // keyboard
  useEffect(() => {
    const down = (e) => {
      if (e.target.tagName === 'INPUT') return
      if (phase === 'title') {
        if (e.key === 'Enter' || e.key === ' ') begin(saved?.ord && !saved?.done ? saved.ord : null)
        if (e.key === 'g' || e.key === 'G') toggleLang()
        if (e.key === 'y' || e.key === 'Y') toggleFurigana()
        if (e.key === 'Escape') exit()
        return
      }
      if (phase !== 'playing') return
      if (showLog) {
        if (e.key === 'Escape' || e.key === 'l' || e.key === 'L' || e.key === 'ArrowDown') setShowLog(false)
        return
      }
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault()
        if (hidden) setHidden(false)
        else if (state?.ended) goNext()
        else advance()
      } else if (e.key === 'Control' && !e.repeat) setSkip(true)
      else if (e.key === 'a' || e.key === 'A') setAuto((v) => !v)
      else if (e.key === 's' || e.key === 'S') setSkip((v) => !v)
      else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowUp') setShowLog(true)
      else if (e.key === 'h' || e.key === 'H') setHidden((v) => !v)
      else if (e.key === 'm' || e.key === 'M') setSettings({ muted: !settings.muted })
      else if (e.key === 'g' || e.key === 'G') toggleLang()
      else if (e.key === 'y' || e.key === 'Y') toggleFurigana()
      else if (e.key === 'Escape') hidden ? setHidden(false) : exit()
    }
    const up = (e) => {
      if (e.key === 'Control') setSkip(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [phase, showLog, hidden, state?.ended, state?.msg?.key, saved, compiled, settings.muted, settings.furigana, next, lang, item])

  const title = source?.title || ''

  if (error)
    return (
      <div className="reader center-msg">
        <p>Couldn't load this story: {error}</p>
        <button className="btn" onClick={exit}>Back</button>
      </div>
    )

  if (phase !== 'playing' || !state)
    return (
      <div className="reader title-card">
        <div className="title-inner">
          <div className="kicker">{title}</div>
          <h1>{item?.questName || '…'}</h1>
          <div className="sub">{item?.label}</div>
          {phase === 'title' && (
            <button className="btn ghost small" onClick={toggleLang}>Text: {lang === 'EN' ? 'English' : '日本語'} (G)</button>
          )}
          {phase === 'loading' ? (
            <div className="loading">Rayshifting…</div>
          ) : (
            <div className="title-actions">
              {saved?.ord && !saved?.done ? (
                <>
                  <button className="btn primary" onClick={() => begin(saved.ord)}>
                    Continue · {Math.round(((saved.ord || 0) / (saved.total || 1)) * 100)}%
                  </button>
                  <button className="btn" onClick={() => begin(null)}>Start over</button>
                </>
              ) : (
                <button className="btn primary" onClick={() => begin(null)}>
                  {saved?.done ? 'Read again' : 'Begin'}
                </button>
              )}
              <button className="btn ghost" onClick={exit}>Back to chapter</button>
            </div>
          )}
          <div className="hint">Click / Space to advance · A auto · S or Ctrl skip · L log · H hide · M mute · G English/日本語 · Y furigana</div>
        </div>
      </div>
    )

  const onStageClick = () => {
    if (showLog) return
    if (hidden) return setHidden(false)
    if (state.choices || state.ended) return
    advance()
  }

  const pct = compiled?.msgCount ? Math.round((((state.msg && compiled.prog[state.msg.key]?.ord) || 0) / compiled.msgCount) * 100) : 0

  return (
    <div className={`reader ${settings.furigana ? '' : 'no-furigana'}`}>
      <Stage
        state={state}
        onClick={onStageClick}
        onContextMenu={(e) => {
          e.preventDefault()
          setHidden((v) => !v)
        }}
        onWheel={(e) => {
          if (e.deltaY < 0 && !showLog) setShowLog(true)
          else if (e.deltaY > 0 && !showLog && !hidden && !state.choices) advance()
        }}
      >
        {!hidden && (
          <MessageBox
            msg={state.msg}
            visible={state.msgVisible}
            speed={settings.textSpeed}
            instant={skip}
            shake={state.msgShake}
            onTyped={setTypedKey}
            typingRef={typingRef}
          />
        )}
        {state.choices && !hidden && (
          <div className="choices" onClick={(e) => e.stopPropagation()}>
            {state.choices.options.map((o, i) => (
              <button key={i} className="choice" onClick={() => engineRef.current.choose(i)}>
                {o.text}
              </button>
            ))}
          </div>
        )}
        {state.ended && (
          <div className="end-card" onClick={(e) => e.stopPropagation()}>
            <div className="end-label">Section complete</div>
            {next ? (
              <>
                <div className="end-next">
                  Next: <b>{next.questName}</b> <span>{next.label}</span>
                </div>
                <button className="btn primary" onClick={goNext}>Continue ▸</button>
              </>
            ) : (
              <div className="end-next">You've reached the end of this chapter.</div>
            )}
            <button className="btn ghost" onClick={exit}>Back to chapter</button>
            <div className="end-support"><CoffeeButton small /></div>
          </div>
        )}
      </Stage>

      {!hidden && (
        <div className="hud">
          <div className="hud-left">
            <button className="icon-btn" onClick={exit} title="Back (Esc)">←</button>
            <div className="hud-title">
              <span>{item?.questName}</span>
              <small>{item?.label} · {pct}%</small>
            </div>
          </div>
          <div className="hud-right">
            <button className={`icon-btn ${settings.furigana ? 'on-soft' : ''}`} onClick={toggleFurigana} title="Furigana on/off (Y)" style={settings.furigana ? undefined : { textDecoration: 'line-through', opacity: 0.6 }}>ふ</button>
            <button className="icon-btn" onClick={toggleLang} title="Switch English / Japanese (G)">{lang === 'EN' ? 'EN' : 'JA'}</button>
            <button className={`icon-btn ${auto ? 'on' : ''}`} onClick={() => setAuto((v) => !v)} title="Auto (A)">Auto</button>
            <button className={`icon-btn ${skip ? 'on' : ''}`} onClick={() => setSkip((v) => !v)} title="Skip (S / hold Ctrl)">Skip</button>
            <button className="icon-btn" onClick={() => setShowLog(true)} title="Log (L)">Log</button>
            <button className="icon-btn" onClick={() => setHidden(true)} title="Hide UI (H / right-click)">Hide</button>
            <button className={`icon-btn ${settings.muted ? '' : 'on-soft'}`} onClick={() => setSettings({ muted: !settings.muted })} title="Mute (M)">
              {settings.muted ? '♪̸' : '♪'}
            </button>
          </div>
        </div>
      )}
      {toast && <div className="toast" key={toast.key}>{toast.msg}</div>}
      {showLog && engineRef.current && <Backlog log={engineRef.current.log} onClose={() => setShowLog(false)} />}
    </div>
  )
}
