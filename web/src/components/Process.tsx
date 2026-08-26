import Reveal from '../effects/Reveal'

const steps = [
  { n: '01', title: 'Diagnóstico', desc: 'Analisamos seus canais, anúncios e números atuais para entender onde estão as oportunidades.' },
  { n: '02', title: 'Plano de ação', desc: 'Montamos uma estratégia clara de marketplaces, tráfego e precificação para o seu negócio.' },
  { n: '03', title: 'Execução', desc: 'Nossa equipe assume a operação: anúncios, campanhas e ajustes contínuos de performance.' },
  { n: '04', title: 'Acompanhamento', desc: 'Relatórios periódicos e reuniões de alinhamento para você acompanhar cada resultado.' },
]

export default function Process() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mb-14 max-w-2xl">
          <span className="text-sm font-semibold uppercase tracking-wider text-accent">Como funciona</span>
          <h2 className="mt-3 text-3xl font-bold lg:text-4xl">Do diagnóstico ao crescimento, em 4 etapas</h2>
        </Reveal>
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.1}>
              <span className="text-4xl font-bold text-primary-2/40">{s.n}</span>
              <h3 className="mt-3 text-lg font-bold">{s.title}</h3>
              <p className="mt-2 text-sm text-text-muted">{s.desc}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
