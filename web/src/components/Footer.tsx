export default function Footer() {
  return (
    <footer className="border-t border-border py-12">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 md:grid-cols-4">
        <div>
          <a href="#top" className="font-heading text-xl font-bold">Yalca<span className="text-accent">.</span></a>
          <p className="mt-3 text-sm text-text-muted">Assessoria completa de ecommerce: da negociação com fornecedores ao contábil, em um só time.</p>
        </div>
        <div>
          <h3 className="mb-3 font-bold">Navegação</h3>
          <div className="flex flex-col gap-2 text-sm text-text-muted">
            <a href="#servicos" className="hover:text-text">Serviços</a>
            <a href="#sobre" className="hover:text-text">Sobre</a>
            <a href="#faq" className="hover:text-text">FAQ</a>
            <a href="/portal/login.html" className="hover:text-text">Área do Cliente</a>
          </div>
        </div>
        <div>
          <h3 className="mb-3 font-bold">Serviços</h3>
          <div className="flex flex-col gap-2 text-sm text-text-muted">
            <a href="#servicos" className="hover:text-text">Negociação com Indústria</a>
            <a href="#servicos" className="hover:text-text">Gestão de Marketplaces</a>
            <a href="#servicos" className="hover:text-text">Tráfego Pago</a>
            <a href="#servicos" className="hover:text-text">Consultoria Estratégica</a>
            <a href="#servicos" className="hover:text-text">Contábil & Tributário</a>
            <a href="#servicos" className="hover:text-text">Criação de Contas & Auditoria</a>
          </div>
        </div>
        <div>
          <h3 className="mb-3 font-bold">Contato</h3>
          <div className="flex flex-col gap-2 text-sm text-text-muted">
            <a href="mailto:contato@yalca.com.br" className="hover:text-text">contato@yalca.com.br</a>
            <a href="https://wa.me/5541987058237" target="_blank" rel="noopener" className="hover:text-text">WhatsApp</a>
            <a href="/privacidade.html" className="hover:text-text">Política de Privacidade</a>
            <a href="/termos.html" className="hover:text-text">Termos de Uso</a>
          </div>
        </div>
      </div>
      <div className="mx-auto mt-10 max-w-6xl border-t border-border px-6 pt-6 text-center text-xs text-text-muted">
        © {new Date().getFullYear()} Yalca E-Consultoria LTDA — CNPJ 68.402.008/0001-18. Todos os direitos reservados.
      </div>
    </footer>
  )
}
