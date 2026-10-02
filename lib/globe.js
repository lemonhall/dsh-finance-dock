/**
 * 地球模块 —— 由 lib/client.js 动态 import（宿主用 /dsh-finance/globe.js 提供）。
 *
 * 不做自绘地球：球面贴的是 NASA Visible Earth 的图（经 three-globe 项目分发，
 * MIT 仓库 / 公有领域素材），bump 用它的地形图，所以有起伏的明暗。
 *
 * 数据怎么上去：每个标的给一个经纬度（交易所 / 交割地），画一颗小点 + 一根朝外的
 * 柱子，柱高 ∝ |涨跌幅|、颜色按涨跌 —— 他想要的"一眼掌控全局"就是这个。
 *
 * 交互：拖动旋转、松手继续自转、点小点回传 symbol（onPick）。
 */

const EARTH_TEXTURE = '/dsh-finance/earth-blue-marble.jpg'
const EARTH_BUMP = '/dsh-finance/earth-topology.png'
const THREE_MODULE = '/dsh-finance/three.module.js'

/** 经纬度 → 球面坐标（equirectangular 贴图的标准映射）。 */
function latLonToVector(THREE, lat, lon, radius) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  )
}

export async function mountGlobe(container, options) {
  const THREE = await import(THREE_MODULE)
  const opts = options || {}

  const scene = new THREE.Scene()
  // 相机要刚好装下整球：fov 34° 在 z=3.6 处的可视高度 = 2*3.6*tan(17°) ≈ 2.2 > 直径 2。
  // 第一版 z=2.72 只有 1.77，球上下被切掉了（"高度不够"就是这么来的）。
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
  camera.position.set(0, 0.5, 3.6)
  camera.lookAt(0, 0, 0) // 不加这句球是偏的

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setClearColor(0x000000, 0)
  container.appendChild(renderer.domElement)
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.cursor = 'grab'

  // 贴图自己带颜色，用不受光的材质最干净（第一版用 Phong + 强光，把暗贴图洗成灰球了）
  scene.add(new THREE.AmbientLight(0xffffff, 1))

  const earthGroup = new THREE.Group()
  earthGroup.rotation.z = (-23.4 * Math.PI) / 180 // 地轴倾角
  scene.add(earthGroup)

  const loader = new THREE.TextureLoader()
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 96),
    // 蓝色大理石最好认；color 是乘法，用冷灰把它压暗到跟终端主题一致
    new THREE.MeshBasicMaterial({ map: loader.load(EARTH_TEXTURE), color: 0x8b97b3 }),
  )
  earthGroup.add(earth)

  // 大气：只留很薄一层，第一版那圈太抢戏
  earthGroup.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1.022, 64, 64),
      new THREE.MeshBasicMaterial({ color: 0x5f9dff, transparent: true, opacity: 0.07, side: THREE.BackSide, blending: THREE.AdditiveBlending }),
    ),
  )

  // 星点
  const starCount = 700
  const starPos = new Float32Array(starCount * 3)
  for (let i = 0; i < starCount; i += 1) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(12 + Math.random() * 10)
    starPos[i * 3] = v.x
    starPos[i * 3 + 1] = v.y
    starPos[i * 3 + 2] = v.z
  }
  const starGeometry = new THREE.BufferGeometry()
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPos, 3))
  scene.add(new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0x9fb4d8, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.7 })))

  const markerGroup = new THREE.Group()
  earth.add(markerGroup)
  const raycaster = new THREE.Raycaster()
  const pointer = new THREE.Vector2()
  let hitTargets = []
  let markersBySymbol = {}

  /** 用一批 {symbol,label,lat,lon,changePct} 重建柱子。 */
  function setMarkers(list) {
    for (const child of markerGroup.children.slice()) {
      child.traverse((node) => {
        if (node.geometry) node.geometry.dispose()
      })
      markerGroup.remove(child)
    }
    hitTargets = []
    markersBySymbol = {}
    for (const item of list || []) {
      if (typeof item.lat !== 'number' || typeof item.lon !== 'number') continue
      const pct = Number(item.changePct) || 0
      const up = pct >= 0
      const color = up ? (opts.colorScheme === 'intl' ? 0x3ddc84 : 0xff5a4d) : opts.colorScheme === 'intl' ? 0xff5a4d : 0x3ddc84
      const height = 0.055 + (Math.min(Math.abs(pct), 6) / 6) * 0.3

      const group = new THREE.Group()
      group.position.copy(latLonToVector(THREE, item.lat, item.lon, 1))
      group.lookAt(group.position.clone().multiplyScalar(2))

      const material = new THREE.MeshBasicMaterial({ color })
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0075, height, 8), material)
      bar.rotation.x = Math.PI / 2
      bar.position.z = height / 2
      bar.userData.symbol = item.symbol
      // 柱子外面套一圈更亮的点，暗贴图上才看得见
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.024, 12, 12), material)
      dot.userData.symbol = item.symbol
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 12, 12),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }),
      )
      halo.userData.symbol = item.symbol

      group.add(bar, dot, halo)
      markerGroup.add(group)
      hitTargets.push(dot, bar)
      markersBySymbol[item.symbol] = group
    }
  }

  /** 高亮某个标的（呼吸式脉冲，一眼看出是哪个）。 */
  let highlighted = null
  function highlight(symbol) {
    highlighted = symbol || null
  }

  /**
   * 转到某个标的正面，然后**停转 10 秒**再恢复自转（点列表行时调用）。
   *
   * 角度推导：marker 在球面上的单位向量是 p，earthGroup.rotation.y = θ 后它的世界方向
   * 是 Ry(θ)·p；要让 x 分量为 0 且朝 +z（也就是正对相机），解 tanθ = -p.x / p.z，
   * 即 θ = atan2(-p.x, p.z)。再取与当前角最近的等价角，免得绕远路转一大圈。
   */
  const FOCUS_PAUSE_SECONDS = 10
  const FOCUS_EASE_SECONDS = 0.7
  let focusAnim = null
  let pausedUntil = 0

  function focus(symbol) {
    const group = symbol ? markersBySymbol[symbol] : null
    highlighted = symbol || null
    if (!group) return
    const p = group.position.clone().normalize()
    let target = Math.atan2(-p.x, p.z)
    const twoPi = Math.PI * 2
    while (target - rotation.y > Math.PI) target -= twoPi
    while (rotation.y - target > Math.PI) target += twoPi
    focusAnim = { fromY: rotation.y, toY: target, fromX: rotation.x, toX: 0, t: 0 }
  }

  // --- 拖动旋转 + 点击 ---
  let dragging = false
  let moved = 0
  let hovered = null
  let lastX = 0
  let lastY = 0
  const rotation = { x: 0, y: 2.2 }
  const element = renderer.domElement

  const onDown = (event) => {
    dragging = true
    moved = 0
    lastX = event.clientX
    lastY = event.clientY
    element.style.cursor = 'grabbing'
  }
  const onMove = (event) => {
    if (dragging) {
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      moved += Math.abs(dx) + Math.abs(dy)
      rotation.y += dx * 0.006
      rotation.x = Math.max(-1.1, Math.min(1.1, rotation.x + dy * 0.006))
      return
    }
    // 悬停：拾取柱子 → 回传 symbol 与屏幕坐标，让 React 画提示条
    if (typeof opts.onHover !== 'function') return
    const rect = element.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(hitTargets, false)
    const symbol = hits.length ? hits[0].object.userData.symbol : null
    if (symbol !== hovered) {
      hovered = symbol
      element.style.cursor = symbol ? 'pointer' : 'grab'
      opts.onHover(symbol, event.clientX - rect.left, event.clientY - rect.top)
    }
  }
  const onUp = (event) => {
    element.style.cursor = 'grab'
    if (!dragging) return
    dragging = false
    if (moved > 4) return
    // 没怎么动就是点击：射线拾取小点/柱子
    const rect = element.getBoundingClientRect()
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)
    const hits = raycaster.intersectObjects(hitTargets, false)
    if (hits.length && typeof opts.onPick === 'function') opts.onPick(hits[0].object.userData.symbol)
  }
  element.addEventListener('pointerdown', onDown)
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)

  const resize = () => {
    const width = container.clientWidth || 1
    const height = container.clientHeight || 1
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null
  if (observer) observer.observe(container)
  resize()

  let raf = 0
  let last = performance.now()
  const tick = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now

    if (focusAnim) {
      // 缓动转过去
      focusAnim.t = Math.min(1, focusAnim.t + dt / FOCUS_EASE_SECONDS)
      const e = 1 - Math.pow(1 - focusAnim.t, 3)
      rotation.y = focusAnim.fromY + (focusAnim.toY - focusAnim.fromY) * e
      rotation.x = focusAnim.fromX + (focusAnim.toX - focusAnim.fromX) * e
      if (focusAnim.t >= 1) {
        focusAnim = null
        pausedUntil = now + FOCUS_PAUSE_SECONDS * 1000 // 转到位后停 10 秒
      }
    } else if (!dragging && now > pausedUntil) {
      rotation.y += dt * 0.055 // 自转（被 focus 暂停时不转）
    }

    earthGroup.rotation.x = rotation.x
    earthGroup.rotation.y = rotation.y

    // 高亮柱子呼吸；其余回到 1
    const pulse = 1.7 + 0.35 * Math.sin(now / 190)
    for (const [key, group] of Object.entries(markersBySymbol)) {
      group.scale.setScalar(key === highlighted ? pulse : 1)
    }

    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return {
    update: setMarkers,
    highlight,
    focus,
    dispose() {
      cancelAnimationFrame(raf)
      if (observer) observer.disconnect()
      element.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      renderer.dispose()
      if (element.parentNode) element.parentNode.removeChild(element)
    },
  }
}
