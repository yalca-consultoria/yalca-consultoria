import { useRef, useState, type ReactNode, type MouseEvent } from 'react'

// Glow que segue o mouse dentro do card — efeito "spotlight" sutil, o
// hover mais comum nas bibliotecas de componentes citadas no vídeo
// (aceternity/magicui), reimplementado direto em CSS/React sem depender
// de nenhum pacote de terceiro.
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

  function handleMouseMove(e: MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    setPos({ x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 })
  }

  return (
    <div
      ref={ref}
      onMouseMove={handleMouseMove}
      className={`group relative overflow-hidden rounded-2xl border ${highlight ? 'border-primary-2' : 'border-border'} bg-surface p-8 transition-transform duration-300 hover:-translate-y-1.5 ${className}`}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background: `radial-gradient(280px circle at ${pos.x}% ${pos.y}%, rgba(109,91,246,0.18), transparent 70%)`,
        }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}
