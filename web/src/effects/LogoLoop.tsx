import { motion } from 'framer-motion'
import { useState } from 'react'

export type LogoItem = { src: string; alt: string }

// Carrossel infinito de logos — pausa no hover do trilho inteiro. Os logos
// ficam sempre coloridos (antes desaturava e só voltava à cor no hover de
// cada um — pedido pra tirar isso, 2026-08-28); e o hover de cada chip é só
// CSS puro (:hover), sem estado do React por item, que antes disparava um
// re-render da lista inteira (~26 itens) a cada movimento do mouse durante
// a animação e travava o carrossel (bug real relatado, 2026-08-28).
export default function LogoLoop({ logos }: { logos: LogoItem[] }) {
  const track = [...logos, ...logos]
  const [paused, setPaused] = useState(false)

  return (
    <div
      className="relative overflow-hidden py-2 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <motion.div
        className="flex w-max gap-10"
        animate={paused ? {} : { x: ['0%', '-50%'] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
      >
        {track.map((logo, i) => (
          <div
            key={`${logo.alt}-${i}`}
            className="flex h-16 w-32 shrink-0 items-center justify-center rounded-xl border border-border bg-white px-4 transition-colors duration-300 hover:border-primary-2"
          >
            {/* Fundo branco fixo no chip — vários logos (Bling, Tiny,
                Americanas etc.) usam arte escura pensada pra fundo claro. */}
            <img src={logo.src} alt={logo.alt} loading="lazy" className="max-h-8 w-auto" />
          </div>
        ))}
      </motion.div>
    </div>
  )
}
