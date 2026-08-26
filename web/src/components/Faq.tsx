import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Reveal from '../effects/Reveal'

const faqs = [
  { q: 'Preciso já ter uma loja rodando para contratar a assessoria?', a: 'Não. Trabalhamos tanto com lojas que já vendem e querem escalar, quanto com quem está começando e precisa estruturar os canais desde o início.' },
  { q: 'Em quais marketplaces vocês atuam?', a: 'Atuamos principalmente em Mercado Livre, Amazon, Shopee e lojas próprias em Shopify e Nuvemshop.' },
  { q: 'Quanto tempo leva para ver resultados?', a: 'Os primeiros ajustes de operação e anúncios costumam gerar impacto já nas primeiras semanas. Resultados mais consistentes de crescimento aparecem entre 60 e 90 dias.' },
  { q: 'Como funciona o contrato?', a: 'O contrato é personalizado para cada cliente — não vendemos um pacote fechado. Montamos o escopo e as condições de acordo com o momento e o tamanho do seu negócio.' },
]

export default function Faq() {
  const [open, setOpen] = useState<number | null>(null)

  return (
    <section id="faq" className="py-24">
      <div className="mx-auto max-w-3xl px-6">
        <Reveal className="mb-12 text-center">
          <span className="text-sm font-semibold uppercase tracking-wider text-accent">Dúvidas frequentes</span>
          <h2 className="mt-3 text-3xl font-bold lg:text-4xl">Perguntas frequentes</h2>
        </Reveal>
        <Reveal className="space-y-3">
          {faqs.map((item, i) => (
            <div key={item.q} className="rounded-xl border border-border bg-surface">
              <button
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold"
              >
                {item.q}
                <span className={`shrink-0 text-accent transition-transform ${open === i ? 'rotate-45' : ''}`}>+</span>
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <p className="px-5 pb-4 text-text-muted">{item.a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  )
}
