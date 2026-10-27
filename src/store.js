import { useEffect, useState } from 'react'

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key)
    return v ? { ...fallback, ...JSON.parse(v) } : fallback
  } catch {
    return fallback
  }
}
function save(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {}
}

const listeners = new Set()
const DEFAULT_SETTINGS = {
  region: 'NA',
  playerName: 'Fujimaru',
  gender: 'male',
  textSpeed: 40, // chars per second * 1
  furigana: true,
  autoDelay: 1.2,
  bgmVol: 0.45,
  seVol: 0.6,
  muted: false,
}
let settings = load('fgo.settings', DEFAULT_SETTINGS)
// progress[region:scriptId] = { pc, ord, total, done, warId, at }
let progress = load('fgo.progress', {})
let last = load('fgo.last', {})

const notify = () => listeners.forEach((f) => f())


export const getSettings = () => settings
export function setSettings(patch) {
  settings = { ...settings, ...patch }
  save('fgo.settings', settings)
  notify()
}

export const progressKey = (region, scriptId) => `${region}:${scriptId}`
export const getProgress = (region, scriptId) => progress[progressKey(region, scriptId)]
export function setProgress(region, scriptId, patch) {
  const k = progressKey(region, scriptId)
  const prev = progress[k] || {}
  progress = { ...progress, [k]: { ...prev, ...patch, done: !!(prev.done || patch.done), at: Date.now() } }
  save('fgo.progress', progress)
  notify()
}
// "Start over": rewind the position but keep the section marked as read.
export function clearProgress(region, scriptId) {
  if (!getProgress(region, scriptId)) return
  setProgress(region, scriptId, { ord: 0, pc: 0 })
}

export const getLast = () => last
export function setLast(v) {
  last = { ...v, at: Date.now() }
  save('fgo.last', last)
  notify()
}

export function useStore() {
  const [, force] = useState(0)
  useEffect(() => {
    const f = () => force((n) => n + 1)
    listeners.add(f)
    return () => listeners.delete(f)
  }, [])
  return { settings, progress, last }
}
