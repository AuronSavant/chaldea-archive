// Automatic furigana for Japanese text, via the kuromoji morphological
// analyser. Loaded lazily (~18MB dictionary) the first time Japanese text
// is read with furigana on.
const CDN = 'https://cdn.jsdelivr.net/npm/kuromoji@0.1.2'

let tokenizer = null
let loading = null

export function loadTokenizer() {
  if (tokenizer) return Promise.resolve(tokenizer)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `${CDN}/build/kuromoji.js`
    s.onload = () =>
      window.kuromoji.builder({ dicPath: `${CDN}/dict/` }).build((err, t) => {
        if (err) return reject(err)
        tokenizer = t
        resolve(t)
      })
    s.onerror = reject
    document.head.appendChild(s)
  }).catch((e) => {
    loading = null
    throw e
  })
  return loading
}

export const tokenizerReady = () => !!tokenizer

const KANJI = /[㐀-䶿一-鿿豈-﫿々〆ヵヶ]/
const toHira = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))

// Splits text into plain runs and {base, rt} ruby runs. Kana around a kanji
// word (okurigana) stays outside the ruby: 食べる → [食]た + べる.
export function furiganaSegments(text) {
  if (!tokenizer || !KANJI.test(text)) return [{ s: text }]
  const out = []
  for (const t of tokenizer.tokenize(text)) {
    const surf = t.surface_form
    if (!KANJI.test(surf) || !t.reading || t.reading === '*') {
      out.push({ s: surf })
      continue
    }
    let base = surf
    let rd = toHira(t.reading)
    let pre = ''
    let suf = ''
    while (base.length > 1 && rd && !KANJI.test(base.at(-1)) && toHira(base.at(-1)) === rd.at(-1)) {
      suf = base.at(-1) + suf
      base = base.slice(0, -1)
      rd = rd.slice(0, -1)
    }
    while (base.length > 1 && rd && !KANJI.test(base[0]) && toHira(base[0]) === rd[0]) {
      pre += base[0]
      base = base.slice(1)
      rd = rd.slice(1)
    }
    if (pre) out.push({ s: pre })
    out.push(rd && rd !== base ? { base, rt: rd } : { s: base })
    if (suf) out.push({ s: suf })
  }
  return out
}
