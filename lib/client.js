/**
 * Client half of dsh-finance-dock —— 右侧栏的「金融终端」tab。
 *
 * 纯 DOM + SVG（不需要 three.js）：分组监视列表 + 最新价 + 涨跌幅 + 迷你走势图。
 * 数据全从两条同源路由来：`/dsh-finance/ping` 给配置（监视列表、刷新间隔、配色），
 * `/dsh-finance/quotes` 给行情 —— 所以**改监视列表只要改 profile 配置，不用碰代码**。
 *
 * tab 的运行期信息要 `props.useTabInfo()` 拿（不是平铺 props），这是踩过的坑。
 */

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

    function Row(props) {
      const { label, quote, colors } = props
      const up = quote && quote.change >= 0
      const color = up ? colors.up : colors.down
      return h(
        'div',
        {
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

      return h(
        'div',
        {
          style: {
            display: 'grid',
            gridTemplateRows: 'auto auto 1fr',
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
        // 列表
        h(
          'div',
          { style: { overflow: 'auto', padding: '6px 4px 12px' } },
          !config
            ? h('div', { style: { padding: 12, fontSize: 12, color: C.dim } }, '加载监视列表…')
            : (config.groups || []).map((group) =>
                h(
                  'div',
                  { key: group.title, style: { marginBottom: 8 } },
                  h(
                    'div',
                    {
                      style: {
                        padding: '4px 8px',
                        fontSize: 11,
                        color: C.dim,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                      },
                    },
                    group.title || '',
                  ),
                  ((group && group.items) || []).map((item) =>
                    h(Row, {
                      key: item.symbol,
                      label: item.label || item.symbol,
                      quote: quotes[item.symbol],
                      colors,
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
