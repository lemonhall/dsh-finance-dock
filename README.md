# dsh-finance-dock 📈

DSH 右侧栏里的**金融终端**：一屏看完跨资产行情 —— 股指、商品、汇率、加密、利率，每行带涨跌幅和迷你走势图，自动刷新。

和 [dsh-radio-dock](https://github.com/lemonhall/dsh-radio-dock) 一个路子：右侧栏本来就是 DSH 的「apps 入口」，官方那三个 tab（文件/终端/浏览器）和第三方插件走的是**完全同一套机制**。

## 效果

![金融终端](https://cdn.jsdelivr.net/gh/lemonhall/dsh-finance-dock@main/docs/screenshot.png)

## 装

```
plugin_manager  install_bundle  target=link:E:\development\dsh-finance-dock
```

或者从 npm：

```
dsh plugin --profile <你的 profile> add dsh-finance-dock
```

⚠️ **客户端半边（那个 tab）改动要重启一次应用**；宿主半边热生效。

装好之后：右侧栏点「+」→ 选 **📈 金融终端**。

## 监视列表自己改

不用碰代码 —— 全在 `cordis.patch.yml` 的 config 里：

```yaml
groups:
  - title: 股市
    items:
      - { symbol: '^GSPC', label: '标普500' }
      - { symbol: '000001.SS', label: '上证指数' }
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `groups` | 5 组 12 个标的 | 分组监视列表，`symbol` 用 Yahoo 代码 |
| `refreshMs` | `60000` | 客户端刷新间隔（最小 15 秒） |
| `colorScheme` | `'cn'` | `cn` = 红涨绿跌；`intl` = 绿涨红跌 |
| `range` / `interval` | `'1mo'` / `'1d'` | sparkline 取多久、多密的数据 |
| `cacheTtlMs` | `30000` | 宿主侧缓存，防止你把 Yahoo 惹毛 |
| `proxy` | `http://127.0.0.1:7897` | 取行情走的代理 |

常用的 Yahoo 代码：指数 `^GSPC ^IXIC ^DJI ^N225 ^HSI 000001.SS`；商品 `GC=F CL=F SI=F`；汇率 `CNY=X EURUSD=X DX-Y.NYB`；加密 `BTC-USD ETH-USD`；利率 `^TNX ^FVX`。

## 它是怎么work的

```
lib/index.js    宿主半：两条同源路由
                  /dsh-finance/ping     配置（监视列表 / 刷新间隔 / 配色）
                  /dsh-finance/quotes   行情（逐标的，走宿主缓存的 Yahoo chart API）
lib/client.js   客户端半：右侧栏 tab，DOM + SVG 手画 sparkline
```

**数据源**：[Yahoo Finance 的 chart 接口](https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC)。选它的原因是**免 key，而且一条请求同时给「最新价 + 前收 + 收盘序列」** —— sparkline 直接用同一份响应画，不用发第二次请求。（同机器上试过 stooq 的 CSV 接口，空返回，弃用。）

**为什么经宿主中转**：Yahoo 在墙外，得走本机代理；顺便解决 CORS，客户端只认同源。

**配色约定**：默认中式**红涨绿跌**（`colorScheme: 'cn'`），看美股习惯的把它改成 `intl`。

## 已知限制

- Yahoo 这个接口是公开但**非官方**的，可能限流或改结构；挂了会在面板顶上显示错误，不会静默
- 只做行情快照 + 迷你走势，没有 K 线、成交量、财报
- 延迟取决于交易所与 Yahoo，非实时（分钟级）

## License

MIT
