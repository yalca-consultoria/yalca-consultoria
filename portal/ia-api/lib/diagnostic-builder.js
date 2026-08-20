// Monta o resumo de dados reais do cliente (já cadastrados no portal —
// não pede pro cliente preencher formulário nenhum) que vira o prompt do
// diagnóstico. Mesmas tabelas que "Visão Geral"/"Financeiro" já leem.

function fmtMoney(n) {
  return `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
}

async function buildDiagnosticPrompt(db, userId) {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const sinceStr = sixMonthsAgo.toISOString().slice(0, 10);

  const [transactions, products] = await Promise.all([
    db.restGet('transactions', `user_id=eq.${userId}&date=gte.${sinceStr}&select=type,category,marketplace,amount,date&order=date.asc`),
    db.restGet('products', `user_id=eq.${userId}&status=eq.Ativo&select=name,marketplace,category,cost,price,units_sold_month`),
  ]);

  if ((!transactions || transactions.length === 0) && (!products || products.length === 0)) {
    return null; // sem dado nenhum — o caller decide o que fazer (avisar o cliente pra cadastrar antes)
  }

  const receitas = transactions.filter((t) => t.type === 'receita');
  const despesas = transactions.filter((t) => t.type === 'despesa');
  const totalReceita = receitas.reduce((s, t) => s + Number(t.amount), 0);
  const totalDespesa = despesas.reduce((s, t) => s + Number(t.amount), 0);

  const porMarketplace = {};
  for (const t of receitas) {
    const mp = t.marketplace || 'Não informado';
    porMarketplace[mp] = (porMarketplace[mp] || 0) + Number(t.amount);
  }
  const porCategoriaDespesa = {};
  for (const t of despesas) {
    porCategoriaDespesa[t.category] = (porCategoriaDespesa[t.category] || 0) + Number(t.amount);
  }

  const produtosComMargem = (products || []).map((p) => ({
    ...p,
    margemPct: p.price > 0 ? ((p.price - p.cost) / p.price) * 100 : 0,
  })).sort((a, b) => b.margemPct - a.margemPct);

  const lines = [];
  lines.push(`Período analisado: últimos 6 meses (desde ${sinceStr}).`);
  lines.push(`Receita total: ${fmtMoney(totalReceita)}. Despesa total: ${fmtMoney(totalDespesa)}. Resultado: ${fmtMoney(totalReceita - totalDespesa)}.`);
  if (Object.keys(porMarketplace).length > 0) {
    lines.push('Receita por marketplace: ' + Object.entries(porMarketplace).map(([mp, v]) => `${mp}: ${fmtMoney(v)}`).join(', ') + '.');
  }
  if (Object.keys(porCategoriaDespesa).length > 0) {
    lines.push('Despesas por categoria: ' + Object.entries(porCategoriaDespesa).map(([c, v]) => `${c}: ${fmtMoney(v)}`).join(', ') + '.');
  }
  if (produtosComMargem.length > 0) {
    lines.push(`Produtos ativos cadastrados: ${produtosComMargem.length}.`);
    const top3 = produtosComMargem.slice(0, 3).map((p) => `${p.name} (${p.marketplace}, margem ${p.margemPct.toFixed(0)}%, ${p.units_sold_month} vendas/mês)`);
    const bottom3 = produtosComMargem.slice(-3).map((p) => `${p.name} (${p.marketplace}, margem ${p.margemPct.toFixed(0)}%, ${p.units_sold_month} vendas/mês)`);
    lines.push('Produtos com maior margem: ' + top3.join('; ') + '.');
    lines.push('Produtos com menor margem: ' + bottom3.join('; ') + '.');
  }

  return lines.join('\n');
}

module.exports = { buildDiagnosticPrompt };
