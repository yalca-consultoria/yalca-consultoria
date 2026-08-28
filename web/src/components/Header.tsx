import { useEffect, useState } from 'react'

export default function Header() {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? 'border-b border-border bg-bg/80 backdrop-blur-md' : 'border-b border-transparent'
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top" className="font-heading text-xl font-bold">
          Yalca<span className="text-accent">.</span>
        </a>

        {/* Escondido abaixo de sm (640px) — sem menu mobile ainda, esses dois
            botões não cabem lado a lado com a logo e quebravam linha dentro
            do container de altura fixa do hover "roll-text", cortando o
            texto e empurrando o resto da página (bug real relatado pelo
            usuário, 2026-08-26). O botão flutuante do WhatsApp já cobre a
            conversão em telas pequenas. */}
        <div className="hidden items-center gap-3 sm:flex">
          <a
            href="/portal/login.html"
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold whitespace-nowrap transition hover:border-primary-2 hover:text-primary-2"
          >
            Área do Cliente
          </a>
          <a
            href="#contato"
            className="rounded-full bg-gradient-to-r from-primary via-primary-2 to-accent p-0.5 transition hover:-translate-y-0.5"
          >
            <span className="group flex items-center gap-2 whitespace-nowrap rounded-full bg-bg px-4 py-1.5">
              <span className="roll-text h-[1.1em] overflow-hidden text-sm font-semibold">
                <span className="roll-text__inner block">
                  <span className="block">Fale com um especialista</span>
                  <span className="block">Fale com um especialista</span>
                </span>
              </span>
            </span>
          </a>
        </div>
      </div>
    </header>
  )
}
