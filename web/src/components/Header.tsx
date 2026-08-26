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
