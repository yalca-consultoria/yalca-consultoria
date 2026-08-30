/* =========================================
   Yalca Portal — Consulta Anvisa
   Espelha o padrão de portal/js/concorrencia.js (busca sob demanda) —
   sem a parte de "acompanhamento automático" do Keepa, essa consulta é
   sempre sob demanda. Só a categoria "alimentos" existe por enquanto;
   novas categorias entram no <select id="anvisaCategoria"> e no backend
   (portal/anvisa-api/lib/anvisa-categories.js) sem mexer aqui.
   ========================================= */

// Guarda a última busca feita, pra paginação re-consultar sem o usuário
// preencher o formulário de novo — diferente do Keepa (paginação sobre
// dados já carregados), aqui cada página é uma chamada nova ao backend.
let ANVISA_LAST_SEARCH = null; // { categoria, tipo, valor }

function initAnvisaSection() {
  const form = document.getElementById('anvisaSearchForm');
  if (!form) return;
  form.addEventListener('submit', handleAnvisaSearchSubmit);
  document.getElementById('anvisaResultPagination')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-page]');
    if (!btn || btn.disabled) return;
    runAnvisaSearch(Number(btn.dataset.page));
  });
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
  const valor = document.getElementById('anvisaValor').value.trim();
  const statusEl = document.getElementById('anvisaSearchStatus');

  if (!valor) {
    statusEl.textContent = 'Digite um valor para pesquisar.';
    statusEl.style.color = 'var(--critical)';
    return;
  }

  ANVISA_LAST_SEARCH = { categoria, tipo, valor };
  await runAnvisaSearch(1);
}

async function runAnvisaSearch(page) {
  if (!ANVISA_LAST_SEARCH) return;
  const { categoria, tipo, valor } = ANVISA_LAST_SEARCH;
  const statusEl = document.getElementById('anvisaSearchStatus');
  const resultPanel = document.getElementById('anvisaResultPanel');
  const submitBtn = document.querySelector('#anvisaSearchForm button[type="submit"]');

  statusEl.textContent = '';
  if (page === 1) resultPanel.style.display = 'none';
  submitBtn.disabled = true;
  submitBtn.textContent = 'Pesquisando...';

  try {
    const result = await yalcaAnvisaSearch(categoria, tipo, valor, page);
    if (!result.ok) {
      statusEl.textContent = result.message || 'Não foi possível pesquisar agora.';
      statusEl.style.color = 'var(--warning)';
      return;
    }
    renderAnvisaResults(result);
  } catch (err) {
    // Erro de rede/timeout já vem com mensagem tratada de
    // yalcaAnvisaApiCall (portal-data.js) — só cai aqui algo
    // inesperado, então mantém genérico mas sem vazar objeto de erro cru.
    statusEl.textContent = err.message || 'Não foi possível consultar agora. Tente novamente.';
    statusEl.style.color = 'var(--critical)';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Pesquisar';
  }
}

function renderAnvisaResults(result) {
  const { results = [], source, page = 1, totalPages = 1, totalElements = results.length } = result;
  const resultPanel = document.getElementById('anvisaResultPanel');
  const body = document.getElementById('anvisaResultBody');
  const countEl = document.getElementById('anvisaResultCount');
  const statusEl = document.getElementById('anvisaSearchStatus');

  if (results.length === 0 && page === 1) {
    statusEl.textContent = 'Nenhum produto encontrado para essa busca. Confira se digitou o CNPJ, registro ou processo corretamente.';
    statusEl.style.color = 'var(--text-muted)';
    resultPanel.style.display = 'none';
    document.getElementById('anvisaResultPagination').innerHTML = '';
    return;
  }

  countEl.textContent = `${totalElements} produto${totalElements === 1 ? '' : 's'} encontrado${totalElements === 1 ? '' : 's'}${source === 'cache' ? ' (resultado em cache)' : ''}`;
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

  renderAnvisaPagination(page, totalPages);
  resultPanel.style.display = '';
  resultPanel.scrollIntoView({ block: 'nearest' });
  statusEl.textContent = '';
}

function renderAnvisaPagination(page, totalPages) {
  const el = document.getElementById('anvisaResultPagination');
  if (!el) return;
  if (totalPages <= 1) { el.innerHTML = ''; return; }

  const pageBtn = (p, label, disabled, active) => `
    <button type="button" class="pagination__btn${active ? ' is-active' : ''}" data-page="${p}" ${disabled ? 'disabled' : ''}>${label}</button>`;

  // No máximo 20 páginas visíveis pra não explodir a barra numa busca
  // muito grande — próximo/anterior sempre cobre o resto.
  const numbers = Array.from({ length: Math.min(totalPages, 20) }, (_, i) => i + 1)
    .map((p) => pageBtn(p, p, false, p === page))
    .join('');

  el.innerHTML = `
    ${pageBtn(page - 1, '‹ Anterior', page <= 1, false)}
    ${numbers}
    ${pageBtn(page + 1, 'Próxima ›', page >= totalPages, false)}`;
}
