import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

// Substitui o IntersectionObserver + classe ".reveal" do site atual —
// mesma ideia (anima quando entra na tela), só que via Framer Motion.
export default function Reveal({
  children,
  delay = 0,
  className = '',
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}
