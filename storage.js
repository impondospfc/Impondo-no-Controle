// ===== STORAGE (IndexedDB + cache em memória) =====
// Mais espaço que localStorage. API continua síncrona depois do init.
const Storage = {
  DB_NAME: 'impondo_db',
  DB_VERSION: 1,
  STORE: 'kv',

  KEYS: {
    clientes: 'clientes',
    prepedidos: 'prepedidos',
    pedidos: 'pedidos',
    config: 'config',
    estoque: 'estoque',
    vendas: 'vendas',
    devedores: 'devedores',
    tabelaMedidas: 'tabelaMedidas'
  },

  // Cache em memória (leituras rápidas e síncronas)
  _cache: {},
  _ready: false,
  _readyPromise: null,
  _db: null,

  // ---------- IndexedDB core ----------
  _openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.DB_NAME, this.DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE)) {
          db.createObjectStore(this.STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async _idbGet(key) {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readonly');
      const req = tx.objectStore(this.STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async _idbSet(key, value) {
    const db = this._db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.STORE, 'readwrite');
      const req = tx.objectStore(this.STORE).put(value, key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  },

  // Migra dados antigos do localStorage → IndexedDB (uma vez)
  _migrateFromLocalStorage() {
    const map = {
      clientes: 'impondo_clientes',
      prepedidos: 'impondo_prepedidos',
      pedidos: 'impondo_pedidos',
      config: 'impondo_config',
      estoque: 'impondo_estoque',
      vendas: 'impondo_vendas',
      devedores: 'impondo_devedores',
      tabelaMedidas: 'impondo_tabela_medidas'
    };
    const migrated = localStorage.getItem('impondo_migrated_idb');
    if (migrated === '1') return Promise.resolve();

    const tasks = Object.keys(map).map(async (key) => {
      try {
        const raw = localStorage.getItem(map[key]);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        // Só migra se IndexedDB ainda não tem esse key
        const existing = await this._idbGet(key);
        if (existing === undefined) {
          await this._idbSet(key, parsed);
        }
      } catch (e) {
        console.warn('migrate fail', key, e);
      }
    });
    return Promise.all(tasks).then(() => {
      try { localStorage.setItem('impondo_migrated_idb', '1'); } catch (e) {}
    });
  },

  async init() {
    if (this._ready) return;
    if (this._readyPromise) return this._readyPromise;

    this._readyPromise = (async () => {
      try {
        this._db = await this._openDB();
        await this._migrateFromLocalStorage();

        // Carrega tudo pro cache
        for (const key of Object.keys(this.KEYS)) {
          try {
            const val = await this._idbGet(key);
            if (val !== undefined) this._cache[key] = val;
          } catch (e) {
            console.warn('load cache', key, e);
          }
        }
        this._ready = true;
      } catch (e) {
        console.error('IndexedDB init fail, fallback localStorage', e);
        // Fallback: usa localStorage se IDB falhar
        this._useLocalFallback = true;
        this._ready = true;
      }
    })();

    return this._readyPromise;
  },

  // ---------- get / set (síncronos via cache) ----------
  get(key) {
    if (this._useLocalFallback) {
      try {
        const legacy = {
          clientes: 'impondo_clientes',
          prepedidos: 'impondo_prepedidos',
          pedidos: 'impondo_pedidos',
          config: 'impondo_config',
          estoque: 'impondo_estoque',
          vendas: 'impondo_vendas',
          devedores: 'impondo_devedores',
          tabelaMedidas: 'impondo_tabela_medidas'
        };
        const raw = localStorage.getItem(legacy[key] || key);
        return raw ? JSON.parse(raw) : (key === 'config' ? null : []);
      } catch (e) {
        return key === 'config' ? null : [];
      }
    }
    const v = this._cache[key];
    if (v === undefined || v === null) return key === 'config' ? null : [];
    // Devolve cópia rasa de arrays pra evitar mutação acidental sem save
    return Array.isArray(v) ? v.slice() : v;
  },

  set(key, data) {
    this._cache[key] = data;
    if (this._useLocalFallback) {
      try {
        const legacy = {
          clientes: 'impondo_clientes',
          prepedidos: 'impondo_prepedidos',
          pedidos: 'impondo_pedidos',
          config: 'impondo_config',
          estoque: 'impondo_estoque',
          vendas: 'impondo_vendas',
          devedores: 'impondo_devedores',
          tabelaMedidas: 'impondo_tabela_medidas'
        };
        localStorage.setItem(legacy[key] || key, JSON.stringify(data));
        return true;
      } catch (e) {
        if (e && (e.name === 'QuotaExceededError' || e.code === 22)) {
          alert('Memória cheia. Use Backup → Liberar espaço.');
        }
        return false;
      }
    }
    // Grava no IndexedDB em background
    if (this._db) {
      this._idbSet(key, data).catch(e => {
        console.error('IDB save error', key, e);
        alert('Erro ao salvar. Tente de novo ou use Backup.');
      });
    }
    return true;
  },

  // ---------- Clientes ----------
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
    this.set('clientes', this.getClientes().filter(c => c.id !== id));
  },

  // ---------- Pré-pedidos ----------
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

  // ---------- Pedidos ----------
  getPedidos() { return this.get('pedidos'); },

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

  // ---------- Estoque ----------
  getEstoque() { return this.get('estoque'); },

  saveEstoque(item) {
    const list = this.getEstoque();
    if (item.id) {
      const idx = list.findIndex(x => x.id === item.id);
      if (idx >= 0) list[idx] = item; else list.push(item);
    } else {
      item.id = this.generateId();
      item.createdAt = new Date().toISOString();
      list.push(item);
    }
    this.set('estoque', list);
    return item;
  },

  deleteEstoque(id) {
    this.set('estoque', this.getEstoque().filter(x => x.id !== id));
  },

  // ---------- Vendas ----------
  getVendas() { return this.get('vendas'); },

  saveVenda(venda) {
    const list = this.getVendas();
    if (!venda.id) {
      venda.id = this.generateId();
      venda.createdAt = new Date().toISOString();
    }
    const idx = list.findIndex(x => x.id === venda.id);
    if (idx >= 0) list[idx] = venda; else list.push(venda);
    this.set('vendas', list);
    return venda;
  },

  // ---------- Devedores ----------
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

  // ---------- Tabelas de medidas ----------
  getTabelaMedidas() {
    try {
      const parsed = this.get('tabelaMedidas');
      if (!parsed || (Array.isArray(parsed) && !parsed.length && this._cache.tabelaMedidas === undefined)) {
        // vazio
      }
      if (Array.isArray(parsed)) return parsed;
      if (parsed && (parsed.texto || parsed.imagem || parsed.nome)) {
        return [{ id: 'legacy', nome: parsed.nome || 'Geral', texto: parsed.texto || '', imagem: parsed.imagem || null }];
      }
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  },

  saveTabelaMedidas(lista) {
    this.set('tabelaMedidas', lista || []);
  },

  saveUmaTabelaMedida(item) {
    const list = this.getTabelaMedidas();
    if (item.id) {
      const idx = list.findIndex(x => x.id === item.id);
      if (idx >= 0) list[idx] = item; else list.push(item);
    } else {
      item.id = this.generateId();
      list.push(item);
    }
    this.saveTabelaMedidas(list);
    return item;
  },

  deleteTabelaMedida(id) {
    this.saveTabelaMedidas(this.getTabelaMedidas().filter(x => x.id !== id));
  },

  // ---------- Config ----------
  getDefaultConfig() {
    return {
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
        'Luva de Goleiro': { custoUSD: 18, venda: 200 },
        'Chaveiro': { custoUSD: 1, venda: 20 },
        'Blusa Moletom': { custoUSD: 35, venda: 280 }
      },
      adicionais: {
        'Personalização': 3,
        'Patch': 1,
        'Patrocínio': 1,
        '2XL': 1,
        '3XL': 2,
        '4XL': 3
      },
      vendaAdicionais: {
        'Personalização': 25,
        'Patch': 10,
        'Patrocínio': 15
      },
      freteFornecedor: [
        { maxPecas: 2, usd: 2 },
        { maxPecas: 5, usd: 4 },
        { maxPecas: 10, usd: 7 },
        { maxPecas: 20, usd: 12 },
        { maxPecas: 999, usd: 18 }
      ]
    };
  },

  getConfig() {
    const defaultConfig = this.getDefaultConfig();
    const saved = this.get('config');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return defaultConfig;
    try {
      return {
        ...defaultConfig,
        ...saved,
        pedido: { ...defaultConfig.pedido, ...(saved.pedido || {}) },
        produtos: { ...defaultConfig.produtos, ...(saved.produtos || {}) },
        adicionais: { ...defaultConfig.adicionais, ...(saved.adicionais || {}) },
        vendaAdicionais: { ...defaultConfig.vendaAdicionais, ...(saved.vendaAdicionais || {}) },
        freteFornecedor: Array.isArray(saved.freteFornecedor)
          ? saved.freteFornecedor
          : defaultConfig.freteFornecedor
      };
    } catch (e) {
      return defaultConfig;
    }
  },

  saveConfig(config) {
    this.set('config', config);
  },

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }
};
