import { asset } from './api.js'

// BGM with crossfades + fire-and-forget sound effects.
export class AudioManager {
  constructor(region) {
    this.region = region
    this.bgm = null
    this.bgmName = null
    this.bgmVol = 0.5
    this.seVol = 0.6
    this.muted = false
    this.ses = new Set()
  }

  setVolumes({ bgm, se, muted }) {
    if (bgm != null) this.bgmVol = bgm
    if (se != null) this.seVol = se
    if (muted != null) this.muted = muted
    if (this.bgm) this.bgm.volume = this.muted ? 0 : this.bgmVol * (this.bgm._gain ?? 1)
    for (const a of this.ses) a.volume = this.muted ? 0 : this.seVol
  }

  playBgm(name, gain = 1) {
    if (this.bgmName === name && this.bgm && !this.bgm.paused) return
    this.stopBgm(0.6)
    const a = new Audio(asset.bgm(this.region, name))
    a.loop = true
    a._gain = Math.min(1, Math.max(0.2, gain || 1))
    a.volume = 0
    a.play().catch(() => {})
    this.fade(a, this.muted ? 0 : this.bgmVol * a._gain, 0.8)
    this.bgm = a
    this.bgmName = name
  }

  stopBgm(dur = 1) {
    const a = this.bgm
    if (!a) return
    this.bgm = null
    this.bgmName = null
    this.fade(a, 0, dur, () => a.pause())
  }

  playSe(name) {
    const urls = asset.se(this.region, name)
    const a = new Audio()
    a.volume = this.muted ? 0 : this.seVol
    let i = 0
    const tryNext = () => {
      if (i >= urls.length) return this.ses.delete(a)
      a.src = urls[i++]
      a.play().catch(() => {})
    }
    a.onerror = tryNext
    a.onended = () => this.ses.delete(a)
    this.ses.add(a)
    tryNext()
  }

  stopSe() {
    for (const a of this.ses) a.pause()
    this.ses.clear()
  }

  stopAll(dur = 0.3) {
    this.stopBgm(dur)
    this.stopSe()
  }

  fade(a, to, dur, done) {
    const from = a.volume
    const t0 = performance.now()
    const tick = () => {
      const k = dur > 0 ? Math.min(1, (performance.now() - t0) / (dur * 1000)) : 1
      a.volume = Math.max(0, Math.min(1, from + (to - from) * k))
      if (k < 1) requestAnimationFrame(tick)
      else done?.()
    }
    tick()
  }

  dispose() {
    this.stopAll(0.2)
  }
}
