import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'

const navItems = [
  { href: '#servicos', label: 'Serviços' },
  { href: '#sobre', label: 'Sobre' },
  { href: '#faq', label: 'FAQ' },
]

export default function Header() {
  const [scrolled, setScrolled] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)

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

        {/* Menu central com pill animada seguindo o item em hover — mesmo
            tipo de efeito de navegação mostrado no vídeo. */}
        <nav
          className="relative hidden items-center gap-1 rounded-full border border-border bg-surface/60 p-1 md:flex"
          onMouseLeave={() => setHovered(null)}
        >
          {navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              onMouseEnter={() => setHovered(item.href)}
              className="relative z-10 rounded-full px-4 py-1.5 text-sm font-semibold text-text-muted transition-colors hover:text-text"
            >
              {hovered === item.href && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 -z-10 rounded-full bg-surface-2"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="/portal/login.html"
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold transition hover:border-primary-2 hover:text-primary-2"
          >
            Área do Cliente
          </a>
          <a
            href="#contato"
            className="rounded-full bg-gradient-to-r from-primary via-primary-2 to-accent px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5"
          >
            Fale com um especialista
          </a>
        </div>
      </div>
    </header>
  )
}
