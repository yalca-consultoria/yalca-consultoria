import { motion } from 'framer-motion'

// Cards flutuantes com os logos reais dos marketplaces/canais que a Yalca
// opera — volta ao formato original (pedido do usuário, 2026-08-28), no
// lugar da visualização orbital. Cada card sobe e desce devagar, sem parar,
// posicionado por porcentagem (não pixel fixo) pra escalar direto com o
// container em qualquer tamanho de tela, sem precisar dos wrappers de
// clipping por breakpoint que a órbita exigia.
// Todos quadrados agora (era uma mistura de círculo/quadrado — pedido do
// usuário, 2026-08-28) e mais espalhados (a rodada anterior ficou "juntos
// demais"): amplitude voltou a crescer (era 4-68%, agora 0-76%), mas ainda
// centralizado como grupo dentro do container. Sem sobrepor (checado pelas
// caixas: nenhum par se toca em nenhum breakpoint).
const items = [
  { src: '/img/marketplaces/mercadolivre.svg', alt: 'Mercado Livre', top: '2%', left: '6%', size: 100, glow: 'rgba(255,204,0,0.35)' },
  { src: '/img/marketplaces/amazon.svg', alt: 'Amazon', top: '0%', left: '60%', size: 96, glow: 'rgba(255,138,101,0.3)' },
  { src: '/img/marketplaces/shopee.svg', alt: 'Shopee', top: '32%', left: '76%', size: 100, glow: 'rgba(109,91,246,0.35)' },
  { src: '/img/marketplaces/tiktok.svg', alt: 'TikTok Shop', top: '76%', left: '56%', size: 98, glow: 'rgba(236,72,153,0.3)' },
  { src: '/img/marketplaces/temu.svg', alt: 'Temu', top: '60%', left: '0%', size: 98, glow: 'rgba(255,138,0,0.3)' },
]

export default function FloatLogos() {
  return (
    <div className="relative h-[380px] w-full max-w-[420px] sm:h-[400px] lg:h-[480px]" aria-hidden="true">
      {items.map((item, i) => (
        <motion.div
          key={item.alt}
          className="absolute flex items-center justify-center bg-white p-2"
          style={{
            top: item.top,
            left: item.left,
            width: item.size,
            height: item.size,
            borderRadius: 16,
            boxShadow: `0 0 28px 6px ${item.glow}`,
            border: '1px solid var(--color-border)',
          }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1, y: [0, -12, 0] }}
          transition={{
            opacity: { delay: i * 0.12, duration: 0.5 },
            scale: { delay: i * 0.12, duration: 0.5 },
            y: { duration: 4 + i * 0.4, repeat: Infinity, ease: 'easeInOut', delay: i * 0.12 },
          }}
        >
          <img src={item.src} alt={item.alt} width={item.size} height={item.size} className="h-full w-full object-contain" />
        </motion.div>
      ))}
    </div>
  )
}
