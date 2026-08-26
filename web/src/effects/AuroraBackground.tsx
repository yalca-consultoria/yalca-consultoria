import { motion } from 'framer-motion'

// Fundo animado sutil pro Hero — blobs de gradiente que se movem devagar,
// no lugar do ".hero__bg" estático do site atual. Sem partículas/canvas
// pesado: só transform em elementos com blur, custo de CPU/GPU baixo.
export default function AuroraBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <motion.div
        className="absolute -top-32 left-[10%] h-[420px] w-[420px] rounded-full bg-primary/30 blur-[120px]"
        animate={{ x: [0, 60, 0], y: [0, 40, 0] }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-10 right-[8%] h-[380px] w-[380px] rounded-full bg-accent/25 blur-[120px]"
        animate={{ x: [0, -50, 0], y: [0, 60, 0] }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[-10%] left-[35%] h-[320px] w-[320px] rounded-full bg-primary-2/20 blur-[110px]"
        animate={{ x: [0, 40, 0], y: [0, -30, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  )
}
