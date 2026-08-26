import { useEffect, useRef } from 'react'

// Fundo "flow field" de partículas — a mesma família de efeito citada no
// vídeo (fundo animado do hero que "parece vivo"). Implementado em canvas
// puro (sem lib de terceiro): um campo de ângulos gerado por funções seno
// sobrepostas (equivalente barato a ruído Perlin) empurra centenas de
// partículas em trilhas suaves, coloridas com a paleta da marca.
export default function FlowFieldBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let width = 0
    let height = 0
    let raf = 0
    let time = 0
    const colors = ['#6d5bf6', '#8b7bff', '#22d3ee']

    function resize() {
      const rect = canvas!.parentElement!.getBoundingClientRect()
      width = canvas!.width = rect.width
      height = canvas!.height = rect.height
    }
    resize()
    window.addEventListener('resize', resize)

    const COUNT = Math.min(140, Math.floor((width * height) / 9000))
    const particles = Array.from({ length: COUNT }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      life: Math.random() * 200,
      color: colors[Math.floor(Math.random() * colors.length)],
    }))

    function angleAt(x: number, y: number, t: number) {
      return (
        Math.sin(x * 0.0025 + t) * 1.4 +
        Math.cos(y * 0.003 - t * 0.8) * 1.4
      )
    }

    function step() {
      // Rastro suave: em vez de limpar o frame inteiro, pinta uma camada
      // semitransparente por cima — é isso que dá o "rastro" de cada
      // partícula em vez de um ponto piscando sem continuidade.
      ctx!.fillStyle = 'rgba(11, 17, 32, 0.06)'
      ctx!.fillRect(0, 0, width, height)

      time += 0.0022
      for (const p of particles) {
        const angle = angleAt(p.x, p.y, time)
        const speed = 0.6
        const nx = p.x + Math.cos(angle) * speed
        const ny = p.y + Math.sin(angle) * speed

        ctx!.strokeStyle = p.color
        ctx!.globalAlpha = 0.55
        ctx!.lineWidth = 1.4
        ctx!.beginPath()
        ctx!.moveTo(p.x, p.y)
        ctx!.lineTo(nx, ny)
        ctx!.stroke()

        p.x = nx
        p.y = ny
        p.life -= 1
        if (p.life <= 0 || p.x < 0 || p.x > width || p.y < 0 || p.y > height) {
          p.x = Math.random() * width
          p.y = Math.random() * height
          p.life = 120 + Math.random() * 160
        }
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 h-full w-full opacity-90 [mask-image:radial-gradient(ellipse_80%_60%_at_50%_20%,black,transparent)]"
      aria-hidden="true"
    />
  )
}
