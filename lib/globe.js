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

const EARTH_TEXTURE = '/dsh-finance/earth-night.jpg'
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
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100)
  camera.position.set(0, 0.62, 2.72)
  camera.lookAt(0, 0, 0) // 不加这句球是偏的（第一版就吃了这个亏）

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
  renderer.setClearColor(0x000000, 0)
  container.appendChild(renderer.domElement)
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.cursor = 'grab'

  // 夜景地球自带城市灯光，用不受光的材质最干净（第一版用 Phong + 强光，
  // 把暗色贴图洗成一颗灰球了）。
  scene.add(new THREE.AmbientLight(0xffffff, 1))

  const earthGroup = new THREE.Group()
  earthGroup.rotation.z = (-23.4 * Math.PI) / 180 // 地轴倾角
  scene.add(earthGroup)

  const loader = new THREE.TextureLoader()
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 96, 96),
    new THREE.MeshBasicMaterial({ map: loader.load(EARTH_TEXTURE) }),
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

  /** 高亮某个标的（列表里点中时同步过来）。 */
  function highlight(symbol) {
    for (const [key, group] of Object.entries(markersBySymbol)) {
      const on = key === symbol
      group.scale.setScalar(on ? 1.9 : 1)
    }
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
    if (!dragging) rotation.y += dt * 0.055 // 自转
    earthGroup.rotation.x = rotation.x
    earthGroup.rotation.y = rotation.y
    renderer.render(scene, camera)
    raf = requestAnimationFrame(tick)
  }
  raf = requestAnimationFrame(tick)

  return {
    update: setMarkers,
    highlight,
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
