// Botão com hover "text-roll": o texto atual desliza pra cima e um
// segundo texto idêntico entra por baixo — mesma técnica vista em
// landing pages de agência premium (texto duplicado dentro de um
// container com altura fixa e overflow escondido).
export default function RollButton({
  label,
  dark = false,
  className = '',
}: {
  label: string
  dark?: boolean
  className?: string
}) {
  return (
    <span
      className={`group inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors ${
        dark ? 'bg-surface-2 text-text' : 'bg-primary-2/15 text-primary-2'
      } ${className}`}
    >
      <span className="roll-text h-[1.1em] overflow-hidden">
        <span className="roll-text__inner block">
          <span className="block">{label}</span>
          <span className="block">{label}</span>
        </span>
      </span>
      <svg
        width="14"
        height="14"
        viewBox="0 0 14 14"
        fill="none"
        className="shrink-0 -rotate-45 transition-transform duration-300 group-hover:rotate-0"
      >
        <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
