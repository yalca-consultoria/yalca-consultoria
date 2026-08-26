import Reveal from '../effects/Reveal'

export default function QuickHelp() {
  return (
    <section className="bg-bg-alt py-14">
      <Reveal className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 text-center lg:flex-row lg:justify-between lg:text-left">
        <div>
          <h3 className="text-xl font-bold lg:text-2xl">Não sabe qual frente sua loja precisa agora?</h3>
          <p className="mt-2 text-text-muted">
            Em uma conversa rápida pelo WhatsApp, a gente entende seu momento e indica o melhor caminho — sem compromisso.
          </p>
        </div>
        <a
          href="https://wa.me/5541987058237"
          target="_blank"
          rel="noopener"
          className="shrink-0 rounded-full bg-whatsapp px-6 py-3 font-semibold text-white transition hover:-translate-y-0.5"
        >
          Falar no WhatsApp
        </a>
      </Reveal>
    </section>
  )
}
