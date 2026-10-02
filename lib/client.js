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
  news: '/dsh-finance/news',
  state: '/dsh-finance/state',
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

    const clamp01 = (value) => Math.max(0, Math.min(1, value))

    /** 异动阈值：|日内涨跌| ≥ 这个数就置顶。 */
    const MOVER_THRESHOLD = 2

    /**
     * 主要交易所的本地开收盘（当地时间）。
     * 时区换算交给 `Intl.DateTimeFormat` 的 timeZone —— 夏令时它自己管，
     * 比我手写"3月第2个周日"那套规则准。**只处理周末，不做节假日日历**，所以是近似。
     */
    const MARKETS = [
      { name: '纽约', tz: 'America/New_York', open: [9, 30], close: [16, 0] },
      { name: '伦敦', tz: 'Europe/London', open: [8, 0], close: [16, 30] },
      { name: '东京', tz: 'Asia/Tokyo', open: [9, 0], close: [15, 0] },
      { name: '上海', tz: 'Asia/Shanghai', open: [9, 30], close: [15, 0] },
    ]

    function fmtDuration(minutes) {
      const h = Math.floor(minutes / 60)
      const m = minutes % 60
      return h ? `${h}小时${m}分` : `${m}分钟`
    }

    /** 某个市场现在开了没（近似）。 */
    function marketStatus(market, now) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: market.tz,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).formatToParts(now)
      const pick = (type) => (parts.find((part) => part.type === type) || {}).value || ''
      const weekday = pick('weekday')
      const minutes = (Number(pick('hour')) % 24) * 60 + Number(pick('minute'))
      const openAt = market.open[0] * 60 + market.open[1]
      const closeAt = market.close[0] * 60 + market.close[1]
      if (weekday === 'Sat' || weekday === 'Sun') return { open: false, text: '周末休市' }
      if (minutes >= openAt && minutes < closeAt) return { open: true, text: `交易中 · 还剩 ${fmtDuration(closeAt - minutes)}` }
      if (minutes < openAt) return { open: false, text: `${fmtDuration(openAt - minutes)}后开盘` }
      return { open: false, text: '已收盘' }
    }

    /** 最后一个点落在这一段区间的什么位置（0=最低，1=最高）。 */
    function relativePosition(points) {
      const clean = (points || []).filter((value) => Number.isFinite(value))
      if (clean.length < 3) return 0.5
      const min = Math.min(...clean)
      const max = Math.max(...clean)
      if (max === min) return 0.5
      return clamp01((clean[clean.length - 1] - min) / (max - min))
    }

    /**
     * 风险偏好读数 0–100（四个输入等权）。**给人看的近似，不是可交易信号。**
     *   VIX 低 → 安心；HYG（高收益债）相对自身一个月的位置高 → 信用松；
     *   铜金比相对自身一个月上行 → 增长预期好；美元走强 → 全球流动性收紧。
     * 返回 null = 四个输入一个都没拿到（行情还没回来）。
     */
    function riskScore(quotes) {
      const parts = []
      const notes = []
      const vix = quotes['^VIX']
      if (vix && Number.isFinite(vix.price)) {
        const calm = clamp01((35 - vix.price) / 15) // 20 以下=1，35 以上=0
        parts.push(calm)
        notes.push(`VIX ${vix.price.toFixed(1)} ${calm > 0.7 ? '平静' : calm < 0.3 ? '恐慌' : '中性'}`)
      }
      const hyg = quotes.HYG
      if (hyg && hyg.spark && hyg.spark.length > 3) {
        const pos = relativePosition(hyg.spark)
        parts.push(pos)
        notes.push(`信用 ${pos > 0.6 ? '松' : pos < 0.4 ? '紧' : '平'}`)
      }
      const copper = quotes['HG=F']
      const gold = quotes['GC=F']
      if (copper && gold && copper.spark && gold.spark && copper.spark.length > 3 && gold.spark.length > 3) {
        const n = Math.min(copper.spark.length, gold.spark.length)
        const now = copper.spark[n - 1] / gold.spark[n - 1]
        const then = copper.spark[0] / gold.spark[0]
        const value = then ? clamp01(0.5 + ((now - then) / then) * 6) : 0.5
        parts.push(value)
        notes.push(`铜金比 ${value > 0.55 ? '↑' : value < 0.45 ? '↓' : '→'}`)
      }
      const dxy = quotes['DX-Y.NYB']
      if (dxy && dxy.spark && dxy.spark.length > 3) {
        const pos = relativePosition(dxy.spark)
        parts.push(1 - pos)
        notes.push(`美元 ${pos > 0.6 ? '强' : pos < 0.4 ? '弱' : '平'}`)
      }
      if (!parts.length) return null
      const score = Math.round((parts.reduce((sum, value) => sum + value, 0) / parts.length) * 100)
      const label = score >= 65 ? '风险偏好' : score <= 35 ? '避险' : '中性'
      return { score, label, notes, inputs: parts.length }
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
      // 竖着劈出来的新闻栏：选中哪个标的就拉它的稿子（Yahoo v1/finance/search）
      const [showNews, setShowNews] = React.useState(true)
      const [news, setNews] = React.useState(null)
      const [newsBusy, setNewsBusy] = React.useState(false)
      // 新闻源（功能 13）：yahoo = 英文、个股准；google = 中文、宏观准
      const [newsSource, setNewsSource] = React.useState('yahoo')
      // 指标中文说明（功能 1）：宿主当静态资源发，这里动态 import 一次
      const [glossary, setGlossary] = React.useState(null)

      React.useEffect(() => {
        let cancelled = false
        import('/dsh-finance/glossary.js')
          .then((mod) => {
            if (!cancelled) setGlossary(mod.GLOSSARY || {})
          })
          .catch(() => {
            if (!cancelled) setGlossary({})
          })
        return () => {
          cancelled = true
        }
      }, [])
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

      React.useEffect(() => {
        if (!showNews || !selected) return undefined
        let cancelled = false
        setNewsBusy(true)
        fetch(`/dsh-finance/news?symbol=${encodeURIComponent(selected)}&count=14&source=${newsSource}`)
          .then((response) => response.json())
          .then((payload) => {
            if (!cancelled) setNews(payload && payload.ok ? payload.news : [])
          })
          .catch(() => {
            if (!cancelled) setNews([])
          })
          .finally(() => {
            if (!cancelled) setNewsBusy(false)
          })
        return () => {
          cancelled = true
        }
      }, [selected, showNews, newsSource])

      /**
       * 双向通道的客户端端。
       * DSH 的客户端**没有推送通道**（服务只有 layout/locale/sessions/slots/theme/timer/
       * uiWorkspace/workspaces），所以这里 2 秒轮询宿主：宿主里 selected 变了就跟着跳
       * （Agent 调 finance_panel 写进去的，面板自己会动）；本地点选则写回宿主
       * （于是 Agent 调 state 就能看到你在看什么）。revision 用来去重。
       */
      const [hostState, setHostState] = React.useState(null)
      const selectedRef = React.useRef(null)
      React.useEffect(() => {
        selectedRef.current = selected
      }, [selected])

      React.useEffect(() => {
        let cancelled = false
        const pull = () => {
          fetch(ROUTES.state)
            .then((response) => response.json())
            .then((payload) => {
              if (cancelled || !payload || !payload.ok) return
              const remote = payload.state || {}
              setHostState(remote)
              if (remote.selected && remote.selected !== selectedRef.current) setSelected(remote.selected)
            })
            .catch(() => {
              /* 宿主没起来时安静降级 */
            })
        }
        pull()
        const timer = setInterval(pull, 2000)
        return () => {
          cancelled = true
          clearInterval(timer)
        }
      }, [])

      const pushState = React.useCallback((patch) => {
        fetch(ROUTES.state, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        }).catch(() => {
          /* 写失败不回滚：本地视图优先，下一轮轮询会对齐 */
        })
      }, [])

      /** 本地选中：先动界面，再写回宿主。 */
      const selectSymbol = React.useCallback(
        (symbol) => {
          setSelected(symbol)
          pushState({ selected: symbol })
        },
        [pushState],
      )

      /**
       * 「问一句」（功能 6）：把 标的 + 现价 + 涨跌 + 最新几条稿子标题 拼成一段问题，
       * 复制到剪贴板，同时写进宿主的 pendingQuestion。
       *
       * 为什么只能复制而不能直接发出去：DSH 的客户端服务里**没有**往会话发消息的那个口子
       * （列过：layout/locale/sessions/slots/theme/timer/uiWorkspace/workspaces），
       * 面板没法把消息塞进聊天。所以做成"复制好了，你去输入框粘一下"。
       */
      const [askDone, setAskDone] = React.useState(false)
      const askAbout = React.useCallback(() => {
        const quote = selected ? quotes[selected] : null
        if (!selected || !quote) return
        const lines = [
          `${labelOf(selected)}（${selected}）现在 ${fmtPrice(quote.price)}，日内 ${fmtPct(quote.changePct)}。帮我看一下今天它这边发生了什么。`,
        ]
        const titles = (news || []).slice(0, 3)
        if (titles.length) {
          lines.push('面板上刚看到的稿子：')
          for (const item of titles) lines.push(`- ${item.title}（${item.publisher}）`)
        }
        const text = lines.join('\n')
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text)
        } catch {
          /* 剪贴板被拒就算了，宿主里还留着一份 */
        }
        setAskDone(true)
        setTimeout(() => setAskDone(false), 2500)
        pushState({ pendingQuestion: text })
      }, [selected, quotes, news, labelOf, pushState])

      const selectedQuote = selected ? quotes[selected] : null

      // 风险偏好读数 + 选中标的的中文说明（功能 1、2）
      const risk = React.useMemo(() => riskScore(quotes), [quotes])
      const riskTone = risk ? (risk.score >= 65 ? colors.up : risk.score <= 35 ? colors.down : C.dim) : C.dim
      const glossaryOfSelected = selected && glossary ? glossary[selected] : null

      // 异动置顶（功能 3）：按 |涨跌幅| 从大到小
      const movers = React.useMemo(
        () =>
          Object.values(quotes)
            .filter((quote) => Number.isFinite(quote.changePct) && Math.abs(quote.changePct) >= MOVER_THRESHOLD)
            .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)),
        [quotes],
      )

      // 多时区开收盘（功能 4）：30 秒跳一次就够
      const [clockTick, setClockTick] = React.useState(() => Date.now())
      React.useEffect(() => {
        const timer = setInterval(() => setClockTick(Date.now()), 30000)
        return () => clearInterval(timer)
      }, [])
      const marketLines = React.useMemo(
        () => MARKETS.map((market) => ({ name: market.name, ...marketStatus(market, clockTick) })),
        [clockTick],
      )

      return h(
        'div',
        {
          style: {
            // 用 flex 列而不是 grid：这一版要往中间塞好几个区块（读数条/异动/地球），
            // grid 的固定行数每加一块就要改一次，flex 不用。
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            position: 'relative',
            paddingRight: showNews && selected ? 250 : 0,
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
              onClick: () => setShowNews((value) => !value),
              title: showNews ? '收起资讯栏' : '展开资讯栏',
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
            '📰',
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
        // 「今天什么情况」：风险偏好读数 + 四个输入 + 选中标的的中文说明
        risk || glossaryOfSelected
          ? h(
              'div',
              {
                style: {
                  padding: '7px 12px',
                  borderBottom: `1px solid ${C.border}`,
                  fontFamily: C.mono,
                  fontSize: 11,
                },
              },
              risk
                ? h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 7 } },
                    h('span', { style: { color: C.dim } }, '今天'),
                    h('span', { style: { fontWeight: 600, color: riskTone } }, `${risk.label} ${risk.score}`),
                    h(
                      'span',
                      { style: { display: 'inline-flex', gap: 2 } },
                      Array.from({ length: 10 }, (_, index) =>
                        h('span', {
                          key: index,
                          style: {
                            width: 6,
                            height: 9,
                            borderRadius: 2,
                            background:
                              index < Math.round(risk.score / 10)
                                ? riskTone
                                : 'color-mix(in srgb, currentColor 14%, transparent)',
                          },
                        }),
                      ),
                    ),
                    h('span', { style: { marginLeft: 'auto', color: C.dim, fontSize: 10 } }, '近似读数 · 非交易信号'),
                  )
                : null,
              h(
                'div',
                {
                  style: {
                    marginTop: 3,
                    color: C.dim,
                    fontSize: 10,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                risk ? risk.notes.join(' · ') : '等 VIX / 信用 / 铜金比 / 美元的数据回来',
              ),
              // 多时区开收盘（近似：只算周末，不算节假日）
              h(
                'div',
                {
                  style: {
                    marginTop: 3,
                    fontSize: 10,
                    color: C.dim,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  },
                },
                `${marketLines.map((line) => `${line.name} ${line.text}`).join(' · ')}（近似）`,
              ),
              glossaryOfSelected
                ? h(
                    'div',
                    { style: { marginTop: 4, fontSize: 11, color: C.text, lineHeight: 1.45 } },
                    h('span', { style: { color: C.dim, fontFamily: C.mono } }, `${selected} ▸ `),
                    glossaryOfSelected,
                  )
                : null,
              // 我在宿主里留的标注（功能 5：Agent 写、人看）
              hostState && hostState.notes && hostState.notes[selected]
                ? h(
                    'div',
                    { style: { marginTop: 3, fontSize: 11, color: '#ffd479', lineHeight: 1.4 } },
                    `📌 我留的：${hostState.notes[selected]}`,
                  )
                : null,
            )
          : null,
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
                onPick: selectSymbol,
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
        // 异动置顶（功能 3）：|涨跌| ≥ 阈值单独一组，不用在 48 个里翻
        movers.length
          ? h(
              'div',
              { style: { flex: 'none', maxHeight: 170, overflow: 'auto', borderBottom: `1px solid ${C.border}`, padding: '4px 4px 6px' } },
              h(
                'div',
                { style: { padding: '2px 8px 4px', fontSize: 10.5, color: C.dim, letterSpacing: '0.06em' } },
                `⚠ 异动 · |涨跌| ≥ ${MOVER_THRESHOLD}%（${movers.length}）`,
              ),
              movers.map((quote) =>
                h(Row, {
                  key: `mover-${quote.symbol}`,
                  label: labelOf(quote.symbol),
                  quote,
                  colors,
                  active: selected === quote.symbol,
                  onSelect: () => selectSymbol(quote.symbol),
                }),
              ),
            )
          : null,
        // 列表
        h(
          'div',
          { style: { overflow: 'auto', padding: '6px 4px 12px', flex: '1 1 auto', minHeight: 0 } },
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
                          onSelect: () => selectSymbol(item.symbol),
                        }),
                      ),
                ),
              ),
        ),
        // 竖着劈出来的新闻栏：绝对定位贴在右边，主区靠 padding 让位
        showNews && selected
          ? h(
              'div',
              {
                style: {
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: 250,
                  display: 'flex',
                  flexDirection: 'column',
                  borderLeft: `1px solid ${C.border}`,
                  background: 'color-mix(in srgb, var(--dsw-alias-bg-layer-1, #0e131c) 92%, transparent)',
                },
              },
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 10px',
                    borderBottom: `1px solid ${C.border}`,
                    fontSize: 12,
                  },
                },
                h('span', { style: { fontWeight: 600 } }, '📰 相关资讯'),
                h(
                  'span',
                  { style: { display: 'inline-flex', gap: 3, fontFamily: C.mono, fontSize: 10 } },
                  ['yahoo', 'google'].map((source) =>
                    h(
                      'span',
                      {
                        key: source,
                        onClick: () => setNewsSource(source),
                        title: source === 'yahoo' ? 'Yahoo 英文源（个股准）' : 'Google 中文源（宏观准）',
                        style: {
                          cursor: 'pointer',
                          padding: '0 4px',
                          borderRadius: 4,
                          color: newsSource === source ? C.text : C.dim,
                          background:
                            newsSource === source
                              ? 'color-mix(in srgb, var(--dsw-alias-brand-primary, #5a7cff) 22%, transparent)'
                              : 'transparent',
                        },
                      },
                      source === 'yahoo' ? '英文' : '中文',
                    ),
                  ),
                ),
                h('span', { style: { fontFamily: C.mono, fontSize: 10, color: C.dim } }, selected),
                h(
                  'button',
                  {
                    type: 'button',
                    onClick: askAbout,
                    title: '把当前标的 + 行情 + 最新稿子拼成一段问题复制到剪贴板（DSH 客户端没有"发消息"的服务，只能这样）',
                    style: {
                      marginLeft: 'auto',
                      border: `1px solid ${C.border}`,
                      background: 'transparent',
                      color: askDone ? colors.up : C.text,
                      borderRadius: 6,
                      fontSize: 10,
                      padding: '1px 6px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    },
                  },
                  askDone ? '已复制 ✓' : '问一句',
                ),
                h(
                  'span',
                  { style: { fontSize: 10, color: C.dim, fontFamily: C.mono } },
                  newsBusy ? '…' : news ? String(news.length) : '',
                ),
              ),
              h(
                'div',
                { style: { overflow: 'auto', padding: '4px 2px 10px' } },
                !news || !news.length
                  ? h('div', { style: { padding: 10, fontSize: 11, color: C.dim } }, newsBusy ? '加载中…' : '这个标的暂时没有稿子')
                  : news.map((item, index) =>
                      h(
                        'a',
                        {
                          key: item.id || index,
                          href: item.link,
                          target: '_blank',
                          rel: 'noreferrer',
                          title: item.title,
                          style: {
                            display: 'block',
                            padding: '6px 8px',
                            borderRadius: 6,
                            textDecoration: 'none',
                            color: C.text,
                            fontSize: 11.5,
                            lineHeight: 1.45,
                          },
                        },
                        h('div', null, item.title),
                        h(
                          'div',
                          { style: { marginTop: 2, fontSize: 10, color: C.dim, fontFamily: C.mono } },
                          `${item.publisher || ''}${item.at ? ' · ' + fmtClock(item.at) : ''}`,
                        ),
                      ),
                    ),
              ),
            )
          : null,
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
