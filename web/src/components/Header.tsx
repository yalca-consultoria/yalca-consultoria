import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

type HeaderProps = {
  menuOpen: boolean
  onMenuOpenChange: (open: boolean) => void
}

export default function Header({ menuOpen, onMenuOpenChange: setMenuOpen }: HeaderProps) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled || menuOpen ? 'border-b border-border bg-bg/80 backdrop-blur-md' : 'border-b border-transparent'
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <a href="#top" className="font-heading text-xl font-bold" onClick={() => setMenuOpen(false)}>
          Yalca<span className="text-accent">.</span>
        </a>

        {/* Abaixo de sm (640px) os dois links viram um menu hambúrguer — antes
            ficavam escondidos sem alternativa nenhuma no header em mobile
            (pedido do usuário, 2026-08-28). */}
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

        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-border sm:hidden"
        >
          <span className="relative flex h-4 w-5 flex-col justify-between">
            <span
              className={`h-0.5 w-full rounded-full bg-text transition-transform duration-300 ${
                menuOpen ? 'translate-y-[7px] rotate-45' : ''
              }`}
            />
            <span
              className={`h-0.5 w-full rounded-full bg-text transition-opacity duration-300 ${
                menuOpen ? 'opacity-0' : ''
              }`}
            />
            <span
              className={`h-0.5 w-full rounded-full bg-text transition-transform duration-300 ${
                menuOpen ? '-translate-y-[7px] -rotate-45' : ''
              }`}
            />
          </span>
        </button>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="overflow-hidden border-t border-border bg-bg sm:hidden"
          >
            <div className="flex flex-col gap-3 px-6 py-5">
              <a
                href="/portal/login.html"
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-center rounded-full border border-border px-4 py-3 text-sm font-semibold"
              >
                Área do Cliente
              </a>
              <a
                href="#contato"
                onClick={() => setMenuOpen(false)}
                className="flex items-center justify-center rounded-full bg-gradient-to-r from-primary via-primary-2 to-accent px-4 py-3 text-sm font-semibold text-white"
              >
                Fale com um especialista
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
