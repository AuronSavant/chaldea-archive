// Turns the inline markup of a message into "units" the typewriter reveals
// one at a time, plus any stage commands embedded in the text.
//
// Inline markup: [sr]/[r] line break, [%1] player name, [&male:female],
// [#base:ruby], [line N] long dash, [RRGGBB]...[-] colour, [f large] size.

import { furiganaSegments } from './furigana.js'

const FORMAT_NAMES = new Set(['sr', 'r', 'k', 'page', 'i', '/i', 'b', '/b', 'u', '/u', 's', '/s', 'c', '-'])
const SIZES = { small: 0.8, medium: 1, large: 1.35, 'x-large': 1.7, 'xx-large': 2.1, '-': 1 }

export function renderText(raw, ctx) {
  const units = []
  const cmds = []
  const colors = []
  let size = 1
  const push = (s) => {
    const color = colors[colors.length - 1]
    for (const ch of Array.from(s)) units.push({ ch, color, size })
  }
  // script text, with automatic readings over kanji when enabled
  const pushText = (s) => {
    if (!ctx.autoRuby) return push(s)
    const color = colors[colors.length - 1]
    for (const seg of furiganaSegments(s)) {
      if (seg.base) units.push({ ruby: seg.base, rt: seg.rt, color, size, auto: true })
      else push(seg.s)
    }
  }
  const re = /\[([^\]]*)\]|\n|([^[\n]+)/g
  for (const m of raw.matchAll(re)) {
    if (m[2] !== undefined) pushText(m[2])
    else if (m[0] === '\n') units.push({ br: true })
    else {
      const tag = m[1]
      if (tag === 'sr' || tag === 'r') units.push({ br: true })
      else if (tag === '%1') push(ctx.playerName)
      else if (tag.startsWith('&')) {
        const [male, female] = tag.slice(1).split(':')
        push((ctx.gender === 'male' ? male : female) ?? '')
      } else if (tag.startsWith('#')) {
        const [base, rt] = tag.slice(1).split(':')
        const color = colors[colors.length - 1]
        units.push({ ruby: base, rt: rt || '', color, size })
      } else if (/^line\s+\d+/.test(tag)) push('—'.repeat(Number(tag.split(/\s+/)[1]) || 1))
      else if (/^[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(tag)) colors.push('#' + tag.slice(0, 6))
      else if (tag === '-') colors.pop()
      else if (tag.startsWith('f ')) size = SIZES[tag.slice(2).trim()] ?? 1
      else if (FORMAT_NAMES.has(tag)) {
        /* ignored formatting */
      } else {
        const parts = tag.trim().split(/\s+/)
        if (parts[0]) cmds.push({ name: parts[0], args: parts.slice(1) })
      }
    }
  }
  // trim leading line breaks
  while (units.length && units[0].br) units.shift()
  return { units, cmds }
}

export const plainText = (units) =>
  units.map((u) => (u.br ? '\n' : u.ruby ? u.ruby : u.ch)).join('')

export const plainName = (raw, ctx) => plainText(renderText(raw || '', ctx).units).trim()
