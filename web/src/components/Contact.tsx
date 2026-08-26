import { useState, type FormEvent } from 'react'
import Reveal from '../effects/Reveal'

type Field = 'name' | 'email' | 'phone' | 'message'

const WHATSAPP_NUMBER = '5541987058237'

// Validação client-side + envio real via WhatsApp (mensagem pré-preenchida)
// — corrige o bug real encontrado no critique de 2026-08-26: antes disso o
// formulário só validava e mostrava "sucesso" local, sem mandar a mensagem
// pra lugar nenhum (todo lead era perdido silenciosamente).
const validators: Record<Field, (v: string) => true | string> = {
  name: (v) => v.trim().length >= 3 || 'Informe seu nome completo.',
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || 'Informe um e-mail válido.',
  phone: (v) => v.replace(/\D/g, '').length >= 10 || 'Informe um telefone válido com DDD.',
  message: (v) => v.trim().length >= 10 || 'Conte um pouco mais (mín. 10 caracteres).',
}

function buildWhatsAppMessage(values: { name: string; email: string; phone: string; store: string; message: string }) {
  const lines = [
    `Olá! Meu nome é ${values.name}.`,
    `E-mail: ${values.email}`,
    `WhatsApp: ${values.phone}`,
    values.store ? `Loja/site: ${values.store}` : null,
    `Sobre meu momento: ${values.message}`,
  ].filter(Boolean)
  return lines.join('\n')
}

export default function Contact() {
  const [values, setValues] = useState({ name: '', email: '', phone: '', store: '', message: '' })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [success, setSuccess] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const nextErrors: Partial<Record<Field, string>> = {}
    ;(Object.keys(validators) as Field[]).forEach((field) => {
      const result = validators[field](values[field])
      if (result !== true) nextErrors[field] = result
    })
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    const text = encodeURIComponent(buildWhatsAppMessage(values))
    window.open(`https://wa.me/${WHATSAPP_NUMBER}?text=${text}`, '_blank', 'noopener')

    setSuccess(true)
    setValues({ name: '', email: '', phone: '', store: '', message: '' })
    setSubmitting(false)
    setTimeout(() => setSuccess(false), 8000)
  }

  return (
    <section id="contato" className="py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-2">
        <Reveal>
          <span className="text-sm font-semibold uppercase tracking-wider text-accent">Contato</span>
          <h2 className="mt-3 text-3xl font-bold lg:text-4xl">Vamos conversar sobre o seu ecommerce</h2>
          <p className="mt-3 text-text-muted">Preencha o formulário ou fale direto pelo WhatsApp. Retornamos em até 1 dia útil.</p>
          <ul className="mt-6 space-y-2 text-text-muted">
            <li>📞 (41) 98705-8237</li>
            <li>✉️ contato@yalca.com.br</li>
            <li>📍 Atendimento 100% remoto, para todo o Brasil</li>
          </ul>
          <a
            href={`https://wa.me/${WHATSAPP_NUMBER}`}
            target="_blank"
            rel="noopener"
            className="mt-6 inline-block rounded-full bg-whatsapp px-6 py-3 font-semibold text-white transition hover:-translate-y-0.5"
          >
            Falar no WhatsApp
          </a>
        </Reveal>

        <Reveal delay={0.1}>
          <form onSubmit={handleSubmit} noValidate className="space-y-4 rounded-2xl border border-border bg-surface p-6">
            {(
              [
                { name: 'name' as const, label: 'Nome', type: 'text', placeholder: 'Seu nome completo' },
                { name: 'email' as const, label: 'E-mail', type: 'email', placeholder: 'voce@email.com' },
                { name: 'phone' as const, label: 'WhatsApp', type: 'tel', placeholder: '(00) 00000-0000' },
              ]
            ).map((f) => (
              <div key={f.name}>
                <label htmlFor={f.name} className="mb-1 block text-sm font-semibold">{f.label}</label>
                <input
                  id={f.name}
                  type={f.type}
                  placeholder={f.placeholder}
                  value={values[f.name]}
                  onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  aria-invalid={!!errors[f.name]}
                  aria-describedby={errors[f.name] ? `${f.name}-error` : undefined}
                  className={`w-full rounded-lg border bg-bg px-3 py-2 outline-none focus:border-primary-2 ${errors[f.name] ? 'border-red-500' : 'border-border'}`}
                />
                {errors[f.name] && (
                  <span id={`${f.name}-error`} role="alert" className="mt-1 block text-xs text-red-400">{errors[f.name]}</span>
                )}
              </div>
            ))}

            <div>
              <label htmlFor="store" className="mb-1 block text-sm font-semibold">Site ou loja (opcional)</label>
              <input
                id="store"
                type="text"
                placeholder="Link da sua loja ou marketplace"
                value={values.store}
                onChange={(e) => setValues((v) => ({ ...v, store: e.target.value }))}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 outline-none focus:border-primary-2"
              />
            </div>

            <div>
              <label htmlFor="message" className="mb-1 block text-sm font-semibold">Conte um pouco sobre seu momento</label>
              <textarea
                id="message"
                rows={4}
                placeholder="Ex: quero melhorar meus anúncios no Mercado Livre..."
                value={values.message}
                onChange={(e) => setValues((v) => ({ ...v, message: e.target.value }))}
                aria-invalid={!!errors.message}
                aria-describedby={errors.message ? 'message-error' : undefined}
                className={`w-full rounded-lg border bg-bg px-3 py-2 outline-none focus:border-primary-2 ${errors.message ? 'border-red-500' : 'border-border'}`}
              />
              {errors.message && (
                <span id="message-error" role="alert" className="mt-1 block text-xs text-red-400">{errors.message}</span>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-full bg-gradient-to-r from-primary via-primary-2 to-accent px-6 py-3 font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-60"
            >
              {submitting ? 'Abrindo WhatsApp...' : 'Enviar mensagem'}
            </button>
            <p aria-live="polite" className="text-center text-sm font-semibold text-accent">
              {success ? 'Abrimos o WhatsApp com sua mensagem pronta — é só confirmar o envio por lá! ✅' : ''}
            </p>
          </form>
        </Reveal>
      </div>
    </section>
  )
}
