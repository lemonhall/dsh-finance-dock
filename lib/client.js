/**
 * Client half of dsh-finance-dock —— 右侧栏的「金融终端」tab。
 *
 * 纯 DOM + SVG（不需要 three.js）：分组监视列表 + 最新价 + 涨跌幅 + 迷你走势图。
 * 数据全从两条同源路由来：`/dsh-finance/ping` 给配置（监视列表、刷新间隔、配色），
 * `/dsh-finance/quotes` 给行情 —— 所以**改监视列表只要改 profile 配置，不用碰代码**。
 *
 * tab 的运行期信息要 `props.useTabInfo()` 拿（不是平铺 props），这是踩过的坑。
 */

// ⚠️ 整个模块必须包在 IIFE 里：DSH 把所有客户端插件**拼成一个脚本**加载
// （/plugins/??a/client.js,b/client.js,…），模块顶层的 const 会跨插件撞名。
// 实测 `TAB_KIND` 和电台插件撞了，直接 SyntaxError → 整个 web boot 失败进不去。
;(() => {
const TAB_KIND = 'finance-terminal'
const TAB_ID = 'dsh-finance-dock:terminal'

const ROUTES = {
  ping: '/dsh-finance/ping',
  quotes: '/dsh-finance/quotes',
}

window.__ModuleLoader__.load({
  id: 'dsh-finance-dock',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const C = {
      bg: 'var(--dsw-alias-bg-base)',
      panel: 'var(--dsw-alias-bg-layer-1)',
      border: 'var(--dsw-alias-border-l1)',
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    }

    /** 涨跌配色：cn = 红涨绿跌（中式），intl = 绿涨红跌。 */
    function palette(scheme) {
      return scheme === 'intl' ? { up: '#3ddc84', down: '#ff5a4d' } : { up: '#ff5a4d', down: '#3ddc84' }
    }

    /** 价格精度按量级自适应：BTC 要 0 位，汇率要 4~6 位。 */
    function fmtPrice(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const abs = Math.abs(value)
      const digits = abs >= 1000 ? 0 : abs >= 100 ? 2 : abs >= 1 ? 4 : 6
      return value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
    }

    function fmtPct(value) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '—'
      const sign = value > 0 ? '+' : ''
      return `${sign}${value.toFixed(2)}%`
    }

    function fmtClock(ms) {
      if (!ms) return '—'
      const d = new Date(ms)
      const pad = (n) => String(n).padStart(2, '0')
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    }

    function Sparkline(props) {
      const points = (props.points || []).filter((value) => Number.isFinite(value))
      if (points.length < 2) return h('span', { style: { color: C.dim, fontSize: 11 } }, '—')
      const width = 62
      const height = 18
      const min = Math.min(...points)
      const max = Math.max(...points)
      const span = max - min || 1
      const step = width / (points.length - 1)
      const path = points
        .map((value, index) => `${(index * step).toFixed(1)},${(height - ((value - min) / span) * height).toFixed(1)}`)
        .join(' ')
      return h(
        'svg',
        { width, height, viewBox: `0 0 ${width} ${height}`, style: { display: 'block', overflow: 'visible' } },
        h('polyline', {
          points: path,
          fill: 'none',
          stroke: props.color,
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
          opacity: 0.95,
        }),
      )
    }

    /**
     * 标的 → 经纬度（交易所 / 交割地）。加密这种没有地理意义的就不标。
     * 同城的几个给一点点抖动，免得柱子叠成一根。
     */
    const GEO = {
      '^GSPC': [40.71, -74.01], '^IXIC': [40.75, -73.98], '^DJI': [40.68, -74.05], '^RUT': [40.78, -73.92],
      '^VIX': [41.88, -87.63], '^STOXX': [50.11, 8.68], '^N225': [35.68, 139.69], '^NSEI': [19.08, 72.88],
      AAPL: [37.33, -122.01], MSFT: [47.64, -122.13], GOOGL: [37.42, -122.08], AMZN: [47.61, -122.33],
      NVDA: [37.37, -121.96], META: [37.48, -122.15], TSLA: [30.27, -97.74],
      '000001.SS': [31.23, 121.47], '^HSI': [22.32, 114.17], ASHR: [31.3, 121.6], MCHI: [22.4, 114.2],
      '^TNX': [40.71, -74.01], '^MOVE': [40.9, -74.2], HYG: [40.6, -74.1],
      'GC=F': [51.51, -0.13], 'SI=F': [51.55, -0.08], 'HG=F': [51.47, -0.18],
      'CL=F': [36.85, -96.42], 'BZ=F': [51.6, -0.05], 'NG=F': [29.76, -95.37],
      'DX-Y.NYB': [40.71, -73.9], 'USDJPY=X': [35.68, 139.6], 'USDCNY=X': [31.23, 121.4], 'EURUSD=X': [50.11, 8.6],
      '^SOX': [40.8, -73.85], SMH: [40.65, -73.8], TSM: [25.03, 121.56], ASML: [51.44, 5.47],
      XLF: [40.9, -73.7], KRE: [40.6, -73.6], XHB: [40.8, -73.5],
      WMT: [36.09, -94.13], XLY: [40.7, -73.4], XLP: [40.75, -73.3],
      XLV: [40.65, -73.2], IBB: [40.85, -73.1], LLY: [39.77, -86.16],
      ITA: [40.6, -73.0], XAR: [40.8, -72.9], LMT: [39.05, -77.12],
      BDRY: [1.29, 103.85],
    }

    /**
     * 地球容器。真正的 three.js 代码在 lib/globe.js（宿主当静态资源发、这里动态 import），
     * 所以这个文件不用把 three.js 那套全塞进来。
     */
    function Globe(props) {
      const mountRef = React.useRef(null)
      const apiRef = React.useRef(null)
      const [failed, setFailed] = React.useState(null)

      // 回调走 ref：mountGlobe 只挂一次，直接用 props 会永远停在首次渲染的闭包上
      const cbRef = React.useRef({ onPick: null, onHover: null })
      cbRef.current.onPick = props.onPick
      cbRef.current.onHover = props.onHover

      React.useEffect(() => {
        let disposed = false
        let handle = null
        import('/dsh-finance/globe.js')
          .then((mod) =>
            mod.mountGlobe(mountRef.current, {
              colorScheme: props.colorScheme,
              onPick: (symbol) => cbRef.current.onPick && cbRef.current.onPick(symbol),
              onHover: (symbol, x, y) => cbRef.current.onHover && cbRef.current.onHover(symbol, x, y),
            }),
          )
          .then((created) => {
            if (disposed) {
              created.dispose()
              return
            }
            handle = created
            apiRef.current = created
          })
          .catch((error) => {
            if (!disposed) setFailed(String((error && error.message) || error))
          })
        return () => {
          disposed = true
          if (handle) handle.dispose()
          apiRef.current = null
        }
      }, [])

      React.useEffect(() => {
        if (apiRef.current) apiRef.current.update(props.markers)
      }, [props.markers])
      // 选中变化 → 地球转到那根柱子的正面，然后停转 10 秒
      // （列表点一行、或点地球上的柱子，都会走到这里）
      React.useEffect(() => {
        if (apiRef.current && props.selected) apiRef.current.focus(props.selected)
      }, [props.selected])

      return h(
        'div',
        {
          style: {
            position: 'relative',
            height: props.height || 236,
            flex: 'none',
            borderBottom: `1px solid ${C.border}`,
            overflow: 'hidden',
            background: 'radial-gradient(120% 90% at 50% 30%, #0d1626 0%, #070a12 70%)',
          },
        },
        h('div', { ref: mountRef, style: { position: 'absolute', inset: 0 } }),
        failed
          ? h('div', { style: { position: 'absolute', left: 8, bottom: 6, fontSize: 10, color: '#ff5a4d' } }, `地球加载失败：${failed}`)
          : null,
      )
    }

    function Row(props) {
      const { label, quote, colors, active, onSelect } = props
      const up = quote && quote.change >= 0
      const color = up ? colors.up : colors.down
      return h(
        'div',
        {
          onClick: onSelect,
          style: {
            display: 'grid',
            gridTemplateColumns: '1fr auto auto 62px',
            alignItems: 'center',
            gap: 8,
            padding: '5px 8px',
            borderRadius: 6,
            fontFamily: C.mono,
            fontSize: 12,
            color: C.text,
            cursor: 'pointer',
            background: active ? 'color-mix(in srgb, var(--dsw-alias-brand-primary, #5a7cff) 18%, transparent)' : 'transparent',
            boxShadow: active ? 'inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-brand-primary, #5a7cff) 45%, transparent)' : 'none',
          },
        },
        h('span', { style: { fontFamily: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label),
        h('span', { style: { textAlign: 'right' } }, quote ? fmtPrice(quote.price) : '…'),
        h('span', { style: { textAlign: 'right', color, minWidth: 56 } }, quote ? fmtPct(quote.changePct) : ''),
        h(Sparkline, { points: quote ? quote.spark : [], color }),
      )
    }

    function TerminalPanel() {
      const [config, setConfig] = React.useState(null)
      const [quotes, setQuotes] = React.useState({})
      const [error, setError] = React.useState(null)
      const [updatedAt, setUpdatedAt] = React.useState(0)
      const [busy, setBusy] = React.useState(false)

      // 先取配置（监视列表 + 刷新间隔），再按它去取行情
      React.useEffect(() => {
        let cancelled = false
        fetch(ROUTES.ping)
          .then((response) => response.json())
          .then((payload) => {
            if (!cancelled && payload && payload.ok) setConfig(payload)
          })
          .catch((err) => {
            if (!cancelled) setError(String((err && err.message) || err))
          })
        return () => {
          cancelled = true
        }
      }, [])

      const symbols = React.useMemo(() => {
        if (!config || !Array.isArray(config.groups)) return []
        const out = []
        for (const group of config.groups) {
          for (const item of (group && group.items) || []) {
            const symbol = String((item && item.symbol) || '').trim()
            if (symbol && !out.includes(symbol)) out.push(symbol)
          }
        }
        return out
      }, [config])

      const load = React.useCallback(async () => {
        if (!symbols.length) return
        setBusy(true)
        try {
          const response = await fetch(`${ROUTES.quotes}?symbols=${encodeURIComponent(symbols.join(','))}`)
          const payload = await response.json()
          if (!payload.ok) throw new Error(payload.error || '取行情失败')
          const map = {}
          for (const quote of payload.quotes || []) map[quote.symbol] = quote
          setQuotes(map)
          setUpdatedAt(payload.updatedAt || Date.now())
          setError(payload.errors && payload.errors.length ? `${payload.errors.length} 个标的取不到` : null)
        } catch (err) {
          setError(String((err && err.message) || err))
        } finally {
          setBusy(false)
        }
      }, [symbols])

      React.useEffect(() => {
        if (!symbols.length) return undefined
        load()
        const timer = setInterval(load, Math.max(15000, Number(config && config.refreshMs) || 60000))
        return () => clearInterval(timer)
      }, [symbols, load, config])

      const colors = palette(config && config.colorScheme)
      const flat = Object.values(quotes)
      const upCount = flat.filter((q) => q.change >= 0).length
      const downCount = flat.length - upCount

      // 当前焦点：列表点一行、或者地球点一根柱子，都落到这里
      const [selected, setSelected] = React.useState(null)
      // 人体工学：48 个标的不能只靠滚 —— 给搜索、折组、地球开关、悬停提示
      const [query, setQuery] = React.useState('')
      const [collapsed, setCollapsed] = React.useState({})
      const [hover, setHover] = React.useState(null)
      const [showGlobe, setShowGlobe] = React.useState(true)
      const markers = React.useMemo(
        () =>
          Object.entries(quotes)
            .filter(([symbol]) => GEO[symbol])
            .map(([symbol, quote]) => ({
              symbol,
              lat: GEO[symbol][0],
              lon: GEO[symbol][1],
              changePct: quote.changePct,
            })),
        [quotes],
      )

      // 搜索过滤（中文名和代码都能搜）；空查询时原样返回
      const visibleGroups = React.useMemo(() => {
        const list = (config && config.groups) || []
        const q = query.trim().toLowerCase()
        if (!q) return list
        return list
          .map((group) => ({
            title: group.title,
            items: (((group && group.items) || []).filter(
              (item) =>
                String(item.label || '').toLowerCase().includes(q) || String(item.symbol || '').toLowerCase().includes(q),
            )),
          }))
          .filter((group) => group.items.length)
      }, [config, query])

      const labelOf = React.useCallback(
        (symbol) => {
          for (const group of (config && config.groups) || []) {
            for (const item of (group && group.items) || []) if (item.symbol === symbol) return item.label || item.symbol
          }
          return symbol
        },
        [config],
      )

      const selectedQuote = selected ? quotes[selected] : null

      return h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateRows: 'auto auto auto auto minmax(0, 1fr)',
            height: '100%',
            background: C.bg,
            color: C.text,
          },
        },
        // 顶栏：标题 + 涨跌家数 + 更新时间 + 刷新
        h(
          'div',
          {
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderBottom: `1px solid ${C.border}`,
            },
          },
          h('span', { style: { fontWeight: 600, fontSize: 13 } }, '金融终端'),
          h('input', {
            value: query,
            onChange: (event) => setQuery(event.target.value),
            placeholder: '搜索',
            style: {
              flex: '1 1 70px',
              minWidth: 60,
              background: 'transparent',
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              color: C.text,
              fontSize: 11,
              padding: '3px 6px',
              outline: 'none',
            },
          }),
          h(
            'button',
            {
              type: 'button',
              onClick: () => setShowGlobe((value) => !value),
              title: showGlobe ? '收起地球' : '展开地球',
              style: {
                border: `1px solid ${C.border}`,
                background: 'transparent',
                color: C.text,
                borderRadius: 6,
                fontSize: 12,
                padding: '2px 7px',
                cursor: 'pointer',
              },
            },
            showGlobe ? '🌐' : '🌍',
          ),
          flat.length
            ? h(
                'span',
                { style: { fontFamily: C.mono, fontSize: 11 } },
                h('span', { style: { color: colors.up } }, `▲${upCount}`),
                ' ',
                h('span', { style: { color: colors.down } }, `▼${downCount}`),
              )
            : null,
          h(
            'span',
            { style: { marginLeft: 'auto', fontFamily: C.mono, fontSize: 11, color: C.dim } },
            busy ? '刷新中…' : fmtClock(updatedAt),
          ),
          h(
            'button',
            {
              type: 'button',
              onClick: load,
              title: '立即刷新',
              style: {
                border: `1px solid ${C.border}`,
                background: 'transparent',
                color: C.text,
                borderRadius: 6,
                fontSize: 12,
                padding: '2px 8px',
                cursor: 'pointer',
              },
            },
            '⟳',
          ),
        ),
        error ? h('div', { style: { padding: '6px 12px', fontSize: 11, color: '#ff5a4d' } }, error) : h('span'),
        // 选中详情：点了列表或地球之后这里必须给反馈，否则点了像没反应
        selectedQuote
          ? h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 12px',
                  borderBottom: `1px solid ${C.border}`,
                  background: 'color-mix(in srgb, var(--dsw-alias-brand-primary, #5a7cff) 10%, transparent)',
                  fontFamily: C.mono,
                  fontSize: 12,
                },
              },
              h('span', { style: { fontWeight: 600 } }, labelOf(selected)),
              h('span', { style: { color: C.dim, fontSize: 10 } }, selected),
              h('span', { style: { marginLeft: 'auto' } }, fmtPrice(selectedQuote.price)),
              h(
                'span',
                { style: { color: selectedQuote.change >= 0 ? colors.up : colors.down, minWidth: 54, textAlign: 'right' } },
                fmtPct(selectedQuote.changePct),
              ),
              h(Sparkline, { points: selectedQuote.spark, color: selectedQuote.change >= 0 ? colors.up : colors.down }),
            )
          : null,
        // 地球：柱高 ∝ |涨跌幅|，颜色按涨跌；点柱子 = 选中那个标的，悬停出提示条
        showGlobe
          ? h(
              'div',
              { style: { position: 'relative', flex: 'none' } },
              h(Globe, {
                markers,
                selected,
                height: 236,
                colorScheme: config && config.colorScheme,
                onPick: setSelected,
                onHover: (symbol) => setHover(symbol),
              }),
              hover && quotes[hover]
                ? h(
                    'div',
                    {
                      style: {
                        position: 'absolute',
                        left: 10,
                        bottom: 8,
                        padding: '3px 8px',
                        borderRadius: 6,
                        background: 'rgba(8,12,20,0.88)',
                        border: `1px solid ${C.border}`,
                        fontFamily: C.mono,
                        fontSize: 11,
                        pointerEvents: 'none',
                        whiteSpace: 'nowrap',
                      },
                    },
                    `${labelOf(hover)}  ${fmtPrice(quotes[hover].price)}  ${fmtPct(quotes[hover].changePct)}`,
                  )
                : null,
            )
          : null,
        // 列表
        h(
          'div',
          { style: { overflow: 'auto', padding: '6px 4px 12px' } },
          !config
            ? h('div', { style: { padding: 12, fontSize: 12, color: C.dim } }, '加载监视列表…')
            : visibleGroups.map((group) =>
                h(
                  'div',
                  { key: group.title, style: { marginBottom: 8 } },
                  h(
                    'div',
                    {
                      onClick: () => setCollapsed((prev) => ({ ...prev, [group.title]: !prev[group.title] })),
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '4px 8px',
                        fontSize: 11,
                        color: C.dim,
                        letterSpacing: '0.08em',
                        cursor: 'pointer',
                        userSelect: 'none',
                      },
                    },
                    h('span', { style: { fontSize: 9 } }, collapsed[group.title] ? '▶' : '▼'),
                    h('span', null, group.title || ''),
                    h(
                      'span',
                      { style: { marginLeft: 'auto', opacity: 0.55, fontFamily: C.mono } },
                      String(((group && group.items) || []).length),
                    ),
                  ),
                  collapsed[group.title]
                    ? null
                    : ((group && group.items) || []).map((item) =>
                        h(Row, {
                          key: item.symbol,
                          label: item.label || item.symbol,
                          quote: quotes[item.symbol],
                          colors,
                          active: selected === item.symbol,
                          onSelect: () => setSelected(item.symbol),
                        }),
                      ),
                ),
              ),
        ),
      )
    }

    function tabInfoOf(props) {
      try {
        if (props && typeof props.useTabInfo === 'function') return props.useTabInfo()
      } catch {
        /* tab 还没 committed */
      }
      return null
    }

    function TerminalBody() {
      return h(TerminalPanel)
    }

    function TerminalTitle() {
      void tabInfoOf
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h('span', { 'aria-hidden': 'true' }, '📈'),
        h('span', null, '金融终端'),
      )
    }

    const inject = ['slots', 'sidebarRightTabs']

    function apply(ctx) {
      ctx.inject(['sidebarRightTabs'], (scoped) => {
        scoped.sidebarRightTabs.register({
          id: TAB_ID,
          kind: TAB_KIND,
          priority: 'extension',
          title: () => '金融终端',
          guide: [
            {
              id: TAB_KIND,
              kind: TAB_KIND,
              order: 60,
              title: () => '金融终端',
              description: () => '跨资产行情 · 涨跌幅 · 迷你走势',
              icon: () => h('span', { style: { fontSize: 16 } }, '📈'),
            },
          ],
        })
      })
      ctx.inject(['slots'], (scoped) => {
        scoped.slots.inject('sidebar.right.pane.tab', () =>
          scoped.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_ID }, TerminalBody),
        )
        scoped.slots.inject('sidebar.right.pane.tab.title', () =>
          scoped.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_ID }, TerminalTitle),
        )
      })
    }

    exports.inject = inject
    exports.apply = apply
    return module.exports
  },
})
})()
