# dsh-finance-dock 📈

DSH 右侧栏里的**金融终端**：一屏看完 13 类 48 个标的的行情，配一颗会转的 3D 地球，能告诉你"今天市场是怕还是贪"，**而且能和 Agent 双向对话** —— 你在面板里点中的标的，我调一次工具就知道；我写一句话，面板自己跳过去。

> 和 [dsh-radio-dock](https://github.com/lemonhall/dsh-radio-dock) 一个路子：右侧栏本来就是 DSH 的「apps 入口」，官方那三个 tab（文件/终端/浏览器）和第三方插件走的是**完全同一套机制**。

## 效果

![金融终端](https://cdn.jsdelivr.net/gh/lemonhall/dsh-finance-dock@main/docs/screenshot-panel-v2.png)

面板从上到下：**今天什么情况**（风险偏好读数 + 四个输入 + 四个市场开收盘）、**异动置顶**、**3D 地球**（柱子高度 ∝ 涨跌幅）、**分组监视列表**，右侧是**相关资讯**栏（英文/中文双源）。

![整屏](https://cdn.jsdelivr.net/gh/lemonhall/dsh-finance-dock@main/docs/screenshot-full-v2.png)

## 它能干什么

| 功能 | 说明 |
| --- | --- |
| **48 个标的 / 13 类** | 全球股市、七姐妹、中美温度、债市信用、金属、能源、汇率、半导体、金融地产、消费、医疗、军工、宏观另类。分类口径照搬本机「经纬雷达」项目（`macro-market-radar/api/lib/catalog.js`） |
| **3D 地球** | three.js + NASA 贴图（随包发）。每根柱子 = 一个交易所/交割地，高度 ∝ 涨跌幅、颜色按涨跌。**点列表某一行，地球缓动转过去把它转到正面，然后停转 10 秒**；拖动可自己转，悬停出提示条 |
| **风险偏好读数 0–100** | VIX + 高收益债 + 铜金比 + 美元指数 四路等权合成，≥65「风险偏好」、≤35「避险」、中间「中性」。**面板上写明是近似读数、不是交易信号** |
| **中文说明** | 48 条"这是什么、为什么重要"，例如 `^TNX` = 美债10年收益率，全球资产的定价锚，它往上走股票估值就被压 |
| **异动置顶** | `\|日内涨跌\| ≥ 2%` 自动排到最上面单独一组，不用在 48 个里翻 |
| **多时区开收盘** | 纽约 / 伦敦 / 东京 / 上海，显示"交易中 · 还剩 3小时12分"或"周末休市"。时区换算用 `Intl.DateTimeFormat` 的 timeZone，夏令时它自己管；**不做节假日日历，属近似** |
| **相关资讯** | 双源切换：**英文**走 Yahoo `v1/finance/search`（个股准），**中文**走 Google News RSS（宏观准，实测能拿到财联社/华尔街见闻/东方财富） |
| **问一句** | 把「标的 + 现价 + 涨跌 + 最新 3 条稿子」拼成一段提问复制到剪贴板，同时写进宿主状态 |
| **双向通道** | 见下节 —— 这是它和"一个行情看板"的根本区别 |

## 和 Agent 双向对话（`finance_panel` 工具）

面板状态**存在宿主**（`$DSH_HOME/dsh-finance-dock/state.json`），不是只活在浏览器里。所以：

```
你点面板里的一行        →  写回宿主  →  我调 finance_panel state 就知道你在看什么
我调 finance_panel      →  写进宿主  →  面板 2 秒内自己跳过去 / 加自选 / 显示我留的标注
```

工具动作：`state`（只读）/ `select` / `watch_add` / `watch_remove` / `note` / `clear_note` / `pin` / `unpin`。

举例，AI 可以直接说：

```
finance_panel  action=select  symbol=^VIX        # 让面板跳到恐慌指数
finance_panel  action=note    symbol=AAPL  text="它下周发财报，注意波动"
```

面板会在读数条下面用 📌 显示这条标注。

## 装

```
plugin_manager  install_bundle  target=link:E:\development\dsh-finance-dock
```

或从 npm：

```
dsh plugin --profile <你的 profile> add dsh-finance-dock
```

⚠️ **客户端半边（那个 tab）改动要重启一次应用**；宿主半边热生效（但**新增路由要重启**，这是实测的坑）。

装好之后：右侧栏点「+」→ 选 **📈 金融终端**。

## 监视列表自己改

不用碰代码，全在 `cordis.patch.yml` 的 config 里：

```yaml
groups:
  - title: 全球股市
    items:
      - { symbol: '^GSPC', label: '标普500' }
      - { symbol: '000001.SS', label: '上证综指' }
```

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `groups` | 13 类 48 个 | 分组监视列表，`symbol` 用 Yahoo 代码，`label` 会当作中文新闻的搜索词 |
| `refreshMs` | `60000` | 客户端刷新间隔（最小 15 秒） |
| `colorScheme` | `'cn'` | `cn` = 红涨绿跌；`intl` = 绿涨红跌 |
| `cacheTtlMs` | `300000` | 宿主侧行情缓存（标的多了，别一分钟一轮怼 Yahoo） |
| `proxy` | `http://127.0.0.1:7897` | 取行情/新闻都走它 |

## 它是怎么work的

```
lib/index.js     宿主半：/dsh-finance/ping    配置（监视列表 / 刷新间隔 / 配色）
                          /dsh-finance/quotes  行情（Yahoo chart，宿主缓存 + 并发限流 4 + curl 重试）
                          /dsh-finance/news    新闻（Yahoo 英文 / Google 中文 RSS）
                          /dsh-finance/state   面板状态 GET 读 / POST 写
                  + finance_panel 工具（双向通道的 Agent 端）
lib/state.js     面板状态（原子写盘，白名单键）
lib/globe.js     3D 地球（客户端动态 import，宿主当静态资源发）
lib/glossary.js  48 条指标中文说明
lib/client.js    右侧栏 tab：读数条 + 异动 + 地球 + 列表 + 资讯栏
vendor/          three.js（r169）与 NASA 地球贴图
```

**数据源**：行情用 [Yahoo Finance chart 接口](https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC) —— 免 key，**一条请求同时给最新价、昨收与收盘序列**（sparkline 直接用同一份数据）。地球贴图来自 [three-globe](https://github.com/vasturiano/three-globe) 项目（MIT），素材是 NASA Visible Earth（公有领域）。

**为什么经宿主中转**：Yahoo 与 Google 在墙外，得走本机代理；顺便解决 CORS，客户端只认同源。

## 踩过的坑（写给下一个改这个插件的人）

- **`range=1mo` 时 `meta.chartPreviousClose` 是"一个月前"的收盘，不是昨收** —— 拿它算日内涨跌，黄金会显示成 −5.85%。而且这个响应里**没有** `previousClose` 字段，真正的昨收是**收盘序列的倒数第二个点**。
- **客户端插件被 DSH 拼成同一个脚本加载**，模块顶层的 `const` 会跨插件撞名（实测 `TAB_KIND` 撞过一次，直接 SyntaxError 把整个 web boot 打挂）。**整个模块必须包在 IIFE 里。**
- **新增宿主路由不吃 HMR**，必须重启应用；工具注册则当场生效。
- 地球第一版是"灰球 + 被裁掉"：`MeshPhongMaterial` + 强光会把暗色贴图洗成灰的（改用不受光的材质），相机太近则球上下被切（`fov 34°` 在 `z=3.6` 处可视高度 ≈2.2 > 直径 2 才装得下）。

## 已知限制

- **风险偏好读数是给人看的近似，不是可交易信号**；四个输入等权，没有回测。
- **开收盘时间是近似**：只处理周末，不含节假日日历。
- 中文新闻走 Google News RSS，是**关键词搜索**的结果，可能带泛市场稿。
- Yahoo 这两个接口都是公开但**非官方**的，可能限流或改结构；挂了面板顶上会显示错误，不会静默。
- 只做行情快照 + 迷你走势，**没有 K 线、成交量、财报，也不做交易**。

## License

MIT
