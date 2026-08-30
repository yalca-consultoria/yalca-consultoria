/* =========================================
   Yalca Portal — Consulta Anvisa
   Espelha o padrão de portal/js/concorrencia.js (busca sob demanda) —
   sem a parte de "acompanhamento automático" do Keepa, essa consulta é
   sempre sob demanda. Só a categoria "alimentos" existe por enquanto;
   novas categorias entram no <select id="anvisaCategoria"> e no backend
   (portal/anvisa-api/lib/anvisa-categories.js) sem mexer aqui.
   ========================================= */

const ANVISA_TIPO_LABELS = { cnpj: 'CNPJ', nome: 'Nome/marca', registro: 'Nº de registro', processo: 'Nº de processo' };

function initAnvisaSection() {
  const form = document.getElementById('anvisaSearchForm');
  if (!form) return;
  form.addEventListener('submit', handleAnvisaSearchSubmit);
}

function yalcaEscapeHtmlAnvisa(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

async function handleAnvisaSearchSubmit(e) {
  e.preventDefault();
  const categoria = document.getElementById('anvisaCategoria').value;
  const tipo = document.getElementById('anvisaTipo').value;
  const valorInput = document.getElementById('anvisaValor');
  const valor = valorInput.value.trim();
  const statusEl = document.getElementById('anvisaSearchStatus');
  const resultPanel = document.getElementById('anvisaResultPanel');
  const submitBtn = e.target.querySelector('button[type="submit"]');

  if (!valor) {
    statusEl.textContent = 'Digite um valor para pesquisar.';
    statusEl.style.color = 'var(--critical)';
    return;
  }

  statusEl.textContent = '';
  resultPanel.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Pesquisando...';

  try {
    const result = await yalcaAnvisaSearch(categoria, tipo, valor);
    if (!result.ok) {
      statusEl.textContent = result.message || 'Não foi possível pesquisar agora.';
      statusEl.style.color = 'var(--warning)';
      return;
    }
    renderAnvisaResults(result.results || [], result.source);
  } catch (err) {
    statusEl.textContent = 'Não foi possível consultar agora: ' + err.message;
    statusEl.style.color = 'var(--critical)';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Pesquisar';
  }
}

function renderAnvisaResults(results, source) {
  const resultPanel = document.getElementById('anvisaResultPanel');
  const body = document.getElementById('anvisaResultBody');
  const countEl = document.getElementById('anvisaResultCount');
  const statusEl = document.getElementById('anvisaSearchStatus');

  if (results.length === 0) {
    statusEl.textContent = 'Nenhum produto encontrado para essa busca.';
    statusEl.style.color = 'var(--text-muted)';
    resultPanel.style.display = 'none';
    return;
  }

  countEl.textContent = `${results.length} produto${results.length === 1 ? '' : 's'} encontrado${results.length === 1 ? '' : 's'}${source === 'cache' ? ' (resultado em cache)' : ''}`;
  body.innerHTML = results.map((r) => {
    const situacaoClass = r.situacaoRegistro === 'Ativo' ? 'ativo' : 'pausado';
    return `
      <tr>
        <td data-label="Produto">
          <strong>${yalcaEscapeHtmlAnvisa(r.descricaoProduto || '—')}</strong>
          <div class="kpi-card__hint">Nº ${yalcaEscapeHtmlAnvisa(r.numeroRegistroOuNotificacao || '—')} · ${yalcaEscapeHtmlAnvisa(r.tipoRegularizacao || '—')}</div>
        </td>
        <td data-label="Empresa">${yalcaEscapeHtmlAnvisa(r.razaoSocialDetentor || '—')}<div class="kpi-card__hint">${yalcaEscapeHtmlAnvisa(r.cnpjDetentorFormatado || '—')}</div></td>
        <td data-label="Situação"><span class="badge badge--${situacaoClass}">${yalcaEscapeHtmlAnvisa(r.situacaoRegistro || '—')}</span></td>
        <td data-label="Vencimento">${yalcaEscapeHtmlAnvisa(r.vencimento || '—')}</td>
        <td data-label="Processo">${yalcaEscapeHtmlAnvisa(r.numeroProcesso || '—')}</td>
      </tr>`;
  }).join('');

  resultPanel.style.display = '';
  document.getElementById('anvisaSearchStatus').textContent = '';
}
