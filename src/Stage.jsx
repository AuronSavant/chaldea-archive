import { useEffect, useRef, useState } from 'react'
import { jpFallback } from './api.js'

export const STAGE_W = 1024
export const STAGE_H = 576

function FallbackImg(props) {
  const { src, ...rest } = props
  const [url, setUrl] = useState(src)
  useEffect(() => setUrl(src), [src])
  return (
    <img
      {...rest}
      src={url}
      draggable={false}
      onError={() => {
        const jp = jpFallback(url)
        if (jp !== url) setUrl(jp)
      }}
    />
  )
}

function Figure({ c, dim }) {
  const m = c.meta
  const ready = !!m
  const tile = c.face > 0 ? c.face - 1 : -1
  const col = tile % 4
  const row = Math.floor(tile / 4)
  const style = {
    left: c.x + (m?.offsetX || 0),
    top: -(m?.offsetY || 0) - c.y,
    opacity: ready ? c.opacity : 0,
    zIndex: 10 + c.z,
    transition: `opacity ${c.tOp}s linear, left ${c.tMove}s ease-in-out, top ${c.tMove}s ease-in-out, filter .3s`,
    filter: [c.filter, dim ? 'brightness(0.55)' : ''].filter(Boolean).join(' ') || 'none',
    transform: c.scale !== 1 ? `scale(${c.scale})` : undefined,
  }
  return (
    <div className={`chara${c.shake ? ' shaking' : ''}`} key={c.shake} style={style}>
      <div className="chara-body">
        <FallbackImg src={c.url} alt="" />
      </div>
      {tile >= 0 && !m?.noFace && (
        <div className="chara-face" style={{ left: m.faceX, top: m.faceY }}>
          <FallbackImg src={c.url} alt="" style={{ left: -col * 256, top: -(768 + row * 256) }} />
        </div>
      )}
    </div>
  )
}

function StageImage({ c, dim }) {
  const style = {
    opacity: c.opacity,
    zIndex: 10 + c.z,
    transition: `opacity ${c.tOp}s linear, transform ${c.tMove}s ease-in-out`,
    transform: `translate(calc(-50% + ${c.x}px), calc(-50% + ${-c.y}px)) scale(${c.scale})`,
    filter: [c.filter, dim ? 'brightness(0.55)' : ''].filter(Boolean).join(' ') || 'none',
  }
  return <FallbackImg className="stage-image" src={c.url} alt="" style={style} />
}

function Overlay({ o, className }) {
  if (!o) return null
  return (
    <div
      key={o.key}
      className={className}
      style={{
        background: o.color,
        '--from': o.from,
        '--to': o.to,
        opacity: o.to,
        animation: o.dur > 0 ? `ovfade ${o.dur}s linear ${o.loop ? 'infinite alternate' : 'forwards'}` : 'none',
      }}
    />
  )
}

export function Stage({ state, children, onClick, onContextMenu, onWheel }) {
  const wrap = useRef(null)
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = wrap.current
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      setScale(Math.min(r.width / STAGE_W, r.height / STAGE_H))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const chars = Object.values(state.chars).sort((a, b) => a.z - b.z)
  const cam = state.camera
  const sh = state.shake

  return (
    <div className="stage-wrap" ref={wrap} onClick={onClick} onContextMenu={onContextMenu} onWheel={onWheel}>
      <div className="stage" style={{ width: STAGE_W, height: STAGE_H, transform: `translate(-50%, -50%) scale(${scale})` }}>
        <div
          key={sh?.key}
          className="shake-layer"
          style={sh ? { '--sx': `${sh.x}px`, '--sy': `${sh.y}px`, animation: `shake 0.08s linear ${sh.dur > 0 ? Math.ceil(sh.dur / 0.08) : 'infinite'}` } : undefined}
        >
          <div
            className="camera"
            style={{
              transform: `scale(${cam.scale}) translate(${-cam.x}px, ${cam.y}px)`,
              transition: `transform ${cam.dur}s ease-in-out`,
            }}
          >
            {state.bgPrev && <FallbackImg className="bg" src={state.bgPrev.url} alt="" key={'p' + state.bgPrev.key} />}
            {state.bg && (
              <FallbackImg
                className="bg"
                src={state.bg.url}
                alt=""
                key={state.bg.key}
                style={{ animation: `fadein ${state.bg.dur}s linear both` }}
              />
            )}
            {chars.map((c) => {
              const dim = state.talkMode && state.talk && state.talk !== c.slot && c.opacity > 0
              return c.kind === 'image' ? <StageImage key={c.slot + c.key} c={c} dim={dim} /> : <Figure key={c.slot + c.key} c={c} dim={dim} />
            })}
          </div>
        </div>
        <Overlay o={state.flash} className="overlay flash" />
        <Overlay o={state.overlay} className="overlay" />
        {children}
      </div>
    </div>
  )
}
