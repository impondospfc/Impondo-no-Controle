// ===== IMPONDO IMPORTS NO CONTROLE — APP =====
const App = {
  currentScreen: 'dashboard',
  config: null,
  dashboardMonth: new Date().toISOString().slice(0,7),

  async init() {
    // Aguarda IndexedDB (migra dados antigos automaticamente)
    if (Storage.init) await Storage.init();
    this.config = Storage.getConfig();
    this.dashboardMonth = localStorage.getItem('impondo_dashboard_month') || this.dashboardMonth;
    this.bindNav();
    this.bindModal();
    this.render();
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  },

  esc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  },

  money(v) { return Calc.formatBRL(Number(v)||0); },

  bindNav() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentScreen = btn.dataset.screen;
        this.render();
      });
    });
  },

  bindModal() {
    document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
    document.getElementById('modal').addEventListener('click', e => {
      if (e.target.id === 'modal') this.closeModal();
    });
  },

  render() {
    const app = document.getElementById('app');
    const views = {
      dashboard: () => this.renderDashboard(),
      clientes: () => this.renderClientes(),
      prepedidos: () => this.renderPrePedidos(),
      pedidos: () => this.renderPedidos(),
      estoque: () => this.renderEstoque(),
      devedores: () => this.renderDevedores()
    };
    app.innerHTML = (views[this.currentScreen] || views.dashboard)();
    this.bindScreenEvents();
  },

  // ---------- DASHBOARD ----------
  getMonthLabel(ym) {
    const [y,m] = ym.split('-');
    return new Date(Number(y), Number(m)-1, 1).toLocaleDateString('pt-BR', {month:'long', year:'numeric'});
  },

  getMonthOptions() {
    const months = new Set();
    const now = new Date();
    for (let i=-6;i<=6;i++) {
      const d = new Date(now.getFullYear(), now.getMonth()+i, 1);
      months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    }
    Storage.getPedidos().forEach(p => {
      const d = new Date(p.dataVenda || p.createdAt || Date.now());
      if (!isNaN(d)) months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    });
    Storage.getVendas().forEach(v => {
      const d=new Date(v.dataVenda || v.createdAt);
      if(!isNaN(d)) months.add(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`);
    });
    return [...months].sort();
  },

  itemSale(item, pedido) {
    const cfg = this.config;
    const prod = cfg.produtos[item.produto] || {};
    const base = Number(item.valorVendaBase ?? item.valorVenda ?? prod.venda ?? 0);
    let adicionais = Number(item.vendaAdicionaisSnapshot ?? 0);
    if (item.vendaAdicionaisSnapshot == null) {
      if (item.personalizacao) adicionais += Number(cfg.vendaAdicionais?.Personalização || 20);
      if (item.patch) adicionais += Number(cfg.vendaAdicionais?.Patch || 10);
      if (item.patrocinio) adicionais += Number(cfg.vendaAdicionais?.Patrocínio || 0);
    }
    const subtotal = (base + adicionais) * (Number(item.quantidade)||1);
    const desconto = Number(item.desconto || 0);
    return { subtotal, desconto, final: Math.max(0, subtotal - desconto) };
  },

  itemCost(item, pedido) {
    const totalUSD = Number(pedido.totalUSD || Calc.totalUSD(pedido.itens||[], this.config));
    const freteUSD = Number(pedido.freteFornecedorUSD || 0);
    const imposto = Number(pedido.impostoBRL || 0);
    const fr = Calc.rateioFrete(item, totalUSD, freteUSD, this.config);
    const ir = Calc.rateioImposto(item, totalUSD, imposto, this.config);
    let custo = Calc.custoRealItem(item, Number(pedido.cotacao)||0, fr, ir, this.config);
    custo += Number(item.entrega?.custo || 0);
    custo += Number(item.embalagemCusto || 0);
    return custo;
  },

  itemEstimatedCost(item, pedido) {
    const totalUSD = Number(pedido.totalUSD || Calc.totalUSD(pedido.itens||[], this.config));
    const freteUSD = Number(pedido.freteFornecedorUSD || 0);
    const fr = Calc.rateioFrete(item, totalUSD, freteUSD, this.config);
    let custo = Calc.custoEstimadoItem(item, Number(pedido.cotacao)||0, fr, this.config);
    custo += Number(item.entrega?.custo || 0);
    custo += Number(item.embalagemCusto || 0);
    return custo;
  },

  getHistoricoImposto(produto) {
    // Aprende com pedidos já tributados: imposto rateado por peça/modelo.
    const porProduto=[]; let globalTax=0, globalUSD=0;
    Storage.getPedidos().forEach(p=>{
      if (p.impostoBRL == null || p.impostoBRL === '' || isNaN(Number(p.impostoBRL))) return;
      const totalUSD=Number(p.totalUSD || Calc.totalUSD(p.itens||[], this.config));
      if (totalUSD<=0) return;
      globalTax += Number(p.impostoBRL)||0; globalUSD += totalUSD;
      (p.itens||[]).forEach(i=>{
        const usd=Calc.custoItemUSD(i,this.config); const q=Math.max(1,Number(i.quantidade)||1);
        const tax=(Number(p.impostoBRL)||0)*(usd/totalUSD);
        porProduto.push({produto:i.produto, taxPerPiece:tax/q});
      });
    });
    const iguais=porProduto.filter(x=>x.produto===produto).map(x=>x.taxPerPiece);
    const mediaProduto=iguais.length ? iguais.reduce((a,b)=>a+b,0)/iguais.length : null;
    const mediaGlobal=globalUSD>0 ? (globalTax/globalUSD)*(Number(this.config.produtos[produto]?.custoUSD)||0) : 0;
    return {taxPerPiece:mediaProduto!=null?mediaProduto:mediaGlobal, fonte:mediaProduto!=null?'histórico do modelo':'média geral'};
  },

  stockUnitCost(item) {
    const usd=Number(item.custoUSD || this.config.produtos[item.produto]?.custoUSD || 0);
    const cambio=Number(item.cotacao || 5.24);
    const imposto=(item.impostoPorPeca != null && item.impostoPorPeca !== '') ? Number(item.impostoPorPeca) : this.getHistoricoImposto(item.produto).taxPerPiece;
    const extras=Number(item.extrasBRL||0);
    return usd*cambio + imposto + extras;
  },

  renderEstoque() {
    const estoque=Storage.getEstoque();
    const totalQtd=estoque.reduce((s,x)=>s+(Number(x.quantidade)||0),0);
    const totalCusto=estoque.reduce((s,x)=>s+(Number(x.quantidade)||0)*this.stockUnitCost(x),0);
    const totalVenda=estoque.reduce((s,x)=>s+(Number(x.quantidade)||0)*(Number(x.precoVenda||this.config.produtos[x.produto]?.venda)||0),0);
    // Peças de estoque ainda em andamento nos pedidos
    const emAndamento=[];
    Storage.getPedidos().forEach(p=>{
      if(['entregue'].includes(p.status)) return;
      (p.itens||[]).forEach((item,idx)=>{
        if(!item.isEstoque) return;
        if(item.estoqueId && p.status==='recebido') return; // já no estoque disponível
        const statusLabel={realizado:'Pedido feito',enviado:'Enviado',imposto_pago:'Imposto pago',em_transito:'Em trânsito',recebido:'Recebido'}[p.status]||p.status;
        emAndamento.push({p,item,idx,statusLabel});
      });
    });
    const busca = (this._estoqueBusca||'').toLowerCase().trim();
    if (busca) {
      // filter applied later in disponivel list via inline - we filter estoque var
    }
    let estoqueFiltrado = estoque;
    if (busca) estoqueFiltrado = estoque.filter(x =>
      (x.time||'').toLowerCase().includes(busca) ||
      (x.produto||'').toLowerCase().includes(busca) ||
      (x.tamanho||'').toLowerCase().includes(busca)
    );
    return `<div class="screen-header"><div><h2>Estoque</h2><div class="list-item-sub">Busca, foto, venda e compartilhar</div></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn btn-primary btn-sm" id="btn-novo-estoque">+ Cadastrar</button>
        <button class="btn btn-secondary btn-sm" id="btn-compartilhar-estoque">📤</button>
        <button class="btn btn-secondary btn-sm" id="btn-tabela-medidas">📏</button>
        <button class="btn btn-secondary btn-sm" id="btn-devedores">💳</button>
      </div>
    </div>
      <div class="form-group"><input id="est-busca" type="search" placeholder="🔍 Buscar time, modelo, tamanho..." value="${this.esc(this._estoqueBusca||'')}"></div>
      <div class="stat-grid"><div class="stat"><div class="stat-value">${totalQtd}</div><div class="stat-label">Disponíveis</div></div><div class="stat"><div class="stat-value">${this.money(totalCusto)}</div><div class="stat-label">Custo estimado</div></div><div class="stat"><div class="stat-value">${this.money(totalVenda)}</div><div class="stat-label">Valor de venda</div></div><div class="stat"><div class="stat-value">${this.money(totalVenda-totalCusto)}</div><div class="stat-label">Lucro potencial</div></div></div>
      ${emAndamento.length?`<div class="section-title">Em andamento (${emAndamento.length})</div>`+emAndamento.map(({p,item,statusLabel})=>`<div class="list-item pendencia"><div class="list-item-info"><div class="list-item-title">${this.esc(item.time||item.produto)} — ${this.esc(item.tamanho||'')}</div><div class="list-item-sub">Pedido #${p.numero} • ${item.quantidade||1} un. • ${statusLabel}</div></div><span class="badge badge-warning">${statusLabel}</span></div>`).join(''):''}
      <div class="section-title">Disponível ${busca?`(filtro: ${this.esc(busca)})`:''}</div>
      ${estoqueFiltrado.filter(x=>Number(x.quantidade)>0).length?estoqueFiltrado.filter(x=>Number(x.quantidade)>0).map(x=>{const q=Number(x.quantidade)||0,c=this.stockUnitCost(x);return `<div class="list-item">${x.foto?`<img src="${x.foto}" style="width:56px;height:56px;border-radius:10px;object-fit:cover;flex-shrink:0">`:''}<div class="list-item-info"><div class="list-item-title">${this.esc(x.time||x.produto)} — ${this.esc(x.tamanho||'')}</div><div class="list-item-sub">${this.esc(x.produto)} • ${q} un. • ${this.money(Number(x.precoVenda)||0)}</div></div><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end"><span class="badge badge-success">${q} un.</span><button class="btn btn-primary btn-sm" data-vender-estoque="${x.id}">Vender</button><button class="btn btn-secondary btn-sm" data-editar-estoque="${x.id}">Editar</button></div></div>`}).join(''):`<div class="empty"><div class="icon">👕</div><p>Nenhuma peça disponível</p></div>`}`;
  },

  openEstoqueForm(id) {
    const old=id?Storage.getEstoque().find(x=>x.id===id):null;
    const produtos=Object.keys(this.config.produtos);
    const tamanhos=['P','M','G','GG','2XL','3XL','4XL'];
    const h=old?this.getHistoricoImposto(old.produto):{taxPerPiece:0,fonte:'histórico'};
    const precoInicial=old?.precoVenda ?? (this.config.produtos[old?.produto || produtos[0]]?.venda || 0);

    if(old){
      this.openModal('Editar estoque',`
        <div class="form-group"><label>Modelo base</label><select id="st-prod">${produtos.map(x=>`<option ${old.produto===x?'selected':''}>${this.esc(x)}</option>`).join('')}</select></div>
        <div class="form-group"><label>Time / modelo</label><input id="st-time" value="${this.esc(old.time||'')}" placeholder="Ex.: Palmeiras Home 24/25"></div>
        <div class="form-row"><div class="form-group"><label>Tamanho</label><select id="st-tam">${tamanhos.map(x=>`<option ${old.tamanho===x?'selected':''}>${x}</option>`).join('')}</select></div>
        <div class="form-group"><label>Quantidade</label><input id="st-qtd" type="number" min="0" value="${old.quantidade??1}"></div></div>
        <div class="form-row"><div class="form-group"><label>Cotação</label><input id="st-cot" type="number" step="0.01" value="${old.cotacao??5.24}"></div>
        <div class="form-group"><label>Preço venda</label><input id="st-preco" type="number" step="0.01" value="${precoInicial}"></div></div>
        <div class="form-group"><label>Imposto/peça (R$)</label><input id="st-imp" type="number" step="0.01" value="${old.impostoPorPeca??''}" placeholder="Opcional"></div>
        <div class="form-group"><label>Foto</label><input id="st-foto" type="file" accept="image/*">${old.foto?`<img src="${old.foto}" class="photo-preview">`:''}</div>
        <button class="btn btn-primary" id="btn-salvar-st">Salvar</button>
        <button class="btn btn-danger mt-12" id="btn-excluir-st">Excluir</button>`);
      document.getElementById('btn-salvar-st').onclick=async()=>{
        const f=document.getElementById('st-foto').files[0];
        const foto=f?await this.readFile(f):(old.foto||null);
        Storage.saveEstoque({id:old.id,produto:document.getElementById('st-prod').value,time:document.getElementById('st-time').value.trim(),tamanho:document.getElementById('st-tam').value,quantidade:Number(document.getElementById('st-qtd').value)||0,cotacao:Number(document.getElementById('st-cot').value)||5.24,precoVenda:Number(document.getElementById('st-preco').value)||0,impostoPorPeca:document.getElementById('st-imp').value===''?null:Number(document.getElementById('st-imp').value),foto});
        this.closeModal();this.toast('Salvo!');this.render();
      };
      document.getElementById('btn-excluir-st').onclick=()=>{if(confirm('Excluir?')){Storage.deleteEstoque(old.id);this.closeModal();this.render();}};
      return;
    }

    this.openModal('Cadastrar estoque',`
      <div class="form-group"><label>Modelo base</label><select id="st-prod">${produtos.map(x=>`<option>${this.esc(x)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Time / modelo</label><input id="st-time" placeholder="Ex.: Palmeiras Home 24/25"></div>
      <div class="form-row"><div class="form-group"><label>Cotação</label><input id="st-cot" type="number" step="0.01" value="5.24"></div>
      <div class="form-group"><label>Preço venda</label><input id="st-preco" type="number" step="0.01" value="${precoInicial}"></div></div>
      <div class="form-group"><label>Imposto/peça (R$)</label><input id="st-imp" type="number" step="0.01" placeholder="Opcional"></div>
      <div class="form-group"><label>Foto do produto</label><input id="st-foto" type="file" accept="image/*"></div>
      <div class="section-title">Quantidade por tamanho</div>
      <div class="card">${tamanhos.map(t=>`<div class="form-row" style="margin-bottom:8px;align-items:center"><label style="min-width:48px;font-weight:700">${t}</label><input class="st-tam-qtd" data-tam="${t}" type="number" min="0" value="0"></div>`).join('')}</div>
      <button class="btn btn-primary" id="btn-salvar-st">Salvar estoque</button>`);
    document.getElementById('st-prod').onchange=()=>{document.getElementById('st-preco').value=this.config.produtos[document.getElementById('st-prod').value]?.venda||0;};
    document.getElementById('btn-salvar-st').onclick=async()=>{
      const produto=document.getElementById('st-prod').value;
      const time=document.getElementById('st-time').value.trim();
      const cotacao=Number(document.getElementById('st-cot').value)||5.24;
      const precoVenda=Number(document.getElementById('st-preco').value)||0;
      const impostoPorPeca=document.getElementById('st-imp').value===''?null:Number(document.getElementById('st-imp').value);
      const f=document.getElementById('st-foto').files[0];
      const foto=f?await this.readFile(f):null;
      let n=0;
      document.querySelectorAll('.st-tam-qtd').forEach(inp=>{
        const qtd=Number(inp.value)||0; if(qtd<=0)return;
        Storage.saveEstoque({produto,time,tamanho:inp.dataset.tam,quantidade:qtd,cotacao,precoVenda,impostoPorPeca,foto});
        n++;
      });
      if(!n)return this.toast('Informe quantidade em pelo menos 1 tamanho');
      this.closeModal();this.toast(n+' tamanho(s) salvos!');this.render();
    };
  },

  openVendaEstoque(id) {
    const x=Storage.getEstoque().find(a=>a.id===id);if(!x||Number(x.quantidade)<=0)return this.toast('Sem estoque disponível');
    const clientes=Storage.getClientes();if(!clientes.length)return this.toast('Cadastre um cliente primeiro!');
    const custo=this.stockUnitCost(x), preco=Number(x.precoVenda||this.config.produtos[x.produto]?.venda)||0;
    this.openModal('Vender do estoque',`
      <div class="card">${x.foto?`<img src="${x.foto}" class="photo-preview">`:''}<b>${this.esc(x.time||x.produto)}</b>
      <div class="list-item-sub">${this.esc(x.produto)} • ${this.esc(x.tamanho)} • Custo ${this.money(custo)}</div></div>
      <div class="form-group"><label>Cliente</label><select id="ve-cli">${clientes.map(c=>`<option value="${c.id}">${this.esc(c.nome)} — ${this.esc(c.cidade)}</option>`).join('')}</select></div>
      <div class="form-row"><div class="form-group"><label>Preço padrão</label><input value="${preco.toFixed(2)}" disabled></div>
      <div class="form-group"><label>Valor vendido (R$)</label><input id="ve-valor" type="number" step="0.01" value="${preco}"></div></div>
      <div class="form-group"><label>Forma de pagamento</label><select id="ve-pag">
        <option>Pix</option><option>Dinheiro</option><option>Cartão crédito 1x</option>
        <option>Cartão crédito 2x</option><option>Cartão crédito 3x</option>
        <option>Cartão débito</option><option>A combinar / parcial</option>
      </select></div>
      <div class="form-group"><label>Valor já pago (R$)</label><input id="ve-pago" type="number" step="0.01" value="${preco}"></div>
      <div class="form-group"><label>Prazo do restante (se ficar devendo)</label><input id="ve-prazo" type="date"></div>
      <div class="form-row"><div class="form-group"><label>Entrega</label><select id="ve-met">
        <option>Pessoalmente</option><option>Uber Moto</option><option>Correios</option><option>Motoboy</option>
      </select></div>
      <div class="form-group"><label>Custo entrega (R$)</label><input id="ve-uber" type="number" step="0.01" value="0"></div></div>
      <div class="form-group"><label>Sacola / embalagem (R$)</label><input id="ve-sacola" type="number" step="0.01" value="2"></div>
      <div class="card"><b>Lucro:</b> <span id="ve-lucro"></span><br><span class="list-item-sub" id="ve-restante"></span></div>
      <button class="btn btn-primary" id="btn-confirmar-venda">Confirmar venda</button>`);
    const calc=()=>{
      const valor=Number(document.getElementById('ve-valor').value)||0;
      const pago=Number(document.getElementById('ve-pago').value)||0;
      const uber=Number(document.getElementById('ve-uber').value)||0;
      const sac=Number(document.getElementById('ve-sacola').value)||0;
      document.getElementById('ve-lucro').textContent=this.money(valor-custo-sac-uber);
      const rest=Math.max(0,valor-pago);
      document.getElementById('ve-restante').textContent=rest>0?`Ficará devendo ${this.money(rest)}`:'Pagamento completo';
    };
    ['ve-valor','ve-pago','ve-uber','ve-sacola'].forEach(id=>document.getElementById(id).oninput=calc);calc();
    document.getElementById('btn-confirmar-venda').onclick=()=>{
      const valor=Number(document.getElementById('ve-valor').value)||0;
      const pago=Number(document.getElementById('ve-pago').value)||0;
      const met=document.getElementById('ve-met').value;
      const uber=Number(document.getElementById('ve-uber').value)||0;
      const sac=Number(document.getElementById('ve-sacola').value)||0;
      const pag=document.getElementById('ve-pag').value;
      const prazo=document.getElementById('ve-prazo').value;
      const cliId=document.getElementById('ve-cli').value;
      if(valor<=0)return this.toast('Informe o valor');
      x.quantidade=Math.max(0,(Number(x.quantidade)||0)-1);
      Storage.saveEstoque(x);
      Storage.saveVenda({clienteId:cliId,estoqueId:x.id,produto:x.produto,time:x.time,tamanho:x.tamanho,valorPadrao:preco,valorVenda:valor,desconto:Math.max(0,preco-valor),custoProduto:custo,embalagem:sac,entrega:{metodo:met,custo:uber},pagamento:pag,valorPago:pago,dataVenda:new Date().toISOString()});
      const rest=Math.max(0,valor-pago);
      if(rest>0.01){
        const cli=Storage.getCliente(cliId);
        Storage.saveDevedor({clienteId:cliId,clienteNome:cli?.nome||'',descricao:`${x.time||x.produto} ${x.tamanho}`,valorTotal:valor,valorPago:pago,valorRestante:rest,prazo:prazo||null,status:'aberto',origem:'venda_estoque'});
        this.toast('Venda ok! Devedor: '+this.money(rest));
      } else this.toast('Venda registrada!');
      this.closeModal();this.render();
    };
  },

  monthMetrics(ym) {
    const pedidos = Storage.getPedidos();
    let faturamento=0,custos=0,custosAPurar=0,pecas=0,descontos=0;
    const byItems=[];
    pedidos.forEach(p => {
      (p.itens||[]).forEach(item => {
        const data = item.dataVenda || p.dataVenda || p.createdAt;
        const d = new Date(data);
        if (isNaN(d) || `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` !== ym) return;

        const sale=this.itemSale(item,p);
        const cost=this.itemCost(item,p);
        faturamento += sale.final;
        descontos += sale.desconto;
        pecas += Number(item.quantidade)||1;

        // Custo real se o imposto do pedido foi lançado (valor preenchido)
        const impostoLancado = p.impostoBRL != null && p.impostoBRL !== '' && !isNaN(Number(p.impostoBRL)) && Number(p.impostoBRL) >= 0;
        if (impostoLancado) {
          custos += cost;
        } else {
          custosAPurar += cost;
        }
        byItems.push({p,item,sale,cost});
      });
    });
    Storage.getVendas().forEach(v=>{ const d=new Date(v.dataVenda||v.createdAt); if(isNaN(d)||`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`!==ym)return; const venda=Number(v.valorVenda||0)-Number(v.desconto||0); const custo=Number(v.custoProduto||0)+Number(v.embalagem||0)+Number(v.entrega?.custo||0); faturamento+=venda; custos+=custo; descontos+=Number(v.desconto||0); pecas+=1; byItems.push({vendaEstoque:v,sale:{final:venda},cost:custo}); });
    const lucro=faturamento-custos;
    return {
      faturamento,
      custos,
      custosAPurar,
      lucro,
      margem:Calc.margem(lucro,faturamento),
      pecas,
      descontos,
      items:byItems,
      ticket:pecas?faturamento/pecas:0
    };
  },

  currentStock() {
    let qtd=0, custo=0, potencial=0;
    Storage.getEstoque().forEach(x=>{
      const q=Math.max(0,Number(x.quantidade)||0); if(!q)return;
      const unit=this.stockUnitCost(x), pv=Number(x.precoVenda||this.config.produtos[x.produto]?.venda)||0;
      qtd+=q; custo+=q*unit; potencial+=q*pv;
    });
    Storage.getPedidos().forEach(p=>{
      (p.itens||[]).forEach(item=>{
        if (item.statusEntrega==='entregue' || p.status==='entregue') return;
        if (p.status!=='recebido') return;
        const q=Number(item.quantidade)||1; qtd+=q; custo+=this.itemCost(item,p); potencial+=this.itemSale(item,p).final;
      });
    });
    return {qtd,custo,potencial,lucro:potencial-custo};
  },

  renderDashboard() {
    const m=this.monthMetrics(this.dashboardMonth);
    const stock=this.currentStock();
    const pedidos=Storage.getPedidos();
    const pre=Storage.getPrePedidos().filter(p=>p.status==='aberto');
    const pend=[];
    pre.forEach(pp=>{
      const c=Storage.getCliente(pp.clienteId);
      const q=Calc.totalPecas(pp.itens||[]);
      if(Calc.podeConverter(pp,c)) pend.push(`Pré-pedido de ${c?.nome||'cliente'} pronto para formar pedido`);
      else if(Calc.isMauaRegiao(c?.cidade||'')) pend.push(`Mauá: ${c?.nome||'cliente'} está com ${q}/4 peças`);
    });
    pedidos.forEach(p=>{
      if((p.impostoBRL == null || p.impostoBRL === '') && ['realizado','enviado'].includes(p.status)) {
        pend.push(`Pedido #${p.numero}: lançar imposto`);
      }

      if(p.dataImpostoPago && !['recebido','entregue'].includes(p.status)) {
        const dias = Number(this.config.pedido?.diasEstimadosAposImposto || 7);
        const previsao = new Date(p.dataImpostoPago);
        previsao.setDate(previsao.getDate() + dias);
        const hoje = new Date();
        if(hoje >= previsao) {
          pend.push(`Pedido #${p.numero}: verificar recebimento — previsão ${previsao.toLocaleDateString('pt-BR')}`);
        }
      }

      if(p.status==='recebido') {
        const n=(p.itens||[]).filter(i=>i.statusEntrega!=='entregue').length;
        if(n) pend.push(`Pedido #${p.numero}: ${n} entrega(s) pendente(s)`);
      }
    });

    return `
      <div class="screen-header">
        <div><h2>Dashboard</h2><div class="list-item-sub">Visão financeira da Impondo</div></div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-secondary btn-sm" id="btn-backup">💾 Backup</button>
          <select id="dashboard-month" style="max-width:180px">${this.getMonthOptions().map(x=>`<option value="${x}" ${x===this.dashboardMonth?'selected':''}>${this.getMonthLabel(x)}</option>`).join('')}</select>
        </div>
      </div>

      <div class="card" style="border-color:var(--purple)">
        <div class="section-title" style="margin-top:0">📅 ${this.getMonthLabel(this.dashboardMonth)}</div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-value">${this.money(m.faturamento)}</div><div class="stat-label">Faturamento</div></div>
          <div class="stat"><div class="stat-value">${this.money(m.custos)}</div><div class="stat-label">Custo real apurado</div></div>
          <div class="stat"><div class="stat-value" style="color:${m.lucro>=0?'var(--success)':'var(--danger)'}">${this.money(m.lucro)}</div><div class="stat-label">Lucro real apurado</div></div>
          <div class="stat"><div class="stat-value">${m.margem.toFixed(1)}%</div><div class="stat-label">Margem</div></div>
        </div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-value">${m.pecas}</div><div class="stat-label">Peças vendidas</div></div>
          <div class="stat"><div class="stat-value">${this.money(m.ticket)}</div><div class="stat-label">Ticket médio/peça</div></div>
          <div class="stat"><div class="stat-value">${this.money(m.descontos)}</div><div class="stat-label">Descontos</div></div>
          <div class="stat"><div class="stat-value">${this.money(m.custosAPurar)}</div><div class="stat-label">Custo a apurar</div></div>
        </div>
      </div>

      <div class="section-title">📦 Estoque atual</div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${stock.qtd}</div><div class="stat-label">Peças recebidas</div></div>
        <div class="stat"><div class="stat-value">${this.money(stock.custo)}</div><div class="stat-label">Capital investido</div></div>
        <div class="stat"><div class="stat-value">${this.money(stock.potencial)}</div><div class="stat-label">Potencial de venda</div></div>
        <div class="stat"><div class="stat-value" style="color:var(--success)">${this.money(stock.lucro)}</div><div class="stat-label">Lucro potencial</div></div>
      </div>

      <div class="section-title">🚚 Operação</div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${pre.length}</div><div class="stat-label">Pré-pedidos abertos</div></div>
        <div class="stat"><div class="stat-value">${pedidos.filter(p=>!['entregue'].includes(p.status)).length}</div><div class="stat-label">Pedidos ativos</div></div>
      </div>

      <div class="section-title">⚠️ Pendências</div>
      ${pend.length?pend.slice(0,10).map(x=>`<div class="list-item"><div class="list-item-info"><div class="list-item-title">${this.esc(x)}</div></div><span class="badge badge-warning">Ação</span></div>`).join(''):`<div class="empty"><div class="icon">✅</div><p>Nenhuma pendência</p></div>`}
    `;
  },

  // ---------- CLIENTES ----------
  renderClientes() {
    const clientes=Storage.getClientes().sort((a,b)=>(a.nome||'').localeCompare(b.nome||''));
    return `<div class="screen-header"><h2>Clientes</h2><button class="btn btn-primary btn-sm" id="btn-novo-cliente">+ Novo</button></div>
      ${clientes.length?clientes.map(c=>`<div class="list-item" data-cliente="${c.id}"><div class="list-item-info"><div class="list-item-title">${this.esc(c.nome)}</div><div class="list-item-sub">${c.instagram?'@'+this.esc(c.instagram.replace('@','')):''}${c.whatsapp?' • '+this.esc(c.whatsapp):''}${c.cidade?' • '+this.esc(c.cidade):''}</div></div><span class="badge ${Calc.isMauaRegiao(c.cidade)?'badge-pink':'badge-cyan'}">${Calc.isMauaRegiao(c.cidade)?'Mauá':'Outro'}</span></div>`).join(''):`<div class="empty"><div class="icon">👥</div><p>Nenhum cliente cadastrado</p></div>`}`;
  },

  openClienteForm(id=null) {
    const c=id?Storage.getCliente(id):null;
    this.openModal(c?'Editar Cliente':'Novo Cliente',`
      <div class="form-group"><label>Nome *</label><input id="cli-nome" value="${this.esc(c?.nome)}"></div>
      <div class="form-group"><label>@ Instagram</label><input id="cli-instagram" value="${this.esc(c?.instagram)}" placeholder="sem @"></div>
      <div class="form-group"><label>WhatsApp</label><input id="cli-whatsapp" value="${this.esc(c?.whatsapp)}"></div>
      <div class="form-group"><label>Cidade / Destino *</label><input id="cli-cidade" value="${this.esc(c?.cidade)}" placeholder="Mauá, São Paulo..."></div>
      <div class="form-group"><label>Observações</label><textarea id="cli-obs" rows="2">${this.esc(c?.observacoes)}</textarea></div>
      <button class="btn btn-primary" id="btn-salvar-cliente">Salvar Cliente</button>
      ${c?'<button class="btn btn-danger mt-12" id="btn-excluir-cliente">Excluir</button>':''}`);
    document.getElementById('btn-salvar-cliente').onclick=()=>{
      const nome=document.getElementById('cli-nome').value.trim(), cidade=document.getElementById('cli-cidade').value.trim();
      if(!nome||!cidade)return this.toast('Nome e cidade são obrigatórios');
      Storage.saveCliente({id:c?.id,nome,instagram:document.getElementById('cli-instagram').value.trim().replace(/^@/,''),whatsapp:document.getElementById('cli-whatsapp').value.trim(),cidade,observacoes:document.getElementById('cli-obs').value.trim()});
      this.closeModal();this.toast('Cliente salvo!');this.render();
    };
    if(c)document.getElementById('btn-excluir-cliente').onclick=()=>{if(confirm('Excluir este cliente?')){Storage.deleteCliente(c.id);this.closeModal();this.render();}};
  },

  // ---------- PRÉ-PEDIDOS ----------
  renderPrePedidos() {
    const pps=Storage.getPrePedidos().filter(p=>p.status==='aberto').sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
    const meta=Number(this.config.pedido?.quantidadeMinima||4);
    // Estoque + clientes Mauá entram no mesmo lote
    const locais=pps.filter(pp=>{
      if(pp.isEstoque||(pp.itens||[]).some(i=>i.isEstoque)) return true;
      return Calc.isMauaRegiao(Storage.getCliente(pp.clienteId)?.cidade||'');
    });
    const totalLocal=locais.reduce((s,pp)=>s+Calc.totalPecas(pp.itens||[]),0);
    const temClienteMaua=locais.some(pp=>!pp.isEstoque && !(pp.itens||[]).every(i=>i.isEstoque) && Calc.isMauaRegiao(Storage.getCliente(pp.clienteId)?.cidade||''));
    const localPronto=temClienteMaua?totalLocal>=meta:true;
    return `<div class="screen-header"><div><h2>Pré-pedidos</h2><div class="list-item-sub">Acumule peças de vários clientes no mesmo lote</div></div><button class="btn btn-primary btn-sm" id="btn-novo-prepedido">+ Novo</button></div>
      <div class="card"><b>Regra de formação</b><p class="list-item-sub" style="margin-top:6px">Mauá/região + estoque: peças de clientes locais e de estoque entram no mesmo lote. ${totalLocal} de ${meta} peça(s). Ao chegar em ${meta}, qualquer pré-pedido local pode gerar o pedido. Outras cidades podem ser enviadas mesmo com 1 peça.</p></div>
      ${pps.length?pps.map(pp=>{
        const c=Storage.getCliente(pp.clienteId); const q=Calc.totalPecas(pp.itens||[]); const isEst=!!(pp.isEstoque||(pp.itens||[]).some(i=>i.isEstoque));
        const local=isEst || Calc.isMauaRegiao(c?.cidade||'');
        const pode=local?localPronto:true;
        const texto=isEst?`${q} peça(s) • ESTOQUE • lote ${totalLocal}/${meta}`:(local?`${totalLocal} de ${meta}${localPronto?' • Pedido liberado':''}`:`${q} peça(s) • Pedido liberado`);
        return `<div class="list-item" data-prepedido="${pp.id}"><div class="list-item-info"><div class="list-item-title">${isEst?'📦 ESTOQUE':this.esc(c?.nome||'Cliente')}</div><div class="list-item-sub">${q} peça(s) • ${this.esc((pp.itens||[]).map(i=>i.time||i.produto).join(', '))} • ${isEst?'Sem cliente':this.esc(c?.cidade||'')}</div></div><div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end"><span class="badge ${isEst?'badge-purple':(pode?'badge-success':'badge-warning')}">${texto}</span>${pode?`<button class="btn btn-primary btn-sm" data-formar-pre="${pp.id}">📦 Efetuar</button>`:''}<button class="btn btn-danger btn-sm" data-excluir-pre="${pp.id}">🗑</button></div></div>`;
      }).join(''):`<div class="empty"><div class="icon">📝</div><p>Nenhum pré-pedido aberto</p></div>`}`;
  },

  async readFile(file) {
    if (!file) return null;
    // Comprime imagens pra não estourar a memória do celular
    if (file.type && file.type.startsWith('image/')) {
      try {
        return await this.compressImage(file, 900, 0.65);
      } catch (e) {
        console.warn('compress fail, using original', e);
      }
    }
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  },

  compressImage(file, maxSide = 900, quality = 0.65) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          let w = img.width, h = img.height;
          if (w > maxSide || h > maxSide) {
            if (w >= h) { h = Math.round(h * maxSide / w); w = maxSide; }
            else { w = Math.round(w * maxSide / h); h = maxSide; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Falha ao ler imagem')); };
      img.src = url;
    });
  },

  // Remove fotos antigas de pré-pedidos já convertidos / pedidos antigos (libera espaço)
  limparFotosAntigas() {
    let n = 0;
    const pps = Storage.getPrePedidos();
    pps.forEach(pp => {
      if (pp.status === 'convertido' && pp.itens) {
        pp.itens.forEach(i => {
          if (i.fotoRef) { i.fotoRef = null; n++; }
        });
      }
    });
    Storage.set('prepedidos', pps);
    const pedidos = Storage.getPedidos();
    pedidos.forEach(p => {
      if (p.fotosFornecedor && p.fotosFornecedor.length > 1) {
        // mantém só a última
        n += p.fotosFornecedor.length - 1;
        p.fotosFornecedor = [p.fotosFornecedor[p.fotosFornecedor.length - 1]];
        p.fotoFornecedor = p.fotosFornecedor[0];
      }
    });
    Storage.set('pedidos', pedidos);
    this.toast(n ? `Liberou espaço (${n} foto(s) removida(s))` : 'Nada para limpar');
    this.render();
  },


  openPrePedidoForm() {
    const clientes=Storage.getClientes();
    const produtos=Object.keys(this.config.produtos), tamanhos=['P','M','G','GG','2XL','3XL','4XL'];
    this.openModal('Novo Pré-pedido',`
      <div class="card" style="margin-bottom:16px">
        <div class="form-group" style="margin-bottom:0">
          <label style="display:flex;align-items:center;gap:10px;font-size:15px;color:var(--text);cursor:pointer">
            <input type="checkbox" id="pp-estoque" style="width:20px;height:20px;accent-color:var(--cyan)">
            <span><b>É estoque</b><br><span class="list-item-sub">Peça para você — sem cliente</span></span>
          </label>
        </div>
      </div>
      <div class="form-group" id="pp-cliente-wrap"><label>Cliente *</label><select id="pp-cliente"><option value="">Selecione...</option>${clientes.map(c=>`<option value="${c.id}">${this.esc(c.nome)} — ${this.esc(c.cidade)}</option>`).join('')}</select></div>
      <div class="section-title">Peças</div><div id="pp-itens"></div>
      <button class="btn btn-secondary btn-sm mb-12" id="btn-add-item">+ Adicionar peça</button>
      <div class="form-group"><label>Observações</label><textarea id="pp-obs" rows="2"></textarea></div>
      <button class="btn btn-primary" id="btn-salvar-pp">Salvar Pré-pedido</button>`);
    let n=0; const cont=document.getElementById('pp-itens');
    const add=()=>{
      n++;const d=document.createElement('div');d.className='item-card';
      d.innerHTML=`<div class="form-group"><label>Produto</label><select class="pp-prod">${produtos.map(p=>`<option>${this.esc(p)}</option>`).join('')}</select></div>
      <div class="form-row"><div class="form-group"><label>Tamanho</label><select class="pp-tam">${tamanhos.map(t=>`<option>${t}</option>`).join('')}</select></div><div class="form-group"><label>Quantidade</label><input class="pp-qtd" type="number" min="1" value="1"></div></div>
      <div class="form-group"><label>Time / Modelo</label><input class="pp-time" placeholder="Ex.: Corinthians Home 24/25"></div>
      <div class="form-row"><div class="form-group"><label>Valor base de venda (R$)</label><input class="pp-venda" type="number" step="0.01"></div><div class="form-group"><label>Desconto (R$)</label><input class="pp-desc" type="number" step="0.01" value="0"></div></div>
      <div class="form-group"><label>Data da venda</label><input class="pp-data-venda" type="date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="form-row"><label><input type="checkbox" class="pp-pers"> Personalizada</label><label><input type="checkbox" class="pp-patch"> Patch</label></div>
      <div class="form-row"><label><input type="checkbox" class="pp-patro"> Patrocínio</label><label><input type="checkbox" class="pp-feminina"> Feminina</label></div>
      <div class="form-group"><label>Foto da camisa</label><input class="pp-foto" type="file" accept="image/*"></div>
      <button type="button" class="btn btn-danger btn-sm btn-rem">Remover</button>`;
      cont.appendChild(d);
      const prod=d.querySelector('.pp-prod'),v=d.querySelector('.pp-venda');
      const upd=()=>v.value=this.config.produtos[prod.value]?.venda||'';
      prod.onchange=upd;upd();d.querySelector('.btn-rem').onclick=()=>d.remove();
    };
    add();document.getElementById('btn-add-item').onclick=add;
    document.getElementById('pp-estoque').onchange=()=>{
      const wrap=document.getElementById('pp-cliente-wrap');
      wrap.style.display=document.getElementById('pp-estoque').checked?'none':'block';
    };
    document.getElementById('btn-salvar-pp').onclick=async()=>{
      try {
        const isEstoque=document.getElementById('pp-estoque').checked;
        const clienteId=document.getElementById('pp-cliente').value;
        if(!isEstoque && !clienteId)return this.toast('Selecione o cliente ou marque como estoque');
        if(!isEstoque && !clientes.length)return this.toast('Cadastre um cliente primeiro!');
        const itens=[];
        for(const card of cont.querySelectorAll('.item-card')){
          let fotoRef=null;
          try { fotoRef=await this.readFile(card.querySelector('.pp-foto').files[0]); } catch(e) {}
          itens.push({produto:card.querySelector('.pp-prod').value,tamanho:card.querySelector('.pp-tam').value,quantidade:Number(card.querySelector('.pp-qtd').value)||1,time:card.querySelector('.pp-time').value.trim(),valorVenda:Number(card.querySelector('.pp-venda').value)||0,desconto:Number(card.querySelector('.pp-desc').value)||0,dataVenda:card.querySelector('.pp-data-venda').value || new Date().toISOString().slice(0,10),personalizacao:card.querySelector('.pp-pers').checked,patch:card.querySelector('.pp-patch').checked,patrocinio:card.querySelector('.pp-patro').checked,feminina:card.querySelector('.pp-feminina').checked,fotoRef,isEstoque});
        }
        if(!itens.length)return this.toast('Adicione pelo menos uma peça');
        const ok=Storage.savePrePedido({clienteId:isEstoque?null:clienteId,isEstoque,itens,observacoes:document.getElementById('pp-obs').value.trim(),status:'aberto'});
        if(!ok && ok!==undefined) return this.toast('Erro ao salvar (memória cheia?). Tente sem foto.');
        this.closeModal();this.toast(isEstoque?'Pré-pedido de estoque salvo!':'Pré-pedido salvo!');this.render();
      } catch(err) {
        console.error(err);
        this.toast('Erro ao salvar pré-pedido: '+(err.message||err));
      }
    };
  },

  openPrePedidoDetail(id) {
    const pp=Storage.getPrePedido(id);if(!pp)return;
    const isEst=!!(pp.isEstoque||(pp.itens||[]).some(i=>i.isEstoque));
    const c=Storage.getCliente(pp.clienteId),q=Calc.totalPecas(pp.itens||[]),meta=Number(this.config.pedido?.quantidadeMinima||4);
    const isMauaCliente=!isEst && Calc.isMauaRegiao(c?.cidade||'');
    const lote=Storage.getPrePedidos().filter(x=>{
      if(x.status!=='aberto') return false;
      if(x.isEstoque||(x.itens||[]).some(i=>i.isEstoque)) return true;
      return Calc.isMauaRegiao(Storage.getCliente(x.clienteId)?.cidade||'');
    });
    const totalLote=lote.reduce((s,x)=>s+Calc.totalPecas(x.itens||[]),0);
    const temClienteMaua=lote.some(x=>!x.isEstoque && !(x.itens||[]).every(i=>i.isEstoque) && Calc.isMauaRegiao(Storage.getCliente(x.clienteId)?.cidade||''));
    // Com cliente Mauá no lote: precisa mínimo. Só estoque ou outra cidade: libera com 1
    const pode=temClienteMaua?totalLote>=meta:true;
    const local=isMauaCliente||isEst;
    this.openModal(isEst?`Pré-pedido — ESTOQUE`:`Pré-pedido — ${this.esc(c?.nome||'')}`,`
      <div class="card"><b>${isEst?'📦 ESTOQUE (sem cliente)':this.esc(c?.nome||'')}</b>${isEst?'':`<div class="list-item-sub">@${this.esc(c?.instagram||'')} • ${this.esc(c?.cidade||'')} • ${this.esc(c?.whatsapp||'')}</div>`}</div>
      <div class="section-title">Peças (${q})</div>
      ${(pp.itens||[]).map((i,idx)=>`<div class="item-card">${i.fotoRef?`<img src="${i.fotoRef}" class="photo-preview">`:''}<div class="row"><span>Produto</span><span>${this.esc(i.produto)}</span></div><div class="row"><span>Tamanho</span><span>${i.tamanho} × ${i.quantidade}</span></div><div class="row"><span>Modelo</span><span>${this.esc(i.time)}</span></div><div class="row"><span>Extras</span><span>${i.personalizacao?'Personalizada ':''}${i.patch?'Patch ':''}${i.patrocinio?'Patrocínio':''}</span></div><div class="row"><span>Desconto</span><span>${this.money(i.desconto)}</span></div></div>`).join('')}
      ${pode?'<button class="btn btn-success mt-12" id="btn-formar-pedido">📦 Efetuar pedido</button>':`<div class="card mt-12" style="border-color:var(--warning)"><p style="color:var(--warning)">Lote de Mauá + estoque: ${totalLote} de ${meta} peça(s). Faltam ${Math.max(0,meta-totalLote)}.</p></div>`}
      <button class="btn btn-danger mt-12" id="btn-excluir-prepedido">🗑 Apagar pré-pedido</button>`);
    if(pode)document.getElementById('btn-formar-pedido').onclick=()=>this.formarPedidoAPartirDoPre(id);
    document.getElementById('btn-excluir-prepedido').onclick=()=>{
      if(!confirm('Apagar este pré-pedido? As peças dele serão removidas da lista e não serão incluídas em um futuro pedido.')) return;
      Storage.deletePrePedido(id);
      this.closeModal();
      this.toast('Pré-pedido apagado.');
      this.render();
    };
  },

  // Formar pedido agrega pré-pedidos prontos para o fornecedor.
  formarPedidoAPartirDoPre(id) {
    try {
      const alvo = Storage.getPrePedido(id);
      if (!alvo) return this.toast('Pré-pedido não encontrado');
      if (alvo.status !== 'aberto') return this.toast('Este pré-pedido já foi convertido');

      const isEst = !!(alvo.isEstoque || (alvo.itens || []).some(i => i.isEstoque));
      const c = alvo.clienteId ? Storage.getCliente(alvo.clienteId) : null;
      const isMaua = !isEst && Calc.isMauaRegiao(c?.cidade || '');

      const abertos = Storage.getPrePedidos().filter(pp => pp.status === 'aberto');
      let selecionados = [];

      // Lote local = clientes Mauá + qualquer estoque aberto
      const loteLocal = abertos.filter(pp => {
        if (pp.isEstoque || (pp.itens || []).some(i => i.isEstoque)) return true;
        return Calc.isMauaRegiao(Storage.getCliente(pp.clienteId)?.cidade || '');
      });
      const totalLote = loteLocal.reduce((sum, pp) => sum + Calc.totalPecas(pp.itens || []), 0);
      const temClienteMaua = loteLocal.some(pp =>
        !pp.isEstoque &&
        !(pp.itens || []).every(i => i.isEstoque) &&
        Calc.isMauaRegiao(Storage.getCliente(pp.clienteId)?.cidade || '')
      );

      if (isMaua || isEst) {
        // Estoque e Mauá entram no mesmo lote
        selecionados = loteLocal;
        if (temClienteMaua && totalLote < 4) {
          return this.toast(`Ainda faltam ${4 - totalLote} peça(s) para fechar o lote (Mauá + estoque).`);
        }
        // Só estoque, sem cliente Mauá: pode com 1
        if (!selecionados.length) selecionados = [alvo];
      } else {
        // Outra cidade: só este pré-pedido
        selecionados = [alvo];
      }

      this.openModal('Formar pedido ao fornecedor', `
        <p class="list-item-sub">Serão agrupados <b>${selecionados.length}</b> pré-pedido(s) • <b>${selecionados.reduce((s,pp)=>s+Calc.totalPecas(pp.itens||[]),0)}</b> peça(s).</p>
        <div class="form-group"><label>Cotação do dólar (R$) *</label><input id="ped-cotacao" type="number" step="0.01" value="5.24"></div>
        <div class="card"><b>Pré-pedidos incluídos</b>${selecionados.map(pp => {
          const cc = pp.clienteId ? Storage.getCliente(pp.clienteId) : null;
          const est = !!(pp.isEstoque || (pp.itens || []).some(i => i.isEstoque));
          return `<div class="list-item-sub" style="margin-top:6px">• ${est ? '📦 ESTOQUE' : this.esc(cc?.nome || 'Cliente')} — ${Calc.totalPecas(pp.itens || [])} peça(s)</div>`;
        }).join('')}</div>
        <button class="btn btn-primary" id="btn-criar-pedido">Criar Pedido</button>`);

      document.getElementById('btn-criar-pedido').onclick = () => {
        try {
          const cotacao = Number(document.getElementById('ped-cotacao').value);
          if (!cotacao || cotacao <= 0) return this.toast('Informe uma cotação válida');

          const itens = [];
          selecionados.forEach(pp => {
            (pp.itens || []).forEach(i => {
              const prod = this.config.produtos[i.produto] || {};
              const adicionais = this.config.adicionais || {};
              let custoUnitarioUSD = Number(prod.custoUSD) || 0;
              if (i.personalizacao) custoUnitarioUSD += Number(adicionais['Personalização']) || 0;
              if (i.patch) custoUnitarioUSD += Number(adicionais['Patch']) || 0;
              if (i.patrocinio) custoUnitarioUSD += Number(adicionais['Patrocínio']) || 0;
              const tam = String(i.tamanho || '').toUpperCase();
              if (tam === '2XL' || tam === '2GG') custoUnitarioUSD += Number(adicionais['2XL']) || 0;
              if (tam === '3XL' || tam === '3GG') custoUnitarioUSD += Number(adicionais['3XL']) || 0;
              if (tam === '4XL' || tam === '4GG') custoUnitarioUSD += Number(adicionais['4XL']) || 0;

              const qtd = Math.max(1, Number(i.quantidade) || 1);
              const vendaAdicionais =
                (i.personalizacao ? Number(this.config.vendaAdicionais?.Personalização) || 0 : 0) +
                (i.patch ? Number(this.config.vendaAdicionais?.Patch) || 0 : 0) +
                (i.patrocinio ? Number(this.config.vendaAdicionais?.Patrocínio) || 0 : 0);

              itens.push({
                ...i,
                clienteId: pp.clienteId || null,
                isEstoque: !!(pp.isEstoque || i.isEstoque),
                statusEntrega: 'pendente',
                entrega: null,
                custoUnitarioUSD,
                custoTotalUSD: custoUnitarioUSD * qtd,
                valorVendaBase: Number(i.valorVenda) || 0,
                vendaAdicionaisSnapshot: vendaAdicionais,
                criadoNoPedidoEm: new Date().toISOString()
              });
            });
          });

          if (!itens.length) return this.toast('Nenhuma peça para criar o pedido');

          const totalUSD = Calc.totalUSD(itens, this.config);
          const frete = Calc.freteFornecedorUSD(Calc.totalPecas(itens), this.config);
          const clienteIds = [...new Set(selecionados.map(x => x.clienteId).filter(Boolean))];

          const pedido = {
            prePedidoIds: selecionados.map(x => x.id),
            clienteIds,
            itens,
            cotacao,
            freteFornecedorUSD: frete,
            totalUSD,
            impostoBRL: null,
            status: 'realizado',
            fotoFornecedor: null,
            fotosFornecedor: [],
            dataFotoFornecedor: null,
            registradoCorreios: false,
            dataVenda: new Date().toISOString(),
            createdAt: new Date().toISOString()
          };

          const salvo = Storage.savePedido(pedido);
          selecionados.forEach(pp => {
            pp.status = 'convertido';
            Storage.savePrePedido(pp);
          });

          this.closeModal();
          this.toast(`Pedido #${salvo.numero} criado com ${itens.length} peça(s)!`);
          this.currentScreen = 'pedidos';
          document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
          const navPed = document.querySelector('[data-screen="pedidos"]');
          if (navPed) navPed.classList.add('active');
          this.render();
        } catch (err) {
          console.error(err);
          this.toast('Erro ao criar pedido: ' + (err.message || err));
        }
      };
    } catch (err) {
      console.error(err);
      this.toast('Erro: ' + (err.message || err));
    }
  },

  // ---------- PEDIDOS ----------
  renderPedidos() {
    const ps=Storage.getPedidos().sort((a,b)=>(b.numero||0)-(a.numero||0));
    const labels={realizado:'Realizado',enviado:'Enviado',imposto_pago:'Imposto pago',em_transito:'Em trânsito',recebido:'Recebido',entregue:'Entregue'};
    return `<div class="screen-header"><div><h2>Pedidos</h2><div class="list-item-sub">Pedidos enviados ao fornecedor</div></div></div>
      ${ps.length?ps.map(p=>{const nomes=(p.clienteIds||[p.clienteId]).map(id=>Storage.getCliente(id)?.nome).filter(Boolean).join(', ');return `<div class="list-item" data-pedido="${p.id}"><div class="list-item-info"><div class="list-item-title">Pedido #${p.numero}</div><div class="list-item-sub">${this.esc(nomes||(p.itens||[]).some(i=>i.isEstoque)?'ESTOQUE':'Cliente')} • ${Calc.totalPecas(p.itens||[])} peça(s) • ${this.money(p.itens?.reduce((s,i)=>s+this.itemSale(i,p).final,0)||0)}${p.codigoRastreio?' • 📦 '+p.codigoRastreio:''}</div></div><span class="badge ${p.status==='recebido'?'badge-success':p.status==='entregue'?'badge-success':'badge-cyan'}">${labels[p.status]||p.status}</span></div>`}).join(''):`<div class="empty"><div class="icon">📦</div><p>Nenhum pedido ainda</p></div>`}`;
  },

  openUnirPedido(idBase) {
    const base = Storage.getPedido(idBase);
    if (!base) return;
    const outros = Storage.getPedidos().filter(p => p.id !== idBase).sort((a,b)=>(b.numero||0)-(a.numero||0));
    if (!outros.length) return this.toast('Não há outro pedido para unir');
    this.openModal(`Unir Pedido #${base.numero} com…`, `
      <p class="list-item-sub mb-12">As peças do pedido escolhido vão para o <b>#${base.numero}</b>. O outro pedido será apagado. Frete fica um só.</p>
      <div class="form-group"><label>Unir com o pedido</label>
        <select id="unir-alvo">
          ${outros.map(p=>{
            const nomes=(p.clienteIds||[p.clienteId]).map(cid=>Storage.getCliente(cid)?.nome).filter(Boolean).join(', ');
            const est=(p.itens||[]).some(i=>i.isEstoque)?' + estoque':'';
            return `<option value="${p.id}">#${p.numero} — ${this.esc(nomes||'Sem cliente')}${est} — ${Calc.totalPecas(p.itens||[])} peça(s)</option>`;
          }).join('')}
        </select>
      </div>
      <div class="card" id="unir-resumo"></div>
      <button class="btn btn-primary" id="btn-confirmar-unir">🔗 Confirmar união</button>
      <button class="btn btn-secondary mt-12" id="btn-cancelar-unir">Voltar</button>`);
    const resumo=()=>{
      const outro=Storage.getPedido(document.getElementById('unir-alvo').value);
      if(!outro)return;
      const totalPecas=Calc.totalPecas(base.itens||[])+Calc.totalPecas(outro.itens||[]);
      const frete=Calc.freteFornecedorUSD(totalPecas,this.config);
      const imp=(Number(base.impostoBRL)||0)+(Number(outro.impostoBRL)||0);
      document.getElementById('unir-resumo').innerHTML=`
        <b>Resultado</b>
        <div class="list-item-sub" style="margin-top:6px">
          Peças: ${totalPecas}<br>
          Frete único estimado: ${Calc.formatUSD(frete)}<br>
          Imposto somado: ${this.money(imp||0)} ${(!base.impostoBRL&&!outro.impostoBRL)?'(nenhum lançado ainda)':''}<br>
          Pedido #${outro.numero} será removido após unir
        </div>`;
    };
    resumo();
    document.getElementById('unir-alvo').onchange=resumo;
    document.getElementById('btn-cancelar-unir').onclick=()=>this.openPedidoDetail(idBase);
    document.getElementById('btn-confirmar-unir').onclick=()=>{
      const outro=Storage.getPedido(document.getElementById('unir-alvo').value);
      if(!outro)return this.toast('Pedido inválido');
      if(!confirm(`Unir #${base.numero} + #${outro.numero}? O pedido #${outro.numero} será apagado.`)) return;

      // Merge items
      const itens=[...(base.itens||[]),...(outro.itens||[])];
      base.itens=itens;

      // Merge client ids
      const ids=new Set([...(base.clienteIds||[]), base.clienteId, ...(outro.clienteIds||[]), outro.clienteId].filter(Boolean));
      base.clienteIds=[...ids];
      if(!base.clienteId && outro.clienteId) base.clienteId=outro.clienteId;

      // Merge prePedido ids
      base.prePedidoIds=[...(base.prePedidoIds||[]),...(outro.prePedidoIds||[])];

      // Freight: one package
      base.freteFornecedorUSD=Calc.freteFornecedorUSD(Calc.totalPecas(itens),this.config);
      base.totalUSD=Calc.totalUSD(itens,this.config);

      // Tax: sum if both have values
      if(base.impostoBRL!=null || outro.impostoBRL!=null){
        base.impostoBRL=(Number(base.impostoBRL)||0)+(Number(outro.impostoBRL)||0);
        base.dataImpostoPago=base.dataImpostoPago||outro.dataImpostoPago||new Date().toISOString();
      }

      // Cotação: keep base, or use the one that exists
      if(!base.cotacao && outro.cotacao) base.cotacao=outro.cotacao;

      // Tracking: keep if only one has it, or prefer base
      if(!base.codigoRastreio && outro.codigoRastreio) base.codigoRastreio=outro.codigoRastreio;

      // Photos
      base.fotosFornecedor=[...(base.fotosFornecedor||[]),...(outro.fotosFornecedor||[])];
      if(!base.fotoFornecedor && outro.fotoFornecedor) base.fotoFornecedor=outro.fotoFornecedor;

      // Status: keep the more advanced one
      const ordem=['realizado','enviado','imposto_pago','em_transito','recebido','entregue'];
      const iB=ordem.indexOf(base.status), iO=ordem.indexOf(outro.status);
      if(iO>iB) base.status=outro.status;

      base.observacaoUniao=(base.observacaoUniao||'')+` Unido com #${outro.numero} em ${new Date().toLocaleDateString('pt-BR')}.`;

      Storage.savePedido(base);
      Storage.deletePedido(outro.id);
      this.toast(`Pedidos #${base.numero} + #${outro.numero} unidos!`);
      this.openPedidoDetail(idBase);
    };
  },

  openPedidoEdit(id) {
    const p = Storage.getPedido(id);
    if (!p) return;
    const produtos = Object.keys(this.config.produtos || {});
    const tamanhos = ['P','M','G','GG','2XL','3XL','4XL'];
    const itens = p.itens || [];
    const rows = itens.map((i,idx) => {
      const cliente = Storage.getCliente(i.clienteId);
      const unit = Number(i.valorVendaBase ?? i.valorVenda ?? this.config.produtos[i.produto]?.venda ?? 0);
      return `<div class="item-card" data-edit-item="${idx}">
        <div class="list-item-sub mb-12">Peça ${idx+1} • ${this.esc(cliente?.nome || 'Cliente')}</div>
        <div class="form-group"><label>Modelo base</label><select data-edit-prod="${idx}">${produtos.map(x=>`<option value="${this.esc(x)}" ${i.produto===x?'selected':''}>${this.esc(x)}</option>`).join('')}</select></div>
        <div class="form-row"><div class="form-group"><label>Tamanho</label><select data-edit-tam="${idx}">${tamanhos.map(x=>`<option ${i.tamanho===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="form-group"><label>Quantidade</label><input data-edit-qtd="${idx}" type="number" min="1" step="1" value="${Number(i.quantidade)||1}"></div></div>
        <div class="form-group"><label>Time / Modelo</label><input data-edit-time="${idx}" value="${this.esc(i.time||'')}"></div>
        <div class="form-row"><div class="form-group"><label>Preço de venda por unidade (R$)</label><input data-edit-preco="${idx}" type="number" min="0" step="0.01" value="${unit}"></div><div class="form-group"><label>Desconto total desta peça (R$)</label><input data-edit-desc="${idx}" type="number" min="0" step="0.01" value="${Number(i.desconto)||0}"></div></div>
        <div class="form-group"><label>Data da venda / registro</label><input data-edit-data="${idx}" type="date" value="${(i.dataVenda||'').toString().slice(0,10)}"></div>
        <div class="form-group"><label><input type="checkbox" data-edit-estoque="${idx}" ${i.isEstoque?'checked':''}> É estoque</label></div>
      </div>`;
    }).join('');
    this.openModal(`Editar Pedido #${p.numero}`, `
      <div class="card"><b>⚠️ Alteração do pedido</b><div class="list-item-sub">O preço acima é <b>por unidade</b>. O desconto é o valor total desta linha.</div></div>
      ${rows}
      <div class="form-row"><div class="form-group"><label>Cotação (R$/US$)</label><input id="edit-ped-cot" type="number" step="0.01" value="${Number(p.cotacao)||5.24}"></div><div class="form-group"><label>Frete fornecedor (US$)</label><input id="edit-ped-frete" type="number" step="0.01" value="${Number(p.freteFornecedorUSD)||0}"></div></div>
      <button class="btn btn-primary" id="btn-save-ped-edit">Salvar alterações</button>
      <button class="btn btn-danger mt-12" id="btn-delete-ped-edit">🗑 Excluir pedido inteiro</button>
    `);
    document.getElementById('btn-save-ped-edit').onclick=()=>{
      document.querySelectorAll('[data-edit-item]').forEach(card=>{
        const idx=Number(card.dataset.editItem), i=p.itens[idx];
        i.produto=document.querySelector(`[data-edit-prod="${idx}"]`).value;
        i.tamanho=document.querySelector(`[data-edit-tam="${idx}"]`).value;
        i.quantidade=Math.max(1,Number(document.querySelector(`[data-edit-qtd="${idx}"]`).value)||1);
        i.time=document.querySelector(`[data-edit-time="${idx}"]`).value.trim();
        i.valorVendaBase=Math.max(0,Number(document.querySelector(`[data-edit-preco="${idx}"]`).value)||0);
        i.valorVenda=i.valorVendaBase;
        i.desconto=Math.max(0,Number(document.querySelector(`[data-edit-desc="${idx}"]`).value)||0);
        const dataEl=document.querySelector(`[data-edit-data="${idx}"]`);
        if(dataEl && dataEl.value) i.dataVenda=dataEl.value;
        const estEl=document.querySelector(`[data-edit-estoque="${idx}"]`);
        if(estEl) i.isEstoque=estEl.checked;
        const prod=this.config.produtos[i.produto]||{};
        let usd=Number(prod.custoUSD)||0;
        const ad=this.config.adicionais||{};
        if(i.personalizacao) usd+=Number(ad['Personalização'])||0;
        if(i.patch) usd+=Number(ad['Patch'])||0;
        if(i.patrocinio) usd+=Number(ad['Patrocínio'])||0;
        const tam=String(i.tamanho||'').toUpperCase();
        if(tam==='2XL') usd+=Number(ad['2XL'])||0;
        if(tam==='3XL') usd+=Number(ad['3XL'])||0;
        if(tam==='4XL') usd+=Number(ad['4XL'])||0;
        i.custoUnitarioUSD=usd; i.custoTotalUSD=usd*i.quantidade;
      });
      p.cotacao=Number(document.getElementById('edit-ped-cot').value)||p.cotacao||5.24;
      p.freteFornecedorUSD=Math.max(0,Number(document.getElementById('edit-ped-frete').value)||0);
      p.totalUSD=Calc.totalUSD(p.itens,this.config);
      Storage.savePedido(p);
      this.toast('Pedido atualizado');
      this.openPedidoDetail(id);
    };
    document.getElementById('btn-delete-ped-edit').onclick=()=>{
      if(!confirm(`Excluir o Pedido #${p.numero} inteiro? Essa ação não apaga os clientes.`)) return;
      Storage.deletePedido(id);
      this.closeModal();
      this.toast(`Pedido #${p.numero} excluído`);
      this.render();
    };
  },

  openPedidoDetail(id) {
    const p=Storage.getPedido(id);if(!p)return;
    const clientes=[...(p.clienteIds||[p.clienteId])].map(id=>Storage.getCliente(id)).filter(Boolean);
    const statusOptions=[['realizado','Realizado'],['enviado','Enviado'],['imposto_pago','Imposto pago'],['em_transito','Em trânsito'],['recebido','Recebido'],['entregue','Entregue']];
    const renderTotals=()=>{
      let venda=0,custo=0; (p.itens||[]).forEach(i=>{venda+=this.itemSale(i,p).final;custo+=this.itemCost(i,p);});
      return {venda,custo,lucro:venda-custo,margem:Calc.margem(venda-custo,venda)};
    };
    const t=renderTotals();
    this.openModal(`Pedido #${p.numero}`,`
      <div class="form-row" style="flex-wrap:wrap;gap:8px">
        <button class="btn btn-secondary btn-sm" id="btn-edit-pedido">✏️ Editar</button>
        <button class="btn btn-secondary btn-sm" id="btn-unir-pedido">🔗 Unir com…</button>
        <button class="btn btn-danger btn-sm" id="btn-delete-pedido">🗑 Excluir</button>
      </div>
      <div class="card"><b>${clientes.map(c=>this.esc(c.nome)).join(', ')}</b><div class="list-item-sub">${clientes.map(c=>this.esc(c.cidade)).join(' • ')}</div></div>
      <div class="stat-grid"><div class="stat"><div class="stat-value">${this.money(t.venda)}</div><div class="stat-label">Venda líquida</div></div><div class="stat"><div class="stat-value">${this.money(t.custo)}</div><div class="stat-label">Custo real</div></div><div class="stat"><div class="stat-value" style="color:${t.lucro>=0?'var(--success)':'var(--danger)'}">${this.money(t.lucro)}</div><div class="stat-label">Lucro</div></div><div class="stat"><div class="stat-value">${t.margem.toFixed(1)}%</div><div class="stat-label">Margem</div></div></div>
      <div class="section-title">Etapa do pedido</div>
      <div class="form-group"><select id="ped-status">${statusOptions.map(x=>`<option value="${x[0]}" ${p.status===x[0]?'selected':''}>${x[1]}</option>`).join('')}</select></div>
      <button class="btn btn-secondary btn-sm mb-12" id="btn-status">Salvar etapa</button>
      <div class="form-row"><div class="form-group"><label>Cotação</label><input value="R$ ${(p.cotacao||0).toFixed(2)}" disabled></div><div class="form-group"><label>Frete fornecedor</label><input value="${this.config ? Calc.formatUSD(p.freteFornecedorUSD||0):''}" disabled></div></div>
      <div class="form-group"><label>Código de rastreio (Correios)</label><input id="ped-rastreio" type="text" value="${this.esc(p.codigoRastreio||'')}" placeholder="Ex.: AB123456789BR" style="text-transform:uppercase"></div>
      <div class="form-row" style="margin-bottom:12px">
        <button class="btn btn-secondary btn-sm" id="btn-salvar-rastreio">Salvar rastreio</button>
        ${p.codigoRastreio?`<a class="btn btn-primary btn-sm" id="btn-abrir-rastreio" href="https://www.linkcorreios.com.br/?id=${encodeURIComponent(p.codigoRastreio)}" target="_blank" rel="noopener">📦 Rastrear nos Correios</a>`:''}
      </div>
      <div class="form-group"><label>Imposto total pago (R$)</label><input id="ped-imposto" type="number" step="0.01" value="${p.impostoBRL??''}" placeholder="Ex.: 167,00"></div>
      ${p.dataImpostoPago?`<div class="list-item-sub mb-12">Imposto pago em ${new Date(p.dataImpostoPago).toLocaleDateString('pt-BR')} • previsão de chegada em ${(() => { const d=new Date(p.dataImpostoPago); d.setDate(d.getDate()+Number(this.config.pedido?.diasEstimadosAposImposto||7)); return d.toLocaleDateString('pt-BR'); })()}</div>`:''}
      <button class="btn btn-secondary btn-sm mb-12" id="btn-imposto">Salvar imposto e ratear</button>
      <div class="section-title">📸 Fotos de confirmação do fornecedor</div>
      <div class="photo-upload" id="ped-photo-area"><p>📷 Anexar foto</p><input id="ped-photo" type="file" accept="image/*" style="display:none"></div>
      ${(p.fotosFornecedor||[]).map((src,i)=>`<div class="item-card"><img src="${src}" class="photo-preview"><button class="btn btn-danger btn-sm mt-8" data-del-photo="${i}">Remover foto</button></div>`).join('')}
      <div class="section-title">👕 Peças / clientes / entrega</div>
      ${(p.itens||[]).map((i,idx)=>{
        const c=Storage.getCliente(i.clienteId),sale=this.itemSale(i,p),cost=this.itemCost(i,p),lucro=sale.final-cost;
        return `<div class="item-card">
          ${i.fotoRef?`<img src="${i.fotoRef}" class="photo-preview">`:''}
          <div class="row"><span>Cliente</span><span>${this.esc(c?.nome||'')}</span></div>
          <div class="row"><span>Peça</span><span>${this.esc(i.time||i.produto)} — ${i.tamanho}</span></div>
          <div class="row"><span>Venda</span><span>${this.money(sale.final)} ${i.desconto?`(desc. ${this.money(i.desconto)})`:''}</span></div>
          <div class="row"><span>Custo real</span><span>${this.money(cost)}</span></div>
          <div class="row"><span>Lucro</span><span style="color:${lucro>=0?'var(--success)':'var(--danger)'}">${this.money(lucro)}</span></div>
          <div class="section-title" style="margin-top:12px">💰 Pagamento / sinal</div>
          <div class="form-row">
            <div class="form-group"><label>Valor total (venda)</label><input value="${sale.final.toFixed(2)}" disabled></div>
            <div class="form-group"><label>Já pago / sinal (R$)</label><input data-item-pago="${idx}" type="number" step="0.01" min="0" value="${Number(i.valorPago)||0}"></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>Forma de pagamento</label>
              <select data-item-pag="${idx}">
                <option value="">Selecione</option>
                ${['Pix','Dinheiro','Cartão crédito 1x','Cartão crédito 2x','Cartão crédito 3x','Cartão débito','Sinal + resto','A combinar'].map(o=>`<option ${i.formaPagamento===o?'selected':''}>${o}</option>`).join('')}
              </select>
            </div>
            <div class="form-group"><label>Prazo do restante</label><input data-item-prazo="${idx}" type="date" value="${(i.prazoRestante||'').toString().slice(0,10)}"></div>
          </div>
          <div class="card" style="margin-bottom:10px"><span class="list-item-sub">Restante:</span> <b>${this.money(Math.max(0, sale.final - (Number(i.valorPago)||0)))}</b>
            ${(Number(i.valorPago)||0)>0 && (Number(i.valorPago)||0)<sale.final?' <span class="badge badge-warning">Em aberto</span>':''}
            ${(Number(i.valorPago)||0)>=sale.final && sale.final>0?' <span class="badge badge-success">Quitado</span>':''}
          </div>
          <div class="form-group"><label>Status da entrega</label><select data-item-status="${idx}"><option value="pendente" ${i.statusEntrega!=='entregue'?'selected':''}>Aguardando entrega</option><option value="entregue" ${i.statusEntrega==='entregue'?'selected':''}>Entregue</option></select></div>
          <div class="form-row"><div class="form-group"><label>Como entregou?</label><select data-item-metodo="${idx}"><option value="">Selecione</option><option ${i.entrega?.metodo==='Uber'?'selected':''}>Uber</option><option ${i.entrega?.metodo==='Pessoal'?'selected':''}>Pessoalmente</option><option ${i.entrega?.metodo==='Terceiro'?'selected':''}>Terceiro</option><option ${i.entrega?.metodo==='Correios'?'selected':''}>Correios</option></select></div><div class="form-group"><label>Custo entrega (R$)</label><input data-item-custo="${idx}" type="number" step="0.01" value="${i.entrega?.custo||0}"></div></div><div class="form-group"><label>Sacola / embalagem (R$)</label><input data-item-emb="${idx}" type="number" step="0.01" value="${i.embalagemCusto??2}"></div>
          <button class="btn btn-primary btn-sm" data-save-item="${idx}">Salvar pagamento e entrega</button>
        </div>`;
      }).join('')}`);
    document.getElementById('btn-edit-pedido').onclick=()=>this.openPedidoEdit(id);
    document.getElementById('btn-unir-pedido').onclick=()=>this.openUnirPedido(id);
    document.getElementById('btn-delete-pedido').onclick=()=>{ if(!confirm(`Excluir o Pedido #${p.numero} inteiro? Essa ação não apaga os clientes.`)) return; Storage.deletePedido(id); this.closeModal(); this.toast(`Pedido #${p.numero} excluído`); this.render(); };
    document.getElementById('btn-status').onclick=()=>{
      p.status=document.getElementById('ped-status').value;
      if(p.status==='imposto_pago' && !p.dataImpostoPago)p.dataImpostoPago=new Date().toISOString();
      if(p.status==='recebido' && !p.dataRecebimento)p.dataRecebimento=new Date().toISOString();
      Storage.savePedido(p);
      if(p.status==='recebido') this.syncEstoqueFromPedido(p);
      this.toast(p.status==='recebido'?'Etapa atualizada • Estoque sincronizado':'Etapa atualizada');
      this.openPedidoDetail(id);
    };
    const btnRast=document.getElementById('btn-salvar-rastreio');
    if(btnRast)btnRast.onclick=()=>{
      const cod=(document.getElementById('ped-rastreio').value||'').trim().toUpperCase();
      p.codigoRastreio=cod||null;
      Storage.savePedido(p);
      this.toast(cod?'Rastreio salvo!':'Rastreio removido');
      this.openPedidoDetail(id);
    };
    document.getElementById('btn-imposto').onclick=()=>{
      const raw=document.getElementById('ped-imposto').value;
      if(raw==='')return this.toast('Informe o valor do imposto pago');
      const v=Number(raw);
      if(v<0||isNaN(v))return this.toast('Imposto inválido');
      p.impostoBRL=v;
      p.dataImpostoPago=p.dataImpostoPago||new Date().toISOString();
      if(['enviado','realizado'].includes(p.status))p.status='imposto_pago';
      Storage.savePedido(p);
      this.toast('Imposto salvo. O rateio foi recalculado por valor USD.');
      this.openPedidoDetail(id);
    };
    const pa=document.getElementById('ped-photo-area'),pi=document.getElementById('ped-photo');pa.onclick=()=>pi.click();pi.onchange=async()=>{const src=await this.readFile(pi.files[0]);if(src){p.fotosFornecedor=p.fotosFornecedor||[];p.fotosFornecedor.push(src);p.fotoFornecedor=src;p.dataFotoFornecedor=new Date().toISOString();if(p.status==='realizado')p.status='enviado';Storage.savePedido(p);this.toast('Foto anexada');this.openPedidoDetail(id);}};
    document.querySelectorAll('[data-del-photo]').forEach(b=>b.onclick=()=>{p.fotosFornecedor.splice(Number(b.dataset.delPhoto),1);p.fotoFornecedor=p.fotosFornecedor.at(-1)||null;Storage.savePedido(p);this.openPedidoDetail(id);});
    document.querySelectorAll('[data-save-item]').forEach(b=>b.onclick=()=>{
      const idx=Number(b.dataset.saveItem);
      const item=p.itens[idx];
      const sale=this.itemSale(item,p);
      const metodo=document.querySelector(`[data-item-metodo="${idx}"]`).value;
      const custo=Number(document.querySelector(`[data-item-custo="${idx}"]`).value)||0;
      const embalagem=Number(document.querySelector(`[data-item-emb="${idx}"]`).value)||0;
      const status=document.querySelector(`[data-item-status="${idx}"]`).value;
      const pago=Number(document.querySelector(`[data-item-pago="${idx}"]`).value)||0;
      const pag=document.querySelector(`[data-item-pag="${idx}"]`).value;
      const prazo=document.querySelector(`[data-item-prazo="${idx}"]`).value;
      item.statusEntrega=status;
      item.entrega={metodo,custo,data:status==='entregue'?new Date().toISOString():item.entrega?.data};
      item.embalagemCusto=embalagem;
      item.valorPago=pago;
      item.formaPagamento=pag||null;
      item.prazoRestante=prazo||null;
      if(status==='entregue')item.dataVenda=item.dataVenda||new Date().toISOString();
      Storage.savePedido(p);
      this.syncDevedorFromPedidoItem(p, idx, sale.final);
      this.toast('Pagamento e entrega salvos');
      this.openPedidoDetail(id);
    });
  },

  // Cria/atualiza/quita devedor a partir do sinal do pedido
  syncDevedorFromPedidoItem(p, idx, valorTotal) {
    const item = p.itens[idx];
    if (!item || item.isEstoque) return; // estoque não gera devedor de cliente aqui
    const cli = Storage.getCliente(item.clienteId);
    const pago = Number(item.valorPago) || 0;
    const total = Number(valorTotal) || 0;
    const rest = Math.max(0, total - pago);
    const linkId = `ped-${p.id}-item-${idx}`;
    const lista = Storage.getDevedores();
    let d = lista.find(x => x.linkId === linkId);

    if (rest <= 0.01) {
      // Quitado: marca pago ou remove se nunca existiu dívida real
      if (d) {
        d.status = 'pago';
        d.valorPago = total;
        d.valorRestante = 0;
        d.pagoEm = new Date().toISOString();
        Storage.saveDevedor(d);
      }
      return;
    }

    // Ainda deve
    if (!d) d = { linkId };
    d.clienteId = item.clienteId || null;
    d.clienteNome = cli?.nome || 'Cliente';
    d.descricao = `Pedido #${p.numero} — ${item.time || item.produto} ${item.tamanho || ''}`;
    d.valorTotal = total;
    d.valorPago = pago;
    d.valorRestante = rest;
    d.prazo = item.prazoRestante || null;
    d.status = 'aberto';
    d.origem = 'pedido';
    d.pedidoId = p.id;
    d.pedidoNumero = p.numero;
    Storage.saveDevedor(d);
  },



  openCompartilharEstoque() {
    const all=Storage.getEstoque().filter(x=>Number(x.quantidade)>0);
    const times=[...new Set(all.map(x=>x.time||x.produto).filter(Boolean))].sort();
    const tabelas=Storage.getTabelaMedidas();
    this.openModal('Compartilhar estoque',`
      <div class="form-group"><label>Filtrar por time / modelo</label>
        <select id="share-time"><option value="">Todos</option>${times.map(t=>`<option>${this.esc(t)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Tabela de medidas</label>
        <select id="share-medidas"><option value="">Nenhuma</option>${tabelas.map(t=>`<option value="${t.id}">${this.esc(t.nome)}</option>`).join('')}</select>
      </div>
      <div class="card" id="share-preview" style="white-space:pre-wrap;font-size:13px;max-height:220px;overflow:auto"></div>
      <button class="btn btn-primary" id="btn-share-wa">📤 Abrir no WhatsApp</button>
      <button class="btn btn-secondary mt-12" id="btn-share-copy">Copiar texto</button>`);
    const build=()=>{
      const filtro=document.getElementById('share-time').value;
      let items=filtro?all.filter(x=>(x.time||x.produto)===filtro):all;
      const map={};
      items.forEach(x=>{
        const key=(x.time||'')+'|'+(x.produto||'');
        if(!map[key]) map[key]={time:x.time,produto:x.produto,preco:x.precoVenda,tams:{}};
        map[key].tams[x.tamanho]=(map[key].tams[x.tamanho]||0)+(Number(x.quantidade)||0);
      });
      let txt='🔥 *PRONTA ENTREGA — Impondo Imports*\n\n';
      Object.values(map).forEach(g=>{
        txt+='*'+((g.time||g.produto)||'')+'*'+(g.time&&g.produto?' ('+g.produto+')':'')+'\n';
        txt+='Tamanhos: '+Object.entries(g.tams).map(([t,q])=>t+': '+q).join(' | ')+'\n';
        if(g.preco) txt+='R$ '+Number(g.preco).toFixed(2)+'\n';
        txt+='\n';
      });
      const tmId=document.getElementById('share-medidas').value;
      if(tmId){
        const tab=tabelas.find(t=>t.id===tmId);
        if(tab){
          txt+='\n📏 *Guia de medidas — '+(tab.nome||'')+'*\n';
          txt+=(tab.texto||'(Consulte a tabela de medidas)')+'\n';
        }
      }
      txt+='\nInteressou? Me chama! ⚽';
      document.getElementById('share-preview').textContent=txt;
      return txt;
    };
    build();
    document.getElementById('share-time').onchange=build;
    document.getElementById('share-medidas').onchange=build;
    document.getElementById('btn-share-wa').onclick=()=>window.open('https://wa.me/?text='+encodeURIComponent(build()),'_blank');
    document.getElementById('btn-share-copy').onclick=async()=>{try{await navigator.clipboard.writeText(build());this.toast('Copiado!');}catch(e){this.toast('Falha ao copiar');}};
  },

  openTabelaMedidas() {
    const lista = Storage.getTabelaMedidas();
    this.openModal('Tabelas de medidas',`
      <p class="list-item-sub mb-12">Cadastre uma tabela por tipo de produto (Torcedor, Jogador, Infantil, Feminino…).</p>
      <button class="btn btn-primary btn-sm mb-12" id="btn-nova-tm">+ Nova tabela</button>
      ${lista.length?lista.map(t=>`
        <div class="list-item">
          <div class="list-item-info">
            <div class="list-item-title">${this.esc(t.nome||'Sem nome')}</div>
            <div class="list-item-sub">${t.texto?(t.texto.slice(0,60)+'…'):'Sem texto'}${t.imagem?' • com foto':''}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <button class="btn btn-secondary btn-sm" data-edit-tm="${t.id}">Editar</button>
            <button class="btn btn-danger btn-sm" data-del-tm="${t.id}">Excluir</button>
          </div>
        </div>`).join(''):`<div class="empty"><div class="icon">📏</div><p>Nenhuma tabela ainda</p></div>`}`);
    document.getElementById('btn-nova-tm').onclick=()=>this.openEditarTabelaMedida(null);
    document.querySelectorAll('[data-edit-tm]').forEach(b=>b.onclick=()=>this.openEditarTabelaMedida(b.dataset.editTm));
    document.querySelectorAll('[data-del-tm]').forEach(b=>b.onclick=()=>{
      if(confirm('Excluir esta tabela?')){Storage.deleteTabelaMedida(b.dataset.delTm);this.openTabelaMedidas();}
    });
  },

  openEditarTabelaMedida(id) {
    const lista = Storage.getTabelaMedidas();
    const old = id ? lista.find(x=>x.id===id) : null;
    const sugestoes = ['Torcedor / Fã','Jogador','Infantil','Feminino','Retrô','NBA','NFL','Geral'];
    this.openModal(old?'Editar tabela':'Nova tabela de medidas',`
      <div class="form-group"><label>Nome / tipo</label>
        <input id="tm-nome" list="tm-sugestoes" value="${this.esc(old?.nome||'')}" placeholder="Ex.: Torcedor, Jogador, Infantil…">
        <datalist id="tm-sugestoes">${sugestoes.map(x=>`<option value="${x}">`).join('')}</datalist>
      </div>
      <div class="form-group"><label>Texto do guia</label><textarea id="tm-texto" rows="5" placeholder="Ex.: P 48-50cm peito / M 50-52cm…">${this.esc(old?.texto||'')}</textarea></div>
      <div class="form-group"><label>Foto da tabela</label><input id="tm-foto" type="file" accept="image/*">${old?.imagem?`<img src="${old.imagem}" class="photo-preview">`:''}</div>
      <button class="btn btn-primary" id="btn-salvar-tm">Salvar</button>`);
    document.getElementById('btn-salvar-tm').onclick=async()=>{
      const nome=document.getElementById('tm-nome').value.trim();
      if(!nome)return this.toast('Informe o nome da tabela');
      const f=document.getElementById('tm-foto').files[0];
      Storage.saveUmaTabelaMedida({
        id:old?.id,
        nome,
        texto:document.getElementById('tm-texto').value.trim(),
        imagem:f?await this.readFile(f):(old?.imagem||null)
      });
      this.toast('Tabela salva!');this.openTabelaMedidas();
    };
  },

  renderDevedores() {
    const lista=Storage.getDevedores().sort((a,b)=>(a.status==='aberto'?0:1)-(b.status==='aberto'?0:1));
    const abertos=lista.filter(d=>d.status==='aberto');
    const totalAberto=abertos.reduce((s,d)=>s+(Number(d.valorRestante)||0),0);
    return `<div class="screen-header"><div><h2>Devedores</h2><div class="list-item-sub">Sinais e valores em aberto</div></div>
      <button class="btn btn-primary btn-sm" id="btn-novo-dev">+ Registrar</button></div>
      <div class="stat-grid">
        <div class="stat"><div class="stat-value">${abertos.length}</div><div class="stat-label">Em aberto</div></div>
        <div class="stat"><div class="stat-value">${this.money(totalAberto)}</div><div class="stat-label">A receber</div></div>
      </div>
      ${lista.length?lista.map(d=>`
        <div class="list-item ${d.status==='aberto'?'pendencia':''}">
          <div class="list-item-info">
            <div class="list-item-title">${this.esc(d.clienteNome||'Cliente')}</div>
            <div class="list-item-sub">${this.esc(d.descricao||'')} • Restante ${this.money(d.valorRestante)}${d.prazo?' • Prazo '+new Date(d.prazo+'T12:00:00').toLocaleDateString('pt-BR'):''}${d.origem==='pedido'&&d.pedidoNumero?' • Ped. #'+d.pedidoNumero:''}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
            <span class="badge ${d.status==='aberto'?'badge-warning':'badge-success'}">${d.status==='aberto'?'Em aberto':'Pago'}</span>
            ${d.status==='aberto'?`<button class="btn btn-success btn-sm" data-quitar-dev="${d.id}">Quitar</button>`:''}
            <button class="btn btn-danger btn-sm" data-excluir-dev="${d.id}">Excluir</button>
          </div>
        </div>`).join(''):`<div class="empty"><div class="icon">💳</div><p>Nenhum devedor</p></div>`}`;
  },

  openDevedores() {
    // Compat: botão antigo no estoque leva pra aba
    this.currentScreen='devedores';
    document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
    const nav=document.querySelector('[data-screen="devedores"]');
    if(nav)nav.classList.add('active');
    this.render();
  },


  openNovoDevedor() {
    const clientes=Storage.getClientes();
    this.openModal('Nova dívida',`
      <div class="form-group"><label>Cliente</label><select id="dv-cli"><option value="">Selecione...</option>${clientes.map(c=>`<option value="${c.id}">${this.esc(c.nome)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Ou nome manual</label><input id="dv-nome" placeholder="Se não tiver cadastrado"></div>
      <div class="form-group"><label>Descrição</label><input id="dv-desc" placeholder="Ex.: Camisa Flamengo G"></div>
      <div class="form-row"><div class="form-group"><label>Valor total</label><input id="dv-total" type="number" step="0.01"></div>
      <div class="form-group"><label>Já pago</label><input id="dv-pago" type="number" step="0.01" value="0"></div></div>
      <div class="form-group"><label>Prazo</label><input id="dv-prazo" type="date"></div>
      <button class="btn btn-primary" id="btn-salvar-dev">Salvar</button>`);
    document.getElementById('btn-salvar-dev').onclick=()=>{
      const cliId=document.getElementById('dv-cli').value;
      const cli=cliId?Storage.getCliente(cliId):null;
      const nome=cli?.nome||document.getElementById('dv-nome').value.trim();
      const total=Number(document.getElementById('dv-total').value)||0;
      const pago=Number(document.getElementById('dv-pago').value)||0;
      if(!nome||total<=0)return this.toast('Nome e valor obrigatórios');
      Storage.saveDevedor({clienteId:cliId||null,clienteNome:nome,descricao:document.getElementById('dv-desc').value.trim(),valorTotal:total,valorPago:pago,valorRestante:Math.max(0,total-pago),prazo:document.getElementById('dv-prazo').value||null,status:total-pago<=0.01?'pago':'aberto'});
      this.toast('Registrado!');this.closeModal();this.currentScreen='devedores';this.render();
    };
  },

  syncEstoqueFromPedido(p) {
    // Quando pedido fica RECEBIDO, peças marcadas como estoque vão para a aba Estoque
    if (!p || p.status !== 'recebido') return;
    (p.itens||[]).forEach(item => {
      if (!item.isEstoque) return;
      if (item.estoqueId) return; // já sincronizado
      const q = Math.max(1, Number(item.quantidade)||1);
      const unitCost = this.itemCost(item, p) / q;
      const impostoUnit = p.impostoBRL != null && p.totalUSD > 0
        ? (Number(p.impostoBRL)||0) * (Calc.custoItemUSD(item, this.config) / Number(p.totalUSD||1)) / q
        : null;
      const st = Storage.saveEstoque({
        produto: item.produto,
        time: item.time || '',
        tamanho: item.tamanho,
        quantidade: q,
        cotacao: Number(p.cotacao)||5.24,
        precoVenda: Number(item.valorVendaBase ?? item.valorVenda ?? this.config.produtos[item.produto]?.venda)||0,
        impostoPorPeca: impostoUnit,
        custoUSD: Calc.custoItemUSD(item, this.config) / q,
        pedidoId: p.id,
        pedidoNumero: p.numero,
        dataRecebimento: p.dataRecebimento || new Date().toISOString(),
        origem: 'pedido'
      });
      item.estoqueId = st.id;
    });
    Storage.savePedido(p);
  },


  exportBackup() {
    try {
      const data = {
        versao: 1,
        exportadoEm: new Date().toISOString(),
        clientes: Storage.getClientes(),
        prepedidos: Storage.getPrePedidos(),
        pedidos: Storage.getPedidos(),
        estoque: Storage.getEstoque(),
        vendas: Storage.getVendas(),
        devedores: Storage.getDevedores(),
        tabelaMedidas: Storage.getTabelaMedidas(),
        config: Storage.getConfig()
      };
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      const nome = 'impondo-backup-' + new Date().toISOString().slice(0,10) + '.json';
      a.href = URL.createObjectURL(blob);
      a.download = nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.toast('Backup baixado: ' + nome);
    } catch (e) {
      console.error(e);
      this.toast('Erro ao exportar: ' + (e.message || e));
    }
  },

  openBackup() {
    this.openModal('Backup dos dados', `
      <p class="list-item-sub mb-12">Exporte um arquivo e guarde no Google Drive ou WhatsApp. Se limpar o navegador, use Importar para recuperar.</p>
      <button class="btn btn-primary" id="btn-export-backup">⬇️ Exportar backup (.json)</button>
      <button class="btn btn-secondary mt-12" id="btn-limpar-fotos">🧹 Liberar espaço (fotos antigas)</button>
      <div class="section-title">Importar</div>
      <div class="form-group"><label>Arquivo de backup</label><input id="backup-file" type="file" accept=".json,application/json"></div>
      <div class="card" style="border-color:var(--warning)"><b>⚠️ Atenção</b><div class="list-item-sub" style="margin-top:6px">Importar <b>substitui</b> os dados atuais pelos do arquivo.</div></div>
      <button class="btn btn-secondary mt-12" id="btn-import-backup">⬆️ Importar backup</button>
    `);
    document.getElementById('btn-export-backup').onclick = () => this.exportBackup();
    document.getElementById('btn-limpar-fotos').onclick = () => {
      if (!confirm('Remove fotos de pré-pedidos já convertidos e extras de pedidos. Continuar?')) return;
      this.limparFotosAntigas();
    };
    document.getElementById('btn-import-backup').onclick = async () => {
      const file = document.getElementById('backup-file').files[0];
      if (!file) return this.toast('Selecione o arquivo .json');
      if (!confirm('Isso vai SUBSTITUIR todos os dados atuais pelo backup. Continuar?')) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!data || typeof data !== 'object') throw new Error('Arquivo inválido');
        if (data.clientes) Storage.set('clientes', data.clientes);
        if (data.prepedidos) Storage.set('prepedidos', data.prepedidos);
        if (data.pedidos) Storage.set('pedidos', data.pedidos);
        if (data.estoque) Storage.set('estoque', data.estoque);
        if (data.vendas) Storage.set('vendas', data.vendas);
        if (data.devedores) Storage.set('devedores', data.devedores);
        if (data.tabelaMedidas) Storage.saveTabelaMedidas(data.tabelaMedidas);
        if (data.config) Storage.saveConfig(data.config);
        this.closeModal();
        this.toast('Backup restaurado!');
        this.render();
      } catch (e) {
        console.error(e);
        this.toast('Erro ao importar: ' + (e.message || e));
      }
    };
  },

  bindScreenEvents() {
    const b=document.getElementById('btn-novo-cliente');if(b)b.onclick=()=>this.openClienteForm();
    document.querySelectorAll('[data-cliente]').forEach(e=>e.onclick=()=>this.openClienteForm(e.dataset.cliente));
    const bp=document.getElementById('btn-novo-prepedido');if(bp)bp.onclick=()=>this.openPrePedidoForm();
    document.querySelectorAll('[data-prepedido]').forEach(e=>e.onclick=()=>this.openPrePedidoDetail(e.dataset.prepedido));
    document.querySelectorAll('[data-formar-pre]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();this.formarPedidoAPartirDoPre(e.dataset.formarPre);});
    document.querySelectorAll('[data-excluir-pre]').forEach(e=>e.onclick=ev=>{
      ev.stopPropagation();
      if(!confirm('Apagar este pré-pedido?')) return;
      Storage.deletePrePedido(e.dataset.excluirPre);
      this.toast('Pré-pedido apagado');
      this.render();
    });
    document.querySelectorAll('[data-pedido]').forEach(e=>e.onclick=()=>this.openPedidoDetail(e.dataset.pedido));
    const bs=document.getElementById('btn-novo-estoque');if(bs)bs.onclick=()=>this.openEstoqueForm();
    document.querySelectorAll('[data-vender-estoque]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();this.openVendaEstoque(e.dataset.venderEstoque);});
    document.querySelectorAll('[data-editar-estoque]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();this.openEstoqueForm(e.dataset.editarEstoque);});
    const bShare=document.getElementById('btn-compartilhar-estoque');if(bShare)bShare.onclick=()=>this.openCompartilharEstoque();
    const bMed=document.getElementById('btn-tabela-medidas');if(bMed)bMed.onclick=()=>this.openTabelaMedidas();
    const bDev=document.getElementById('btn-devedores');if(bDev)bDev.onclick=()=>this.openDevedores();
    const bNovoDev=document.getElementById('btn-novo-dev');if(bNovoDev)bNovoDev.onclick=()=>this.openNovoDevedor();
    document.querySelectorAll('[data-quitar-dev]').forEach(b=>b.onclick=()=>{
      const d=Storage.getDevedores().find(x=>x.id===b.dataset.quitarDev);if(!d)return;
      d.status='pago';d.valorPago=d.valorTotal;d.valorRestante=0;d.pagoEm=new Date().toISOString();
      Storage.saveDevedor(d);this.toast('Quitado!');this.render();
    });
    document.querySelectorAll('[data-excluir-dev]').forEach(b=>b.onclick=()=>{
      if(confirm('Excluir este registro?')){Storage.deleteDevedor(b.dataset.excluirDev);this.render();}
    });
    const bBusca=document.getElementById('est-busca');
    if(bBusca){bBusca.oninput=()=>{this._estoqueBusca=bBusca.value;this.render();};}

    const dm=document.getElementById('dashboard-month');if(dm)dm.onchange=()=>{this.dashboardMonth=dm.value;localStorage.setItem('impondo_dashboard_month',dm.value);this.render();};
    const bBackup=document.getElementById('btn-backup');if(bBackup)bBackup.onclick=()=>this.openBackup();
  },

  openModal(title,body){document.getElementById('modal-title').textContent=title;document.getElementById('modal-body').innerHTML=body;document.getElementById('modal').classList.remove('hidden');},
  closeModal(){document.getElementById('modal').classList.add('hidden');},
  toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(this._toast);this._toast=setTimeout(()=>t.classList.add('hidden'),2800);}
};

document.addEventListener('DOMContentLoaded',()=>App.init());
