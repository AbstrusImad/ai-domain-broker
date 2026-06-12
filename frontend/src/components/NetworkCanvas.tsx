import { useEffect, useRef } from 'react'

interface Node {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  hue: number
}

/**
 * Animated validator-network background: drifting nodes, proximity edges and
 * light pulses traveling between connected nodes. Pure canvas, zero deps.
 */
export function NetworkCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let raf = 0
    let W = 0
    let H = 0
    let nodes: Node[] = []
    const pulses: { a: Node; b: Node; t: number; speed: number }[] = []
    const mouse = { x: -9999, y: -9999 }

    const LINK_DIST = 170

    function resize() {
      W = canvas!.width = window.innerWidth
      H = canvas!.height = window.innerHeight
      const count = Math.min(90, Math.floor((W * H) / 26000))
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: 1 + Math.random() * 1.8,
        hue: Math.random() < 0.78 ? 250 : Math.random() < 0.5 ? 190 : 310,
      }))
    }

    function spawnPulse() {
      if (pulses.length > 14 || nodes.length < 2) return
      const a = nodes[Math.floor(Math.random() * nodes.length)]
      let best: Node | null = null
      let bestD = LINK_DIST
      for (const b of nodes) {
        if (b === a) continue
        const d = Math.hypot(a.x - b.x, a.y - b.y)
        if (d < bestD) {
          bestD = d
          best = b
        }
      }
      if (best) pulses.push({ a, b: best, t: 0, speed: 0.012 + Math.random() * 0.02 })
    }

    function tick() {
      ctx!.clearRect(0, 0, W, H)

      for (const n of nodes) {
        n.x += n.vx
        n.y += n.vy
        // gentle mouse repulsion
        const dm = Math.hypot(n.x - mouse.x, n.y - mouse.y)
        if (dm < 120 && dm > 0.1) {
          n.x += ((n.x - mouse.x) / dm) * 0.6
          n.y += ((n.y - mouse.y) / dm) * 0.6
        }
        if (n.x < -20) n.x = W + 20
        if (n.x > W + 20) n.x = -20
        if (n.y < -20) n.y = H + 20
        if (n.y > H + 20) n.y = -20
      }

      // edges
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i]
          const b = nodes[j]
          const d = Math.hypot(a.x - b.x, a.y - b.y)
          if (d > LINK_DIST) continue
          const alpha = (1 - d / LINK_DIST) * 0.16
          ctx!.strokeStyle = `hsla(245, 80%, 72%, ${alpha})`
          ctx!.lineWidth = 1
          ctx!.beginPath()
          ctx!.moveTo(a.x, a.y)
          ctx!.lineTo(b.x, b.y)
          ctx!.stroke()
        }
      }

      // nodes
      for (const n of nodes) {
        ctx!.beginPath()
        ctx!.arc(n.x, n.y, n.r, 0, Math.PI * 2)
        ctx!.fillStyle = `hsla(${n.hue}, 90%, 75%, 0.65)`
        ctx!.fill()
      }

      // pulses (light traveling along an edge)
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]
        p.t += p.speed
        if (p.t >= 1) {
          pulses.splice(i, 1)
          continue
        }
        const x = p.a.x + (p.b.x - p.a.x) * p.t
        const y = p.a.y + (p.b.y - p.a.y) * p.t
        const g = ctx!.createRadialGradient(x, y, 0, x, y, 7)
        g.addColorStop(0, 'rgba(77, 217, 255, 0.9)')
        g.addColorStop(1, 'rgba(77, 217, 255, 0)')
        ctx!.fillStyle = g
        ctx!.beginPath()
        ctx!.arc(x, y, 7, 0, Math.PI * 2)
        ctx!.fill()
      }

      if (Math.random() < 0.07) spawnPulse()
      raf = requestAnimationFrame(tick)
    }

    const onMouse = (e: MouseEvent) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
    }
    const onLeave = () => {
      mouse.x = -9999
      mouse.y = -9999
    }

    resize()
    tick()
    window.addEventListener('resize', resize)
    window.addEventListener('mousemove', onMouse)
    window.addEventListener('mouseout', onLeave)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMouse)
      window.removeEventListener('mouseout', onLeave)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 0,
        opacity: 0.55,
        pointerEvents: 'none',
      }}
    />
  )
}
