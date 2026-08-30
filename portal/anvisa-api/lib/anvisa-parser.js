// Normaliza a resposta da API de Consulta de Alimentos da Anvisa (schema
// confirmado testando com dado real em 2026-08-30 — não é documentação
// oficial publicada, é o formato observado de verdade) pro formato plano
// que o front-end consome. Um campo novo por categoria futura (medicamentos,
// cosméticos) ganha sua própria função parse<Categoria>Product aqui.

function parseAlimentoProduct(raw) {
  return {
    codigoProduto: raw.coProduto ?? null,
    cnpjDetentor: raw.detentorRegistro?.cnpj ?? null,
    cnpjDetentorFormatado: raw.detentorRegistro?.cnpjFormatado ?? null,
    razaoSocialDetentor: raw.detentorRegistro?.razaoSocial ?? null,
    descricaoProduto: raw.produto?.descricao ?? null,
    numeroRegistroOuNotificacao: raw.produto?.numeroRegistroOuNotificacao ?? null,
    vencimento: raw.produto?.mesAnoVencimentoFormatado ?? null,
    situacaoRegistro: raw.produto?.situacaoRegistro ?? null,
    tipoRegularizacao: raw.produto?.tipoRegularizacao ?? null,
    numeroProcesso: raw.processo?.numeroProcessoFormatado ?? raw.processo?.numero ?? null,
    situacaoProcesso: raw.processo?.situacao ?? null,
    categorias: raw.categorias ?? [],
    alegacoesFuncionais: raw.alegacoesFuncionais ?? [],
    marcas: raw.marcas ?? [],
    apresentacoes: raw.apresentacoes ?? [],
    dataAtualizacao: raw.dataAtualizacao ? new Date(raw.dataAtualizacao).toISOString() : null,
  };
}

// Resposta de teste local, usada quando ANVISA_MOCK=true (sem gastar
// requisição real da cota diária durante desenvolvimento) — mesmo padrão
// do mockKeepaResponse em keepa-parser.js.
function mockAlimentoResponse(nomeProduto) {
  return {
    content: [
      {
        coProduto: 9999999,
        detentorRegistro: { cnpj: '00000000000000', cnpjFormatado: '00.000.000/0000-00', razaoSocial: 'EMPRESA MOCK LTDA' },
        produto: {
          descricao: `${nomeProduto || 'PRODUTO'} (dado de teste)`,
          numeroRegistroOuNotificacao: '999999999',
          situacaoRegistro: 'Ativo',
          tipoRegularizacao: 'Notificado',
          mesAnoVencimentoFormatado: '12/2030',
        },
        processo: { numero: '99999999999999', numeroProcessoFormatado: '99999.999999/2026-99', situacao: 'Anuído' },
        categorias: [], alegacoesFuncionais: [], marcas: [], apresentacoes: [],
        dataAtualizacao: Date.now(),
      },
    ],
    totalElements: 1,
  };
}

module.exports = { parseAlimentoProduct, mockAlimentoResponse };
