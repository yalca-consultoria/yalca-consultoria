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
    // nome de filtro exato que essa categoria espera. BUG REAL encontrado
    // em produção (2026-08-30, via log real de uso): CNPJ formatado com
    // pontuação (ex: "05.802.880/0001-33") faz a Anvisa responder 404 —
    // ela só aceita dígitos puros (confirmado testando os dois formatos
    // direto na API). CNPJ e nº de processo costumam vir formatados de
    // quem copia e cola do site da Receita/Anvisa, então normaliza pra só
    // dígitos aqui em vez de exigir que o cliente digite sem pontuação.
    buildFilter(tipo, valor) {
      const digitsOnly = (v) => v.replace(/\D/g, '');
      switch (tipo) {
        case 'cnpj': return { detentorRegistro: digitsOnly(valor) };
        case 'nome': return { nomeProduto: valor };
        case 'registro': return { numeroRegistroNotificacao: digitsOnly(valor) };
        case 'processo': return { numeroProcesso: digitsOnly(valor) };
        default: return {};
      }
    },
  },
};

module.exports = { CATEGORIES };
