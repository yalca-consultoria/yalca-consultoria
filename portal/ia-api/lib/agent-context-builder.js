// Monta o resumo de dados reais (já cadastrados no portal) que dá contexto
// pro agente especializado de cada página — mesma ideia do
// diagnostic-builder.js, só que uma versão enxuta por área em vez de um
// relatório completo de 6 meses.

function fmtMoney(n) {
  return `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
}

const AGENTS = {
  overview: { label: 'Visão Geral' },
  financeiro: { label: 'Financeiro' },
  fluxocaixa: { label: 'Fluxo de Caixa' },
  marketplaces: { label: 'Marketplaces' },
  estoque: { label: 'Estoque' },
  precificacao: { label: 'Precificação' },
  concorrencia: { label: 'Compras & Concorrência' },
};

function isValidAgent(agent) {
  return Object.prototype.hasOwnProperty.call(AGENTS, agent);
}

async function buildAgentContext(db, userId, agent) {
  const monthAgo = new Date();
  monthAgo.setDate(monthAgo.getDate() - 30);
  const sinceStr = monthAgo.toISOString().slice(0, 10);

  if (agent === 'overview' || agent === 'financeiro') {
    const transactions = await db.restGet('transactions', `user_id=eq.${userId}&date=gte.${sinceStr}&select=type,category,marketplace,amount,date&order=date.asc`);
    if (!transactions || transactions.length === 0) return null;
    const receitas = transactions.filter((t) => t.type === 'receita');
    const despesas = transactions.filter((t) => t.type === 'despesa');
    const totalReceita = receitas.reduce((s, t) => s + Number(t.amount), 0);
    const totalDespesa = despesas.reduce((s, t) => s + Number(t.amount), 0);
    const porMarketplace = {};
    for (const t of receitas) { const mp = t.marketplace || 'Não informado'; porMarketplace[mp] = (porMarketplace[mp] || 0) + Number(t.amount); }
    const porCategoriaDespesa = {};
    for (const t of despesas) { porCategoriaDespesa[t.category] = (porCategoriaDespesa[t.category] || 0) + Number(t.amount); }
    const lines = [`Últimos 30 dias — receita: ${fmtMoney(totalReceita)}, despesa: ${fmtMoney(totalDespesa)}, resultado: ${fmtMoney(totalReceita - totalDespesa)}.`];
    if (Object.keys(porMarketplace).length > 0) lines.push('Receita por marketplace: ' + Object.entries(porMarketplace).map(([mp, v]) => `${mp}: ${fmtMoney(v)}`).join(', ') + '.');
    if (Object.keys(porCategoriaDespesa).length > 0) lines.push('Despesas por categoria: ' + Object.entries(porCategoriaDespesa).map(([c, v]) => `${c}: ${fmtMoney(v)}`).join(', ') + '.');
    return lines.join('\n');
  }

  if (agent === 'fluxocaixa') {
    const [settings, planned] = await Promise.all([
      db.restGetOne('client_settings', `user_id=eq.${userId}&select=cash_balance`),
      db.restGet('planned_entries', `user_id=eq.${userId}&select=date,description,amount&order=date.asc`),
    ]);
    if (!settings && (!planned || planned.length === 0)) return null;
    const lines = [];
    if (settings?.cash_balance != null) lines.push(`Saldo em caixa atual: ${fmtMoney(settings.cash_balance)}.`);
    if (planned && planned.length > 0) {
      lines.push('Lançamentos futuros planejados: ' + planned.map((p) => `${p.date} — ${p.description}: ${fmtMoney(p.amount)}`).join('; ') + '.');
    }
    return lines.join('\n');
  }

  if (agent === 'marketplaces' || agent === 'estoque' || agent === 'precificacao') {
    const [products, settings] = await Promise.all([
      db.restGet('products', `user_id=eq.${userId}&select=name,marketplace,category,cost,price,stock,min_stock,units_sold_month,status`),
      db.restGetOne('client_settings', `user_id=eq.${userId}&select=default_tax_pct,default_shipping_cost,marketplace_fees`),
    ]);
    if (!products || products.length === 0) return null;
    const lines = [`Produtos cadastrados: ${products.length}.`];

    if (agent === 'marketplaces') {
      const porMp = {};
      for (const p of products) { const mp = p.marketplace || 'Não informado'; (porMp[mp] = porMp[mp] || []).push(p); }
      for (const [mp, list] of Object.entries(porMp)) {
        const totalVendasMes = list.reduce((s, p) => s + Number(p.units_sold_month || 0), 0);
        lines.push(`${mp}: ${list.length} produtos, ${totalVendasMes} unidades vendidas/mês.`);
      }
    }

    if (agent === 'estoque') {
      const baixo = products.filter((p) => p.min_stock != null && Number(p.stock) <= Number(p.min_stock));
      if (baixo.length > 0) lines.push('Produtos com estoque baixo ou esgotado: ' + baixo.map((p) => `${p.name} (estoque ${p.stock}, mínimo ${p.min_stock})`).join('; ') + '.');
      else lines.push('Nenhum produto está com estoque abaixo do mínimo cadastrado no momento.');
    }

    if (agent === 'precificacao') {
      if (settings) lines.push(`Configuração de precificação: imposto padrão ${settings.default_tax_pct ?? 0}%, frete padrão ${fmtMoney(settings.default_shipping_cost)}, taxas por marketplace: ${JSON.stringify(settings.marketplace_fees || {})}.`);
      const comMargem = products.filter((p) => p.price > 0).map((p) => ({ ...p, margemPct: ((p.price - p.cost) / p.price) * 100 })).sort((a, b) => a.margemPct - b.margemPct);
      const piores = comMargem.slice(0, 3).map((p) => `${p.name} (margem ${p.margemPct.toFixed(0)}%)`);
      if (piores.length > 0) lines.push('Produtos com menor margem: ' + piores.join('; ') + '.');
    }

    return lines.join('\n');
  }

  if (agent === 'concorrencia') {
    const tracked = await db.restGet('keepa_tracked_asins', `user_id=eq.${userId}&active=eq.true&select=asin,label`);
    if (!tracked || tracked.length === 0) return null;
    const asins = tracked.map((t) => t.asin);
    const cache = await db.restGet('keepa_asin_cache', `asin=in.(${asins.join(',')})&select=asin,title,current_price,bsr,buybox_is_amazon,offers_count`);
    const byAsin = Object.fromEntries((cache || []).map((c) => [c.asin, c]));
    const lines = [`Produtos monitorados: ${tracked.length}.`];
    for (const t of tracked.slice(0, 15)) {
      const c = byAsin[t.asin];
      if (!c) continue;
      lines.push(`${t.label || c.title || t.asin}: preço atual ${c.current_price != null ? fmtMoney(c.current_price) : 'sem dado'}, BSR ${c.bsr ?? 'sem dado'}, buybox ${c.buybox_is_amazon ? 'com a Amazon' : 'sem a Amazon'}, ${c.offers_count ?? 0} ofertas ativas.`);
    }
    return lines.join('\n');
  }

  return null;
}

module.exports = { buildAgentContext, isValidAgent, AGENTS };
