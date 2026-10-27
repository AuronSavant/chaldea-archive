// Atlas Academy is the data source for everything: war/quest metadata,
// raw story scripts, character sprite sheets, backgrounds and audio.
import eventRank from './eventRank.json'

const API = 'https://api.atlasacademy.io'
const STATIC = 'https://static.atlasacademy.io'

const cache = new Map()
function cached(key, fn) {
  if (!cache.has(key)) {
    const p = fn().catch((e) => {
      cache.delete(key)
      throw e
    })
    cache.set(key, p)
  }
  return cache.get(key)
}

async function json(url) {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json()
}

export const getWarList = (region) =>
  cached(`wars-${region}`, () => json(`${API}/export/${region}/basic_war.json`))

export const getWar = (region, id) =>
  cached(`war-${region}-${id}`, () => json(`${API}/nice/${region}/war/${id}`))

export const getScriptText = (url) =>
  cached(`script-${url}`, async () => {
    const r = await fetch(url)
    if (!r.ok) throw new Error(`${r.status} ${url}`)
    return r.text()
  })

// Face placement data for a sprite sheet. Falls back to JP for characters
// that NA doesn't have yet.
export const getCharaScript = (region, charaId) =>
  cached(`svtScript-${region}-${charaId}`, async () => {
    for (const r of region === 'JP' ? ['JP'] : [region, 'JP']) {
      try {
        const d = await json(`${API}/raw/${r}/svtScript?charaId=${charaId}`)
        if (d && d[0]) return d[0]
      } catch {}
    }
    return { faceX: 0, faceY: 0, offsetX: 0, offsetY: 0, noFace: true }
  })

export const asset = {
  bg: (region, id) => `${STATIC}/${region}/Back/back${id}_1344_626.png`,
  figure: (region, id) => `${STATIC}/${region}/CharaFigure/${id}/${id}_merged.png`,
  image: (region, id) => `${STATIC}/${region}/Image/${id}/${id}.png`,
  bgm: (region, name) => `${STATIC}/${region}/Audio/Bgm/${name}/${name}.mp3`,
  se: (region, name) => {
    // SE files are split across folders; guess by prefix, then fall back.
    const guess = name.startsWith('ba') ? 'Battle' : name.startsWith('ar') ? 'ResidentSE' : 'SE'
    const folders = [guess, 'SE', 'Battle', 'ResidentSE', 'SystemSE'].filter((f, i, a) => a.indexOf(f) === i)
    return folders.map((f) => `${STATIC}/${region}/Audio/${f}/${name}.mp3`)
  },
}

// Swap an NA asset URL for its JP equivalent (newer art often only exists on JP).
export const jpFallback = (url) => url.replace(`${STATIC}/NA/`, `${STATIC}/JP/`)

export const getServantList = (region) =>
  cached(`svts-${region}`, () => json(`${API}/export/${region}/basic_servant.json`))

export const getServant = (region, id) =>
  cached(`svt-${region}-${id}`, () => json(`${API}/nice/${region}/servant/${id}?lore=false`))

export const getQuest = (region, id) =>
  cached(`quest-${region}-${id}`, () => json(`${API}/nice/${region}/quest/${id}`))

function questItems(q) {
  const items = []
  const total = q.phaseScripts.length
  for (const ps of q.phaseScripts) {
    ps.scripts.forEach((s, i) => {
      const when = s.scriptId.endsWith('0') ? 'Before battle' : s.scriptId.endsWith('1') ? 'After battle' : `Part ${i + 1}`
      items.push({
        scriptId: s.scriptId,
        url: s.script,
        questId: q.id,
        questName: q.name,
        questType: q.type,
        label: total > 1 ? `Section ${ps.phase} · ${when}` : when,
      })
    })
  }
  return items
}

// Flatten a war into an ordered reading list of scripts.
export function warPlaylist(war) {
  const items = []
  if (war.scriptId && war.scriptId !== 'NONE' && war.script) {
    items.push({ scriptId: war.scriptId, url: war.script, questName: 'Opening', label: 'Opening', questId: 0 })
  }
  const seen = new Set()
  const quests = war.spots
    .flatMap((s) => s.quests)
    .filter((q) => q.phaseScripts && q.phaseScripts.length)
    .filter((q) => (seen.has(q.id) ? false : seen.add(q.id)))
    .sort((a, b) => b.priority - a.priority || a.id - b.id)
  for (const q of quests) items.push(...questItems(q))
  return items
}

// A "source" is anything with a reading list: a war ("100") or a servant's
// personal stories ("svt-100100": interludes + Valentine scenes).
export const getSource = (region, src) =>
  cached(`src-${region}-${src}`, async () => {
    if (!String(src).startsWith('svt-')) {
      const war = await getWar(region, src)
      const { title, kicker } = warTitle(war)
      return { title, kicker, banner: war.banner, sub: [war.age, war.eventName].filter(Boolean), playlist: warPlaylist(war) }
    }
    const svt = await getServant(region, src.slice(4))
    const quests = await Promise.all(
      (svt.relateQuestIds || []).map((id) => getQuest(region, id).catch(() => null)),
    )
    const playlist = quests
      .filter((q) => q && q.phaseScripts?.length)
      .sort((a, b) => a.id - b.id)
      .flatMap(questItems)
    for (const v of svt.valentineScript || []) {
      playlist.push({ scriptId: v.scriptId, url: v.script, questId: `val-${v.scriptId}`, questName: `Valentine · ${v.scriptName}`, questType: 'valentine', label: 'Valentine scene' })
    }
    return {
      title: svt.name,
      kicker: `${svt.className} · ${'★'.repeat(svt.rarity)}`,
      face: svt.extraAssets?.faces?.ascension?.['1'] || null,
      sub: ['Interludes & Valentine scenes'],
      playlist,
    }
  })

export function groupWars(wars, region) {
  const main = wars.filter((w) => w.flags.includes('mainScenario') && w.id < 10000)
  const arc = (id) =>
    id < 200 ? 'Part 1 · Observer on Timeless Temple'
    : id < 300 ? 'Part 1.5 · Epic of Remnant'
    : id < 400 ? 'Part 2 · Cosmos in the Lostbelt'
    : 'Part 2.5 · Ordeal Call'
  const groups = []
  for (const w of main.sort((a, b) => a.id - b.id)) {
    const name = arc(w.id)
    let g = groups.find((x) => x.name === name)
    if (!g) groups.push((g = { name, wars: [] }))
    g.wars.push(w)
  }
  const other = wars.filter((w) => !w.eventId && !w.flags.includes('mainScenario') && [1003, 9999].includes(w.id))
  return { groups, events: rankEvents(wars, region), other }
}

// Events that feed directly into the main plot, in reading order.
const ESSENTIAL = [
  /Fourth Revelation|Accel Zero/i, // Fate/Accel Zero Order — sets up Camelot
  /Ogawa-heim|Garden of Order/i, // Kara no Kyoukai collab
  /Da Vinci and the 7 Counterfeit/i,
  /SE\.RA\.PH/i, // Fate/EXTRA CCC collab — introduces Kiara
  /Ooku/i, // ties into Lostbelt 4 / Kama
  /Imaginary (Trench|Scramble)/i, // Part 2 setup
  /Lilim Harlot/i,
  /Tunguska Sanctuary/i, // leads into Lostbelt 7
]

const baseTitle = (w) =>
  (w.longName || w.name || '')
    .replace(/\n/g, ' ')
    .replace(/^Revival:\s*/i, '')
    .replace(/\s*-?\s*(Lite|Expanded)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

// Ranked event tiers: essential (curated) → major → smaller, by amount of story.
// Reruns collapse into one entry; events with no story are dropped.
function rankEvents(wars, region) {
  const sizes = eventRank[region] || {}
  const byTitle = new Map()
  for (const w of wars) {
    if (!(w.eventId > 0) || w.flags.includes('mainScenario')) continue
    const size = sizes[w.id]
    if (size === 0) continue
    const title = baseTitle(w)
    const key = title === '-' ? `id-${w.id}` : title.toLowerCase().replace(/[^a-z0-9]+/g, '')
    const prev = byTitle.get(key)
    const better = !prev || (size ?? -1) > (prev.size ?? -1) || ((size ?? -1) === (prev.size ?? -1) && w.id < prev.id)
    if (better) byTitle.set(key, { ...w, size, essential: ESSENTIAL.findIndex((re) => re.test(title)) })
  }
  const all = [...byTitle.values()]
  const essential = all.filter((w) => w.essential >= 0).sort((a, b) => a.essential - b.essential)
  const rest = all.filter((w) => w.essential < 0)
  const bySize = (a, b) => b.size - a.size || a.id - b.id
  return [
    { name: 'New', wars: rest.filter((w) => w.size == null).sort((a, b) => b.id - a.id) },
    { name: 'Essential to the main story', wars: essential },
    { name: 'Major story events', wars: rest.filter((w) => w.size >= 40).sort(bySize) },
    { name: 'Smaller events', wars: rest.filter((w) => w.size != null && w.size < 40).sort(bySize) },
  ].filter((t) => t.wars.length)
}

export const warTitle = (w) => {
  const parts = (w.longName || w.name || '').split('\n').map((s) => s.trim()).filter(Boolean)
  const title = parts.length > 1 ? parts.slice(1).join(' ') : parts[0] || w.name
  const kicker = parts.length > 1 ? parts[0] : ''
  return { title: title === '-' ? `War ${w.id}` : title, kicker }
}
