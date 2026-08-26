import Reveal from '../effects/Reveal'
import HoverGlowCard from '../effects/HoverGlowCard'

// 6 frentes reais do negócio (PRODUCT.md) — antes só 3 apareciam aqui
// ("Gestão de Marketplaces", "Tráfego Pago", "Consultoria Estratégica"),
// escondendo o real diferencial competitivo da Yalca: negociação com
// indústria, contábil/tributário e criação de contas. Corrigido a partir
// do critique de 2026-08-26 (P0: "Services section hides the real
// differentiator").
const services = [
  {
    icon: '🤝',
    title: 'Negociação com Indústria',
    desc: 'Nosso time comercial negocia direto com fornecedores e indústrias pelo poder de compra que você precisa pra ser competitivo em preço.',
    items: ['Poder de negociação com fornecedores', 'Condições comerciais melhores', 'Sourcing de novos fornecedores'],
    highlight: true,
  },
  {
    icon: '🛒',
    title: 'Gestão de Marketplaces',
    desc: 'Cuidamos da operação diária dos seus canais para você vender mais sem dor de cabeça.',
    items: ['Cadastro e otimização de anúncios', 'Gestão de estoque e preços', 'Reputação e atendimento', 'Estratégia de posicionamento por canal'],
  },
  {
    icon: '📈',
    title: 'Tráfego Pago & Marketing',
    desc: 'Campanhas de performance pensadas para gerar retorno real sobre o investimento.',
    items: ['Google Ads e Meta Ads', 'Remarketing e funis de conversão', 'Testes A/B de criativos e páginas', 'Relatórios claros de ROAS e CAC'],
  },
  {
    icon: '🧭',
    title: 'Consultoria Estratégica',
    desc: 'Visão de negócio para decisões mais seguras e crescimento sustentável.',
    items: ['Precificação e margem de lucro', 'Análise de dados e indicadores', 'Planejamento financeiro do ecommerce', 'Plano de expansão de canais'],
  },
  {
    icon: '📊',
    title: 'Contábil & Tributário',
    desc: 'Cuidamos da parte contábil e tributária do seu ecommerce, sem você precisar entender de imposto.',
    items: ['Regime tributário do ecommerce', 'Organização fiscal', 'Suporte contábil contínuo'],
  },
  {
    icon: '⚙️',
    title: 'Criação de Contas & Auditoria',
    desc: 'Configuramos suas contas em marketplaces e ERPs, e revisamos ecommerces que já estão em andamento.',
    items: ['Criação de contas: Bling, Tiny, Amazon, Mercado Livre, Shopee', 'Revisão de ecommerces já existentes', 'Diagnóstico de operações em andamento'],
  },
]

export default function Services() {
  return (
    <section id="servicos" className="py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal className="mb-14 max-w-2xl">
          <span className="text-sm font-semibold uppercase tracking-wider text-accent">O que fazemos</span>
          <h2 className="mt-3 text-3xl font-bold lg:text-4xl">Um parceiro completo, não um fornecedor a mais</h2>
          <p className="mt-3 text-text-muted">
            O que você faria hoje com 3-4 fornecedores diferentes, a gente faz com um time só — da negociação
            com a indústria ao contábil, passando pela operação dos seus canais.
          </p>
        </Reveal>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.08}>
              <HoverGlowCard highlight={s.highlight}>
                {s.highlight && (
                  <span className="absolute right-4 top-4 rounded-full bg-gradient-to-r from-primary to-accent px-3 py-1 text-xs font-semibold text-white">
                    Diferencial Yalca
                  </span>
                )}
                <div className="text-3xl">{s.icon}</div>
                <h3 className="mt-4 text-xl font-bold">{s.title}</h3>
                <p className="mt-2 text-text-muted">{s.desc}</p>
                <ul className="mt-4 space-y-2 text-sm text-text-muted">
                  {s.items.map((item) => (
                    <li key={item} className="flex gap-2">
                      <span className="text-accent">•</span> {item}
                    </li>
                  ))}
                </ul>
              </HoverGlowCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
