import { motion } from 'framer-motion'
import { useState } from 'react'

export type LogoItem = { src: string; alt: string }

// Carrossel infinito de logos — pausa no hover do trilho inteiro, e cada
// logo individual passa de preto-e-branco pra cor real ao passar o mouse
// (efeito comum em landing pages premium pra dar vida ao "trust bar").
export default function LogoLoop({ logos }: { logos: LogoItem[] }) {
  const track = [...logos, ...logos]
  const [paused, setPaused] = useState(false)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  return (
    <div
      className="relative overflow-hidden py-2 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => { setPaused(false); setHoveredIdx(null) }}
    >
      <motion.div
        className="flex w-max gap-10"
        animate={paused ? {} : { x: ['0%', '-50%'] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
      >
        {track.map((logo, i) => (
          <div
            key={`${logo.alt}-${i}`}
            onMouseEnter={() => setHoveredIdx(i)}
            className="flex h-16 w-32 shrink-0 items-center justify-center rounded-xl border border-border bg-surface/60 px-4 transition-colors duration-300 hover:border-primary-2"
          >
            <img
              src={logo.src}
              alt={logo.alt}
              loading="lazy"
              className="max-h-8 w-auto transition-all duration-300"
              style={{
                filter: hoveredIdx === i ? 'none' : 'grayscale(1)',
                opacity: hoveredIdx === i ? 1 : 0.6,
              }}
            />
          </div>
        ))}
      </motion.div>
    </div>
  )
}
