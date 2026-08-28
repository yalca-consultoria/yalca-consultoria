import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export default function FloatingButtons() {
  const [showTop, setShowTop] = useState(false)

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 500)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      {/* Os dois botões ficam no canto inferior DIREITO (empilhados), nunca no
          esquerdo: o conteúdo do site é alinhado à esquerda (títulos e texto
          dos cards começam bem onde ficava o WhatsApp antes), então um botão
          fixo ali tapava texto real conforme a página rolava — bug real visto
          em telas mobile/tablet (pedido do usuário, 2026-08-28). Canto
          direito também é o padrão que usuários brasileiros já esperam pro
          botão do WhatsApp. */}
      <a
        href="https://wa.me/5541987058237"
        target="_blank"
        rel="noopener"
        aria-label="Falar no WhatsApp"
        className="fixed right-6 bottom-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-whatsapp shadow-lg transition hover:scale-105"
      >
        <img src="/img/icons/whatsapp.svg" alt="" width={26} height={26} />
      </a>

      <AnimatePresence>
        {showTop && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            aria-label="Voltar ao topo"
            className="fixed right-6 bottom-24 z-50 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-lg shadow-lg transition hover:-translate-y-0.5"
          >
            ↑
          </motion.button>
        )}
      </AnimatePresence>
    </>
  )
}
