// ===== IMPONDO IMPORTS NO CONTROLE — APP =====
const App = {
  currentScreen: 'dashboard',
  config: null,
  dashboardMonth: new Date().toISOString().slice(0,7),

  init() {
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
      estoque: () => this.renderEstoque()
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
      if (p.impostoBRL == null || !p.dataImpostoPago) return;
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
    return `<div class="screen-header"><div><h2>Estoque</h2><div class="list-item-sub">Peças disponíveis + progresso</div></div><button class="btn btn-primary btn-sm" id="btn-novo-estoque">+ Cadastrar</button></div>
      <div class="stat-grid"><div class="stat"><div class="stat-value">${totalQtd}</div><div class="stat-label">Disponíveis</div></div><div class="stat"><div class="stat-value">${this.money(totalCusto)}</div><div class="stat-label">Custo estimado</div></div><div class="stat"><div class="stat-value">${this.money(totalVenda)}</div><div class="stat-label">Valor de venda</div></div><div class="stat"><div class="stat-value">${this.money(totalVenda-totalCusto)}</div><div class="stat-label">Lucro potencial</div></div></div>
      ${emAndamento.length?`<div class="section-title">Em andamento (${emAndamento.length})</div>`+emAndamento.map(({p,item,statusLabel})=>`<div class="list-item pendencia"><div class="list-item-info"><div class="list-item-title">${this.esc(item.time||item.produto)} — ${this.esc(item.tamanho||'')}</div><div class="list-item-sub">Pedido #${p.numero} • ${item.quantidade||1} un. • ${statusLabel}</div></div><span class="badge badge-warning">${statusLabel}</span></div>`).join(''):''}
      <div class="section-title">Disponível para venda</div>
      ${estoque.length?estoque.map(x=>{const q=Number(x.quantidade)||0,c=this.stockUnitCost(x),h=this.getHistoricoImposto(x.produto);return `<div class="list-item"><div class="list-item-info"><div class="list-item-title">${this.esc(x.time||x.produto)} — ${this.esc(x.tamanho||'')}</div><div class="list-item-sub">${this.esc(x.produto)} • ${q} un. • Custo ${this.money(c)}/un. • Imposto ${x.impostoPorPeca!=null?this.money(x.impostoPorPeca):this.money(h.taxPerPiece)} ${x.impostoPorPeca==null?'(estimado)':''}</div></div><div><span class="badge ${q>0?'badge-success':'badge-warning'}">${q} disponível</span><button class="btn btn-primary btn-sm mt-8" data-vender-estoque="${x.id}" ${q<=0?'disabled':''}>Vender</button><button class="btn btn-secondary btn-sm mt-8" data-editar-estoque="${x.id}">Editar</button></div></div>`}).join(''):`<div class="empty"><div class="icon">👕</div><p>Nenhuma peça disponível</p></div>`}`;
  },

  openEstoqueForm(id) {
    const old=id?Storage.getEstoque().find(x=>x.id===id):null;
    const produtos=Object.keys(this.config.produtos), tamanhos=['P','M','G','GG','2XL','3XL','4XL'];
    const h=old?this.getHistoricoImposto(old.produto):{taxPerPiece:0,fonte:'histórico'};
    const precoInicial=old?.precoVenda ?? (this.config.produtos[old?.produto || produtos[0]]?.venda || 0);
    this.openModal(old?'Editar estoque':'Cadastrar estoque',`<div class="form-group"><label>Modelo base</label><select id="st-prod">${produtos.map(x=>`<option ${old?.produto===x?'selected':''}>${this.esc(x)}</option>`).join('')}</select></div><div class="form-group"><label>Time / modelo</label><input id="st-time" value="${this.esc(old?.time||'')}" placeholder="Ex.: Palmeiras Home Wine"></div><div class="form-row"><div class="form-group"><label>Tamanho</label><select id="st-tam">${tamanhos.map(x=>`<option ${old?.tamanho===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="form-group"><label>Quantidade</label><input id="st-qtd" type="number" min="0" value="${old?.quantidade??1}"></div></div><div class="form-row"><div class="form-group"><label>Cotação usada (R$/US$)</label><input id="st-cot" type="number" step="0.01" value="${old?.cotacao??5.24}"></div><div class="form-group"><label>Preço padrão (R$)</label><input id="st-preco" type="number" step="0.01" value="${precoInicial}"></div></div><div class="form-group"><label>Imposto já pago por peça (R$) <span class="list-item-sub">opcional</span></label><input id="st-imp" type="number" step="0.01" value="${old?.impostoPorPeca??''}" placeholder="Deixe vazio para usar média automática"></div><div class="card"><b>Estimativa automática:</b> ${this.money(h.taxPerPiece)} de imposto por peça (${this.esc(h.fonte)}).</div><button class="btn btn-primary" id="btn-salvar-st">Salvar estoque</button>${old?'<button class="btn btn-danger mt-12" id="btn-excluir-st">Excluir</button>':''}`);
    document.getElementById('st-prod').onchange=()=>{const prod=document.getElementById('st-prod').value;const hh=this.getHistoricoImposto(prod);document.querySelector('#modal-body .card').innerHTML=`<b>Estimativa automática:</b> ${this.money(hh.taxPerPiece)} de imposto por peça (${this.esc(hh.fonte)}).`;const pv=this.config.produtos[prod]?.venda||0;document.getElementById('st-preco').value=pv;};
    document.getElementById('btn-salvar-st').onclick=()=>{const produto=document.getElementById('st-prod').value;const obj={id:old?.id,produto,time:document.getElementById('st-time').value.trim(),tamanho:document.getElementById('st-tam').value,quantidade:Number(document.getElementById('st-qtd').value)||0,cotacao:Number(document.getElementById('st-cot').value)||5.24,precoVenda:Number(document.getElementById('st-preco').value)||0,impostoPorPeca:document.getElementById('st-imp').value===''?null:Number(document.getElementById('st-imp').value)};Storage.saveEstoque(obj);this.closeModal();this.toast('Estoque salvo!');this.render();};
    if(old)document.getElementById('btn-excluir-st').onclick=()=>{if(confirm('Excluir este item do estoque?')){Storage.deleteEstoque(old.id);this.closeModal();this.render();}};
  },

  openVendaEstoque(id) {
    const x=Storage.getEstoque().find(a=>a.id===id);if(!x||Number(x.quantidade)<=0)return this.toast('Sem estoque disponível');
    const clientes=Storage.getClientes();if(!clientes.length)return this.toast('Cadastre um cliente primeiro!');
    const custo=this.stockUnitCost(x), preco=Number(x.precoVenda||this.config.produtos[x.produto]?.venda)||0;
    this.openModal('Vender peça do estoque',`<div class="card"><b>${this.esc(x.time||x.produto)}</b><div class="list-item-sub">${this.esc(x.produto)} • ${this.esc(x.tamanho)} • Custo estimado ${this.money(custo)}</div></div><div class="form-group"><label>Cliente</label><select id="ve-cli">${clientes.map(c=>`<option value="${c.id}">${this.esc(c.nome)} — ${this.esc(c.cidade)}</option>`).join('')}</select></div><div class="form-row"><div class="form-group"><label>Preço padrão</label><input value="${preco.toFixed(2)}" disabled></div><div class="form-group"><label>Valor vendido (R$)</label><input id="ve-valor" type="number" step="0.01" value="${preco}"></div></div><div class="form-group"><label>Desconto concedido (R$) — calculado</label><input id="ve-desc" type="number" step="0.01" value="0" disabled></div><div class="form-row"><div class="form-group"><label>Entrega</label><select id="ve-met"><option value="Pessoalmente">Pessoalmente — R$ 0</option><option value="Uber Moto">Uber Moto</option></select></div><div class="form-group"><label>Uber Moto (R$)</label><input id="ve-uber" type="number" step="0.01" value="0"></div></div><div class="form-group"><label>Sacola / embalagem (R$)</label><input id="ve-sacola" type="number" step="0.01" value="2"></div><div class="card"><b>Lucro previsto:</b> <span id="ve-lucro"></span></div><button class="btn btn-primary" id="btn-confirmar-venda">Confirmar venda</button>`);
    const calc=()=>{const valor=Number(document.getElementById('ve-valor').value)||0,desc=Math.max(0,preco-valor),met=document.getElementById('ve-met').value,uber=met==='Uber Moto'?(Number(document.getElementById('ve-uber').value)||0):0,sac=Number(document.getElementById('ve-sacola').value)||0;document.getElementById('ve-desc').value=desc.toFixed(2);const lucro=valor-custo-sac-uber;document.getElementById('ve-lucro').textContent=this.money(lucro);};
    ['ve-valor','ve-uber','ve-sacola','ve-met'].forEach(id=>document.getElementById(id).oninput=calc);calc();
    document.getElementById('btn-confirmar-venda').onclick=()=>{const valor=Number(document.getElementById('ve-valor').value)||0,desc=Math.max(0,preco-valor),met=document.getElementById('ve-met').value,uber=met==='Uber Moto'?(Number(document.getElementById('ve-uber').value)||0):0,sac=Number(document.getElementById('ve-sacola').value)||0;if(valor<=0)return this.toast('Informe o valor da venda');x.quantidade=Math.max(0,(Number(x.quantidade)||0)-1);Storage.saveEstoque(x);Storage.saveVenda({clienteId:document.getElementById('ve-cli').value,estoqueId:x.id,produto:x.produto,time:x.time,tamanho:x.tamanho,valorPadrao:preco,valorVenda:valor,desconto:desc,custoProduto:custo,embalagem:sac,entrega:{metodo:met,custo:uber},dataVenda:new Date().toISOString()});this.closeModal();this.toast('Venda registrada e estoque atualizado!');this.render();};
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

        if (p.impostoBRL != null && Number(p.impostoBRL) >= 0 && p.dataImpostoPago) {
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
        <select id="dashboard-month" style="max-width:180px">${this.getMonthOptions().map(x=>`<option value="${x}" ${x===this.dashboardMonth?'selected':''}>${this.getMonthLabel(x)}</option>`).join('')}</select>
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
    const locais=pps.filter(pp=>Calc.isMauaRegiao(Storage.getCliente(pp.clienteId)?.cidade||''));
    const totalLocal=locais.reduce((s,pp)=>s+Calc.totalPecas(pp.itens||[]),0);
    const localPronto=totalLocal>=meta;
    return `<div class="screen-header"><div><h2>Pré-pedidos</h2><div class="list-item-sub">Acumule peças de vários clientes no mesmo lote</div></div><button class="btn btn-primary btn-sm" id="btn-novo-prepedido">+ Novo</button></div>
      <div class="card"><b>Regra de formação</b><p class="list-item-sub" style="margin-top:6px">Mauá/região: as peças de todos os pré-pedidos abertos entram no mesmo lote. ${totalLocal} de ${meta} peça(s). Ao chegar em ${meta}, qualquer pré-pedido local pode gerar o pedido. Outras cidades podem ser enviadas mesmo com 1 peça.</p></div>
      ${pps.length?pps.map(pp=>{
        const c=Storage.getCliente(pp.clienteId); const q=Calc.totalPecas(pp.itens||[]); const isEst=!!(pp.isEstoque||(pp.itens||[]).some(i=>i.isEstoque));
        const local=!isEst && Calc.isMauaRegiao(c?.cidade||'');
        const pode=isEst?true:(local?localPronto:true);
        const texto=isEst?`${q} peça(s) • ESTOQUE`:(local?`${totalLocal} de ${meta}${localPronto?' • Pedido liberado':''}`:`${q} peça(s) • Pedido liberado`);
        return `<div class="list-item"><div class="list-item-info"><div class="list-item-title">${isEst?'📦 ESTOQUE':this.esc(c?.nome||'Cliente')}</div><div class="list-item-sub">${q} peça(s) • ${this.esc((pp.itens||[]).map(i=>i.time||i.produto).join(', '))} • ${isEst?'Sem cliente':this.esc(c?.cidade||'')}</div></div><div><span class="badge ${isEst?'badge-purple':(pode?'badge-success':'badge-warning')}">${texto}</span>${pode?`<button class="btn btn-primary btn-sm mt-8" data-formar-pre="${pp.id}">📦 Efetuar pedido</button>`:''}</div></div>`;
      }).join(''):`<div class="empty"><div class="icon">📝</div><p>Nenhum pré-pedido aberto</p></div>`}`;
  },

  async readFile(file) {
    if(!file)return null;
    return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
  },

  openPrePedidoForm() {
    const clientes=Storage.getClientes();
    const produtos=Object.keys(this.config.produtos), tamanhos=['P','M','G','GG','2XL','3XL','4XL'];
    this.openModal('Novo Pré-pedido',`
      <div class="form-group"><label><input type="checkbox" id="pp-estoque"> É estoque (sem cliente)</label></div>
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
      const isEstoque=document.getElementById('pp-estoque').checked;
      const clienteId=document.getElementById('pp-cliente').value;
      if(!isEstoque && !clienteId)return this.toast('Selecione o cliente ou marque como estoque');
      if(!isEstoque && !clientes.length)return this.toast('Cadastre um cliente primeiro!');
      const itens=[];
      for(const card of cont.querySelectorAll('.item-card')){
        itens.push({produto:card.querySelector('.pp-prod').value,tamanho:card.querySelector('.pp-tam').value,quantidade:Number(card.querySelector('.pp-qtd').value)||1,time:card.querySelector('.pp-time').value.trim(),valorVenda:Number(card.querySelector('.pp-venda').value)||0,desconto:Number(card.querySelector('.pp-desc').value)||0,dataVenda:card.querySelector('.pp-data-venda').value || new Date().toISOString().slice(0,10),personalizacao:card.querySelector('.pp-pers').checked,patch:card.querySelector('.pp-patch').checked,patrocinio:card.querySelector('.pp-patro').checked,feminina:card.querySelector('.pp-feminina').checked,fotoRef:await this.readFile(card.querySelector('.pp-foto').files[0]),isEstoque});
      }
      if(!itens.length)return this.toast('Adicione pelo menos uma peça');
      Storage.savePrePedido({clienteId:isEstoque?null:clienteId,isEstoque,itens,observacoes:document.getElementById('pp-obs').value.trim(),status:'aberto'});
      this.closeModal();this.toast(isEstoque?'Pré-pedido de estoque salvo!':'Pré-pedido salvo!');this.render();
    };
  },

  openPrePedidoDetail(id) {
    const pp=Storage.getPrePedido(id);if(!pp)return;
    const isEst=!!(pp.isEstoque||(pp.itens||[]).some(i=>i.isEstoque));
    const c=Storage.getCliente(pp.clienteId),q=Calc.totalPecas(pp.itens||[]),meta=Number(this.config.pedido?.quantidadeMinima||4);
    const local=!isEst && Calc.isMauaRegiao(c?.cidade||'');
    const locais=Storage.getPrePedidos().filter(x=>x.status==='aberto'&&!x.isEstoque&&Calc.isMauaRegiao(Storage.getCliente(x.clienteId)?.cidade||''));
    const totalLocal=locais.reduce((s,x)=>s+Calc.totalPecas(x.itens||[]),0);
    const pode=isEst?true:(local?totalLocal>=meta:true);
    this.openModal(isEst?`Pré-pedido — ESTOQUE`:`Pré-pedido — ${this.esc(c?.nome||'')}`,`
      <div class="card"><b>${isEst?'📦 ESTOQUE (sem cliente)':this.esc(c?.nome||'')}</b>${isEst?'':`<div class="list-item-sub">@${this.esc(c?.instagram||'')} • ${this.esc(c?.cidade||'')} • ${this.esc(c?.whatsapp||'')}</div>`}</div>
      <div class="section-title">Peças (${q})</div>
      ${(pp.itens||[]).map((i,idx)=>`<div class="item-card">${i.fotoRef?`<img src="${i.fotoRef}" class="photo-preview">`:''}<div class="row"><span>Produto</span><span>${this.esc(i.produto)}</span></div><div class="row"><span>Tamanho</span><span>${i.tamanho} × ${i.quantidade}</span></div><div class="row"><span>Modelo</span><span>${this.esc(i.time)}</span></div><div class="row"><span>Extras</span><span>${i.personalizacao?'Personalizada ':''}${i.patch?'Patch ':''}${i.patrocinio?'Patrocínio':''}</span></div><div class="row"><span>Desconto</span><span>${this.money(i.desconto)}</span></div></div>`).join('')}
      ${pode?'<button class="btn btn-success mt-12" id="btn-formar-pedido">📦 Efetuar pedido</button>':`<div class="card mt-12" style="border-color:var(--warning)"><p style="color:var(--warning)">Lote de Mauá: ${totalLocal} de ${meta} peça(s). Faltam ${Math.max(0,meta-totalLocal)}.</p></div>`}
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
    const alvo=Storage.getPrePedido(id), c=Storage.getCliente(alvo.clienteId);
    let selecionados=[];
    if(Calc.isMauaRegiao(c?.cidade||'')){
      const abertos=Storage.getPrePedidos().filter(pp=>pp.status==='aberto');
      // Todos os pré-pedidos abertos de clientes da região local podem compor o mesmo lote.
      selecionados=abertos.filter(pp=>Calc.isMauaRegiao(Storage.getCliente(pp.clienteId)?.cidade||''));
      const total=selecionados.reduce((s,pp)=>s+Calc.totalPecas(pp.itens||[]),0);
      if(total<4)return this.toast(`Ainda faltam ${4-total} peça(s) para fechar o pedido de Mauá.`);
    } else selecionados=[alvo];

    this.openModal('Formar pedido ao fornecedor',`
      <p class="list-item-sub">Serão agrupados ${selecionados.length} pré-pedido(s).</p>
      <div class="form-group"><label>Cotação do dólar (R$) *</label><input id="ped-cotacao" type="number" step="0.01" value="5.24"></div>
      <div class="card"><b>Pré-pedidos incluídos</b>${selecionados.map(pp=>{const cc=Storage.getCliente(pp.clienteId);return `<div class="list-item-sub" style="margin-top:6px">• ${this.esc(cc?.nome)} — ${Calc.totalPecas(pp.itens||[])} peça(s)</div>`}).join('')}</div>
      <button class="btn btn-primary" id="btn-criar-pedido">Criar Pedido</button>`);
    document.getElementById('btn-criar-pedido').onclick=()=>{
      const cotacao=Number(document.getElementById('ped-cotacao').value);if(!cotacao||cotacao<=0)return this.toast('Informe uma cotação válida');
      const itens=[];let totalUSD=0;
      selecionados.forEach(pp=>{pp.itens.forEach(i=>{
        const prod=this.config.produtos[i.produto] || {};
        const adicionais=this.config.adicionais || {};
        let custoUnitarioUSD=Number(prod.custoUSD)||0;
        if(i.personalizacao)custoUnitarioUSD+=Number(adicionais['Personalização'])||0;
        if(i.patch)custoUnitarioUSD+=Number(adicionais['Patch'])||0;
        if(i.patrocinio)custoUnitarioUSD+=Number(adicionais['Patrocínio'])||0;
        const tam=String(i.tamanho||'').toUpperCase();
        if(tam==='2XL'||tam==='2GG')custoUnitarioUSD+=Number(adicionais['2XL'])||0;
        if(tam==='3XL'||tam==='3GG')custoUnitarioUSD+=Number(adicionais['3XL'])||0;
        if(tam==='4XL'||tam==='4GG')custoUnitarioUSD+=Number(adicionais['4XL'])||0;

        const qtd=Math.max(1,Number(i.quantidade)||1);
        const vendaAdicionais=(i.personalizacao?Number(this.config.vendaAdicionais?.Personalização)||0:0)
          +(i.patch?Number(this.config.vendaAdicionais?.Patch)||0:0)
          +(i.patrocinio?Number(this.config.vendaAdicionais?.Patrocínio)||0:0);

        const item={
          ...i,
          clienteId:pp.clienteId,
          isEstoque:!!(pp.isEstoque||i.isEstoque),
          statusEntrega:'pendente',
          entrega:null,
          custoUnitarioUSD,
          custoTotalUSD:custoUnitarioUSD*qtd,
          valorVendaBase:Number(i.valorVenda)||0,
          vendaAdicionaisSnapshot:vendaAdicionais,
          criadoNoPedidoEm:new Date().toISOString()
        };
        itens.push(item);
      });});
      totalUSD=Calc.totalUSD(itens,this.config);
      const frete=Calc.freteFornecedorUSD(Calc.totalPecas(itens),this.config);
      const pedido={prePedidoIds:selecionados.map(x=>x.id),clienteIds:[...new Set(selecionados.map(x=>x.clienteId))],itens,cotacao,freteFornecedorUSD:frete,totalUSD,impostoBRL:null,status:'realizado',fotoFornecedor:null,fotosFornecedor:[],dataFotoFornecedor:null,registradoCorreios:false,dataVenda:new Date().toISOString(),createdAt:new Date().toISOString()};
      Storage.savePedido(pedido);selecionados.forEach(pp=>{pp.status='convertido';Storage.savePrePedido(pp);});
      this.closeModal();this.toast(`Pedido #${pedido.numero} criado com ${itens.length} peça(s)!`);this.currentScreen='pedidos';document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));document.querySelector('[data-screen="pedidos"]').classList.add('active');this.render();
    };
  },

  // ---------- PEDIDOS ----------
  renderPedidos() {
    const ps=Storage.getPedidos().sort((a,b)=>(b.numero||0)-(a.numero||0));
    const labels={realizado:'Realizado',enviado:'Enviado',imposto_pago:'Imposto pago',em_transito:'Em trânsito',recebido:'Recebido',entregue:'Entregue'};
    return `<div class="screen-header"><div><h2>Pedidos</h2><div class="list-item-sub">Pedidos enviados ao fornecedor</div></div></div>
      ${ps.length?ps.map(p=>{const nomes=(p.clienteIds||[p.clienteId]).map(id=>Storage.getCliente(id)?.nome).filter(Boolean).join(', ');return `<div class="list-item" data-pedido="${p.id}"><div class="list-item-info"><div class="list-item-title">Pedido #${p.numero}</div><div class="list-item-sub">${this.esc(nomes||'Cliente')} • ${Calc.totalPecas(p.itens||[])} peça(s) • ${this.money(p.itens?.reduce((s,i)=>s+this.itemSale(i,p).final,0)||0)}</div></div><span class="badge ${p.status==='recebido'?'badge-success':p.status==='entregue'?'badge-success':'badge-cyan'}">${labels[p.status]||p.status}</span></div>`}).join(''):`<div class="empty"><div class="icon">📦</div><p>Nenhum pedido ainda</p></div>`}`;
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
      <div class="form-row"><button class="btn btn-secondary" id="btn-edit-pedido">✏️ Editar pedido</button><button class="btn btn-danger" id="btn-delete-pedido">🗑 Excluir pedido</button></div>
      <div class="card"><b>${clientes.map(c=>this.esc(c.nome)).join(', ')}</b><div class="list-item-sub">${clientes.map(c=>this.esc(c.cidade)).join(' • ')}</div></div>
      <div class="stat-grid"><div class="stat"><div class="stat-value">${this.money(t.venda)}</div><div class="stat-label">Venda líquida</div></div><div class="stat"><div class="stat-value">${this.money(t.custo)}</div><div class="stat-label">Custo real</div></div><div class="stat"><div class="stat-value" style="color:${t.lucro>=0?'var(--success)':'var(--danger)'}">${this.money(t.lucro)}</div><div class="stat-label">Lucro</div></div><div class="stat"><div class="stat-value">${t.margem.toFixed(1)}%</div><div class="stat-label">Margem</div></div></div>
      <div class="section-title">Etapa do pedido</div>
      <div class="form-group"><select id="ped-status">${statusOptions.map(x=>`<option value="${x[0]}" ${p.status===x[0]?'selected':''}>${x[1]}</option>`).join('')}</select></div>
      <button class="btn btn-secondary btn-sm mb-12" id="btn-status">Salvar etapa</button>
      <div class="form-row"><div class="form-group"><label>Cotação</label><input value="R$ ${(p.cotacao||0).toFixed(2)}" disabled></div><div class="form-group"><label>Frete fornecedor</label><input value="${this.config ? Calc.formatUSD(p.freteFornecedorUSD||0):''}" disabled></div></div>
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
          <div class="form-group"><label>Status da entrega</label><select data-item-status="${idx}"><option value="pendente" ${i.statusEntrega!=='entregue'?'selected':''}>Aguardando entrega</option><option value="entregue" ${i.statusEntrega==='entregue'?'selected':''}>Entregue</option></select></div>
          <div class="form-row"><div class="form-group"><label>Como entregou?</label><select data-item-metodo="${idx}"><option value="">Selecione</option><option ${i.entrega?.metodo==='Uber'?'selected':''}>Uber</option><option ${i.entrega?.metodo==='Pessoal'?'selected':''}>Pessoalmente</option><option ${i.entrega?.metodo==='Terceiro'?'selected':''}>Terceiro</option><option ${i.entrega?.metodo==='Correios'?'selected':''}>Correios</option></select></div><div class="form-group"><label>Custo entrega (R$)</label><input data-item-custo="${idx}" type="number" step="0.01" value="${i.entrega?.custo||0}"></div></div><div class="form-group"><label>Sacola / embalagem (R$)</label><input data-item-emb="${idx}" type="number" step="0.01" value="${i.embalagemCusto??2}"></div>
          <button class="btn btn-secondary btn-sm" data-save-item="${idx}">Salvar entrega</button>
        </div>`;
      }).join('')}`);
    document.getElementById('btn-edit-pedido').onclick=()=>this.openPedidoEdit(id);
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
    document.querySelectorAll('[data-save-item]').forEach(b=>b.onclick=()=>{const idx=Number(b.dataset.saveItem);const metodo=document.querySelector(`[data-item-metodo="${idx}"]`).value;const custo=Number(document.querySelector(`[data-item-custo="${idx}"]`).value)||0;const embalagem=Number(document.querySelector(`[data-item-emb="${idx}"]`).value)||0;const status=document.querySelector(`[data-item-status="${idx}"]`).value;p.itens[idx].statusEntrega=status;p.itens[idx].entrega={metodo,custo,data:status==='entregue'?new Date().toISOString():p.itens[idx].entrega?.data};p.itens[idx].embalagemCusto=embalagem;if(status==='entregue')p.itens[idx].dataVenda=p.itens[idx].dataVenda||new Date().toISOString();Storage.savePedido(p);this.toast('Entrega salva e custo incluído no custo real');this.openPedidoDetail(id);});
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

  bindScreenEvents() {
    const b=document.getElementById('btn-novo-cliente');if(b)b.onclick=()=>this.openClienteForm();
    document.querySelectorAll('[data-cliente]').forEach(e=>e.onclick=()=>this.openClienteForm(e.dataset.cliente));
    const bp=document.getElementById('btn-novo-prepedido');if(bp)bp.onclick=()=>this.openPrePedidoForm();
    document.querySelectorAll('[data-prepedido]').forEach(e=>e.onclick=()=>this.openPrePedidoDetail(e.dataset.prepedido));
    document.querySelectorAll('[data-formar-pre]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();this.formarPedidoAPartirDoPre(e.dataset.formarPre);});
    document.querySelectorAll('[data-pedido]').forEach(e=>e.onclick=()=>this.openPedidoDetail(e.dataset.pedido));
    const bs=document.getElementById('btn-novo-estoque');if(bs)bs.onclick=()=>this.openEstoqueForm();
    document.querySelectorAll('[data-vender-estoque]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();this.openVendaEstoque(e.dataset.venderEstoque);});
    document.querySelectorAll('[data-editar-estoque]').forEach(e=>e.onclick=ev=>{ev.stopPropagation();this.openEstoqueForm(e.dataset.editarEstoque);});
    const dm=document.getElementById('dashboard-month');if(dm)dm.onchange=()=>{this.dashboardMonth=dm.value;localStorage.setItem('impondo_dashboard_month',dm.value);this.render();};
  },

  openModal(title,body){document.getElementById('modal-title').textContent=title;document.getElementById('modal-body').innerHTML=body;document.getElementById('modal').classList.remove('hidden');},
  closeModal(){document.getElementById('modal').classList.add('hidden');},
  toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(this._toast);this._toast=setTimeout(()=>t.classList.add('hidden'),2800);}
};

document.addEventListener('DOMContentLoaded',()=>App.init());
