// Mapa central de categorias suportadas pela Anvisa — cada categoria nova
// (medicamentos, cosméticos, produtos de saúde) entra só como uma linha
// nova aqui, sem mexer no server.js. Só "alimentos" está confirmado e
// funcionando hoje (testado com dado real, 2026-08-30); os paths reais de
// medicamentos/cosméticos ainda não foram localizados na documentação da
// Anvisa — ver notas no plano da feature.
const { parseAlimentoProduct, mockAlimentoResponse } = require('./anvisa-parser');

const CATEGORIES = {
  alimentos: {
    label: 'Alimentos e Suplementos',
    // Caminho confirmado batendo direto na API (gateway autenticado via
    // Client Credentials do gov.br) — não é o mesmo host da documentação
    // pública (api.anvisa.gov.br), que fica atrás de proteção anti-bot.
    endpoint: '/consultas-externas-api/api/v1/consulta/alimento/produtos',
    parse: parseAlimentoProduct,
    mock: mockAlimentoResponse,
    // Mapeia os campos genéricos que o front-end manda (tipo de busca) pro
    // nome de filtro exato que essa categoria espera.
    buildFilter(tipo, valor) {
      switch (tipo) {
        case 'cnpj': return { detentorRegistro: valor };
        case 'nome': return { nomeProduto: valor };
        case 'registro': return { numeroRegistroNotificacao: valor };
        case 'processo': return { numeroProcesso: valor };
        default: return {};
      }
    },
  },
};

module.exports = { CATEGORIES };
