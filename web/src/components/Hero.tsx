import { motion } from 'framer-motion'
import FloatLogos from '../effects/FloatLogos'
import { useTypewriter } from '../effects/useTypewriter'

const HEADLINE = 'Sua loja vendendo mais, com estratégia e sem achismo.'

export default function Hero() {
  const { visible, done } = useTypewriter(HEADLINE, 35, 400)

  return (
    <section id="top" className="relative isolate overflow-hidden pt-10 pb-14 sm:pt-14 lg:pt-20">
      <div className="relative mx-auto flex max-w-6xl flex-col gap-12 px-6 lg:flex-row lg:items-center lg:justify-between">
        <motion.div
          className="flex-[0_1_560px] lg:pt-10"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        >
          <span className="text-sm font-semibold uppercase tracking-wider text-accent">
            Assessoria de Ecommerce
          </span>

          <h1
            className="font-urbanist mt-4 min-h-[180px] text-4xl font-semibold leading-tight tracking-tight sm:min-h-[100px] lg:min-h-[192px] lg:text-[64px] lg:leading-[64px] lg:tracking-[-1.5px]"
            aria-label={HEADLINE}
          >
            <span aria-hidden="true">
              {visible}
              {!done && <span className="typewriter-cursor h-[1em] translate-y-[0.15em]" />}
            </span>
          </h1>

          <motion.p
            className="mt-5 max-w-lg text-lg text-text-muted"
            initial={{ opacity: 0 }}
            animate={{ opacity: done ? 1 : 0 }}
            transition={{ duration: 0.5 }}
          >
            Da negociação com fornecedores à parte contábil, passando pela gestão dos seus marketplaces
            e pelo tráfego pago — tudo com um time só, pra você crescer com previsibilidade e margem saudável.
          </motion.p>

          <motion.div
            className="mt-8 flex flex-wrap items-center gap-4"
            initial={{ opacity: 0, y: 16 }}
            animate={done ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.4 }}
          >
            <div className="btn-border-wrap">
              <div className="btn-border-mask">
                <div className="btn-border-spin" />
              </div>
              <a
                href="#contato"
                className="btn-fill-swap--right btn-fill-swap relative flex items-center gap-2 rounded-full bg-[#060218] px-7 py-3.5 text-base font-semibold text-white"
              >
                Iniciar projeto
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 9h10M9 4l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
            <a
              href="#servicos"
              className="rounded-full border border-border px-6 py-3 font-semibold transition hover:border-primary-2 hover:text-primary-2"
            >
              Ver serviços
            </a>
          </motion.div>
        </motion.div>

        <motion.div
          className="mx-auto hidden w-full max-w-[420px] shrink-0 sm:block lg:mx-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 1.2, delay: 0.3, ease: 'easeOut' }}
        >
          <FloatLogos />
        </motion.div>
      </div>
    </section>
  )
}
