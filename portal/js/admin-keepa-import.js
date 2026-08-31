/* =========================================
   Yalca Portal (admin) — importação em massa de exports do Keepa
   Parse no navegador (SheetJS, carregado via CDN no admin.html) — só os
   campos mapeados vão pro backend, nunca o arquivo cru inteiro. Formatos
   de coluna abaixo foram confirmados lendo os arquivos reais do usuário
   (2026-08-30), não são suposição da documentação do Keepa.
   ========================================= */

function yalcaKeepaImportStripCurrency(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
function yalcaKeepaImportYesNo(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'yes' || s === 'sim') return true;
  if (s === 'no' || s === 'não' || s === 'nao') return false;
  return null;
}
function yalcaKeepaImportInt(v) {
  if (v == null || v === '') return null;
  const n = parseInt(String(v).replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}
function yalcaKeepaImportFloat(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}
// "Amazon" sozinho, ou "Nome (87%) / ID_DO_VENDEDOR" — o resto do sistema
// (keepa-parser.js) guarda o ID do vendedor em buybox_seller, não o nome,
// então extrai o ID quando existir; sem "/" é porque é a própria Amazon.
function yalcaKeepaImportBuyboxSeller(v) {
  if (v == null) return { seller: null, isAmazon: false };
  const s = String(v).trim();
  if (s === 'Amazon') return { seller: 'Amazon', isAmazon: true };
  const parts = s.split(' / ');
  const id = parts.length > 1 ? parts[parts.length - 1].trim() : null;
  return { seller: id || s, isAmazon: false };
}

function yalcaKeepaImportReadWorkbook(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: null });
        resolve(rows);
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsArrayBuffer(file);
  });
}

// Localizador de Produtos -> linhas mapeadas pra keepa_asin_cache
async function yalcaParseKeepaProductFinderFile(file) {
  const rows = await yalcaKeepaImportReadWorkbook(file);
  const headers = rows[0];
  const col = (name) => headers.indexOf(name);
  const idx = {
    asin: col('ASIN'), title: col('Título'), image: col('Imagem'),
    price: col('Buy Box: Atual'), buyboxSeller: col('Buy Box: Vendedor da Buy Box'),
    bsr: col('Classificação de vendas: Atual'),
    categoryRoot: col('Categorias: Raiz'), categoryTree: col('Categorias: Árvore'),
    rating: col('Avaliações: Classificação'), reviewCount: col('Avaliações: Contagem de avaliações'),
    offersCount: col('Contagem total de Ofertas'),
    brand: col('Marca'), manufacturer: col('Fabricante'), model: col('Modelo'),
    color: col('Cor'), size: col('Tamanho'),
    description: col('Descrição & Recursos: Descrição'),
    ean: col('Códigos do produto: EAN'),
    weight: col('Pacote: Peso (g)'), length: col('Pacote: Comprimento (cm)'), width: col('Pacote: Largura (cm)'), height: col('Pacote: Altura (cm)'),
    batteriesRequired: col('Requer baterias'), batteriesIncluded: col('Baterias incluídas'),
    adultProduct: col('Produto adulto'),
    listedSince: col('Listado desde'), listPrice: col('Preço de Lista: Atual'),
    competitiveThreshold: col('Limite de Preço Competitivo'), suggestedLower: col('Preço Inferior Sugerido'),
    parentAsin: col('ASIN principal'), variationsCount: col('Contagem de Variações'),
  };
  const featureIdx = Array.from({ length: 10 }, (_, i) => col(`Descrição & Recursos: Recurso ${i + 1}`)).filter((i) => i !== -1);

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[idx.asin]) continue;
    const buybox = yalcaKeepaImportBuyboxSeller(row[idx.buyboxSeller]);
    const price = yalcaKeepaImportStripCurrency(row[idx.price]);
    const features = featureIdx.map((i) => row[i]).filter(Boolean);
    out.push({
      asin: String(row[idx.asin]).trim().toUpperCase(),
      title: row[idx.title] || null,
      image_url: row[idx.image] ? String(row[idx.image]).split(';')[0].trim() : null,
      current_price: price, buybox_price: price,
      buybox_seller: buybox.seller, buybox_is_amazon: buybox.isAmazon,
      bsr: yalcaKeepaImportInt(row[idx.bsr]),
      category: row[idx.categoryRoot] || null,
      category_breadcrumb: row[idx.categoryTree] ? String(row[idx.categoryTree]).split(' › ').map((s) => s.trim()) : [],
      rating: yalcaKeepaImportFloat(row[idx.rating]),
      review_count: yalcaKeepaImportInt(row[idx.reviewCount]),
      offers_count: yalcaKeepaImportInt(row[idx.offersCount]),
      total_offer_count: yalcaKeepaImportInt(row[idx.offersCount]),
      brand: row[idx.brand] || null, manufacturer: row[idx.manufacturer] || null, model: row[idx.model] || null,
      color: row[idx.color] || null, size: row[idx.size] || null,
      description: row[idx.description] || null, features,
      ean: row[idx.ean] || null,
      package_weight_kg: yalcaKeepaImportFloat(row[idx.weight]) != null ? yalcaKeepaImportFloat(row[idx.weight]) / 1000 : null,
      package_length_cm: yalcaKeepaImportFloat(row[idx.length]),
      package_width_cm: yalcaKeepaImportFloat(row[idx.width]),
      package_height_cm: yalcaKeepaImportFloat(row[idx.height]),
      batteries_required: yalcaKeepaImportYesNo(row[idx.batteriesRequired]),
      batteries_included: yalcaKeepaImportYesNo(row[idx.batteriesIncluded]),
      is_adult_product: yalcaKeepaImportYesNo(row[idx.adultProduct]),
      listed_since: row[idx.listedSince] || null,
      list_price: yalcaKeepaImportStripCurrency(row[idx.listPrice]),
      competitive_price_threshold: yalcaKeepaImportStripCurrency(row[idx.competitiveThreshold]),
      suggested_lower_price: yalcaKeepaImportStripCurrency(row[idx.suggestedLower]),
      parent_asin: row[idx.parentAsin] || null,
      variations_count: yalcaKeepaImportInt(row[idx.variationsCount]),
    });
  }
  return out;
}

// Lista de Principais Vendedores -> linhas mapeadas pra keepa_seller_cache
async function yalcaParseKeepaSellerListFile(file) {
  const rows = await yalcaKeepaImportReadWorkbook(file);
  const headers = rows[0];
  const col = (name) => headers.indexOf(name);
  const idx = {
    sellerId: col('ID do vendedor'), name: col('Nome'),
    ratingLifetime: col('Classificação: Tempo de vida'), ratingCountLifetime: col('Contagem de avaliações: Tempo de vida'),
    rating30: col('Classificação: 30 Dias'), rating90: col('Classificação: 90 Dias'), rating365: col('Classificação: 365 Dias'),
    usesFba: col('Usa FBA'), verifiedListings: col('Listagens verificadas'),
  };

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row[idx.sellerId]) continue;
    out.push({
      seller_id: String(row[idx.sellerId]).trim(),
      seller_name: row[idx.name] || null,
      current_rating: yalcaKeepaImportFloat(row[idx.ratingLifetime]),
      current_rating_count: yalcaKeepaImportInt(row[idx.ratingCountLifetime]),
      has_fba: yalcaKeepaImportYesNo(row[idx.usesFba]),
      total_storefront_asins: yalcaKeepaImportInt(row[idx.verifiedListings]),
      rating_breakdown: {
        d30: yalcaKeepaImportFloat(row[idx.rating30]),
        d90: yalcaKeepaImportFloat(row[idx.rating90]),
        d365: yalcaKeepaImportFloat(row[idx.rating365]),
      },
    });
  }
  return out;
}

function yalcaChunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Envia em lotes de 300, reportando progresso — usado pelos dois botões
// de import no painel admin (admin-app.js).
async function yalcaRunKeepaImport(rows, apiFn, onProgress) {
  const batches = yalcaChunkArray(rows, 300);
  let imported = 0, skipped = 0;
  for (const batch of batches) {
    const result = await apiFn(batch);
    if (!result.ok) throw new Error(result.message || 'Falha ao importar um lote.');
    imported += result.imported || 0;
    skipped += result.skipped || 0;
    onProgress?.(imported + skipped, rows.length);
  }
  return { imported, skipped, total: rows.length };
}
