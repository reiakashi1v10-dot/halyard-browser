import * as THREE from 'three'

/*
 * One WebGL scene behind the whole page: a night sea drawn like a nautical chart
 * (contour lines on the waves), the Halyard sailboat riding it, and scroll-driven
 * "acts" (shield against trackers, sailing off at dawn). Scroll code only changes
 * the numbers in `state`; this file eases toward them every frame.
 */

// Gerstner-ish sum of sines, mirrored in GLSL so the boat floats on the same water
const WAVES = [
  { dir: [1.0, 0.35], amp: 0.34, len: 18, speed: 0.9 },
  { dir: [-0.4, 1.0], amp: 0.2, len: 11, speed: 1.15 },
  { dir: [0.75, -0.65], amp: 0.11, len: 6.5, speed: 1.6 },
  { dir: [-0.9, -0.3], amp: 0.06, len: 3.4, speed: 2.1 }
]
WAVES.forEach((w) => {
  const l = Math.hypot(w.dir[0], w.dir[1])
  w.dir = [w.dir[0] / l, w.dir[1] / l]
  w.k = (Math.PI * 2) / w.len
})

function waveHeight(x, z, t, calm) {
  let h = 0
  for (const w of WAVES) h += w.amp * calm * Math.sin((w.dir[0] * x + w.dir[1] * z) * w.k + t * w.speed)
  return h
}

const glslWaves = WAVES.map(
  (w) => `h += ${w.amp.toFixed(3)} * uCalm * sin(dot(vec2(${w.dir[0].toFixed(4)}, ${w.dir[1].toFixed(4)}), p) * ${w.k.toFixed(4)} + uTime * ${w.speed.toFixed(3)});`
).join('\n')
const glslGrad = WAVES.map(
  (w) =>
    `g += ${w.amp.toFixed(3)} * uCalm * ${w.k.toFixed(4)} * cos(dot(vec2(${w.dir[0].toFixed(4)}, ${w.dir[1].toFixed(4)}), p) * ${w.k.toFixed(4)} + uTime * ${w.speed.toFixed(3)}) * vec2(${w.dir[0].toFixed(4)}, ${w.dir[1].toFixed(4)});`
).join('\n')

const NIGHT = { top: new THREE.Color('#05070f'), horizon: new THREE.Color('#1b1f3f'), sea: new THREE.Color('#070a18'), crest: new THREE.Color('#3a3f86') }
const DAWN = { top: new THREE.Color('#1c1640'), horizon: new THREE.Color('#e89a6b'), sea: new THREE.Color('#141532'), crest: new THREE.Color('#b9a2e6') }

export function createScene(canvas, { reduced = false, onBlock = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 600)

  /** Targets set by the scroll code. */
  const state = {
    cam: new THREE.Vector3(-7.5, 2.2, 13),
    look: new THREE.Vector3(0, 1.6, 0),
    dawn: 0,
    shield: 0,
    sail: 0, // 0 = drifting, 1 = sailing off to the horizon
    calm: 1,
    lines: 1
  }
  const cur = { cam: state.cam.clone(), look: state.look.clone(), dawn: 0, shield: 0, sail: 0, calm: 1, lines: 1 }
  const pointer = new THREE.Vector2()
  const pointerEase = new THREE.Vector2()

  const uniforms = {
    uTime: { value: 0 },
    uCalm: { value: 1 },
    uDawn: { value: 0 },
    uLines: { value: 1 },
    uBoat: { value: new THREE.Vector2() },
    uNightTop: { value: NIGHT.top },
    uNightHorizon: { value: NIGHT.horizon },
    uDawnTop: { value: DAWN.top },
    uDawnHorizon: { value: DAWN.horizon },
    uNightSea: { value: NIGHT.sea },
    uDawnSea: { value: DAWN.sea },
    uNightCrest: { value: NIGHT.crest },
    uDawnCrest: { value: DAWN.crest },
    uSun: { value: new THREE.Vector3(-0.35, 0.18, -1).normalize() }
  }

  // ------------------------------------------------------------ sky + moon
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(400, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uDawn;
        uniform vec3 uNightTop, uNightHorizon, uDawnTop, uDawnHorizon, uSun;
        varying vec3 vDir;
        void main() {
          float y = clamp(vDir.y, -0.2, 1.0);
          vec3 top = mix(uNightTop, uDawnTop, uDawn);
          vec3 hor = mix(uNightHorizon, uDawnHorizon, uDawn);
          vec3 col = mix(hor, top, pow(smoothstep(-0.02, 0.55, y), 0.75));
          float d = max(dot(normalize(vDir), uSun), 0.0);
          // moon at night, low sun at dawn
          col += mix(vec3(0.75, 0.8, 1.0), vec3(1.0, 0.72, 0.45), uDawn) * (pow(d, 900.0) * 2.4 + pow(d, 24.0) * 0.18 * (0.4 + uDawn));
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`
    })
  )
  scene.add(sky)

  // ------------------------------------------------------------ stars
  {
    const n = 1400
    const pos = new Float32Array(n * 3)
    const seed = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2
      const v = Math.acos(1 - Math.random() * 0.95)
      const r = 360
      pos[i * 3] = r * Math.sin(v) * Math.cos(u)
      pos[i * 3 + 1] = r * Math.cos(v) + 8
      pos[i * 3 + 2] = r * Math.sin(v) * Math.sin(u)
      seed[i] = Math.random()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    const stars = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms,
        vertexShader: /* glsl */ `
          attribute float aSeed;
          uniform float uTime, uDawn;
          varying float vA;
          void main() {
            vA = (0.35 + 0.65 * sin(uTime * (0.6 + aSeed * 2.0) + aSeed * 40.0) * 0.5 + 0.5) * (1.0 - uDawn * 0.9);
            gl_PointSize = 1.0 + aSeed * 1.8;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying float vA;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            gl_FragColor = vec4(vec3(0.85, 0.88, 1.0), vA * smoothstep(0.5, 0.0, d));
          }`
      })
    )
    scene.add(stars)
  }

  // ------------------------------------------------------------ sea (nautical-chart contours)
  const seaGeo = new THREE.PlaneGeometry(320, 320, 280, 280)
  seaGeo.rotateX(-Math.PI / 2)
  const sea = new THREE.Mesh(
    seaGeo,
    new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        uniform float uTime, uCalm;
        varying vec3 vWorld;
        varying vec3 vNormal2;
        varying float vH;
        void main() {
          vec3 p3 = (modelMatrix * vec4(position, 1.0)).xyz;
          vec2 p = p3.xz;
          float h = 0.0;
          ${glslWaves}
          vec2 g = vec2(0.0);
          ${glslGrad}
          p3.y += h;
          vH = h;
          vWorld = p3;
          vNormal2 = normalize(vec3(-g.x, 1.0, -g.y));
          gl_Position = projectionMatrix * viewMatrix * vec4(p3, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uDawn, uLines, uTime;
        uniform vec2 uBoat;
        uniform vec3 uNightSea, uDawnSea, uNightCrest, uDawnCrest, uNightHorizon, uDawnHorizon, uNightTop, uDawnTop, uSun;
        varying vec3 vWorld;
        varying vec3 vNormal2;
        varying float vH;
        void main() {
          vec3 n = normalize(vNormal2);
          vec3 v = normalize(cameraPosition - vWorld);
          vec3 seaC = mix(uNightSea, uDawnSea, uDawn);
          vec3 crest = mix(uNightCrest, uDawnCrest, uDawn);
          vec3 hor = mix(uNightHorizon, uDawnHorizon, uDawn);
          vec3 top = mix(uNightTop, uDawnTop, uDawn);
          float fres = pow(1.0 - max(dot(n, v), 0.0), 4.0);
          vec3 col = mix(seaC, mix(top, hor, 0.6), fres * 0.85);
          col += crest * smoothstep(0.15, 0.6, vH) * 0.25;
          // moon/sun glitter
          vec3 r = reflect(-v, n);
          float s = pow(max(dot(r, uSun), 0.0), 140.0);
          col += mix(vec3(0.7, 0.75, 1.0), vec3(1.0, 0.7, 0.45), uDawn) * s * 2.2;
          // chart contour lines: one thin line every 0.12 of height
          float lv = vH / 0.12;
          float w = max(fwidth(lv), 1e-4);
          // distance to the nearest contour, in screen pixels: a crisp 1px line at any zoom
          float line = 1.0 - smoothstep(0.0, 1.2, abs(fract(lv - 0.5) - 0.5) / w);
          float dist = length(vWorld.xz - cameraPosition.xz);
          float near = 1.0 - smoothstep(18.0, 70.0, dist);
          col += crest * clamp(line, 0.0, 1.0) * 0.55 * near * uLines;
          // ring of the bearing around the boat (a chart compass)
          float rd = length(vWorld.xz - uBoat);
          float ring = smoothstep(0.06, 0.0, abs(rd - 6.0)) + smoothstep(0.04, 0.0, abs(rd - 9.5)) * 0.6;
          col += crest * ring * 0.35 * uLines * near;
          // fog into the horizon
          float fog = smoothstep(25.0, 150.0, dist);
          col = mix(col, hor, fog);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`
    })
  )
  scene.add(sea)

  // ------------------------------------------------------------ the boat (the Halyard logo, in 3D)
  const boat = new THREE.Group()
  const rig = new THREE.Group()
  boat.add(rig)
  scene.add(boat)

  const hullShape = new THREE.Shape()
  hullShape.moveTo(-2.5, 0.25)
  hullShape.lineTo(2.1, 0.25)
  hullShape.quadraticCurveTo(2.0, -0.15, 1.5, -0.5)
  hullShape.lineTo(-1.7, -0.5)
  hullShape.quadraticCurveTo(-2.45, -0.3, -2.5, 0.25)
  const hullGeo = new THREE.ExtrudeGeometry(hullShape, { depth: 1.1, bevelEnabled: true, bevelThickness: 0.18, bevelSize: 0.14, bevelSegments: 6, curveSegments: 24 })
  hullGeo.translate(0, 0, -0.55)
  const hull = new THREE.Mesh(
    hullGeo,
    new THREE.MeshPhysicalMaterial({ color: '#eef0ff', roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15, metalness: 0 })
  )
  boat.add(hull)
  const stripe = new THREE.Mesh(
    new THREE.BoxGeometry(4.6, 0.07, 1.42),
    new THREE.MeshStandardMaterial({ color: '#6c5cff', emissive: '#4b3bff', emissiveIntensity: 0.9 })
  )
  stripe.position.set(-0.15, 0.08, 0)
  boat.add(stripe)

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 6.2, 12), new THREE.MeshStandardMaterial({ color: '#c9ccec', roughness: 0.4 }))
  mast.position.set(0, 3.35, 0)
  rig.add(mast)

  /** A sail as a real surface: rows up the mast, columns out to the leech, with belly. */
  function sailGeometry(width, height, curve, dir, cols = 22, rows = 30) {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array((cols + 1) * (rows + 1) * 3)
    const uv = new Float32Array((cols + 1) * (rows + 1) * 2)
    const idx = []
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= cols; i++) {
        const k = j * (cols + 1) + i
        uv[k * 2] = i / cols
        uv[k * 2 + 1] = j / rows
      }
    for (let j = 0; j < rows; j++)
      for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i
        const b = a + 1
        const c = a + cols + 1
        const d = c + 1
        idx.push(a, c, b, b, c, d)
      }
    g.setIndex(idx)
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
    g.userData = { width, height, curve, dir, cols, rows }
    return g
  }

  function shapeSail(g, t, fill) {
    const { width, height, curve, dir, cols, rows } = g.userData
    const pos = g.attributes.position.array
    for (let j = 0; j <= rows; j++) {
      const v = j / rows
      const chord = width * (1 - Math.pow(v, curve))
      for (let i = 0; i <= cols; i++) {
        const u = i / cols
        const k = (j * (cols + 1) + i) * 3
        const belly = Math.sin(u * Math.PI) * chord * 0.16 * fill * (1 - v * 0.5)
        const flutter = Math.sin(v * 7 - t * 3.2 + u * 2) * 0.03 * u * (1.2 - fill * 0.6)
        pos[k] = dir * u * chord
        pos[k + 1] = v * height
        pos[k + 2] = belly + flutter
      }
    }
    g.attributes.position.needsUpdate = true
    g.computeVertexNormals()
  }

  const sailMat = new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    roughness: 0.75,
    side: THREE.DoubleSide,
    sheen: 1,
    sheenColor: new THREE.Color('#b7b0ff'),
    emissive: '#5e57c9',
    emissiveIntensity: 0.12
  })
  const jibMat = sailMat.clone()
  jibMat.color = new THREE.Color('#d9dbf6')

  const mainGeo = sailGeometry(3.3, 5.6, 1.7, 1)
  const jibGeo = sailGeometry(2.0, 4.4, 1.0, -1)
  const mainSail = new THREE.Mesh(mainGeo, sailMat)
  mainSail.position.set(0.18, 0.75, 0)
  const jib = new THREE.Mesh(jibGeo, jibMat)
  jib.position.set(-0.22, 0.75, 0)
  rig.add(mainSail, jib)

  // wake: a faint trail of light behind the boat when it moves
  const wakeMat = new THREE.MeshBasicMaterial({ color: '#8f85ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending })
  const wake = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wakeMat)
  wake.rotation.x = -Math.PI / 2
  scene.add(wake)

  // ------------------------------------------------------------ the shield and the trackers
  const SHIELD_R = 5.2
  const shieldMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uOpacity: { value: 0 }, uTime: uniforms.uTime, uHit: { value: new THREE.Vector4(0, 0, 0, 0) } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main() {
        vN = normalize(normalMatrix * normal);
        vP = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity, uTime; uniform vec4 uHit;
      varying vec3 vN; varying vec3 vP; varying vec3 vV;
      void main() {
        float rim = pow(1.0 - abs(dot(vN, vV)), 2.5);
        // hexagon-ish lattice from latitude/longitude lines
        vec3 p = normalize(vP);
        float lat = abs(fract(asin(p.y) * 6.0 + 0.5) - 0.5);
        float lon = abs(fract(atan(p.z, p.x) * 5.0 + 0.5) - 0.5);
        float grid = smoothstep(0.03, 0.0, min(lat, lon));
        float hit = uHit.w * smoothstep(1.6, 0.0, distance(vP, uHit.xyz));
        float a = (rim * 0.55 + grid * 0.25 + hit * 1.4) * uOpacity;
        gl_FragColor = vec4(mix(vec3(0.48, 0.42, 1.0), vec3(1.0, 0.45, 0.35), hit), a);
      }`
  })
  const shield = new THREE.Mesh(new THREE.SphereGeometry(SHIELD_R, 64, 32), shieldMat)
  shield.position.y = 2.2
  boat.add(shield)

  const N = reduced ? 160 : 520
  const tPos = new Float32Array(N * 3)
  const tLife = new Float32Array(N)
  const tVel = []
  const spawn = (i) => {
    const u = Math.random() * Math.PI * 2
    const v = Math.random() * 0.9 + 0.05
    const r = 26 + Math.random() * 18
    tPos[i * 3] = Math.cos(u) * Math.sin(v * Math.PI * 0.5) * r
    tPos[i * 3 + 1] = Math.cos(v * Math.PI * 0.5) * r * 0.45 + 2
    tPos[i * 3 + 2] = Math.sin(u) * Math.sin(v * Math.PI * 0.5) * r
    tVel[i] = 4 + Math.random() * 6
    tLife[i] = 1
  }
  for (let i = 0; i < N; i++) {
    spawn(i)
    // spread them out so they don't all arrive together
    const f = Math.random()
    tPos[i * 3] *= 0.25 + f
    tPos[i * 3 + 1] = (tPos[i * 3 + 1] - 2) * (0.25 + f) + 2
    tPos[i * 3 + 2] *= 0.25 + f
  }
  const tGeo = new THREE.BufferGeometry()
  tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3))
  tGeo.setAttribute('aLife', new THREE.BufferAttribute(tLife, 1))
  const trackerMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uOpacity: { value: 0 }, uScale: { value: 1 } },
    vertexShader: /* glsl */ `
      attribute float aLife;
      uniform float uScale;
      varying float vLife;
      void main() {
        vLife = aLife;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = (aLife < 1.0 ? 26.0 * (1.0 - aLife) + 6.0 : 7.0) * uScale / -mv.z * 6.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float core = smoothstep(0.5, 0.1, d);
        float ring = smoothstep(0.08, 0.0, abs(d - 0.38)) * step(vLife, 0.999);
        vec3 c = vLife < 1.0 ? vec3(1.0, 0.55, 0.4) : vec3(1.0, 0.32, 0.28);
        float a = (vLife < 1.0 ? ring * vLife : core) * uOpacity;
        gl_FragColor = vec4(c, a);
      }`
  })
  const trackers = new THREE.Points(tGeo, trackerMat)
  scene.add(trackers)

  // ------------------------------------------------------------ light
  scene.add(new THREE.HemisphereLight('#8a90ff', '#0a0c22', 0.7))
  const key = new THREE.DirectionalLight('#dfe3ff', 2.2)
  key.position.set(-8, 10, -12)
  scene.add(key)
  const rim = new THREE.DirectionalLight('#7b6dff', 2.6)
  rim.position.set(9, 4, 8)
  scene.add(rim)
  const fill = new THREE.PointLight('#ffb48a', 0, 30)
  fill.position.set(-4, 3, 6)
  scene.add(fill)

  // ------------------------------------------------------------ loop
  let w = 0
  let h = 0
  function resize() {
    w = window.innerWidth
    h = window.innerHeight
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    // narrow screens: wider lens so the boat still fits
    camera.fov = w < 700 ? 52 : 36
    camera.updateProjectionMatrix()
    trackerMat.uniforms.uScale.value = Math.min(window.devicePixelRatio, 1.75) * (h / 900)
  }
  resize()
  window.addEventListener('resize', resize)
  window.addEventListener('pointermove', (e) => {
    pointer.set((e.clientX / w) * 2 - 1, (e.clientY / h) * 2 - 1)
  })

  const clock = new THREE.Clock()
  let active = true
  let t = 0
  const boatPos = new THREE.Vector3()
  const hitLocal = new THREE.Vector3()
  let hitStrength = 0

  function frame() {
    requestAnimationFrame(frame)
    const dt = Math.min(clock.getDelta(), 0.05)
    if (!active || document.hidden) return
    t += dt * (reduced ? 0.25 : 1)
    const e = 1 - Math.pow(0.0025, dt) // frame-rate independent easing
    cur.cam.lerp(state.cam, e)
    cur.look.lerp(state.look, e)
    for (const key of ['dawn', 'shield', 'sail', 'calm', 'lines']) cur[key] += (state[key] - cur[key]) * e

    uniforms.uTime.value = t
    uniforms.uCalm.value = cur.calm
    uniforms.uDawn.value = cur.dawn
    uniforms.uLines.value = cur.lines
    fill.intensity = cur.dawn * 30

    // boat rides the waves; sailing off moves it toward the horizon
    boatPos.set(-cur.sail * 70, 0, -cur.sail * 95)
    const y = waveHeight(boatPos.x, boatPos.z, t, cur.calm)
    const dx = waveHeight(boatPos.x + 1.2, boatPos.z, t, cur.calm) - waveHeight(boatPos.x - 1.2, boatPos.z, t, cur.calm)
    const dz = waveHeight(boatPos.x, boatPos.z + 0.8, t, cur.calm) - waveHeight(boatPos.x, boatPos.z - 0.8, t, cur.calm)
    boat.position.set(boatPos.x, y + 0.05, boatPos.z)
    boat.rotation.set(dz * 0.55, 0.62 + cur.sail * 0.18, -dx * 0.35)
    uniforms.uBoat.value.set(boatPos.x, boatPos.z)
    shapeSail(mainGeo, t, 0.55 + cur.sail * 0.45)
    shapeSail(jibGeo, t + 0.4, 0.5 + cur.sail * 0.5)

    wake.position.set(boatPos.x + 3.5, 0.02 + y * 0.3, boatPos.z + 4.8)
    wake.rotation.z = 0.62
    wake.scale.set(1.2, 9 * cur.sail + 0.01, 1)
    wakeMat.opacity = cur.sail * 0.18

    // trackers fly at the boat and burst on the shield
    const sh = cur.shield
    shieldMat.uniforms.uOpacity.value = sh
    trackerMat.uniforms.uOpacity.value = sh
    trackers.visible = sh > 0.01
    if (trackers.visible) {
      const cx = boat.position.x
      const cy = boat.position.y + 2.2
      const cz = boat.position.z
      for (let i = 0; i < N; i++) {
        const k = i * 3
        if (tLife[i] < 1) {
          tLife[i] -= dt * 1.6
          if (tLife[i] <= 0) spawn(i)
          continue
        }
        let x = tPos[k] - cx
        let yy = tPos[k + 1] - cy
        let z = tPos[k + 2] - cz
        const d = Math.hypot(x, yy, z)
        if (d <= SHIELD_R) {
          tLife[i] = 0.999
          hitLocal.set(x, yy, z).setLength(SHIELD_R)
          hitStrength = 1
          shieldMat.uniforms.uHit.value.set(hitLocal.x, hitLocal.y, hitLocal.z, 1)
          if (sh > 0.5) onBlock()
          continue
        }
        const step = (tVel[i] * dt) / d
        tPos[k] -= x * step
        tPos[k + 1] -= yy * step
        tPos[k + 2] -= z * step
        // a little wobble so they look alive
        tPos[k + 1] += Math.sin(t * 3 + i) * dt * 0.6
      }
      tGeo.attributes.position.needsUpdate = true
      tGeo.attributes.aLife.needsUpdate = true
    }
    hitStrength *= Math.pow(0.02, dt)
    shieldMat.uniforms.uHit.value.w = hitStrength

    pointerEase.lerp(pointer, 1 - Math.pow(0.02, dt))
    // the camera stays put at the end, so the boat sails away from you toward the dawn
    camera.position.set(cur.cam.x + pointerEase.x * 0.9, cur.cam.y - pointerEase.y * 0.45, cur.cam.z)
    camera.lookAt(cur.look.x + boatPos.x * 0.35, cur.look.y, cur.look.z + boatPos.z * 0.35)
    renderer.render(scene, camera)
  }
  frame()

  return {
    state,
    setActive(v) {
      active = v
      if (v) clock.getDelta()
    }
  }
}
