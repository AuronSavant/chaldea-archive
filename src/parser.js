// Compiles an FGO story script into a flat instruction list.
//
// Script shape (abridged):
//   [charaSet A 98001000 0 Mash]      command line (one or more [tags])
//   ＠A：Mash                          speaker line, opens a message
//   Hello,[sr]Senpai.                 message body (inline tags allowed)
//   [k]                               end of message, wait for click
//   ？1：Option one                    choice option; body follows
//   ？2：Option two
//   ？！                                end of choice group
//
// Output ops: msg, choice, jmp, branch, selUse, cmd.

const TAG_RE = /\[([^\]]*)\]/g

function parseTag(body) {
  const parts = body.trim().split(/\s+/)
  return { name: parts[0], args: parts.slice(1) }
}

const onlyTags = (s) => s.replace(TAG_RE, '').trim() === ''

export function compile(src) {
  const lines = src.replace(/\r/g, '').split('\n')
  const prog = []
  const labels = {}
  const groups = [] // open choice groups
  let msg = null

  const closeMsg = () => {
    if (!msg) return
    while (msg.lines.length && !msg.lines[msg.lines.length - 1].trim()) msg.lines.pop()
    msg.raw = msg.lines.join('\n')
    delete msg.lines
    prog.push(msg)
    msg = null
  }

  const pushTags = (line) => {
    for (const m of line.matchAll(TAG_RE)) {
      const { name, args } = parseTag(m[1])
      if (!name) continue
      if (name === 'label') labels[args[0]] = prog.length
      else if (name === 'branch') prog.push({ op: 'branch', label: args[0], flag: args[1], val: args[2] })
      else if (name === 'selectionUse') prog.push({ op: 'selUse', v: args[0] })
      else prog.push({ op: 'cmd', name, args })
    }
  }

  const appendToMsg = (t) => {
    const k = t.indexOf('[k]')
    if (k < 0) {
      if (t || msg.lines.length) msg.lines.push(t)
      return
    }
    const before = t.slice(0, k)
    if (before) msg.lines.push(before)
    closeMsg()
    const rest = t.slice(k + 3).trim()
    if (rest) handleLine(rest)
  }

  function handleLine(t) {
    if (msg) {
      if (t.startsWith('＠') || t.startsWith('？')) closeMsg()
      else return appendToMsg(t)
    }
    if (!t || t.startsWith('＄')) return

    if (t.startsWith('＠')) {
      const body = t.slice(1)
      const m = body.match(/^([A-Za-z0-9]{1,3})：(.*)$/)
      msg = m ? { op: 'msg', slot: m[1], name: m[2].trim(), lines: [] } : { op: 'msg', slot: null, name: body.trim(), lines: [] }
      return
    }

    if (t === '？！') {
      const g = groups.pop()
      if (!g) return
      for (const j of g.jumps) prog[j].to = prog.length
      g.ins.end = prog.length
      return
    }

    const cm = t.match(/^？(\d+)：(.*)$/)
    if (cm) {
      const n = Number(cm[1])
      let g = groups[groups.length - 1]
      if (!g || (n === 1 && g.ins.options.length)) {
        const ins = { op: 'choice', options: [], end: -1 }
        prog.push(ins)
        g = { ins, jumps: [] }
        groups.push(g)
      } else {
        // close the previous option's body
        g.jumps.push(prog.length)
        prog.push({ op: 'jmp', to: -1 })
      }
      g.ins.options.push({ raw: cm[2], start: prog.length })
      return
    }

    if (onlyTags(t)) return pushTags(t)

    // bare text outside a message = narration
    msg = { op: 'msg', slot: null, name: '', lines: [] }
    appendToMsg(t)
  }

  for (const line of lines) handleLine(line.trim())
  closeMsg()
  // unterminated choice groups: point them at the end
  for (const g of groups) {
    for (const j of g.jumps) prog[j].to = prog.length
    g.ins.end = prog.length
  }

  // ordinal of each message, for progress %
  let n = 0
  for (const ins of prog) if (ins.op === 'msg') ins.ord = n++

  return { prog, labels, msgCount: n }
}

// Ids of every sprite / image / background a script references, in order,
// so the reader can preload them.
export function collectAssets(prog) {
  const figures = new Set()
  const scenes = new Set()
  const images = new Set()
  for (const ins of prog) {
    if (ins.op !== 'cmd') continue
    const a = ins.args
    if (ins.name === 'charaSet' && a[1]) figures.add(a[1])
    else if (ins.name === 'charaChange' && a[1]) figures.add(a[1])
    else if (ins.name === 'scene' && a[0]) scenes.add(a[0])
    else if (ins.name === 'imageSet' && a[1]) images.add(a[1])
  }
  return { figures: [...figures], scenes: [...scenes], images: [...images] }
}
