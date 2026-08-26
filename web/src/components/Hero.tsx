import { motion } from 'framer-motion'
import AuroraBackground from '../effects/AuroraBackground'
import FlowFieldBackground from '../effects/FlowFieldBackground'

const floats = [
  { src: '/img/marketplaces/mercadolivre.svg', className: 'top-4 left-0' },
  { src: '/img/marketplaces/amazon.svg', className: 'top-24 right-4' },
  { src: '/img/marketplaces/shopee.svg', className: 'bottom-28 left-8' },
  { src: '/img/marketplaces/tiktok.svg', className: 'bottom-4 right-10' },
  { src: '/img/marketplaces/bling.svg', className: 'top-1/2 left-1/2' },
]

export default function Hero() {
  return (
    <section id="top" className="relative isolate overflow-hidden pt-20 pb-24">
      <FlowFieldBackground />
      <AuroraBackground />
      <div className="relative mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-2 lg:items-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <span className="text-sm font-semibold uppercase tracking-wider text-accent">
            Assessoria de Ecommerce
          </span>
          <h1 className="mt-4 text-4xl font-bold leading-tight lg:text-5xl">
            Sua loja vendendo mais, <span className="text-gradient">com estratégia</span> e sem achismo.
          </h1>
          <p className="mt-5 max-w-lg text-lg text-text-muted">
            Cuidamos da gestão dos seus marketplaces, do tráfego pago e da estratégia do seu negócio
            para você crescer com previsibilidade e margem saudável.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href="#contato"
              className="rounded-full bg-gradient-to-r from-primary via-primary-2 to-accent px-6 py-3 font-semibold text-white transition hover:-translate-y-0.5"
            >
              Quero uma análise gratuita
            </a>
            <a
              href="#servicos"
              className="rounded-full border border-border px-6 py-3 font-semibold transition hover:border-primary-2 hover:text-primary-2"
            >
              Ver serviços
            </a>
          </div>
        </motion.div>

        <div className="relative hidden h-[360px] lg:block">
          {floats.map((f, i) => (
            <motion.div
              key={f.src}
              className={`absolute rounded-xl border border-border bg-surface/80 p-3 shadow-lg backdrop-blur ${f.className}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1, y: [0, -10, 0] }}
              transition={{ opacity: { delay: i * 0.15, duration: 0.5 }, scale: { delay: i * 0.15, duration: 0.5 }, y: { duration: 4 + i, repeat: Infinity, ease: 'easeInOut' } }}
            >
              <img src={f.src} alt="" width={88} height={34} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}
