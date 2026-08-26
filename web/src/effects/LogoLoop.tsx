import { motion } from 'framer-motion'

export type LogoItem = { src: string; alt: string }

// Carrossel infinito de logos — duplica a lista uma vez e anima o trilho
// inteiro em loop (translateX 0 → -50%), efeito clássico de "logo loop"
// visto em landing pages premium.
export default function LogoLoop({ logos }: { logos: LogoItem[] }) {
  const track = [...logos, ...logos]
  return (
    <div className="relative overflow-hidden py-2 [mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
      <motion.div
        className="flex w-max gap-10"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
      >
        {track.map((logo, i) => (
          <div
            key={`${logo.alt}-${i}`}
            className="flex h-16 w-32 shrink-0 items-center justify-center rounded-xl border border-border bg-surface/60 px-4"
          >
            <img src={logo.src} alt={logo.alt} loading="lazy" className="max-h-8 w-auto opacity-80" />
          </div>
        ))}
      </motion.div>
    </div>
  )
}
