// ===== STORAGE (LocalStorage) =====
const Storage = {
  KEYS: {
    clientes: 'impondo_clientes',
    prepedidos: 'impondo_prepedidos',
    pedidos: 'impondo_pedidos',
    config: 'impondo_config',
    estoque: 'impondo_estoque',
    vendas: 'impondo_vendas',
    devedores: 'impondo_devedores',
    tabelaMedidas: 'impondo_tabela_medidas'
  },

  get(key) {
    try {
      const data = localStorage.getItem(this.KEYS[key] || key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Erro ao ler storage:', e);
      return [];
    }
  },

  set(key, data) {
    try {
      localStorage.setItem(this.KEYS[key] || key, JSON.stringify(data));
      return true;
    } catch (e) {
      console.error('Erro ao salvar storage:', e);
      return false;
    }
  },

  getClientes() { return this.get('clientes'); },

  saveCliente(cliente) {
    const list = this.getClientes();
    if (cliente.id) {
      const idx = list.findIndex(c => c.id === cliente.id);
      if (idx >= 0) list[idx] = cliente;
      else list.push(cliente);
    } else {
      cliente.id = this.generateId();
      cliente.createdAt = new Date().toISOString();
      list.push(cliente);
    }
    this.set('clientes', list);
    return cliente;
  },

  getCliente(id) {
    return this.getClientes().find(c => c.id === id);
  },

  deleteCliente(id) {
    const list = this.getClientes().filter(c => c.id !== id);
    this.set('clientes', list);
  },

  getPrePedidos() { return this.get('prepedidos'); },

  savePrePedido(pp) {
    const list = this.getPrePedidos();
    if (pp.id) {
      const idx = list.findIndex(p => p.id === pp.id);
      if (idx >= 0) list[idx] = pp;
      else list.push(pp);
    } else {
      pp.id = this.generateId();
      pp.createdAt = new Date().toISOString();
      pp.status = pp.status || 'aberto';
      list.push(pp);
    }
    this.set('prepedidos', list);
    return pp;
  },

  getPrePedido(id) {
    return this.getPrePedidos().find(p => p.id === id);
  },

  deletePrePedido(id) {
    this.set('prepedidos', this.getPrePedidos().filter(p => p.id !== id));
  },

  getPedidos() { return this.get('pedidos'); },

  getEstoque() { return this.get('estoque'); },
  saveEstoque(item) {
    const list = this.getEstoque();
    if (item.id) {
      const idx = list.findIndex(x => x.id === item.id);
      if (idx >= 0) list[idx] = item; else list.push(item);
    } else { item.id = this.generateId(); item.createdAt = new Date().toISOString(); list.push(item); }
    this.set('estoque', list); return item;
  },
  deleteEstoque(id) { this.set('estoque', this.getEstoque().filter(x => x.id !== id)); },

  getVendas() { return this.get('vendas'); },
  saveVenda(venda) {
    const list = this.getVendas();
    if (!venda.id) { venda.id = this.generateId(); venda.createdAt = new Date().toISOString(); }
    const idx = list.findIndex(x => x.id === venda.id);
    if (idx >= 0) list[idx] = venda; else list.push(venda);
    this.set('vendas', list); return venda;
  },

  savePedido(pedido) {
    const list = this.getPedidos();
    if (pedido.id) {
      const idx = list.findIndex(p => p.id === pedido.id);
      if (idx >= 0) list[idx] = pedido;
      else list.push(pedido);
    } else {
      pedido.id = this.generateId();
      pedido.numero = this.nextPedidoNumero();
      pedido.createdAt = new Date().toISOString();
      list.push(pedido);
    }
    this.set('pedidos', list);
    return pedido;
  },

  getPedido(id) {
    return this.getPedidos().find(p => p.id === id);
  },

  deletePedido(id) {
    this.set('pedidos', this.getPedidos().filter(p => p.id !== id));
  },

  nextPedidoNumero() {
    const pedidos = this.getPedidos();
    if (!pedidos.length) return 1;
    return Math.max(...pedidos.map(p => Number(p.numero) || 0)) + 1;
  },

  getConfig() {
    const defaultConfig = {
      pedido: {
        quantidadeMinima: 4,
        diasEstimadosAposImposto: 7
      },
      produtos: {
        'Fã/Torcedor': { custoUSD: 10, venda: 150 },
        'Player Adidas': { custoUSD: 13, venda: 190 },
        'Player Nike/Puma': { custoUSD: 16, venda: 190 },
        'Manga Longa': { custoUSD: 13, venda: 190 },
        'Retrô': { custoUSD: 15, venda: 180 },
        'Polo': { custoUSD: 11, venda: 160 },
        'Kit Infantil': { custoUSD: 13, venda: 165 },
        'NBA': { custoUSD: 20, venda: 230 },
        'NFL': { custoUSD: 25, venda: 250 },
        'Kit Treino': { custoUSD: 35, venda: 350 },
        'Body Bebê': { custoUSD: 12, venda: 160 },
        'Short Jogo': { custoUSD: 8, venda: 120 },
        'Short Casual': { custoUSD: 11, venda: 130 },
        'Corta-vento': { custoUSD: 27, venda: 220 },
        'Calça Treino': { custoUSD: 18, venda: 220 },
        'Jaqueta Treino': { custoUSD: 25, venda: 280 },
        'Boné': { custoUSD: 10, venda: 100 },
        'Meia': { custoUSD: 6, venda: 60 },
        'Fórmula 1': { custoUSD: 20, venda: 230 },
        'Camisa Casual': { custoUSD: 11, venda: 150 },
        'Chuteira 48/55': { custoUSD: 48, venda: 450 },
        'Luva de Goleiro': { custoUSD: 35, venda: 250 },
        'Bola 28/30': { custoUSD: 28, venda: 220 },
        'Bobojaco': { custoUSD: 55, venda: 450 },
        'Chaveiro': { custoUSD: 1, venda: 20 }
      },
      adicionais: {
        'Personalização': 3,
        'Patch': 1,
        'Patrocínio': 3,
        '2XL': 1,
        '3XL': 2,
        '4XL': 2
      },
      freteFornecedor: [
        { min: 1, max: 1, valor: 5 },
        { min: 2, max: 2, valor: 4 },
        { min: 3, max: 3, valor: 3 },
        { min: 4, max: 999, valor: 0 }
      ],
      vendaAdicionais: {
        'Personalização': 20,
        'Patch': 10,
        'Patrocínio': 0
      }
    };

    const saved = localStorage.getItem(this.KEYS.config);
    if (!saved) return defaultConfig;

    try {
      const s = JSON.parse(saved);
      return {
        ...defaultConfig,
        ...s,
        pedido: { ...defaultConfig.pedido, ...(s.pedido || {}) },
        produtos: { ...defaultConfig.produtos, ...(s.produtos || {}) },
        adicionais: { ...defaultConfig.adicionais, ...(s.adicionais || {}) },
        vendaAdicionais: { ...defaultConfig.vendaAdicionais, ...(s.vendaAdicionais || {}) },
        freteFornecedor: Array.isArray(s.freteFornecedor)
          ? s.freteFornecedor
          : defaultConfig.freteFornecedor
      };
    } catch (e) {
      return defaultConfig;
    }
  },

  saveConfig(config) {
    localStorage.setItem(this.KEYS.config, JSON.stringify(config));
  },

  getDevedores() { return this.get('devedores'); },
  saveDevedor(d) {
    const list = this.getDevedores();
    if (d.id) {
      const idx = list.findIndex(x => x.id === d.id);
      if (idx >= 0) list[idx] = d; else list.push(d);
    } else {
      d.id = this.generateId();
      d.createdAt = new Date().toISOString();
      d.status = d.status || 'aberto';
      list.push(d);
    }
    this.set('devedores', list);
    return d;
  },
  deleteDevedor(id) {
    this.set('devedores', this.getDevedores().filter(x => x.id !== id));
  },

  getTabelaMedidas() {
    try {
      const raw = localStorage.getItem(this.KEYS.tabelaMedidas);
      return raw ? JSON.parse(raw) : { imagem: null, texto: '' };
    } catch(e) { return { imagem: null, texto: '' }; }
  },
  saveTabelaMedidas(data) {
    localStorage.setItem(this.KEYS.tabelaMedidas, JSON.stringify(data));
  },

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
};
