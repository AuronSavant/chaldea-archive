import { asset, getCharaScript } from './api.js'
import { renderText, plainText, plainName } from './text.js'

// Runs a compiled script, producing a render state for the Stage.
// Stage space is FGO's native 1024x576.

const MAX_WAIT = 3

const num = (v, d = 0) => {
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : d
}

// "1" -> slot (0 left, 1 centre, 2 right); "x,y" -> pixel offset from centre (y up)
function parsePos(arg) {
  if (arg == null) return null
  if (arg.includes(',')) {
    const [x, y] = arg.split(',').map(Number)
    return { x: x || 0, y: y || 0 }
  }
  const n = Number(arg)
  if (!Number.isFinite(n)) return null
  return { x: (n - 1) * 256, y: 0 }
}

function rgba(hex) {
  if (!hex) return 'rgba(255,255,255,1)'
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16)
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return { color: `rgb(${r},${g},${b})`, alpha: a }
}

const COLORS = { black: 'rgb(0,0,0)', white: 'rgb(255,255,255)', red: 'rgb(200,0,0)' }

export class Engine {
  constructor(compiled, opts) {
    this.p = compiled.prog
    this.labels = compiled.labels
    this.msgCount = compiled.msgCount
    this.opts = opts // { region, ctx:{playerName, gender}, audio, onState, onMessage }
    this.pc = 0
    this.flags = { IsMale: opts.ctx.gender === 'male' ? 'true' : 'false' }
    this.selUse = null
    this.log = []
    this.ff = null
    this.dead = false
    this.running = false
    this.wakers = new Set()
    this.fxEnd = 0
    this.pendingBgm = undefined
    this.seq = 0
    this.state = {
      bg: null, // {url, key}
      bgPrev: null,
      chars: {},
      talk: null,
      talkMode: true,
      overlay: { color: COLORS.black, from: 1, to: 1, dur: 0, key: 0 },
      flash: null,
      shake: null,
      msgShake: null,
      camera: { x: 0, y: 0, scale: 1, dur: 0 },
      msg: null,
      msgVisible: false,
      choices: null,
      ended: false,
    }
  }

  emit() {
    if (this.ff != null || this.dead) return
    this.opts.onState({ ...this.state, chars: { ...this.state.chars } })
  }

  set(patch) {
    Object.assign(this.state, patch)
  }

  chara(slot) {
    return this.state.chars[slot]
  }

  setChara(slot, patch) {
    const c = this.state.chars[slot]
    if (!c) return
    this.state.chars[slot] = { ...c, ...patch }
  }

  sleep(sec) {
    if (this.ff != null || this.hurrying || sec <= 0) return Promise.resolve()
    return new Promise((res) => {
      const t = setTimeout(done, Math.min(sec, MAX_WAIT) * 1000)
      function done() {
        clearTimeout(t)
        res()
      }
      this.wakers.add(done)
    }).finally(() => {})
  }

  hurry() {
    this.hurrying = true
    for (const w of this.wakers) w()
    this.wakers.clear()
  }

  // ---- public API used by the Reader ----

  async start(resumePc) {
    if (resumePc != null && resumePc > 0) this.ff = resumePc
    await this.run()
  }

  advance() {
    if (this.running) return this.hurry()
    if (this.state.choices || this.state.ended) return
    this.run()
  }

  choose(i) {
    const c = this.state.choices
    if (!c) return
    const opt = c.options[i]
    this.log.push({ choice: opt.text })
    this.set({ choices: null })
    this.pc = opt.start
    this.run()
  }

  // Jump straight to the end of the script (skip).
  destroy() {
    this.dead = true
    this.hurry()
  }

  // ---- interpreter ----

  async run() {
    if (this.running || this.dead) return
    this.running = true
    this.hurrying = false
    try {
      while (this.pc < this.p.length && !this.dead) {
        const at = this.pc
        const ins = this.p[this.pc++]
        if (ins.op === 'msg') {
          const shown = this.showMsg(ins, at)
          if (shown) return
        } else if (ins.op === 'choice') {
          const want = this.selUse
          this.selUse = null
          if (want === 'masterMale' && this.opts.ctx.gender !== 'male') { this.pc = ins.end; continue }
          if (want === 'masterFemale' && this.opts.ctx.gender === 'male') { this.pc = ins.end; continue }
          if (this.ff != null) { this.pc = ins.options[0]?.start ?? ins.end; continue }
          this.set({
            choices: {
              options: ins.options.map((o) => ({ ...o, text: plainText(renderText(o.raw, this.opts.ctx).units) })),
            },
          })
          this.emit()
          return
        } else if (ins.op === 'jmp') this.pc = ins.to
        else if (ins.op === 'branch') {
          if (!ins.flag || String(this.flags[ins.flag]) === ins.val) {
            const t = this.labels[ins.label]
            if (t != null) this.pc = t
          }
        } else if (ins.op === 'selUse') this.selUse = ins.v
        else if (ins.op === 'cmd') {
          if (ins.name === 'end') break
          await this.exec(ins.name, ins.args)
        }
      }
      if (this.dead) return
      this.finishFastForward()
      this.set({ ended: true, msgVisible: false, msg: null })
      this.emit()
      this.opts.onEnd?.()
    } finally {
      this.running = false
    }
  }

  finishFastForward() {
    if (this.ff == null) return
    this.ff = null
    const a = this.opts.audio
    if (this.pendingBgm) a.playBgm(this.pendingBgm.name, this.pendingBgm.gain)
    else a.stopBgm(0.5)
    // land with everything settled
    this.state.overlay = { ...this.state.overlay, from: this.state.overlay.to, dur: 0, key: ++this.seq }
  }

  showMsg(ins, at) {
    const { units, cmds } = renderText(ins.raw, this.opts.ctx)
    const name = plainName(ins.name, this.opts.ctx)
    this.log.push({ name, text: plainText(units), pc: at })
    if (this.ff != null) {
      if (at < this.ff) {
        for (const c of cmds) this.execSync(c.name, c.args)
        return false
      }
      this.finishFastForward()
    }
    for (const c of cmds) this.execSync(c.name, c.args)
    this.set({ msg: { name, slot: ins.slot, units, key: at }, msgVisible: true })
    this.emit()
    this.opts.onMessage?.(ins, at)
    return true
  }

  async exec(name, args) {
    const wait = this.execSync(name, args)
    if (wait > 0) await this.sleep(wait)
    else if (wait !== -1) this.emit()
  }

  // Applies a command; returns seconds to wait (or -1 if it already emitted).
  execSync(name, a) {
    const s = this.state
    const ff = this.ff != null
    const audio = this.opts.audio
    const region = this.opts.region
    const D = (v) => (ff ? 0 : num(v))
    switch (name) {
      // ---- background ----
      case 'scene': {
        const url = asset.bg(region, a[0])
        if (s.bg?.url === url) break
        this.set({ bgPrev: s.bg, bg: { url, key: ++this.seq, dur: ff ? 0 : num(a[1], 0.4) || 0.4 } })
        this.preload(url)
        break
      }
      // ---- characters ----
      case 'charaSet': {
        const [slot, id, , ...nameParts] = a
        if (!slot || !id) break
        const prev = s.chars[slot]
        s.chars[slot] = {
          slot, kind: 'figure', id, url: asset.figure(region, id), face: 0,
          x: 0, y: 0, opacity: 0, tOp: 0, tMove: 0, z: prev?.z ?? 0, filter: null, scale: 1,
          name: nameParts.join(' '), meta: null, key: ++this.seq,
        }
        this.loadMeta(slot, id)
        break
      }
      case 'imageSet':
      case 'sceneSet': {
        const [slot, id] = a
        if (!slot || !id) break
        const url = name === 'sceneSet' ? asset.bg(region, id) : asset.image(region, id)
        s.chars[slot] = {
          slot, kind: 'image', id, url, face: 0, x: 0, y: 0, opacity: 0, tOp: 0, tMove: 0,
          z: s.chars[slot]?.z ?? 0, filter: null, scale: 1, key: ++this.seq,
        }
        break
      }
      case 'charaChange': {
        const [slot, id, face] = a
        const c = s.chars[slot]
        if (!c || !id) break
        this.setChara(slot, { id, url: asset.figure(region, id), face: num(face), meta: null, key: ++this.seq })
        this.loadMeta(slot, id)
        break
      }
      case 'charaFace':
      case 'charaFaceFade':
        this.setChara(a[0], { face: num(a[1]) })
        break
      case 'charaFadein': {
        const pos = parsePos(a[2])
        const dur = D(a[1])
        this.setChara(a[0], { opacity: 1, tOp: dur, tMove: 0, ...(pos || {}) })
        this.fxEnd = Date.now() + dur * 1000
        break
      }
      case 'charaFadeout': {
        const dur = D(a[1])
        this.setChara(a[0], { opacity: 0, tOp: dur })
        this.fxEnd = Date.now() + dur * 1000
        break
      }
      case 'charaPut': {
        const pos = parsePos(a[1])
        this.setChara(a[0], { opacity: 1, tOp: 0, tMove: 0, ...(pos || {}) })
        break
      }
      case 'charaMove': {
        const pos = parsePos(a[1])
        if (pos) this.setChara(a[0], { ...pos, tMove: D(a[2]) })
        break
      }
      case 'charaMoveReturn':
        this.setChara(a[0], { tMove: D(a[2]) })
        break
      case 'charaClear':
        this.setChara(a[0], { opacity: 0, tOp: 0 })
        break
      case 'charaDepth':
        this.setChara(a[0], { z: num(a[1]) })
        break
      case 'charaScale':
      case 'charaMoveScale':
        this.setChara(a[0], { scale: num(a[1], 1) || 1 })
        break
      case 'charaFilter': {
        const f = (a[1] || '').toLowerCase()
        const filter = f === 'silhouette' ? 'brightness(0)' : f === 'gray' || f === 'sepia' ? 'grayscale(1)' : f === 'night' ? 'brightness(0.55) saturate(0.7)' : null
        this.setChara(a[0], { filter })
        break
      }
      case 'charaShake':
        if (!ff) this.setChara(a[0], { shake: ++this.seq })
        break
      case 'charaTalk': {
        const v = a[0]
        if (v === 'on') this.set({ talkMode: true })
        else if (v === 'off') this.set({ talkMode: false, talk: null })
        else if (v && !v.startsWith('depth')) this.set({ talk: v })
        break
      }
      // ---- screen fx ----
      case 'fadeout':
      case 'wipeout': {
        const color = name === 'wipeout' ? COLORS.black : COLORS[a[0]] || COLORS.black
        const dur = D(a[1])
        const cur = s.overlay
        this.set({ overlay: { color, from: cur.color === color ? cur.to : 0, to: 1, dur, key: ++this.seq } })
        this.fxEnd = Date.now() + dur * 1000
        break
      }
      case 'fadein':
      case 'wipein': {
        const cur = s.overlay
        const color = name === 'wipein' ? cur.color : COLORS[a[0]] || COLORS.black
        const dur = D(a[1])
        const from = cur.to > 0 ? cur.to : 1
        this.set({ overlay: { color: cur.to > 0 ? cur.color : color, from, to: 0, dur, key: ++this.seq } })
        this.fxEnd = Date.now() + dur * 1000
        break
      }
      case 'flashin': {
        if (ff) break
        const from = rgba(a[3])
        const to = rgba(a[4])
        this.set({ flash: { color: from.color, from: from.alpha, to: to.alpha, dur: num(a[1], 0.2) + num(a[2], 0.2), loop: a[0] === 'loop', key: ++this.seq } })
        break
      }
      case 'flashout':
      case 'flashOff':
        this.set({ flash: null })
        break
      case 'shake':
        if (!ff) this.set({ shake: { x: num(a[1], 4), y: num(a[2], 4), dur: num(a[3], 0), key: ++this.seq } })
        break
      case 'shakeStop':
        this.set({ shake: null })
        break
      case 'messageShake':
        if (!ff) this.set({ msgShake: { x: num(a[1], 3), y: num(a[2], 3), dur: num(a[3], 0.5), key: ++this.seq } })
        break
      case 'messageShakeStop':
        this.set({ msgShake: null })
        break
      case 'cameraMove': {
        const pos = parsePos(a[1]) || { x: 0, y: 0 }
        this.set({ camera: { ...pos, scale: num(a[2], 1) || 1, dur: D(a[0]) } })
        break
      }
      case 'cameraHome':
        this.set({ camera: { x: 0, y: 0, scale: 1, dur: D(a[0]) } })
        break
      case 'messageOff':
        this.set({ msgVisible: false })
        break
      // ---- timing ----
      case 'wt':
        return ff ? 0 : num(a[0])
      case 'wait':
        if (ff) return 0
        if (a[0] === 'fade' || a[0] === 'wipe' || a[0]?.startsWith('chara')) {
          this.emit()
          return Math.max(0, (this.fxEnd - Date.now()) / 1000) || 0.001
        }
        return 0
      // ---- sound ----
      case 'bgm':
        if (ff) this.pendingBgm = { name: a[0], gain: num(a[1], 1) }
        else audio.playBgm(a[0], num(a[1], 1))
        break
      case 'bgmStop':
        if (ff) this.pendingBgm = null
        else audio.stopBgm(num(a[1], 1))
        break
      case 'se':
        if (!ff && a[0]) audio.playSe(a[0])
        break
      case 'seStop':
        if (!ff) audio.stopSe()
        break
      case 'soundStopAll':
      case 'soundStopAllFade':
        if (ff) this.pendingBgm = null
        else audio.stopAll(name === 'soundStopAllFade' ? num(a[0], 1) : 0.2)
        break
      case 'flag':
        this.flags[a[0]] = a[1]
        break
      default:
        // effects, voices, camera filters etc. are not rendered
        break
    }
    return 0
  }

  // Re-render the current line (e.g. after furigana readings become available).
  refreshText() {
    const m = this.state.msg
    const ins = m && this.p[m.key]
    if (!ins || ins.op !== 'msg') return
    this.set({ msg: { ...m, units: renderText(ins.raw, this.opts.ctx).units } })
    this.emit()
  }

  async loadMeta(slot, id) {
    const meta = await getCharaScript(this.opts.region, id)
    const c = this.state.chars[slot]
    if (c && c.id === id) {
      this.state.chars[slot] = { ...c, meta }
      this.emit()
    }
  }

  preload(url) {
    const img = new Image()
    img.src = url
  }
}
