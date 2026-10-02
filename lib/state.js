/**
 * 面板状态 —— 宿主持有，客户端只是它的视图。
 *
 * 为什么要放宿主：这样**两边都能读写**。面板里点一下，Agent 调 `finance_panel`
 * 就能读到你在看什么；Agent 写一次，面板 2 秒内自己跳过去。
 * 状态只活在浏览器里的话，刷新即丢，而且我永远看不见。
 *
 * 存 `$DSH_HOME/dsh-finance-dock/state.json` —— 插件自己的目录，不碰 profile。
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 允许出现的键；写别的会被忽略（免得客户端塞垃圾进来）。 */
export const STATE_KEYS = ['selected', 'watchlist', 'notes', 'pinned', 'pendingQuestion']

export const DEFAULT_STATE = {
  selected: null, // 当前焦点标的
  watchlist: [], // 用户自选
  notes: {}, // { symbol: '给柠檬叔看的标注' }（我写的）
  pinned: [], // 异动置顶
  pendingQuestion: null, // 面板上"一键提问"攒的内容，我能读到
  updatedAt: 0,
  revision: 0, // 每次写 +1，客户端靠它判断要不要重画
}

export function createStateStore(file) {
  let state = { ...DEFAULT_STATE }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object') state = { ...DEFAULT_STATE, ...parsed }
  } catch {
    /* 第一次跑没有文件，用默认值 */
  }

  function get() {
    return { ...state, notes: { ...state.notes } }
  }

  /** 只认识的键会被合并进去，其余忽略；写盘失败不影响返回值。 */
  function patch(partial) {
    const next = { ...state }
    for (const [key, value] of Object.entries(partial || {})) {
      if (!STATE_KEYS.includes(key)) continue
      next[key] = value
    }
    next.updatedAt = Date.now()
    next.revision = (state.revision || 0) + 1
    state = next
    try {
      mkdirSync(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
      renameSync(tmp, file) // 原子替换，读的人不会撞上写了一半的文件
    } catch {
      /* 写不进去也不该把面板拖垮 */
    }
    return get()
  }

  /** 便捷写：增删自选 / 写标注，都是渲染前端的常用动作。 */
  function mutate(action, args) {
    const symbol = args && args.symbol ? String(args.symbol) : null
    const text = args && typeof args.text === 'string' ? args.text : ''
    if (action === 'select') return patch({ selected: symbol })
    if (action === 'watch_add') {
      const list = state.watchlist.includes(symbol) ? state.watchlist : [...state.watchlist, symbol]
      return patch({ watchlist: list.filter(Boolean) })
    }
    if (action === 'watch_remove') return patch({ watchlist: state.watchlist.filter((item) => item !== symbol) })
    if (action === 'note') return patch({ notes: { ...state.notes, [symbol]: text } })
    if (action === 'clear_note') {
      const notes = { ...state.notes }
      delete notes[symbol]
      return patch({ notes })
    }
    if (action === 'pin' || action === 'unpin') {
      const has = state.pinned.includes(symbol)
      const want = action === 'pin'
      if (has === want) return get()
      return patch({ pinned: want ? [...state.pinned, symbol] : state.pinned.filter((item) => item !== symbol) })
    }
    if (action === 'clear_pending') return patch({ pendingQuestion: null })
    return get()
  }

  return { get, patch, mutate, file }
}
