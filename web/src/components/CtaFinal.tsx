import Reveal from '../effects/Reveal'

export default function CtaFinal() {
  return (
    <section className="bg-gradient-to-r from-primary via-primary-2 to-accent py-20">
      <Reveal className="mx-auto max-w-2xl px-6 text-center text-white">
        <h2 className="text-3xl font-bold lg:text-4xl">Pronto para vender mais no seu ecommerce?</h2>
        <p className="mt-3 opacity-90">Fale com a gente e receba uma análise gratuita do seu momento atual.</p>
        <a
          href="#contato"
          className="mt-6 inline-block rounded-full bg-white px-6 py-3 font-semibold text-primary transition hover:-translate-y-0.5"
        >
          Quero minha análise gratuita
        </a>
      </Reveal>
    </section>
  )
}
