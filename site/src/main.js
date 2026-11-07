import '@fontsource-variable/bricolage-grotesque'
import '@fontsource-variable/onest'
import '@fontsource-variable/jetbrains-mono'
import './style.css'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import Lenis from 'lenis'
import { createScene } from './scene.js'
import { LOCALE_TAG, S, rememberLanguageChoice } from './strings.js'

gsap.registerPlugin(ScrollTrigger)

// Fill these in when the GitHub repository exists (same as "repository" in the app's package.json).
const REPO = 'https://github.com/reiakashi1v10-dot/halyard-browser'
const DOWNLOAD = `${REPO}/releases/latest`
const READY = !REPO.includes('SEU-USUARIO')

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]

// ------------------------------------------------------------ links, year, clock
for (const a of $$('[data-download]')) if (READY) a.href = DOWNLOAD
for (const a of $$('[data-repo]')) a.href = READY ? REPO : '#'
$('[data-year]').textContent = new Date().getFullYear()
rememberLanguageChoice()
const clock = $('[data-clock]')
const tick = () => (clock.textContent = new Date().toLocaleTimeString(LOCALE_TAG, { hour: '2-digit', minute: '2-digit' }))
tick()
setInterval(tick, 15_000)

// ------------------------------------------------------------ 3D scene
let blocked = 0
let shownBlocked = -1
const counter = $('[data-counter]')
const sea = createScene($('#sea'), { reduced, onBlock: () => blocked++ })
const fmt = new Intl.NumberFormat(LOCALE_TAG)
gsap.ticker.add(() => {
  if (blocked !== shownBlocked) {
    shownBlocked = blocked
    counter.textContent = fmt.format(blocked)
  }
})

// render the sea only while a section that shows it is on screen
const immersive = new Set()
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) e.isIntersecting ? immersive.add(e.target) : immersive.delete(e.target)
    sea.setActive(immersive.size > 0)
  },
  { rootMargin: '10% 0px' }
)
$$('.immersive').forEach((el) => io.observe(el))

/** Camera and mood for each act of the page. */
const ACTS = {
  hero: { cam: [-7.5, 2.1, 13], look: [0, 1.9, 0], dawn: 0, shield: 0, sail: 0, calm: 1, lines: 1 },
  manifesto: { cam: [-2, 10, 24], look: [0, 0, -12], dawn: 0, shield: 0, sail: 0, calm: 1.35, lines: 1.5 },
  shield: { cam: [7, 4.2, 16], look: [0, 2.6, 0], dawn: 0, shield: 1, sail: 0, calm: 1, lines: 0.7 },
  ia: { cam: [-13, 3.2, 9], look: [0, 2.2, 0], dawn: 0.15, shield: 0, sail: 0, calm: 0.85, lines: 0.5 },
  finale: { cam: [3, 3.4, 17], look: [-6, 2, -14], dawn: 1, shield: 0, sail: 1, calm: 0.7, lines: 0.35 }
}
function setAct(name) {
  const a = ACTS[name]
  if (!a) return
  sea.state.cam.set(...a.cam)
  sea.state.look.set(...a.look)
  Object.assign(sea.state, { dawn: a.dawn, shield: a.shield, sail: a.sail, calm: a.calm, lines: a.lines })
}
for (const el of $$('[data-act]')) {
  ScrollTrigger.create({
    trigger: el,
    start: 'top 55%',
    end: 'bottom 45%',
    onToggle: (self) => self.isActive && setAct(el.dataset.act)
  })
}
setAct('hero')

// ------------------------------------------------------------ smooth scroll
let lenis = null
if (!reduced) {
  lenis = new Lenis({ lerp: 0.09, wheelMultiplier: 0.95 })
  lenis.on('scroll', ScrollTrigger.update)
  gsap.ticker.add((t) => lenis.raf(t * 1000))
  gsap.ticker.lagSmoothing(0)
}
for (const a of $$('a[href^="#"]')) {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href')
    if (id.length < 2 || (a.hasAttribute('data-download') && READY)) return
    const target = $(id)
    if (!target) return
    e.preventDefault()
    lenis ? lenis.scrollTo(target, { offset: 0, duration: 1.6 }) : target.scrollIntoView()
  })
}

// ------------------------------------------------------------ nav: hides going down, inverts over paper
const nav = $('[data-nav]')
ScrollTrigger.create({
  start: 80,
  end: 'max',
  onUpdate: (self) => {
    nav.classList.toggle('is-scrolled', self.scroll() > 80)
    nav.classList.toggle('is-hidden', self.direction === 1 && self.scroll() > 400)
  }
})
for (const el of $$('[data-paper]')) {
  if (el.classList.contains('paper-dark')) continue
  ScrollTrigger.create({ trigger: el, start: 'top 36px', end: 'bottom 36px', toggleClass: { targets: nav, className: 'on-paper' } })
}

// heading on the hero changes as you go
const heading = $('[data-heading]')
ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (s) => (heading.textContent = String(Math.round(247 + s.progress * 96) % 360)) })

// ------------------------------------------------------------ text
/** Wrap each line (span) of a title in a mask so it can rise into view. */
for (const title of $$('[data-split]')) {
  for (const line of [...title.children]) {
    const inner = document.createElement('span')
    inner.className = 'line-inner'
    inner.append(...line.childNodes)
    line.className = 'line'
    line.append(inner)
  }
}
for (const p of $$('[data-words]')) {
  const words = p.textContent.trim().split(/\s+/)
  p.textContent = ''
  words.forEach((w, i) => {
    const s = document.createElement('span')
    s.className = 'word'
    s.textContent = w
    p.append(s, i < words.length - 1 ? ' ' : '')
  })
}

if (reduced) {
  document.documentElement.classList.add('reduced')
} else {
  // the hero plays once the fonts are in, so lines don't jump
  document.fonts.ready.then(() => {
    const hero = gsap.timeline({ defaults: { ease: 'expo.out' } })
    hero
      .from('.hero .line-inner', { yPercent: 115, rotate: 4, duration: 1.5, stagger: 0.09 }, 0.15)
      .from('.hero [data-reveal]', { y: 24, opacity: 0, duration: 1.1, stagger: 0.08 }, 0.55)
      .from('.nav', { y: -30, opacity: 0, duration: 1 }, 0.4)
      .from('.coords span, .scroll-hint', { opacity: 0, duration: 1, stagger: 0.06 }, 0.9)
  })

  for (const title of $$('[data-split]').filter((t) => !t.closest('.hero'))) {
    gsap.from($$('.line-inner', title), {
      yPercent: 115,
      rotate: 3,
      duration: 1.3,
      ease: 'expo.out',
      stagger: 0.08,
      scrollTrigger: { trigger: title, start: 'top 82%' }
    })
  }
  for (const num of $$('.chapter-num')) {
    gsap.from(num, { clipPath: 'inset(0 100% 0 0)', duration: 1.1, ease: 'power3.inOut', scrollTrigger: { trigger: num, start: 'top 85%' } })
  }
  ScrollTrigger.batch($$('[data-reveal]').filter((el) => !el.closest('.hero')), {
    start: 'top 88%',
    onEnter: (els) => gsap.from(els, { y: 28, opacity: 0, duration: 1, ease: 'power3.out', stagger: 0.08 }),
    once: true
  })

  // manifesto: words light up as you scroll through
  gsap.to('.manifesto .word', {
    opacity: 1,
    stagger: 0.05,
    ease: 'none',
    scrollTrigger: { trigger: '.manifesto', start: 'top 70%', end: 'bottom 60%', scrub: 0.6 }
  })

  // hero sinks a little and fades as the sea takes over
  gsap.to('.hero-title', { yPercent: -18, opacity: 0.15, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } })
}

// ------------------------------------------------------------ 02 scam demo
{
  const typed = $('[data-typed]')
  const warnEl = $('[data-warn]')
  const page = $('.fake-page')
  const stage = $('[data-scam]')
  const addr = stage.dataset.typedText
  const typer = { n: 0 }
  const render = () => (typed.textContent = addr.slice(0, Math.round(typer.n)))

  const tl = gsap.timeline({ paused: reduced })
  tl.to(typer, { n: addr.length, duration: 1.4, ease: 'steps(20)', onUpdate: render })
    .fromTo(page, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5 }, '+=0.15')
    .to(page, { filter: 'blur(6px) saturate(0.4)', opacity: 0.55, duration: 0.5 }, '+=0.35')
    .fromTo(warnEl, { opacity: 0, y: 40, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.7, ease: 'back.out(1.6)' }, '<')
    .to('.addr', { color: 'var(--signal)', duration: 0.3 }, '<')

  if (reduced) {
    tl.progress(1)
  } else {
    const mm = gsap.matchMedia()
    mm.add('(min-width: 900px)', () => {
      ScrollTrigger.create({ trigger: stage, start: 'top 18%', end: '+=900', pin: true, scrub: 0.7, animation: tl })
    })
    mm.add('(max-width: 899px)', () => {
      ScrollTrigger.create({ trigger: stage, start: 'top 70%', animation: tl, toggleActions: 'play none none none' })
    })
  }
}

// ------------------------------------------------------------ 03 zip demo
{
  const stage = $('[data-dl]')
  const files = $$('[data-file]', stage)
  const tl = gsap.timeline({ paused: true })
  tl.from(files, { x: -24, opacity: 0, duration: 0.45, stagger: 0.18, ease: 'power3.out' })
    .fromTo('.scanline', { top: '22%', opacity: 1 }, { top: '96%', duration: 1.3, ease: 'power1.inOut' }, 0.2)
    .to('.scanline', { opacity: 0, duration: 0.2 })
    .add(() => stage.classList.add('is-flagged'))
    .from('[data-verdict]', { y: 20, opacity: 0, duration: 0.6, ease: 'power3.out' }, '+=0.1')
  if (reduced) {
    tl.progress(1)
    stage.classList.add('is-flagged')
  } else ScrollTrigger.create({ trigger: stage, start: 'top 65%', onEnter: () => tl.play() })
}

// ------------------------------------------------------------ 04 local AI: horizontal track
if (!reduced) {
  const mm = gsap.matchMedia()
  mm.add('(min-width: 900px)', () => {
    const track = $('[data-track]')
    const distance = () => track.scrollWidth - window.innerWidth + parseFloat(getComputedStyle(track).paddingLeft) * 1
    gsap.to(track, {
      x: () => -distance(),
      ease: 'none',
      scrollTrigger: { trigger: '.ia-pin', start: 'top top', end: () => `+=${distance()}`, pin: true, scrub: 0.8, invalidateOnRefresh: true }
    })
  })
}

// ------------------------------------------------------------ 05 windows status flips on
{
  const items = $$('[data-win] li')
  const marks = items.map((li) => $('i', li))
  const finals = marks.map((m) => m.innerHTML)
  if (!reduced) {
    marks.forEach((m) => {
      m.dataset.final = m.dataset.state
      m.dataset.state = 'wait'
      m.textContent = S.checking
    })
    ScrollTrigger.create({
      trigger: '[data-win]',
      start: 'top 70%',
      once: true,
      onEnter: () =>
        marks.forEach((m, i) =>
          setTimeout(() => {
            m.dataset.state = m.dataset.final
            m.innerHTML = finals[i]
          }, 350 + i * 260)
        )
    })
  }
}

// ------------------------------------------------------------ 06 the full list
const FEATURES = S.features
{
  const box = $('[data-index]')
  let group = ''
  FEATURES.forEach(([cat, name, desc, always], i) => {
    if (cat !== group) {
      group = cat
      const h = document.createElement('h3')
      h.className = 'index-group mono'
      h.textContent = cat
      box.append(h)
    }
    const row = document.createElement('div')
    row.className = 'index-row'
    row.innerHTML = `<span class="mono index-n">${String(i + 1).padStart(2, '0')}</span><strong>${name}</strong><span class="index-desc">${desc}</span><span class="mono index-mode is-${always ? 'always' : 'optional'}">${always ? S.always : S.optional}</span>`
    box.append(row)
  })
  if (!reduced)
    ScrollTrigger.batch($$('.index-row, .index-group', box), {
      start: 'top 92%',
      once: true,
      onEnter: (els) => gsap.from(els, { y: 22, opacity: 0, duration: 0.7, ease: 'power3.out', stagger: 0.045 })
    })
}

// ------------------------------------------------------------ magnetic buttons
if (!reduced && window.matchMedia('(pointer: fine)').matches) {
  for (const btn of $$('.magnetic')) {
    const xTo = gsap.quickTo(btn, 'x', { duration: 0.5, ease: 'power3.out' })
    const yTo = gsap.quickTo(btn, 'y', { duration: 0.5, ease: 'power3.out' })
    btn.addEventListener('pointermove', (e) => {
      const r = btn.getBoundingClientRect()
      xTo((e.clientX - r.left - r.width / 2) * 0.28)
      yTo((e.clientY - r.top - r.height / 2) * 0.38)
    })
    btn.addEventListener('pointerleave', () => {
      xTo(0)
      yTo(0)
    })
  }
}

// fonts change line heights: measure pins again once they are in
document.fonts.ready.then(() => ScrollTrigger.refresh())
