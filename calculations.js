// ===== CÁLCULOS FINANCEIROS =====
const Calc = {
  // Calcula custo base em USD de um item
  custoItemUSD(item, config) {
    const produto = config.produtos[item.produto] || { custoUSD: 0 };
    let custo = produto.custoUSD || 0;

    // Adicionais
    if (item.personalizacao) custo += (config.adicionais['Personalização'] || 3);
    if (item.patch) custo += (config.adicionais['Patch'] || 1);

    // Tamanhos especiais
    const tamanho = (item.tamanho || '').toUpperCase();
    if (tamanho === '2XL' || tamanho === '2GG') custo += (config.adicionais['2XL'] || 1);
    if (tamanho === '3XL' || tamanho === '3GG') custo += (config.adicionais['3XL'] || 2);
    if (tamanho === '4XL' || tamanho === '4GG') custo += (config.adicionais['4XL'] || 2);

    return custo * (item.quantidade || 1);
  },

  // Total USD de todos os itens do pedido
  totalUSD(itens, config) {
    return itens.reduce((sum, item) => sum + this.custoItemUSD(item, config), 0);
  },

  // Frete do fornecedor baseado na quantidade total de peças
  freteFornecedorUSD(qtdPecas, config) {
    const regras = config.freteFornecedor || [];
    for (const r of regras) {
      if (qtdPecas >= r.min && qtdPecas <= r.max) return r.valor;
    }
    return 0;
  },

  // Rateio do frete por item (proporcional ao valor USD)
  rateioFrete(item, totalUSD, freteTotalUSD, config) {
    if (totalUSD <= 0) return 0;
    const itemUSD = this.custoItemUSD(item, config);
    return (itemUSD / totalUSD) * freteTotalUSD;
  },

  // Rateio do imposto (por % do valor do pedido em USD)
  rateioImposto(item, totalUSD, impostoBRL, config) {
    if (totalUSD <= 0) return 0;
    const itemUSD = this.custoItemUSD(item, config);
    const percentual = itemUSD / totalUSD;
    return percentual * impostoBRL;
  },

  // Custo real de um item (em R$)
  custoRealItem(item, cotacao, freteRateadoUSD, impostoRateadoBRL, config) {
    const custoUSD = this.custoItemUSD(item, config);
    const custoConvertido = custoUSD * cotacao;
    const freteBRL = freteRateadoUSD * cotacao;
    return custoConvertido + freteBRL + impostoRateadoBRL;
  },

  // Lucro de um item
  lucroItem(item, custoReal) {
    const venda = (item.valorVenda || 0) * (item.quantidade || 1);
    return venda - custoReal;
  },

  // Margem %
  margem(lucro, venda) {
    if (venda <= 0) return 0;
    return (lucro / venda) * 100;
  },

  // Total de peças
  totalPecas(itens) {
    return itens.reduce((sum, i) => sum + (i.quantidade || 1), 0);
  },

  // Verifica se pode converter pré-pedido em pedido
  podeConverter(prePedido, cliente) {
    const qtd = this.totalPecas(prePedido.itens || []);
    const isMaua = this.isMauaRegiao(cliente?.cidade || cliente?.destino || '');
    if (isMaua) return qtd >= 4;
    return qtd >= 1;
  },

  isMauaRegiao(cidade) {
    if (!cidade) return false;
    const c = cidade.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const maua = ['maua', 'mauá', 'ribeirao pires', 'ribeirão pires', 'santo andre', 'santo andré',
      'sao bernardo', 'são bernardo', 'sao caetano', 'são caetano', 'diadema',
      'suzano', 'mogi das cruzes', 'poa', 'poá', 'ferraz', 'itaquaquecetuba'];
    return maua.some(m => c.includes(m));
  },

  // Custo estimado (sem imposto real ainda)
  custoEstimadoItem(item, cotacao, freteRateadoUSD, config) {
    const custoUSD = this.custoItemUSD(item, config);
    const custoConvertido = custoUSD * cotacao;
    const freteBRL = freteRateadoUSD * cotacao;
    return custoConvertido + freteBRL;
  },

  // Formata dinheiro
  formatBRL(valor) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
  },

  formatUSD(valor) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(valor || 0);
  }
};
