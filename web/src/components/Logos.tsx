import Reveal from '../effects/Reveal'
import LogoLoop from '../effects/LogoLoop'

const logos = [
  { src: '/img/marketplaces/mercadolivre.svg', alt: 'Mercado Livre' },
  { src: '/img/marketplaces/amazon.svg', alt: 'Amazon' },
  { src: '/img/marketplaces/shopee.svg', alt: 'Shopee' },
  { src: '/img/marketplaces/magalu.svg', alt: 'Magalu' },
  { src: '/img/marketplaces/americanas.svg', alt: 'Americanas' },
  { src: '/img/marketplaces/tiktok.svg', alt: 'TikTok Shop' },
  { src: '/img/marketplaces/shopify.svg', alt: 'Shopify' },
  { src: '/img/marketplaces/nuvemshop.png', alt: 'Nuvemshop' },
  { src: '/img/marketplaces/googleads.svg', alt: 'Google Ads' },
  { src: '/img/marketplaces/metaads.svg', alt: 'Meta Ads' },
  { src: '/img/marketplaces/bling.svg', alt: 'Bling' },
  { src: '/img/marketplaces/tiny.svg', alt: 'Tiny ERP' },
  { src: '/img/marketplaces/temu.svg', alt: 'Temu' },
]

export default function Logos() {
  return (
    <section className="border-y border-border py-10">
      <Reveal className="mx-auto max-w-6xl px-6">
        <p className="mb-6 text-center text-sm font-semibold uppercase tracking-wider text-text-muted">
          Plataformas e canais que dominamos
        </p>
        <LogoLoop logos={logos} />
      </Reveal>
    </section>
  )
}
