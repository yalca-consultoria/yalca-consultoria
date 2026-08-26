import Reveal from '../effects/Reveal'

const points = [
  { title: 'Time multidisciplinar', desc: 'Especialistas em marketplaces, tráfego pago, contábil e negociação com fornecedores trabalhando juntos.' },
  { title: 'Decisão baseada em dados', desc: 'Relatórios simples e objetivos para você entender exatamente o que está funcionando.' },
  { title: 'Contrato sob medida', desc: 'Nada de pacote fechado: montamos o escopo e as condições pra cada cliente, do jeito que faz sentido pro seu momento.' },
]

export default function About() {
  return (
    <section id="sobre" className="bg-bg-alt py-24">
      <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-2">
        <Reveal>
          <span className="text-sm font-semibold uppercase tracking-wider text-accent">Sobre a Yalca Consultoria</span>
          <h2 className="mt-3 text-3xl font-bold lg:text-4xl">Assessoria feita por quem já operou ecommerce de verdade</h2>
          <p className="mt-4 text-text-muted">
            Somos uma equipe especializada em marketplaces, mídia paga e estratégia de negócio. Nosso foco não é
            só "aparecer mais" — é vender mais, com lucro de verdade e processos que se sustentam a longo prazo.
          </p>
        </Reveal>
        <div className="space-y-6">
          {points.map((p, i) => (
            <Reveal key={p.title} delay={i * 0.1} className="rounded-xl border border-border bg-surface p-5">
              <h4 className="font-bold">{p.title}</h4>
              <p className="mt-1 text-sm text-text-muted">{p.desc}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
