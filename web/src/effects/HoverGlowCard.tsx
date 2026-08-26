import { useRef, useState, type ReactNode, type MouseEvent } from 'react'
import { motion } from 'framer-motion'

// Card com dois efeitos sobrepostos:
// 1. Borda com gradiente girando devagar sem parar (efeito "glass" tipo o
//    citado no vídeo como referência da Apple) — sutil no card normal,
//    mais visível no card em destaque.
// 2. Spotlight que segue o mouse dentro do card (some quando o mouse sai).
export default function HoverGlowCard({
  children,
  className = '',
  highlight = false,
}: {
  children: ReactNode
  className?: string
  highlight?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 50, y: 50 })
  const [hovering, setHovering] = useState(false)

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setPos({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 })
  }

  return (
    <div className={`relative overflow-hidden rounded-2xl p-px ${className}`}>
      <motion.div
        className="absolute inset-[-50%] rounded-2xl"
        style={{
          background: `conic-gradient(from 0deg, #6d5bf6, #22d3ee, #8b7bff, #6d5bf6)`,
          opacity: highlight ? 0.9 : hovering ? 0.6 : 0.18,
        }}
        animate={{ rotate: 360 }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />
      <div
        ref={ref}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="group relative overflow-hidden rounded-2xl bg-surface p-8 transition-transform duration-300 hover:-translate-y-1.5"
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background: `radial-gradient(280px circle at ${pos.x}% ${pos.y}%, rgba(109,91,246,0.22), transparent 70%)`,
          }}
        />
        <div className="relative">{children}</div>
      </div>
    </div>
  )
}
