// Precomputes how much story each event has (number of story scenes), used to
// rank events by importance. Run: node scripts/rank-events.mjs
import { writeFileSync } from 'node:fs'

const API = 'https://api.atlasacademy.io'
const out = {}
for (const region of ['NA', 'JP']) {
  const wars = await (await fetch(`${API}/export/${region}/basic_war.json`)).json()
  const events = wars.filter((w) => w.eventId > 0)
  out[region] = {}
  let i = 0
  const queue = [...events]
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let w; (w = queue.shift()); ) {
        try {
          const d = await (await fetch(`${API}/nice/${region}/war/${w.id}`)).json()
          const seen = new Set()
          let n = 0
          for (const s of d.spots) for (const q of s.quests) {
            if (seen.has(q.id)) continue
            seen.add(q.id)
            for (const p of q.phaseScripts) n += p.scripts.length
          }
          out[region][w.id] = n
        } catch (e) {
          console.error(region, w.id, e.message)
        }
        if (++i % 25 === 0) console.log(region, i, '/', events.length)
      }
    }),
  )
}
writeFileSync(new URL('../src/eventRank.json', import.meta.url), JSON.stringify(out))
console.log('done')
