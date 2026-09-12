const CONFIG = window.LUNCH_CONFIG || {};
const supabaseClient = window.supabase?.createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);
const PAGE_SIZE = 10;
const COLOR_MAP = {
  green: { bg: '#4caf87', text: 'white', label: '綠' },
  red: { bg: '#e05555', text: 'white', label: '紅' },
  blue: { bg: '#4a7fc1', text: 'white', label: '藍' },
  yellow: { bg: '#f7d779', text: '#6b5a1e', label: '黃' },
  gray: { bg: '#8a8f98', text: 'white', label: '灰' },
  white: { bg: '#eed9bf', text: '#713e2c', label: '白' }
};
const COLOR_ORDER = ['green', 'white', 'red', 'blue', 'yellow', 'gray'];
const TABLES = ['people', 'restaurants', 'restaurant_menu', 'orders', 'order_menu', 'order_items', 'order_versions'];

const state = {
  people: [],
  restaurants: [],
  restaurant_menu: [],
  orders: [],
  order_menu: [],
  order_items: [],
  order_versions: [],
  ready: false,
  error: '',
  pagination: { history: 1, payments: 1, unpaid: 1 }
};

const drafts = JSON.parse(sessionStorage.getItem('lunch-drafts-v2') || '{}');
let adminUnlocked = sessionStorage.getItem('lunch-admin-unlocked') === 'true';
let adminEditingId = null;
let activePaymentRow = null;
let renderTimer = 0;

const app = document.querySelector('#app');
const money = value => '$' + Number(value || 0).toLocaleString('zh-TW');
const num = value => Number(value || 0);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`);

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function saveDrafts() {
  sessionStorage.setItem('lunch-drafts-v2', JSON.stringify(drafts));
}

function getDraft(orderId) {
  drafts[orderId] ||= { selectedMenuId: null, selectedPeople: [], qty: 1, note: '' };
  return drafts[orderId];
}

function peopleGrouped() {
  return [...state.people].sort((a, b) => {
    const ai = COLOR_ORDER.indexOf(a.color || 'white');
    const bi = COLOR_ORDER.indexOf(b.color || 'white');
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name, 'zh-Hant');
  });
}

function personById(id) {
  return state.people.find(item => item.id === id);
}

function personFaceHtml(person, fallbackName) {
  const c = COLOR_MAP[person?.color] || COLOR_MAP.white;
  const face = person?.face || fallbackName?.[0] || '?';
  return `<span class="person-face" style="background:${c.bg};color:${c.text}">${escHtml(face)}</span>`;
}

function isClosed(order) {
  return !order || order.closed || (order.deadline_at && Date.now() >= new Date(order.deadline_at).getTime());
}

function activeOrders() {
  return state.orders.filter(order => !isClosed(order)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function closedOrders() {
  return state.orders.filter(isClosed).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function menuFor(orderId) {
  return state.order_menu.filter(item => item.order_id === orderId).sort((a, b) => a.sort_order - b.sort_order);
}

function itemsFor(orderId) {
  return state.order_items.filter(item => item.order_id === orderId).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

function versionsFor(orderId) {
  return state.order_versions.filter(item => item.order_id === orderId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function itemAmount(item) {
  return num(item.price) * num(item.qty || 1);
}

function orderTotal(orderId) {
  return itemsFor(orderId).reduce((sum, item) => sum + itemAmount(item), 0);
}

function orderQty(orderId) {
  return itemsFor(orderId).reduce((sum, item) => sum + num(item.qty || 1), 0);
}

function deadlineLabel(order) {
  return new Date(order.deadline_at).toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function localDateTimeValue(date) {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatTimeDiff(ms) {
  if (ms <= 0) return '0 分鐘';
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours && mins) return `${hours} 小時 ${mins} 分鐘`;
  if (hours) return `${hours} 小時`;
  return `${mins} 分鐘`;
}

function upsertRow(table, row) {
  if (!row?.id) return;
  const list = state[table];
  const index = list.findIndex(item => item.id === row.id);
  if (index >= 0) list[index] = row;
  else list.push(row);
}

function removeRow(table, id) {
  state[table] = state[table].filter(item => item.id !== id);
}

function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 40);
}

function toast(message) {
  document.querySelector('.toast-notice')?.remove();
  const el = document.createElement('div');
  el.className = 'toast-notice';
  el.textContent = message;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-visible'));
  setTimeout(() => el.remove(), 2600);
}

function confirmAction({ title, subtitle = '避免誤觸提醒', desc, notice, confirmText = '確定刪除', danger = true }) {
  return new Promise(resolve => {
    document.querySelector('#confirm-modal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div id="confirm-modal" class="modal-overlay" role="dialog" aria-modal="true">
        <div class="modal-card">
          <div class="modal-header">
            <div class="modal-icon warning">⚠️</div>
            <div>
              <h3>${escHtml(title)}</h3>
              <span class="modal-subtitle">${escHtml(subtitle)}</span>
            </div>
          </div>
          <div class="modal-body">
            <p class="modal-desc">${desc}</p>
            ${notice ? `<div class="modal-notice">${notice}</div>` : ''}
          </div>
          <div class="modal-actions">
            <button type="button" class="outline-btn" id="modal-cancel-btn">取消</button>
            <button type="button" class="primary-btn ${danger ? 'btn-danger' : ''}" id="modal-confirm-btn">${escHtml(confirmText)}</button>
          </div>
        </div>
      </div>
    `);
    const close = value => {
      document.querySelector('#confirm-modal')?.remove();
      resolve(value);
    };
    document.querySelector('#modal-cancel-btn').onclick = () => close(false);
    document.querySelector('#modal-confirm-btn').onclick = () => close(true);
    document.querySelector('#confirm-modal').onclick = event => {
      if (event.target.id === 'confirm-modal') close(false);
    };
  });
}

async function dbInsert(table, rows) {
  const { data, error } = await supabaseClient.from(table).insert(rows).select();
  if (error) throw error;
  (data || []).forEach(row => upsertRow(table, row));
  return data;
}

async function dbUpdate(table, id, patch) {
  const { data, error } = await supabaseClient.from(table).update(patch).eq('id', id).select();
  if (error) throw error;
  (data || []).forEach(row => upsertRow(table, row));
  return data?.[0];
}

async function dbDelete(table, id) {
  const { error } = await supabaseClient.from(table).delete().eq('id', id);
  if (error) throw error;
  removeRow(table, id);
}

function orderSnapshot(order) {
  return {
    order: {
      id: order.id,
      restaurant_name: order.restaurant_name,
      icon: order.icon,
      deadline_at: order.deadline_at,
      closed: order.closed
    },
    menu: menuFor(order.id),
    items: itemsFor(order.id)
  };
}

async function recordVersion(order, action) {
  if (!order) return;
  const row = {
    id: uid(),
    order_id: order.id,
    action,
    snapshot: orderSnapshot(order),
    created_at: new Date().toISOString()
  };
  await dbInsert('order_versions', row);
  const extras = versionsFor(order.id).slice(30);
  await Promise.all(extras.map(item => dbDelete('order_versions', item.id)));
}

async function loadAll() {
  const results = await Promise.all(TABLES.map(table => supabaseClient.from(table).select('*')));
  const failed = results.find(item => item.error);
  if (failed?.error) throw failed.error;
  TABLES.forEach((table, index) => {
    state[table] = results[index].data || [];
  });
}

function subscribeRealtime() {
  const channel = supabaseClient.channel('lunch-v2');
  TABLES.forEach(table => {
    channel.on('postgres_changes', { event: '*', schema: 'public', table }, payload => {
      if (payload.eventType === 'DELETE') removeRow(table, payload.old?.id);
      else upsertRow(table, payload.new);
      scheduleRender();
    });
  });
  channel.subscribe(status => {
    if (status === 'CHANNEL_ERROR') state.error = '即時同步連線失敗，請重新整理頁面。';
  });
}

async function closeExpiredOrders() {
  const expired = state.orders.filter(order => !order.closed && order.deadline_at && Date.now() >= new Date(order.deadline_at).getTime());
  for (const order of expired) {
    await dbUpdate('orders', order.id, { closed: true });
    await recordVersion(order, '截止時間自動結單');
  }
  if (expired.length && (location.hash === '#active' || location.hash.startsWith('#active-') || !location.hash || location.hash === '#')) {
    location.hash = '#history';
  }
}

function renderPagination(type, totalItems, currentPage) {
  if (totalItems <= PAGE_SIZE) return '';
  const totalPages = Math.ceil(totalItems / PAGE_SIZE) || 1;
  const options = [];
  for (let i = 1; i <= totalPages; i++) {
    const start = (i - 1) * PAGE_SIZE + 1;
    const end = Math.min(i * PAGE_SIZE, totalItems);
    options.push(`<option value="${i}" ${i === currentPage ? 'selected' : ''}>第 ${i} 頁 (${start} - ${end} 筆)</option>`);
  }
  return `
    <nav class="pagination-bar" data-pagination-type="${type}" aria-label="分頁導覽">
      <button type="button" class="outline-btn pagination-btn" data-page="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>← 上一頁</button>
      <div class="pagination-select-wrap">
        <label class="pagination-label">切換分頁：</label>
        <select class="pagination-select" data-pagination-select="${type}">${options.join('')}</select>
      </div>
      <button type="button" class="outline-btn pagination-btn" data-page="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>下一頁 →</button>
      <span class="pagination-info">第 ${currentPage} / ${totalPages} 頁 · 共 ${totalItems} 筆</span>
    </nav>
  `;
}

function bindPagination(type) {
  const select = document.querySelector(`[data-pagination-select="${type}"]`);
  if (select) select.onchange = event => {
    state.pagination[type] = Number(event.target.value);
    render();
  };
  document.querySelectorAll(`[data-pagination-type="${type}"] .pagination-btn`).forEach(btn => {
    btn.onclick = () => {
      const page = Number(btn.dataset.page);
      if (page >= 1) {
        state.pagination[type] = page;
        render();
      }
    };
  });
}

function currentRoute() {
  const active = activeOrders();
  const defaultRoute = active.length ? `active-${active[0].id}` : 'new-order';
  const raw = location.hash.replace('#', '') || defaultRoute;
  if (raw === 'home' || raw === 'active') return defaultRoute;
  if ((raw === 'active' || raw.startsWith('active-')) && !active.length) return 'new-order';
  return raw;
}

function renderNavigation(route) {
  const active = activeOrders();
  const activeLinks = active.map(order =>
    `<a class="${route === `active-${order.id}` ? 'active' : ''}" href="#active-${order.id}">${escHtml(order.restaurant_name)}</a>`
  ).join('');
  const rest = [
    ['people', '人員名單'],
    ['favorites', '常用餐廳'],
    ['payments', '付款確認'],
    ['unpaid', '未繳費統計'],
    ['admin', '管理者'],
    ['history', '歷史訂單']
  ].map(([key, label]) => `<a class="${route === key || route.startsWith(`${key}-`) ? 'active' : ''}" href="#${key}">${label}</a>`).join('');
  document.querySelector('#top-nav').innerHTML = `${activeLinks}<a class="${route === 'new-order' ? 'active' : ''}" href="#new-order">新增訂單</a>${rest}`;
  const bottomActive = active.map(order =>
    `<a class="${route === `active-${order.id}` ? 'active' : ''}" href="#active-${order.id}"><span>◷</span>${escHtml(order.restaurant_name)}</a>`
  ).join('');
  document.querySelector('#bottom-nav').innerHTML = `${bottomActive}<a class="${route === 'new-order' ? 'active' : ''}" href="#new-order"><span>＋</span>新增</a><a class="${route.startsWith('people') ? 'active' : ''}" href="#people"><span>♙</span>名單</a><a class="${route.startsWith('favorites') ? 'active' : ''}" href="#favorites"><span>★</span>常用</a><a class="${route === 'payments' ? 'active' : ''}" href="#payments"><span>✓</span>付款</a><a class="${route === 'unpaid' ? 'active' : ''}" href="#unpaid"><span>!</span>未繳</a><a class="${route === 'admin' ? 'active' : ''}" href="#admin"><span>⚙</span>管理</a><a class="${route === 'history' ? 'active' : ''}" href="#history"><span>▤</span>歷史</a>`;
}

function render() {
  if (!state.ready) {
    app.innerHTML = `<div class="empty">${state.error ? escHtml(state.error) : '載入中…'}</div>`;
    return;
  }
  const route = currentRoute();
  if (route !== 'admin') adminEditingId = null;
  renderNavigation(route);
  if (route.startsWith('people')) renderPeople();
  else if (route.startsWith('favorites')) renderFavorites();
  else if (route === 'payments') renderPayments();
  else if (route === 'unpaid') renderUnpaid();
  else if (route === 'admin') renderAdmin();
  else if (route === 'history') renderHistory();
  else if (route.startsWith('active-')) {
    const order = activeOrders().find(item => item.id === route.slice(7)) || activeOrders()[0];
    if (!order) renderCreateOrder();
    else renderActive(order);
  } else renderCreateOrder();
}

function menuFieldHtml(name = '', price = '') {
  return `<div class="menu-field"><input name="menuName" required placeholder="餐點名稱" value="${escHtml(name)}"><input name="menuPrice" required type="number" min="0" placeholder="金額" value="${escHtml(String(price))}"><button type="button" class="delete-person remove-menu" aria-label="刪除餐點">×</button></div>`;
}

function bindMenuRemovals(selector, min = 1) {
  document.querySelectorAll(`${selector} .remove-menu`).forEach(button => {
    button.onclick = async () => {
      const fields = document.querySelectorAll(`${selector} .menu-field`);
      if (fields.length <= min) {
        toast(`至少保留 ${min} 個餐點`);
        return;
      }
      const row = button.parentElement;
      const filled = [...row.querySelectorAll('input')].some(input => input.value.trim());
      if (filled && !await confirmAction({
        title: '移除餐點欄位',
        desc: '確定要移除此餐點欄位嗎？尚未儲存的內容會消失。',
        confirmText: '確定移除'
      })) return;
      row.remove();
    };
  });
}

function renderCreateOrder() {
  app.innerHTML = `
    ${state.error ? `<div class="banner-error">${escHtml(state.error)}</div>` : ''}
    <div class="hero-row"><div><div class="eyebrow">START A TEAM LUNCH</div><h1>開啟新訂單</h1><p class="hero-copy">設定餐廳、餐點和截止時間。建立後會立刻出現進行中分頁，同事可同時點餐且不會互相覆蓋。</p></div></div>
    <section class="form-card"><form id="order-form">
      <label>常用餐廳<select id="favorite-restaurant"><option value="">選擇後自動帶入餐點</option>${state.restaurants.map(item => `<option value="${item.id}">${escHtml(item.name)}</option>`).join('')}</select></label>
      <label>餐廳名稱<input name="restaurant" required placeholder="例如：日常食堂"></label>
      <label>截止時間<input name="deadlineAt" type="datetime-local" required></label>
      <div class="form-section">
        <div class="section-label"><h2>餐點選項</h2><button type="button" class="add-person" id="add-menu">＋ 增加餐點</button></div>
        <div id="menu-fields" class="menu-fields">${menuFieldHtml()}${menuFieldHtml()}</div>
      </div>
      <button class="primary-btn" type="submit">建立訂單並開放選餐</button>
    </form></section>
  `;
  document.querySelector('[name="deadlineAt"]').value = localDateTimeValue(new Date(Date.now() + 2 * 3600000));
  document.querySelector('#favorite-restaurant').onchange = event => {
    const restaurant = state.restaurants.find(item => item.id === event.target.value);
    if (!restaurant) return;
    const menu = state.restaurant_menu.filter(item => item.restaurant_id === restaurant.id).sort((a, b) => a.sort_order - b.sort_order);
    document.querySelector('[name="restaurant"]').value = restaurant.name;
    document.querySelector('#menu-fields').innerHTML = (menu.length ? menu : [{ name: '', price: '' }, { name: '', price: '' }])
      .map(item => menuFieldHtml(item.name, item.price ?? '')).join('');
    bindMenuRemovals('#menu-fields', 1);
  };
  document.querySelector('#add-menu').onclick = () => {
    document.querySelector('#menu-fields').insertAdjacentHTML('beforeend', menuFieldHtml());
    bindMenuRemovals('#menu-fields', 1);
  };
  bindMenuRemovals('#menu-fields', 1);
  document.querySelector('#order-form').onsubmit = createOrder;
}

async function createOrder(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const names = form.getAll('menuName').map(item => item.trim()).filter(Boolean);
  const prices = form.getAll('menuPrice');
  if (!names.length) return toast('請至少新增一個餐點');
  const restaurant = form.get('restaurant').trim();
  const deadlineAt = new Date(form.get('deadlineAt')).toISOString();
  const order = {
    id: uid(),
    restaurant_name: restaurant,
    icon: '🍜',
    deadline_at: deadlineAt,
    closed: false
  };
  const menu = names.map((name, index) => ({
    id: uid(),
    order_id: order.id,
    name,
    price: num(prices[index]),
    emoji: index % 2 ? '🍛' : '🍜',
    note: '',
    sort_order: index
  }));
  try {
    await dbInsert('orders', order);
    await dbInsert('order_menu', menu);
    await recordVersion(order, '建立訂單');
    location.hash = `#active-${order.id}`;
    render();
  } catch (error) {
    toast(error.message || '建立訂單失敗');
  }
}

function renderActive(order) {
  const draft = getDraft(order.id);
  const menu = menuFor(order.id);
  const items = itemsFor(order.id);
  const selectedMenu = menu.find(item => item.id === draft.selectedMenuId);
  const qty = Math.max(1, num(draft.qty) || 1);
  const peopleCount = draft.selectedPeople.length;
  const estimate = selectedMenu ? num(selectedMenu.price) * qty * peopleCount : 0;
  const liveRows = items.map(item => {
    const person = personById(item.person_id);
    return `<div class="live-row">${personFaceHtml(person, item.person_name)}<span class="live-name">${escHtml(item.person_name)}</span><span class="live-food">${escHtml(item.menu_name)}${item.qty > 1 ? ` × ${item.qty}` : ''}${item.note ? ` · ${escHtml(item.note)}` : ''}</span><strong>${money(itemAmount(item))}</strong><button class="delete-person" data-delete-item="${item.id}" aria-label="刪除明細">×</button></div>`;
  }).join('');

  app.innerHTML = `
    <div class="hero-row">
      <div>
        <div class="eyebrow">OPEN ORDER · ${escHtml(deadlineLabel(order))}</div>
        <h1>一起點午餐</h1>
        <p class="hero-copy">${escHtml(order.restaurant_name)} · 選人名、餐點與數量後送出。每人可幫同事點，資料即時同步。</p>
      </div>
      <div class="hero-actions">
        <a class="outline-btn" href="#new-order">＋ 再開一單</a>
        <button class="primary-btn" id="close-order">截止並結算</button>
      </div>
    </div>
    <section class="order-card">
      <div class="order-head">
        <div class="order-title">
          <span class="order-icon">${escHtml(order.icon || '🍜')}</span>
          <div>
            <h3>${escHtml(order.restaurant_name)}</h3>
            <p>截止 ${escHtml(deadlineLabel(order))} · 已送出 ${orderQty(order.id)} 份</p>
          </div>
        </div>
        <span class="status"><i></i>開放中</span>
      </div>
      <div class="order-body">
        <div class="menu-side">
          <h4>選擇餐點</h4>
          <p class="selection-hint">先選餐點，再選訂餐人與數量</p>
          <div class="food-list">
            ${menu.map(item => `<button class="food-option ${draft.selectedMenuId === item.id ? 'selected' : ''}" data-menu="${item.id}"><span class="food-info"><span class="food-emoji">${escHtml(item.emoji || '🍜')}</span><span>${escHtml(item.name)}${item.note ? `<small class="food-note">${escHtml(item.note)}</small>` : ''}</span></span><span class="price">${money(item.price)}</span></button>`).join('')}
          </div>
          <label class="note-field">訂單備註<input id="order-note" value="${escHtml(draft.note)}" placeholder="例如：不加香菜、少冰、要餐具"></label>
        </div>
        <div class="people-side">
          <div class="people-head">
            <h4>選取訂餐人</h4>
            <a class="add-person" href="#people">管理名單 →</a>
          </div>
          <p class="selection-hint">${selectedMenu ? '可同時幫多位同事點同一餐' : '請先從左側選擇餐點'}</p>
          <div class="people-grid">
            ${peopleGrouped().map(person => {
              const selected = draft.selectedPeople.includes(person.id);
              return `<button class="person ${selected ? 'selected' : ''}" data-person="${person.id}" ${selectedMenu ? '' : 'disabled'}>${personFaceHtml(person)}<span class="person-name">${escHtml(person.name)}</span><span class="person-check">${selected ? '✓' : ''}</span></button>`;
            }).join('') || '<div class="empty">請先到人員名單新增同事</div>'}
          </div>
        </div>
      </div>
      <div class="summary-bar">
        <div class="qty-box">
          <span>數量</span>
          <div class="qty-control">
            <button type="button" id="qty-minus" aria-label="減少">−</button>
            <input id="order-qty" type="number" min="1" value="${qty}">
            <button type="button" id="qty-plus" aria-label="增加">+</button>
          </div>
        </div>
        <div class="summary-copy"><strong>${peopleCount} 人</strong>× ${qty} 份 · 預估總額</div>
        <span class="total">${money(estimate)}</span>
        <button class="primary-btn" id="confirm-order">送出點餐</button>
      </div>
    </section>
    ${items.length ? `<section class="live-info"><div class="section-label"><h2>目前訂單狀態</h2><span>即時 ${orderQty(order.id)} 份 · ${money(orderTotal(order.id))}</span></div>${liveRows}</section>` : ''}
  `;

  document.querySelectorAll('[data-menu]').forEach(button => {
    button.onclick = () => {
      draft.selectedMenuId = button.dataset.menu;
      saveDrafts();
      render();
    };
  });
  document.querySelector('#order-note').oninput = event => {
    draft.note = event.target.value;
    saveDrafts();
  };
  document.querySelectorAll('[data-person]').forEach(button => {
    button.onclick = () => {
      const id = button.dataset.person;
      draft.selectedPeople = draft.selectedPeople.includes(id)
        ? draft.selectedPeople.filter(item => item !== id)
        : [...draft.selectedPeople, id];
      saveDrafts();
      render();
    };
  });
  const qtyInput = document.querySelector('#order-qty');
  const setQty = value => {
    draft.qty = Math.max(1, num(value) || 1);
    saveDrafts();
    render();
  };
  document.querySelector('#qty-minus').onclick = () => setQty(qty - 1);
  document.querySelector('#qty-plus').onclick = () => setQty(qty + 1);
  qtyInput.onchange = () => setQty(qtyInput.value);
  document.querySelector('#confirm-order').onclick = () => submitOrderItems(order);
  document.querySelector('#close-order').onclick = () => closeOrder(order);
  document.querySelectorAll('[data-delete-item]').forEach(button => {
    button.onclick = () => deleteOrderItem(order, button.dataset.deleteItem);
  });
}

async function submitOrderItems(order) {
  const draft = getDraft(order.id);
  const menuItem = menuFor(order.id).find(item => item.id === draft.selectedMenuId);
  const people = draft.selectedPeople.map(personById).filter(Boolean);
  const qty = Math.max(1, num(draft.qty) || 1);
  const note = (draft.note || '').trim();
  if (!menuItem) return toast('請先選擇餐點');
  if (!people.length) return toast('請選擇訂餐人');
  try {
    for (const person of people) {
      const existing = itemsFor(order.id).find(item => item.person_id === person.id && item.menu_id === menuItem.id && (item.note || '') === note);
      if (existing) {
        await dbUpdate('order_items', existing.id, { qty: num(existing.qty) + qty });
      } else {
        await dbInsert('order_items', {
          id: uid(),
          order_id: order.id,
          person_id: person.id,
          person_name: person.name,
          menu_id: menuItem.id,
          menu_name: menuItem.name,
          price: num(menuItem.price),
          qty,
          note,
          paid: false
        });
      }
    }
    draft.selectedPeople = [];
    draft.qty = 1;
    draft.note = '';
    draft.selectedMenuId = null;
    saveDrafts();
    await recordVersion(order, `送出 ${people.length} 人點餐`);
    render();
  } catch (error) {
    toast(error.message || '送出失敗，請再試一次');
  }
}

async function deleteOrderItem(order, itemId) {
  const item = state.order_items.find(row => row.id === itemId);
  if (!item) return;
  if (!await confirmAction({
    title: '刪除訂購明細',
    desc: `確定刪除 <strong>${escHtml(item.person_name)}</strong> 的 <strong>${escHtml(item.menu_name)}</strong> × ${item.qty} 嗎？`,
    confirmText: '確定刪除'
  })) return;
  await dbDelete('order_items', itemId);
  await recordVersion(order, `刪除 ${item.person_name} 的 ${item.menu_name}`);
  render();
}

async function closeOrder(order) {
  const remaining = new Date(order.deadline_at).getTime() - Date.now();
  const ok = remaining > 0
    ? await confirmAction({
      title: '提早結單確認',
      desc: `目前此訂單原定截止時間為 <strong>${escHtml(deadlineLabel(order))}</strong>。<br>距離截止尚有 <strong class="text-highlight">${formatTimeDiff(remaining)}</strong>，確定要提早截止嗎？`,
      notice: '<div>• 提早結單後同仁將<strong>無法繼續選餐</strong>。</div><div>• 訂單會移至「歷史訂單」與「付款確認」。</div>',
      confirmText: '確認提早結單'
    })
    : await confirmAction({
      title: '截止並結算',
      desc: `確定結束「${escHtml(order.restaurant_name)}」這筆訂單嗎？`,
      confirmText: '確定結單',
      danger: false
    });
  if (!ok) return;
  await dbUpdate('orders', order.id, { closed: true });
  await recordVersion({ ...order, closed: true }, remaining > 0 ? '提早結單' : '手動結單');
  location.hash = '#history';
  render();
}

function renderPeople() {
  const editingId = location.hash.startsWith('#people-edit-') ? location.hash.replace('#people-edit-', '') : null;
  const editing = state.people.find(item => item.id === editingId);
  const showForm = editing || location.hash === '#people-new';
  app.innerHTML = `
    <div class="hero-row">
      <div>
        <div class="eyebrow">PEOPLE DIRECTORY</div>
        <h1>人員名單</h1>
        <p class="hero-copy">頭像顏色用來區分部門，點餐時可一鍵幫同事下單。</p>
      </div>
      <button class="primary-btn" id="add-person-page">＋ 新增同事</button>
    </div>
    <div class="color-legend">${COLOR_ORDER.map(key => `<span><i style="background:${COLOR_MAP[key].bg}"></i>${COLOR_MAP[key].label}色部門</span>`).join('')}</div>
    ${showForm ? personForm(editing) : ''}
    ${state.people.length ? `<div class="people-list">${peopleGrouped().map(person => `
      <div class="person-row">
        ${personFaceHtml(person)}
        <span class="person-name-text">${escHtml(person.name)}</span>
        <div class="favorite-actions">
          <a class="outline-btn" href="#people-edit-${person.id}">編輯</a>
          <button class="delete-person" data-delete="${person.id}" aria-label="刪除 ${escHtml(person.name)}">×</button>
        </div>
      </div>`).join('')}</div>` : '<div class="empty">還沒有人員名單，先新增一位吧</div>'}
  `;
  document.querySelector('#add-person-page').onclick = () => { location.hash = '#people-new'; render(); };
  document.querySelectorAll('[data-delete]').forEach(button => {
    button.onclick = async () => {
      const person = personById(button.dataset.delete);
      if (!await confirmAction({
        title: '刪除同事',
        desc: `確定刪除「<strong>${escHtml(person?.name || '')}</strong>」嗎？歷史訂單仍會保留當時的姓名紀錄。`,
        confirmText: '確定刪除'
      })) return;
      await dbDelete('people', person.id);
      render();
    };
  });
  if (showForm) bindPersonForm(editing);
}

function personForm(existing) {
  const selected = existing?.color || 'white';
  return `
    <section class="form-card person-form"><form id="person-form">
      <label>同事姓名<input name="personName" required value="${escHtml(existing?.name || '')}" placeholder="例如：王小明" autofocus></label>
      <div class="color-picker-group">
        <span class="color-picker-label">部門顏色</span>
        <div class="color-picker">
          ${COLOR_ORDER.map(key => {
            const c = COLOR_MAP[key];
            return `<label class="color-option${selected === key ? ' selected' : ''}" title="${c.label}色">
              <input type="radio" name="personColor" value="${key}" ${selected === key ? 'checked' : ''}>
              <span class="color-swatch" style="background:${c.bg};color:${c.text}"></span>
            </label>`;
          }).join('')}
        </div>
      </div>
      <div class="favorite-form-actions">
        <button type="button" class="outline-btn" id="cancel-person">取消</button>
        <button class="primary-btn" type="submit">${existing ? '儲存修改' : '儲存同事'}</button>
      </div>
    </form></section>
  `;
}

function bindPersonForm(existing) {
  document.querySelectorAll('[name="personColor"]').forEach(radio => {
    radio.onchange = () => {
      document.querySelectorAll('.color-option').forEach(opt => opt.classList.remove('selected'));
      radio.closest('.color-option').classList.add('selected');
    };
  });
  document.querySelector('#cancel-person').onclick = () => { location.hash = '#people'; render(); };
  document.querySelector('#person-form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = form.get('personName').trim();
    const color = form.get('personColor') || 'white';
    if (!name) return;
    if (existing) await dbUpdate('people', existing.id, { name, face: name[0], color });
    else await dbInsert('people', { id: uid(), name, face: name[0], color });
    location.hash = '#people';
    render();
  };
}

function renderFavorites() {
  const editingId = location.hash.startsWith('#favorites-edit-') ? location.hash.replace('#favorites-edit-', '') : null;
  const editing = state.restaurants.find(item => item.id === editingId);
  const showForm = editing || location.hash === '#favorites-new';
  app.innerHTML = `
    <div class="hero-row">
      <div><div class="eyebrow">FREQUENT RESTAURANTS</div><h1>常用餐廳</h1><p class="hero-copy">儲存常點的餐廳與餐點，開單時一鍵帶入。</p></div>
      <button class="primary-btn" id="add-favorite">＋ 新增餐廳</button>
    </div>
    ${showForm ? favoriteForm(editing) : ''}
    ${state.restaurants.length ? `<div class="favorite-list">${state.restaurants.map(item => {
      const menu = state.restaurant_menu.filter(row => row.restaurant_id === item.id).sort((a, b) => a.sort_order - b.sort_order);
      return `<article class="favorite-card"><div class="favorite-view"><div><h3>${escHtml(item.name)}</h3><div class="favorite-menu">${menu.map(food => `<span>${escHtml(food.name)} <b>${money(food.price)}</b></span>`).join('')}</div></div><div class="favorite-actions"><a class="outline-btn" href="#favorites-edit-${item.id}">編輯</a><button class="delete-person" data-delete-favorite="${item.id}">×</button></div></div></article>`;
    }).join('')}</div>` : '<div class="empty">還沒有常用餐廳，先新增一間吧</div>'}
  `;
  document.querySelector('#add-favorite').onclick = () => { location.hash = '#favorites-new'; render(); };
  document.querySelectorAll('[data-delete-favorite]').forEach(button => {
    button.onclick = async () => {
      const restaurant = state.restaurants.find(item => item.id === button.dataset.deleteFavorite);
      if (!await confirmAction({
        title: '刪除常用餐廳',
        desc: `確定刪除「<strong>${escHtml(restaurant?.name || '')}</strong>」及其餐點嗎？進行中的訂單不會受影響。`,
        confirmText: '確定刪除'
      })) return;
      await dbDelete('restaurants', restaurant.id);
      state.restaurant_menu = state.restaurant_menu.filter(item => item.restaurant_id !== restaurant.id);
      render();
    };
  });
  if (showForm) bindFavoriteForm(editing);
}

function favoriteForm(existing) {
  const menu = existing
    ? state.restaurant_menu.filter(item => item.restaurant_id === existing.id).sort((a, b) => a.sort_order - b.sort_order)
    : [{}, {}];
  return `<section class="form-card favorite-form"><form id="favorite-form">
    <label>餐廳名稱<input name="favoriteName" required value="${escHtml(existing?.name || '')}" placeholder="例如：日常食堂"></label>
    <div class="form-section">
      <div class="section-label"><h2>常用餐點</h2><button type="button" class="add-person" id="add-favorite-menu">＋ 增加餐點</button></div>
      <div id="favorite-menu-fields" class="menu-fields">${(menu.length ? menu : [{}, {}]).map(item => menuFieldHtml(item.name, item.price ?? '')).join('')}</div>
    </div>
    <div class="favorite-form-actions">
      <button type="button" class="outline-btn" id="cancel-favorite">取消</button>
      <button class="primary-btn" type="submit">儲存常用餐廳</button>
    </div>
  </form></section>`;
}

function bindFavoriteForm(existing) {
  document.querySelector('#cancel-favorite').onclick = () => { location.hash = '#favorites'; render(); };
  document.querySelector('#add-favorite-menu').onclick = () => {
    document.querySelector('#favorite-menu-fields').insertAdjacentHTML('beforeend', menuFieldHtml());
    bindMenuRemovals('#favorite-menu-fields', 1);
  };
  bindMenuRemovals('#favorite-menu-fields', 1);
  document.querySelector('#favorite-form').onsubmit = async event => {
    event.preventDefault();
    const form = new FormData(event.target);
    const name = form.get('favoriteName').trim();
    const names = form.getAll('menuName');
    const prices = form.getAll('menuPrice');
    const menu = names.map((item, index) => ({ name: item.trim(), price: num(prices[index]) })).filter(item => item.name);
    const restaurantId = existing?.id || uid();
    if (existing) await dbUpdate('restaurants', existing.id, { name });
    else await dbInsert('restaurants', { id: restaurantId, name });
    const oldMenu = state.restaurant_menu.filter(item => item.restaurant_id === restaurantId);
    await Promise.all(oldMenu.map(item => dbDelete('restaurant_menu', item.id)));
    if (menu.length) {
      await dbInsert('restaurant_menu', menu.map((item, index) => ({
        id: uid(),
        restaurant_id: restaurantId,
        name: item.name,
        price: item.price,
        emoji: index % 2 ? '🍛' : '🍜',
        note: '',
        sort_order: index
      })));
    }
    location.hash = '#favorites';
    render();
  };
}

function renderPayments() {
  const orders = closedOrders();
  const totalPages = Math.ceil(orders.length / PAGE_SIZE) || 1;
  state.pagination.payments = Math.min(Math.max(1, state.pagination.payments || 1), totalPages);
  const page = state.pagination.payments;
  const paged = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagination = renderPagination('payments', orders.length, page);
  app.innerHTML = `
    <div class="hero-row"><div><div class="eyebrow">PAYMENT TRACKER</div><h1>付款確認</h1><p class="hero-copy">訂單截止後依人統計金額。點選姓名列後送出付款狀態，僅供紀錄。</p></div></div>
    ${orders.length ? `${pagination}<div class="payment-order-list">${paged.map(order => {
      const items = itemsFor(order.id);
      const paidItems = items.filter(item => item.paid);
      const paidTotal = paidItems.reduce((sum, item) => sum + itemAmount(item), 0);
      const rows = items.map(item => {
        const person = personById(item.person_id);
        const rowKey = item.id;
        if (item.paid) {
          return `<div class="payment-row payment-row-paid"><span class="payment-status-icon paid-icon">✓</span>${personFaceHtml(person, item.person_name)}<span class="payment-person">${escHtml(item.person_name)}</span><span class="payment-food">${escHtml(item.menu_name)} × ${item.qty}</span><strong>${money(itemAmount(item))}</strong></div>`;
        }
        const expanded = activePaymentRow === rowKey;
        return `<div class="payment-row payment-row-unpaid${expanded ? ' expanded' : ''}" data-payment-row="${rowKey}">
          <span class="payment-status-icon unpaid-icon">○</span>${personFaceHtml(person, item.person_name)}
          <span class="payment-person">${escHtml(item.person_name)}</span>
          <span class="payment-food">${escHtml(item.menu_name)} × ${item.qty}</span>
          <strong>${money(itemAmount(item))}</strong>
          ${expanded ? `<button class="primary-btn confirm-payment-btn" data-confirm-payment="${rowKey}">✓ 確認已付款</button>` : ''}
        </div>`;
      }).join('');
      return `<section class="payment-card"><div class="payment-card-head"><div><span class="eyebrow">${new Date(order.created_at).toLocaleDateString('zh-TW')}</span><h3>${escHtml(order.icon)} ${escHtml(order.restaurant_name)}</h3><p>截止 ${escHtml(deadlineLabel(order))}</p></div><div class="payment-summary"><strong class="paid-count">${paidItems.length} / ${items.length} 筆</strong><span class="paid-total">${money(paidTotal)} / ${money(orderTotal(order.id))}</span></div></div><div class="payment-rows">${rows || '<div class="empty-detail">沒有訂購明細</div>'}</div></section>`;
    }).join('')}</div>${pagination}` : '<div class="empty">還沒有已截止的訂單</div>'}
  `;
  document.querySelectorAll('[data-payment-row]').forEach(row => {
    row.onclick = event => {
      if (event.target.closest('[data-confirm-payment]')) return;
      activePaymentRow = activePaymentRow === row.dataset.paymentRow ? null : row.dataset.paymentRow;
      renderPayments();
    };
  });
  document.querySelectorAll('[data-confirm-payment]').forEach(btn => {
    btn.onclick = async event => {
      event.stopPropagation();
      const item = state.order_items.find(row => row.id === btn.dataset.confirmPayment);
      const order = state.orders.find(row => row.id === item?.order_id);
      await dbUpdate('order_items', item.id, { paid: true });
      if (order) await recordVersion(order, `確認 ${item.person_name} 已付款`);
      activePaymentRow = null;
      renderPayments();
    };
  });
  bindPagination('payments');
}

function renderUnpaid() {
  const summary = {};
  closedOrders().forEach(order => {
    itemsFor(order.id).forEach(item => {
      if (item.paid) return;
      const key = item.person_id || item.person_name;
      summary[key] ||= { person: personById(item.person_id), name: item.person_name, count: 0, amount: 0, rows: [] };
      summary[key].count += num(item.qty);
      summary[key].amount += itemAmount(item);
      summary[key].rows.push({
        date: new Date(order.created_at).toLocaleDateString('zh-TW'),
        text: `${order.restaurant_name} · ${item.menu_name} × ${item.qty} · ${money(itemAmount(item))}`
      });
    });
  });
  const people = Object.values(summary).sort((a, b) => b.amount - a.amount);
  const totalCount = people.reduce((sum, item) => sum + item.count, 0);
  const totalAmount = people.reduce((sum, item) => sum + item.amount, 0);
  const totalPages = Math.ceil(people.length / PAGE_SIZE) || 1;
  state.pagination.unpaid = Math.min(Math.max(1, state.pagination.unpaid || 1), totalPages);
  const page = state.pagination.unpaid;
  const paged = people.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagination = renderPagination('unpaid', people.length, page);
  app.innerHTML = `
    <div class="hero-row"><div><div class="eyebrow">UNPAID SUMMARY</div><h1>未繳費統計</h1><p class="hero-copy">依人名統計未繳費訂單、餐點與金額。</p></div></div>
    <div class="unpaid-total"><div><span>未繳費總份數</span><strong>${totalCount} 份</strong></div><div><span>未繳費總金額</span><strong>${money(totalAmount)}</strong></div></div>
    ${people.length ? `${pagination}<div class="unpaid-list">${paged.map(item => `
      <article class="unpaid-card">
        <div class="unpaid-person">${personFaceHtml(item.person, item.name)}<div><h3>${escHtml(item.name)}</h3><p>${item.count} 份未繳 · ${money(item.amount)}</p></div></div>
        <div class="unpaid-orders">${item.rows.map(row => `<div><span>${escHtml(row.date)}</span><span>${escHtml(row.text)}</span></div>`).join('')}</div>
      </article>`).join('')}</div>${pagination}` : '<div class="empty">目前沒有未繳費紀錄</div>'}
  `;
  bindPagination('unpaid');
}

function renderAdmin() {
  if (!adminUnlocked) {
    app.innerHTML = `<div class="people-page"><div class="eyebrow">ADMIN ACCESS</div><h1>管理者</h1><p class="hero-copy">輸入管理密碼後，可修改進行中與已截止訂單，並查看歷史變動。</p><section class="form-card admin-login-card"><form id="admin-login"><label>管理密碼<input name="password" type="password" inputmode="numeric" autocomplete="off" required placeholder="請輸入 6 位數密碼"></label><p id="admin-error" class="admin-error" hidden>密碼錯誤，請再試一次。</p><button class="primary-btn" type="submit">登入管理者</button></form></section></div>`;
    document.querySelector('#admin-login').onsubmit = event => {
      event.preventDefault();
      if (new FormData(event.target).get('password') === String(CONFIG.adminPassword)) {
        adminUnlocked = true;
        sessionStorage.setItem('lunch-admin-unlocked', 'true');
        render();
      } else document.querySelector('#admin-error').hidden = false;
    };
    return;
  }
  const editing = state.orders.find(item => item.id === adminEditingId);
  const allOrders = [...activeOrders(), ...closedOrders()];
  app.innerHTML = `
    <div class="hero-row"><div><div class="eyebrow">ADMIN CONSOLE</div><h1>管理者</h1><p class="hero-copy">可更改進行中與已截止訂單；每次儲存都會留下版本紀錄。</p></div><button class="outline-btn" id="admin-logout">登出</button></div>
    ${editing ? adminEditForm(editing) : ''}
    ${editing ? versionPanel(editing) : ''}
    ${allOrders.length ? `<div class="admin-order-list">${allOrders.map(order => `
      <article class="history-card admin-order-card">
        <div>
          <span class="eyebrow">${new Date(order.created_at).toLocaleDateString('zh-TW')}</span>
          <h3>${escHtml(order.icon)} ${escHtml(order.restaurant_name)} <span class="admin-badge ${isClosed(order) ? 'closed' : ''}">${isClosed(order) ? '已截止' : '進行中'}</span></h3>
          <p>截止 ${escHtml(deadlineLabel(order))} · ${orderQty(order.id)} 份 · ${money(orderTotal(order.id))}</p>
        </div>
        <div class="favorite-actions">
          <button class="outline-btn" data-admin-edit="${order.id}">編輯</button>
          <button class="delete-person" data-admin-delete="${order.id}">×</button>
        </div>
      </article>`).join('')}</div>` : '<div class="empty">還沒有訂單</div>'}
  `;
  document.querySelector('#admin-logout').onclick = () => {
    adminUnlocked = false;
    sessionStorage.removeItem('lunch-admin-unlocked');
    render();
  };
  document.querySelectorAll('[data-admin-edit]').forEach(button => {
    button.onclick = () => { adminEditingId = button.dataset.adminEdit; render(); };
  });
  document.querySelectorAll('[data-admin-delete]').forEach(button => {
    button.onclick = async () => {
      const order = state.orders.find(item => item.id === button.dataset.adminDelete);
      if (!await confirmAction({
        title: '刪除整筆訂單',
        desc: `確定刪除「<strong>${escHtml(order?.restaurant_name || '')}</strong>」嗎？餐點明細與版本紀錄會一併移除。`,
        confirmText: '確定刪除整筆訂單'
      })) return;
      await dbDelete('orders', order.id);
      state.order_menu = state.order_menu.filter(item => item.order_id !== order.id);
      state.order_items = state.order_items.filter(item => item.order_id !== order.id);
      state.order_versions = state.order_versions.filter(item => item.order_id !== order.id);
      adminEditingId = null;
      render();
    };
  });
  if (editing) bindAdminEdit(editing);
}

function adminEditForm(order) {
  const menu = menuFor(order.id);
  const items = itemsFor(order.id);
  return `<section class="form-card admin-edit-card"><form id="admin-edit-form">
    <h2>編輯訂單</h2>
    <label>餐廳名稱<input name="restaurant" required value="${escHtml(order.restaurant_name)}"></label>
    <label>截止時間<input name="deadlineAt" type="datetime-local" required value="${localDateTimeValue(new Date(order.deadline_at))}"></label>
    <label>訂單狀態<select name="closed"><option value="open" ${order.closed ? '' : 'selected'}>進行中</option><option value="closed" ${order.closed ? 'selected' : ''}>已截止</option></select></label>
    <div class="form-section">
      <div class="section-label"><h2>訂購明細</h2><button type="button" class="add-person" id="add-admin-entry">＋ 新增明細</button></div>
      <div id="admin-entry-fields">${items.map(item => adminEntryField(item, menu)).join('')}</div>
    </div>
    <div class="form-section">
      <div class="section-label"><h2>餐點設定</h2><button type="button" class="add-person" id="add-admin-menu">＋ 增加餐點</button></div>
      <div id="admin-menu-fields">${menu.map(item => `<div class="menu-field" data-menu-id="${item.id}"><input name="adminMenuName" required value="${escHtml(item.name)}"><input name="adminMenuPrice" required type="number" min="0" value="${escHtml(String(item.price))}"><input name="adminMenuNote" value="${escHtml(item.note || '')}" placeholder="備註"><button type="button" class="delete-person remove-menu" aria-label="刪除餐點">×</button></div>`).join('')}</div>
    </div>
    <div class="favorite-form-actions">
      <button type="button" class="outline-btn" id="cancel-admin-edit">取消</button>
      <button class="primary-btn" type="submit">儲存修改</button>
    </div>
  </form></section>`;
}

function adminEntryField(item, menu) {
  const id = item?.id || `new-${uid()}`;
  const selectedMenu = item?.menu_id || menu[0]?.id || '';
  return `<div class="admin-entry-field" data-entry="${id}">
    <input name="entryPerson" required value="${escHtml(item?.person_name || '')}" placeholder="姓名">
    <select name="entryMenu">${menu.map(food => `<option value="${food.id}" ${food.id === selectedMenu ? 'selected' : ''}>${escHtml(food.name)}</option>`).join('')}</select>
    <input name="entryQty" required type="number" min="1" value="${escHtml(String(item?.qty || 1))}" placeholder="數量">
    <input name="entryPrice" required type="number" min="0" value="${escHtml(String(item?.price || 0))}" placeholder="單價">
    <input name="entryNote" value="${escHtml(item?.note || '')}" placeholder="備註">
    <select name="entryPaid"><option value="unpaid" ${item?.paid ? '' : 'selected'}>未繳</option><option value="paid" ${item?.paid ? 'selected' : ''}>已繳</option></select>
    <button type="button" class="delete-person remove-admin-entry">×</button>
  </div>`;
}

function versionDetailsHtml(snapshot) {
  const items = snapshot?.items || [];
  return items.length
    ? `<div class="version-details">${items.map(item => `<span><b>${escHtml(item.person_name)}</b> · ${escHtml(item.menu_name)} × ${item.qty || 1} <em>${money(itemAmount(item))}</em></span>`).join('')}</div>`
    : '<span class="version-empty">尚無訂購明細</span>';
}

function versionPanel(order) {
  const versions = versionsFor(order.id);
  if (!versions.length) return '';
  return `<section class="version-card"><div class="section-label"><h2>版本紀錄</h2><span>最近 ${versions.length} 筆</span></div><p class="version-hint">每次訂單與餐點變動都會留下紀錄，可還原到先前版本。</p><div class="version-list">${versions.map(version => `
    <div class="version-row"><div><strong>${escHtml(version.action)}</strong><span>${new Date(version.created_at).toLocaleString('zh-TW')}</span>${versionDetailsHtml(version.snapshot)}</div><button type="button" class="outline-btn" data-restore-version="${version.id}">還原此版本</button></div>`).join('')}</div></section>`;
}

function bindAdminEdit(order) {
  document.querySelector('#cancel-admin-edit').onclick = () => { adminEditingId = null; render(); };
  document.querySelector('#add-admin-menu').onclick = () => {
    document.querySelector('#admin-menu-fields').insertAdjacentHTML('beforeend', `<div class="menu-field" data-menu-id="${uid()}"><input name="adminMenuName" required placeholder="餐點名稱"><input name="adminMenuPrice" required type="number" min="0" placeholder="金額"><input name="adminMenuNote" placeholder="備註"><button type="button" class="delete-person remove-menu">×</button></div>`);
    bindMenuRemovals('#admin-menu-fields', 1);
  };
  bindMenuRemovals('#admin-menu-fields', 1);
  document.querySelector('#add-admin-entry').onclick = () => {
    document.querySelector('#admin-entry-fields').insertAdjacentHTML('beforeend', adminEntryField(null, menuFor(order.id)));
    bindAdminEntryRemovals();
  };
  bindAdminEntryRemovals();
  document.querySelectorAll('[data-restore-version]').forEach(button => {
    button.onclick = () => restoreVersion(order, button.dataset.restoreVersion);
  });
  document.querySelector('#admin-edit-form').onsubmit = event => saveAdminEdit(event, order);
}

function bindAdminEntryRemovals() {
  document.querySelectorAll('.remove-admin-entry').forEach(button => {
    button.onclick = async () => {
      if (!await confirmAction({
        title: '移除明細',
        desc: '確定移除此筆訂購明細嗎？儲存後才會寫入資料庫。',
        confirmText: '確定移除'
      })) return;
      button.parentElement.remove();
    };
  });
}

async function saveAdminEdit(event, order) {
  event.preventDefault();
  const form = event.target;
  const restaurant = form.restaurant.value.trim();
  const deadlineAt = new Date(form.deadlineAt.value).toISOString();
  const closed = form.closed.value === 'closed';
  const menuFields = [...document.querySelectorAll('#admin-menu-fields .menu-field')];
  const entryFields = [...document.querySelectorAll('#admin-entry-fields .admin-entry-field')];
  const newMenu = menuFields.map((field, index) => ({
    id: field.dataset.menuId || uid(),
    order_id: order.id,
    name: field.querySelector('[name="adminMenuName"]').value.trim(),
    price: num(field.querySelector('[name="adminMenuPrice"]').value),
    note: field.querySelector('[name="adminMenuNote"]').value.trim(),
    emoji: menuFor(order.id)[index]?.emoji || (index % 2 ? '🍛' : '🍜'),
    sort_order: index
  }));
  const menuNameById = Object.fromEntries(newMenu.map(item => [item.id, item]));
  const newItems = entryFields.map(field => {
    const old = itemsFor(order.id).find(item => item.id === field.dataset.entry);
    const personName = field.querySelector('[name="entryPerson"]').value.trim();
    const person = state.people.find(item => item.name === personName) || personById(old?.person_id);
    const menuId = field.querySelector('[name="entryMenu"]').value;
    return {
      id: old?.id || uid(),
      order_id: order.id,
      person_id: person?.id || null,
      person_name: personName,
      menu_id: menuId || null,
      menu_name: menuNameById[menuId]?.name || old?.menu_name || '餐點',
      price: num(field.querySelector('[name="entryPrice"]').value),
      qty: Math.max(1, num(field.querySelector('[name="entryQty"]').value)),
      note: field.querySelector('[name="entryNote"]').value.trim(),
      paid: field.querySelector('[name="entryPaid"]').value === 'paid',
      created_at: old?.created_at || new Date().toISOString()
    };
  });
  try {
    await dbUpdate('orders', order.id, { restaurant_name: restaurant, deadline_at: deadlineAt, closed });
    const oldMenu = menuFor(order.id);
    const oldItems = itemsFor(order.id);
    await Promise.all(oldItems.map(item => dbDelete('order_items', item.id)));
    await Promise.all(oldMenu.map(item => dbDelete('order_menu', item.id)));
    if (newMenu.length) await dbInsert('order_menu', newMenu);
    if (newItems.length) await dbInsert('order_items', newItems);
    const updated = state.orders.find(item => item.id === order.id);
    await recordVersion(updated, '管理者修改訂單');
    adminEditingId = null;
    render();
  } catch (error) {
    toast(error.message || '儲存失敗');
  }
}

async function restoreVersion(order, versionId) {
  const version = versionsFor(order.id).find(item => item.id === versionId);
  if (!version) return;
  if (!await confirmAction({
    title: '還原版本',
    desc: `確定還原「<strong>${escHtml(version.action)}</strong>」這個版本嗎？目前內容會被覆蓋。`,
    confirmText: '確定還原',
    danger: false
  })) return;
  const snap = version.snapshot || {};
  try {
    if (snap.order) {
      await dbUpdate('orders', order.id, {
        restaurant_name: snap.order.restaurant_name,
        deadline_at: snap.order.deadline_at,
        closed: !!snap.order.closed,
        icon: snap.order.icon || '🍜'
      });
    }
    await Promise.all(itemsFor(order.id).map(item => dbDelete('order_items', item.id)));
    await Promise.all(menuFor(order.id).map(item => dbDelete('order_menu', item.id)));
    if (snap.menu?.length) await dbInsert('order_menu', snap.menu.map(item => ({ ...item, order_id: order.id })));
    if (snap.items?.length) await dbInsert('order_items', snap.items.map(item => ({ ...item, order_id: order.id })));
    await recordVersion(state.orders.find(item => item.id === order.id), `由版本紀錄還原：${version.action}`);
    render();
  } catch (error) {
    toast(error.message || '還原失敗');
  }
}

function renderHistory() {
  const orders = closedOrders();
  const totalMeals = orders.reduce((sum, order) => sum + orderQty(order.id), 0);
  const totalAmount = orders.reduce((sum, order) => sum + orderTotal(order.id), 0);
  const totalPages = Math.ceil(orders.length / PAGE_SIZE) || 1;
  state.pagination.history = Math.min(Math.max(1, state.pagination.history || 1), totalPages);
  const page = state.pagination.history;
  const paged = orders.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pagination = renderPagination('history', orders.length, page);
  const cards = paged.map(order => {
    const items = itemsFor(order.id);
    const menu = menuFor(order.id);
    const qty = orderQty(order.id);
    const total = orderTotal(order.id);
    const counts = {};
    items.forEach(item => {
      const key = item.menu_id || item.menu_name;
      counts[key] ||= { name: item.menu_name, price: item.price, count: 0, subtotal: 0, emoji: menu.find(food => food.id === item.menu_id)?.emoji || '🍱' };
      counts[key].count += num(item.qty);
      counts[key].subtotal += itemAmount(item);
    });
    const quantityRows = Object.values(counts).map(item => `
      <div class="history-quantity-chip"><span class="quantity-chip-emoji">${escHtml(item.emoji)}</span><div class="quantity-chip-info"><strong>${escHtml(item.name)}</strong><span class="quantity-chip-unit">${money(item.price)} / 份</span></div><span class="quantity-chip-count">× ${item.count} 份</span><b class="quantity-chip-subtotal">${money(item.subtotal)}</b></div>`).join('');
    const peopleRows = items.map(item => `<div class="history-detail-row">${personFaceHtml(personById(item.person_id), item.person_name)}<strong>${escHtml(item.person_name)}</strong><span>${escHtml(item.menu_name)} × ${item.qty}${item.note ? ` · ${escHtml(item.note)}` : ''}</span><b>${money(itemAmount(item))}</b></div>`).join('');
    const menuRows = menu.map(item => `<span>${escHtml(item.emoji || '🍛')} ${escHtml(item.name)} <b>${money(item.price)}</b></span>`).join('');
    return `<article class="history-card history-card-detailed"><div class="history-main">
      <div class="history-head-row"><div><span class="eyebrow">${new Date(order.created_at).toLocaleDateString('zh-TW')}</span><h3>${escHtml(order.icon)} ${escHtml(order.restaurant_name)}</h3><p>截止 ${escHtml(deadlineLabel(order))} · 共 ${items.length} 筆明細</p></div><div class="history-order-pills"><span class="pill-badge pill-count">${qty} 份餐點</span><span class="pill-badge pill-total">${money(total)}</span></div></div>
      <div class="history-section"><div class="history-section-title"><small>各項餐點數量統計</small><span class="history-section-count">總計 ${qty} 份</span></div><div class="history-quantity-grid">${quantityRows || '<span class="empty-detail">沒有餐點數量</span>'}</div></div>
      <div class="history-section"><div class="history-section-title"><small>訂購人員明細</small><span class="history-section-count">${items.length} 筆</span></div><div class="history-details-list">${peopleRows || '<span class="empty-detail">沒有訂購明細</span>'}</div></div>
      <div class="history-section"><div class="history-section-title"><small>完整菜單選項</small></div><div class="history-menu-list">${menuRows}</div></div>
    </div>
    <div class="history-stats"><div class="history-stat-box"><span class="stat-label">餐點總份數</span><strong class="stat-value">${qty} 份</strong></div><div class="history-stat-box"><span class="stat-label">訂單總金額</span><strong class="stat-value highlight">${money(total)}</strong></div><div class="history-stat-box"><span class="stat-label">平均單份價格</span><span class="stat-avg">${money(qty ? Math.round(total / qty) : 0)} / 份</span></div></div></article>`;
  }).join('') || '<div class="empty">還沒有已截止的訂單</div>';

  app.innerHTML = `
    <div class="hero-row"><div><div class="eyebrow">ORDER ARCHIVE</div><h1>歷史訂單</h1><p class="hero-copy">查詢已截止訂單，並統計各餐點份數與金額，方便電話叫餐。</p></div></div>
    ${orders.length ? `<div class="history-dashboard"><div class="history-dashboard-metrics">
      <div class="metric-card"><span class="metric-label">歷史訂單數</span><strong>${orders.length} <small>筆</small></strong><span class="metric-sub">累計已結算單數</span></div>
      <div class="metric-card highlight"><span class="metric-label">總訂購餐點數</span><strong>${totalMeals} <small>份</small></strong><span class="metric-sub">全期訂購餐點份數</span></div>
      <div class="metric-card"><span class="metric-label">歷史累積總額</span><strong>${money(totalAmount)}</strong><span class="metric-sub">平均每份 ${money(totalMeals ? Math.round(totalAmount / totalMeals) : 0)}</span></div>
    </div></div>` : ''}
    ${pagination}
    <div class="history-order-list">${cards}</div>
    ${orders.length ? pagination : ''}
  `;
  bindPagination('history');
}

document.querySelector('.avatar')?.addEventListener('click', () => {
  document.querySelector('#avatar-message')?.remove();
  document.body.insertAdjacentHTML('beforeend', `<div id="avatar-message" class="avatar-message" role="status"><span>🍱</span><p>請點餐，不是點我！</p><button type="button" aria-label="關閉">×</button></div>`);
  const message = document.querySelector('#avatar-message');
  message.querySelector('button').onclick = () => message.remove();
  setTimeout(() => message.remove(), 3200);
});

window.addEventListener('hashchange', render);

async function init() {
  if (!supabaseClient) {
    state.error = '找不到 Supabase 設定，請檢查 config.js。';
    state.ready = true;
    render();
    return;
  }
  try {
    await loadAll();
    state.ready = true;
    const active = activeOrders();
    if (active.length && (!location.hash || location.hash === '#' || location.hash === '#new-order')) {
      history.replaceState(null, '', `#active-${active[0].id}`);
    }
    render();
    subscribeRealtime();
    await closeExpiredOrders();
    setInterval(closeExpiredOrders, 30000);
  } catch (error) {
    state.error = `資料庫連線失敗：${error.message || error}。請先在 Supabase SQL Editor 執行 supabase-schema.sql。`;
    state.ready = true;
    render();
  }
}

init();
