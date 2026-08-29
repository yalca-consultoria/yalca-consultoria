import { useEffect, useState } from 'react'

const STORAGE_KEY = 'yalca_cookie_notice_seen'

// Aviso de cookies/LGPD — o site hoje não usa cookies de rastreamento nem
// terceiros de analytics, então isso é um aviso informativo (o que já
// cumpre a transparência exigida pela LGPD) em vez de um seletor de
// preferências vazio, que seria só teatro. Se um dia entrar analytics/pixel,
// aí sim vira um banner de consentimento com opção de recusar.
export default function CookieBanner() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
    } catch {
      setVisible(true)
    }
  }, [])

  function dismiss() {
    setVisible(false)
    try {
      localStorage.setItem(STORAGE_KEY, '1')
    } catch {
      /* navegação privada: sem problema, só volta a aparecer na próxima visita */
    }
  }

  if (!visible) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] border-t border-border bg-surface/95 px-6 py-4 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 sm:flex-row sm:justify-between">
        <p className="text-sm text-text-muted">
          Este site não usa cookies de rastreamento ou de terceiros. Usamos apenas o essencial pro site
          funcionar. Saiba mais na{' '}
          <a href="/privacidade.html" className="font-semibold text-primary-2 hover:underline">
            Política de Privacidade
          </a>
          .
        </p>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-full bg-gradient-to-r from-primary via-primary-2 to-accent px-5 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5"
        >
          Entendi
        </button>
      </div>
    </div>
  )
}
