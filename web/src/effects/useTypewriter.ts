import { useEffect, useState } from 'react'

// Digita `text` caractere a caractere — usado no H1 do Hero pra dar o mesmo
// efeito de "sendo escrito ao vivo" que qualquer CTA de agência/consultoria
// quer passar. `startDelayMs` segura o início (dá tempo do resto do Hero
// entrar primeiro); termina com `done=true` pra disparar o que vem depois
// (botão, cursor decorativo) só depois que a frase estiver completa.
export function useTypewriter(text: string, speedMs = 35, startDelayMs = 400) {
  const [count, setCount] = useState(0)
  const [done, setDone] = useState(false)

  useEffect(() => {
    // Quem pediu pro sistema reduzir animações não quer ver o texto sendo
    // digitado letra por letra — mostra pronto de uma vez.
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setCount(text.length)
      setDone(true)
      return
    }
    let i = 0
    let interval: ReturnType<typeof setInterval>
    const startTimer = setTimeout(() => {
      interval = setInterval(() => {
        i += 1
        setCount(i)
        if (i >= text.length) {
          clearInterval(interval)
          setDone(true)
        }
      }, speedMs)
    }, startDelayMs)
    return () => { clearTimeout(startTimer); clearInterval(interval) }
  }, [text, speedMs, startDelayMs])

  return { visible: text.slice(0, count), done }
}
