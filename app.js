
'use strict';

/* =========================================================
   EasyDoc — Complete Updated App
   File: js/app.js
   ========================================================= */

const CFG = window.EASYDOC_CONFIG || {};
const FREE = Number(CFG.FREE_GUEST_INVOICES ?? 1);
const $ = selector => document.querySelector(selector);

/* Always resolve logo from the website root */
const LOGO_URL = new URL('./logo.png', document.baseURI).href;

const sb = (
  window.supabase &&
  CFG.SUPABASE_URL &&
  CFG.SUPABASE_ANON_KEY &&
  !/PASTE/i.test(CFG.SUPABASE_ANON_KEY)
) ? window.supabase.createClient(
  CFG.SUPABASE_URL,
  CFG.SUPABASE_ANON_KEY
) : null;

/* Helpers */
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[c]));

const num = value => Number(value || 0).toLocaleString('en-IN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const inr = value => '₹' + num(value);
const rs = value => 'Rs. ' + num(value);

const kfmt = value => {
  const n = Number(value || 0);
  return n >= 1000
    ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace('.0', '') + 'K'
    : String(n);
};

const today = () => {
  const d = new Date();
  const offset = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offset).toISOString().slice(0, 10);
};

const toast = message => {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = message;
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
};

const page = html => {
  const app = $('#app');
  if (!app) return;
  app.innerHTML = html;
  window.scrollTo({ top: 0, behavior: 'instant' });
};

const go = hash => {
  location.hash = hash;
};

const backBtn = (to = '#/home') => `
  <button class="ios-back-btn" onclick="go('${to}')">
    <svg width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round">
      <polyline points="15 18 9 12 15 6"/>
    </svg>
    Back
  </button>
`;

const svgInv = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
stroke="currentColor" stroke-width="2" aria-hidden="true">
<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
<polyline points="14 2 14 8 20 8"/>
<line x1="16" y1="13" x2="8" y2="13"/>
<line x1="16" y1="17" x2="8" y2="17"/>
</svg>`;

const svgImg = `
<svg width="20" height="20" viewBox="0 0 24 24" fill="none"
stroke="currentColor" stroke-width="2" aria-hidden="true">
<rect x="3" y="3" width="18" height="18" rx="2"/>
<circle cx="8.5" cy="8.5" r="1.5"/>
<polyline points="21 15 16 10 5 21"/>
</svg>`;

const fallbackLogo = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#2563eb"/><path d="M22 36l6 6 14-14" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)}`;

const logoSrc = logo => logo || LOGO_URL;

/* =========================================================
   IndexedDB
   ========================================================= */

const IDB = new Promise((resolve, reject) => {
  if (!window.indexedDB) {
    reject(new Error('This browser does not support local storage.'));
    return;
  }

  const request = indexedDB.open('easydoc', 1);

  request.onupgradeneeded = () => {
    const db = request.result;

    ['invoices', 'pdfs', 'meta', 'conv'].forEach(name => {
      if (!db.objectStoreNames.contains(name)) {
        db.createObjectStore(name, { keyPath: 'id' });
      }
    });
  };

  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const st = async (store, mode, action) => {
  const db = await IDB;

  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.onabort = () => reject(tx.error || new Error('Database transaction failed'));
  });
};

const dbAll = store => st(store, 'readonly', objectStore => objectStore.getAll());
const dbGet = (store, id) => st(store, 'readonly', objectStore => objectStore.get(id));
const dbPut = (store, value) => st(store, 'readwrite', objectStore => objectStore.put(value));
const dbDel = (store, id) => st(store, 'readwrite', objectStore => objectStore.delete(id));

/* =========================================================
   State and invoice calculations
   ========================================================= */

const S = {
  user: null,
  biz: null,
  inv: null,
  after: null
};

const calc = invoice => {
  const items = Array.isArray(invoice.items) ? invoice.items : [];
  const sub = items.reduce(
    (sum, item) => sum + (Number(item.q) || 0) * (Number(item.p) || 0),
    0
  );

  const discount = Math.max(0, Number(invoice.disc) || 0);
  const total = Math.max(0, sub - discount);
  const paid = Math.max(0, Number(invoice.paid) || 0);
  const balance = Math.max(0, total - paid);

  return {
    sub,
    tot: total,
    bal: balance,
    status: paid <= 0
      ? 'Unpaid'
      : paid >= total && total > 0
        ? 'Paid'
        : 'Partially Paid'
  };
};

const newInv = template => ({
  id: crypto.randomUUID(),
  no: 'INV-' + today().replace(/-/g, '') + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase(),
  date: today(),
  due: '',
  tpl: template,
  cust: { name: '', phone: '', addr: '' },
  items: [{ n: '', q: 1, p: 0 }],
  disc: 0,
  paid: 0,
  saved: false,
  synced: false,
  published: false,
  token: '',
  updatedAt: new Date().toISOString()
});

const token = () => [...crypto.getRandomValues(new Uint8Array(24))]
  .map(byte => byte.toString(16).padStart(2, '0'))
  .join('');

const dl = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

async function shareBlob(blob, name) {
  const file = new File([blob], name, { type: 'application/pdf' });

  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.warn('Sharing failed; downloading instead.', error);
    }
  }

  dl(blob, name);
  toast('PDF downloaded. Direct sharing is unavailable.');
}

const imgToData = (file, max, type = 'image/png', quality = 0.9) =>
  new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('Please select an image'));
      return;
    }

    const image = new Image();
    const url = URL.createObjectURL(file);

    image.onload = () => {
      const ratio = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');

      canvas.width = Math.max(1, Math.round(image.width * ratio));
      canvas.height = Math.max(1, Math.round(image.height * ratio));

      const context = canvas.getContext('2d');

      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error('Could not process this image'));
        return;
      }

      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      try {
        const data = canvas.toDataURL(type, quality);
        URL.revokeObjectURL(url);
        resolve({ d: data, w: canvas.width, h: canvas.height });
      } catch (error) {
        URL.revokeObjectURL(url);
        reject(error);
      }
    };

    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unsupported image'));
    };

    image.src = url;
  });

/* =========================================================
   Invoice templates
   ========================================================= */

const TPL = [
  { n: 'Classic Professional', c: [30, 41, 59], f: 'times', h: 'line', t: 'grid' },
  { n: 'Modern Blue', c: [37, 99, 235], f: 'helvetica', h: 'band', t: 'striped' },
  { n: 'Minimal White', c: [90, 90, 90], f: 'helvetica', h: 'plain', t: 'plain' },
  { n: 'Elegant Black & Gold', c: [24, 24, 24], a: [200, 160, 60], f: 'times', h: 'band', t: 'striped' },
  { n: 'Green Business', c: [22, 134, 90], f: 'helvetica', h: 'side', t: 'grid' },
  { n: 'Creative Gradient', c: [168, 85, 247], a: [236, 72, 153], f: 'helvetica', h: 'grad', t: 'striped' },
  { n: 'Compact Retail', c: [60, 60, 60], f: 'courier', h: 'plain', t: 'plain' },
  { n: 'Premium Corporate', c: [15, 23, 42], a: [37, 99, 235], f: 'helvetica', h: 'band', t: 'grid' }
];

const rgb = values => `rgb(${values.join(',')})`;

function prevHTML(invoice, business = {}) {
  const template = TPL[invoice.tpl] || TPL[0];
  const totals = calc(invoice);
  const logo = logoSrc(business.logo);

  return `
  <div class="inv h-${template.h} tt-${template.t}"
    style="--c:${rgb(template.c)};--a:${rgb(template.a || template.c)};
    font-family:${template.f === 'times' ? 'Georgia,serif' :
      template.f === 'courier' ? 'monospace' : 'system-ui'}">

    <div class="ih">
      <img src="${esc(logo)}" alt="Business logo"
        onerror="this.onerror=null;this.src='${fallbackLogo}'">
      <div>
        <b>${esc(business.name || 'Your Business')}</b>
        <small>${esc(business.addr)}<br>${esc(business.phone)}
        ${business.owner ? ' · ' + esc(business.owner) : ''}</small>
      </div>
      <h3>INVOICE</h3>
    </div>

    <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <div>
        <b>Bill To</b><br>
        ${esc(invoice.cust.name) || '-'}<br>
        ${esc(invoice.cust.phone)}<br>
        ${esc(invoice.cust.addr)}
      </div>
      <div style="text-align:right;overflow-wrap:anywhere">
        No: ${esc(invoice.no)}<br>
        Date: ${esc(invoice.date)}
        ${invoice.due ? `<br>Due: ${esc(invoice.due)}` : ''}
        <br><b>${esc(totals.status)}</b>
      </div>
    </div>

    <table>
      <thead>
        <tr><th>#</th><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr>
      </thead>
      <tbody>
        ${(invoice.items || []).map((item, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${esc(item.n)}</td>
            <td>${Number(item.q) || 0}</td>
            <td class="money">${inr(item.p)}</td>
            <td class="money">${inr((Number(item.q) || 0) * (Number(item.p) || 0))}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <div class="tot money">
      Subtotal: ${inr(totals.sub)}<br>
      Discount: ${inr(invoice.disc)}<br>
      <b>Total: ${inr(totals.tot)}</b><br>
      Paid: ${inr(invoice.paid)}<br>
      <b>Balance Due: ${inr(totals.bal)}</b>
    </div>

    <div class="wm">
      <span style="color:#2563eb">Easy</span><span style="color:#15803d">Doc</span>
      · Invoice
    </div>
  </div>`;
}

/* =========================================================
   PDF generation — asynchronously load local logo
   ========================================================= */

async function loadImageData(source) {
  if (!source) return null;
  if (source.startsWith('data:image/')) return source;

  try {
    const response = await fetch(source);
    if (!response.ok) throw new Error('Logo could not be fetched');

    const blob = await response.blob();

    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.warn('Using PDF without the default logo:', error);
    return null;
  }
}

async function makePdf(invoice, business = {}) {
  if (!window.jspdf?.jsPDF) {
    throw new Error('jsPDF library is missing. Check your HTML script imports.');
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const template = TPL[invoice.tpl] || TPL[0];
  const color = template.c;
  const accent = template.a || color;
  const totals = calc(invoice);
  const dark = template.h === 'band' || template.h === 'grad';

  doc.setFont(template.f);

  if (template.h === 'band') {
    doc.setFillColor(...color);
    doc.rect(0, 0, 210, 34, 'F');
  }

  if (template.h === 'grad') {
    for (let i = 0; i < 34; i++) {
      doc.setFillColor(...color.map((v, j) =>
        Math.round(v + (accent[j] - v) * i / 34)
      ));
      doc.rect(0, i, 210, 1.2, 'F');
    }
  }

  if (template.h === 'side') {
    doc.setFillColor(...color);
    doc.rect(0, 0, 8, 297, 'F');
  }

  if (template.h === 'line') {
    doc.setDrawColor(...color);
    doc.setLineWidth(0.8);
    doc.line(14, 32, 196, 32);
    doc.line(14, 33.5, 196, 33.5);
  }

  if (template.h === 'plain') {
    doc.setDrawColor(200);
    doc.line(14, 32, 196, 32);
  }

  const logo = await loadImageData(logoSrc(business.logo));
  let textX = 14;

  if (logo) {
    try {
      const format = logo.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
      doc.addImage(logo, format, 14, 6, 22, 22);
      textX = 40;
    } catch (error) {
      console.warn('Logo could not be added to PDF:', error);
    }
  }

  doc.setTextColor(...(dark ? [255, 255, 255] : color));
  doc.setFontSize(16);
  doc.text(String(business.name || 'Business'), textX, 13);

  doc.setFontSize(9);
  const businessDetails =
    `${business.addr || ''}\nPh: ${business.phone || ''}   Owner: ${business.owner || ''}`;

  doc.text(doc.splitTextToSize(businessDetails, 100), textX, 19);

  doc.setFontSize(20);
  doc.text('INVOICE', 196, 14, { align: 'right' });

  doc.setTextColor(40);
  doc.setFontSize(10);

  const y = 44;

  const customerLines = [
    'Bill To:',
    invoice.cust.name,
    invoice.cust.phone ? 'Ph: ' + invoice.cust.phone : '',
    ...doc.splitTextToSize(invoice.cust.addr || '', 80)
  ].filter(Boolean);

  doc.text(customerLines, 14, y);

  doc.text([
    `Invoice No: ${invoice.no}`,
    `Date: ${invoice.date}`,
    invoice.due ? `Due: ${invoice.due}` : '',
    `Status: ${totals.status}`
  ].filter(Boolean), 140, y);

  if (typeof doc.autoTable !== 'function') {
    throw new Error('jsPDF AutoTable plugin is missing.');
  }

  doc.autoTable({
    startY: y + 28,
    head: [['#', 'Item', 'Qty', 'Price', 'Total']],
    body: (invoice.items || []).map((item, index) => [
      index + 1,
      item.n,
      item.q,
      rs(item.p),
      rs((Number(item.q) || 0) * (Number(item.p) || 0))
    ]),
    theme: template.t === 'plain' ? 'plain' : template.t,
    showHead: 'everyPage',
    styles: {
      font: template.f,
      fontSize: 10,
      overflow: 'linebreak'
    },
    headStyles: template.t === 'plain'
      ? { textColor: 30, lineWidth: { bottom: 0.5 } }
      : { fillColor: color },
    columnStyles: {
      3: { halign: 'right' },
      4: { halign: 'right' }
    },
    margin: { left: 14, right: 14 }
  });

  let totalY = doc.lastAutoTable.finalY + 8;

  if (totalY > 250) {
    doc.addPage();
    totalY = 20;
  }

  doc.setFontSize(11);

  [
    ['Subtotal', rs(totals.sub)],
    ['Discount', rs(invoice.disc)],
    ['Total', rs(totals.tot)],
    ['Paid', rs(invoice.paid)],
    ['Balance Due', rs(totals.bal)]
  ].forEach(([label, value], index) => {
    doc.setFont(template.f, index === 2 || index === 4 ? 'bold' : 'normal');
    doc.text(label, 130, totalY + index * 6.5);
    doc.text(value, 196, totalY + index * 6.5, { align: 'right' });
  });

  const pageCount = doc.getNumberOfPages();

  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont(template.f, 'normal');
    doc.setFontSize(9);
    doc.setTextColor(170);
    doc.text('EasyDoc', 105, 291, { align: 'center' });
    doc.text(`Page ${p}/${pageCount}`, 196, 291, { align: 'right' });
  }

  return doc;
}

/* =========================================================
   Supabase sync
   ========================================================= */

async function push(invoice) {
  if (!sb || !S.user) return false;

  try {
    const record = {
      id: invoice.id,
      user_id: S.user.id,
      invoice_no: invoice.no,
      invoice_date: invoice.date,
      due_date: invoice.due || null,
      template: invoice.tpl,
      cust_name: invoice.cust.name,
      cust_phone: invoice.cust.phone,
      cust_address: invoice.cust.addr,
      discount: invoice.disc,
      amount_paid: invoice.paid,
      is_draft: !invoice.saved,
      is_published: !!invoice.published,
      public_token: invoice.token || null,
      updated_at: new Date().toISOString()
    };

    const { error } = await sb.from('invoices').upsert(record);
    if (error) throw error;

    const { error: deleteError } = await sb.from('invoice_items')
      .delete()
      .eq('invoice_id', invoice.id);

    if (deleteError) throw deleteError;

    if (invoice.items.length) {
      const { error: itemError } = await sb.from('invoice_items').insert(
        invoice.items.map((item, index) => ({
          invoice_id: invoice.id,
          position: index,
          name: item.n,
          qty: item.q,
          unit_price: item.p
        }))
      );

      if (itemError) throw itemError;
    }

    invoice.synced = true;
    await dbPut('invoices', invoice);
    return true;
  } catch (error) {
    console.error('Invoice sync failed:', error);
    return false;
  }
}

async function syncAll() {
  if (!sb || !S.user) return;

  try {
    if (S.biz) {
      const { error } = await sb.from('business_profiles').upsert({
        user_id: S.user.id,
        name: S.biz.name,
        address: S.biz.addr,
        phone: S.biz.phone,
        owner_name: S.biz.owner,
        logo_data: S.biz.logo || null
      }, { onConflict: 'user_id' });

      if (error) console.error('Business profile sync:', error);
    }

    for (const invoice of await dbAll('invoices')) {
      if (invoice.saved && !invoice.synced) {
        await push(invoice);
      }
    }

    const { data, error } = await sb.from('invoices')
      .select('*,invoice_items(*)')
      .order('created_at');

    if (error) throw error;

    for (const record of data || []) {
      const local = await dbGet('invoices', record.id);

      if (local && !local.synced &&
          new Date(local.updatedAt || 0) > new Date(record.updated_at || 0)) {
        continue;
      }

      await dbPut('invoices', {
        id: record.id,
        no: record.invoice_no,
        date: record.invoice_date,
        due: record.due_date || '',
        tpl: Number(record.template) || 0,
        cust: {
          name: record.cust_name || '',
          phone: record.cust_phone || '',
          addr: record.cust_address || ''
        },
        items: (record.invoice_items || [])
          .sort((a, b) => a.position - b.position)
          .map(item => ({
            n: item.name || '',
            q: Number(item.qty) || 0,
            p: Number(item.unit_price) || 0
          })),
        disc: Number(record.discount) || 0,
        paid: Number(record.amount_paid) || 0,
        saved: !record.is_draft,
        synced: true,
        published: !!record.is_published,
        token: record.public_token || '',
        updatedAt: record.updated_at || new Date().toISOString()
      });
    }

    const { data: profile, error: profileError } = await sb
      .from('business_profiles')
      .select('*')
      .eq('user_id', S.user.id)
      .maybeSingle();

    if (profileError) console.error('Business profile fetch:', profileError);

    if (profile) {
      S.biz = {
        id: 'biz',
        name: profile.name || '',
        addr: profile.address || '',
        phone: profile.phone || '',
        owner: profile.owner_name || '',
        logo: profile.logo_data || ''
      };

      await dbPut('meta', S.biz);
    }
  } catch (error) {
    console.error('Sync failed:', error);
  }
}

/* =========================================================
   Router
   ========================================================= */

async function route() {
  const [path, arg, extra] = (location.hash.slice(2) || 'home').split('/');

  document.body.classList.toggle('priv', !!localStorage.priv);

  const nav = $('#nav');
  if (nav) nav.style.display = path === 'invoice' ? 'none' : 'flex';

  document.querySelectorAll('#nav a').forEach(link => {
    link.classList.toggle(
      'on',
      link.dataset.k === (
        { home: 'home', invoices: 'invoices', account: 'account' }[path] ||
        (['new', 'edit', 'biz', 'img2pdf'].includes(path) ? 'home' : '')
      )
    );
  });

  const routes = {
    home,
    invoices,
    account,
    img2pdf,
    biz,
    new: tplScreen,
    edit: () => editor(arg),
    help: () => legal('help'),
    terms: () => legal('terms'),
    privacy: () => legal('privacy'),
    invoice: () => pub(extra)
  };

  try {
    await (routes[path] || home)(arg);
  } catch (error) {
    console.error('Page error:', error);
    page(`
      <div class="card">
        <h3>Something went wrong</h3>
        <p>${esc(error.message || 'Please try again.')}</p>
        <button class="btn" onclick="go('#/home')">Back Home</button>
      </div>
    `);
  }
}

window.onhashchange = route;

/* =========================================================
   Home
   ========================================================= */

async function home() {
  const list = (await dbAll('invoices'))
    .filter(invoice => invoice.saved)
    .sort((a, b) => b.date.localeCompare(a.date));

  const business = S.biz;
  const statuses = list.map(invoice => calc(invoice).status);
  const visits = (await dbGet('meta', 'visits'))?.n || 0;
  let totalVisits = null;

  if (sb) {
    try {
      const { data, error } = await sb.rpc('visit_total');
      if (!error && data != null) totalVisits = data;
    } catch (error) {
      console.warn('Visit count unavailable:', error);
    }
  }

  page(`
    <header class="top">
      <div class="home-brand">
        <img class="home-logo" src="${LOGO_URL}" alt="EasyDoc logo"
          onerror="this.onerror=null;this.src='${fallbackLogo}'">
        <h1><span class="brand-title"><span class="l-easy">Easy</span><span class="l-doc">Doc</span></span></h1>
      </div>
      <p>Welcome${S.user ? ', ' + esc(S.user.user_metadata?.full_name || '') : ''}!</p>
    </header>

    ${business ? `
      <div class="card biz">
        <img src="${esc(logoSrc(business.logo))}" alt="Business logo"
          onerror="this.onerror=null;this.src='${fallbackLogo}'">
        <div><b>${esc(business.name)}</b><br>${esc(business.phone)}</div>
        <a style="margin-left:auto" href="#/biz">Edit</a>
      </div>
    ` : `
      <a class="btn big" href="#/biz">Create Business Profile</a>
    `}

    <div class="tools">
      <a class="card" href="#/img2pdf">${svgImg}<b>Image to PDF</b></a>
      <a class="card" href="#/new">${svgInv}<b>Create Invoice</b></a>
    </div>

    <div class="stats">
      <div class="card"><b>${list.length}</b><small>Total</small></div>
      <div class="card"><b>${statuses.filter(s => s === 'Paid').length}</b><small>Paid</small></div>
      <div class="card"><b>${statuses.filter(s => s !== 'Paid').length}</b><small>Unpaid</small></div>
      <div class="card"><b>${kfmt(totalVisits ?? visits)}</b><small>${totalVisits != null ? 'App visits' : 'Your visits'}</small></div>
    </div>

    <h3>My Invoices</h3>
    ${list.slice(0, 4).map(invRow).join('') || '<div class="card">No invoices yet.</div>'}
    <a href="#/invoices">View all →</a>

    <p style="margin-top:20px">
      <a href="#/help">Help &amp; Support</a> ·
      <a href="#/terms">Terms</a> ·
      <a href="#/privacy">Privacy</a>
    </p>
  `);
}

const invRow = invoice => {
  const totals = calc(invoice);

  return `
    <div class="card">
      <b>${esc(invoice.no)}</b>
      <span class="badge ${esc(totals.status)}">${esc(totals.status)}</span>
      <span class="badge">${invoice.synced ? '☁ synced' : '📱 local'}</span>
      <br>${esc(invoice.cust.name) || '-'} ·
      <span class="money">${inr(totals.tot)}</span> · ${esc(invoice.date)}<br>
      <button class="btn o" onclick="viewInv('${invoice.id}')">Preview</button>
      <button class="btn o" onclick="go('#/edit/${invoice.id}')">Edit</button>
      <button class="btn o" onclick="pdfInv('${invoice.id}')">PDF</button>
      <button class="btn o" onclick="pdfInv('${invoice.id}',1)">Share</button>
      <button class="btn r" onclick="delInv('${invoice.id}')">Delete</button>
    </div>
  `;
};

/* =========================================================
   Invoice list and actions
   ========================================================= */

let F = { q: '', s: 'all', o: 'new', d: '' };

async function invoices() {
  const all = await dbAll('invoices');

  const list = all.filter(invoice => {
    const status = invoice.saved ? calc(invoice).status : 'Draft';

    return (F.s === 'all' || F.s === status) &&
      (!F.d || invoice.date === F.d) &&
      ((invoice.no || '') + (invoice.cust?.name || ''))
        .toLowerCase().includes(F.q.toLowerCase());
  }).sort((a, b) => F.o === 'new'
    ? b.date.localeCompare(a.date)
    : a.date.localeCompare(b.date));

  page(`
    ${backBtn('#/home')}
    <h2>Invoices</h2>
    ${navigator.onLine ? '' : '<div class="offline">Offline — showing locally saved invoices</div>'}

    <div class="card">
      <input id="fq" placeholder="Search invoice no. / customer" value="${esc(F.q)}"
        oninput="F.q=this.value;invoices()">

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px">
        <select onchange="F.s=this.value;invoices()">
          ${['all', 'Paid', 'Partially Paid', 'Unpaid', 'Draft']
            .map(status => `<option value="${status}" ${F.s === status ? 'selected' : ''}>${status}</option>`).join('')}
        </select>

        <select onchange="F.o=this.value;invoices()">
          <option value="new" ${F.o === 'new' ? 'selected' : ''}>Newest</option>
          <option value="old" ${F.o === 'old' ? 'selected' : ''}>Oldest</option>
        </select>

        <input type="date" value="${esc(F.d)}" onchange="F.d=this.value;invoices()">
      </div>
    </div>

    ${list.map(invoice => invoice.saved ? invRow(invoice) : `
      <div class="card">
        <b>${esc(invoice.no)}</b>
        <span class="badge Draft">Draft</span><br>
        <button class="btn o" onclick="go('#/edit/${invoice.id}')">Edit</button>
        <button class="btn r" onclick="delInv('${invoice.id}')">Delete</button>
      </div>
    `).join('') || '<div class="card">No invoices found.</div>'}
  `);

  const search = $('#fq');
  if (search) {
    search.focus();
    search.setSelectionRange(search.value.length, search.value.length);
  }
}

async function pdfInv(id, share) {
  try {
    const invoice = await dbGet('invoices', id);
    if (!invoice) return toast('Invoice not found');

    const pdf = await makePdf(invoice, S.biz || {});
    const blob = pdf.output('blob');
    const name = invoice.no + '.pdf';

    await dbPut('pdfs', { id: invoice.id, blob, name });

    if (share) await shareBlob(blob, name);
    else dl(blob, name);
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not generate PDF');
  }
}

async function viewInv(id) {
  const invoice = await dbGet('invoices', id);
  if (invoice) modal(prevHTML(invoice, S.biz || {}));
}

function modal(html) {
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.innerHTML = `
    <button class="btn x" onclick="this.parentNode.remove()">✕ Close</button>
    ${html}
  `;
  overlay.addEventListener('click', event => {
    if (event.target === overlay) overlay.remove();
  });
  document.body.append(overlay);
}

async function delInv(id) {
  if (!confirm('Delete this invoice permanently?')) return;

  await dbDel('invoices', id);
  await dbDel('pdfs', id);

  if (sb && S.user) {
    const { error } = await sb.from('invoices').delete().eq('id', id);
    if (error) console.error(error);
  }

  toast('Invoice deleted');
  route();
}

/* =========================================================
   Template selection
   ========================================================= */

async function tplScreen() {
  const sample = {
    ...newInv(0),
    cust: { name: 'Sample Customer', phone: '98765 43210', addr: 'Kashmir' },
    items: [{ n: 'Sample item', q: 2, p: 500 }],
    paid: 500
  };

  page(`
    ${backBtn('#/home')}
    <h2>Choose a template</h2>
    <div class="tg">
      ${TPL.map((template, index) => `
        <a class="card" href="#/${S.biz ? 'edit/new' + index : 'biz'}"
          onclick="S.after='#/edit/new${index}'">
          ${prevHTML({ ...sample, tpl: index }, S.biz || {})}
          <b style="position:relative;background:#fff">${esc(template.n)}</b>
        </a>
      `).join('')}
    </div>
  `);
}

/* =========================================================
   Business profile
   ========================================================= */

async function biz() {
  const business = S.biz || {};

  page(`
    ${backBtn('#/home')}
    <h2>Business Profile</h2>

    <div class="card">
      <label for="lg">Business logo</label>
      <input type="file" id="lg" accept="image/*">
      <div id="lp">
        ${business.logo
          ? `<img src="${esc(business.logo)}" height="60" alt="Business logo">`
          : `<img src="${LOGO_URL}" height="60" alt="Default logo" onerror="this.style.display='none'">`}
      </div>

      <label for="bn">Business name *</label>
      <input id="bn" value="${esc(business.name)}">

      <label for="ba">Address</label>
      <input id="ba" value="${esc(business.addr)}">

      <label for="bp">Phone *</label>
      <input id="bp" type="tel" value="${esc(business.phone)}">

      <label for="bo">Owner name</label>
      <input id="bo" value="${esc(business.owner)}">

      <br><button class="btn" id="sv">Save Profile</button>
    </div>
  `);

  let logo = business.logo || '';

  $('#lg').onchange = async event => {
    try {
      const file = event.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith('image/')) {
        event.target.value = '';
        return toast('Please select an image file');
      }

      if (file.size > 5e6) {
        event.target.value = '';
        return toast('Logo too large (max 5MB)');
      }

      logo = (await imgToData(file, 500)).d;
      $('#lp').innerHTML = `<img src="${logo}" height="60" alt="Business logo">`;
    } catch (error) {
      toast(error.message);
    }
  };

  $('#sv').onclick = async () => {
    const name = $('#bn').value.trim();
    const phone = $('#bp').value.trim();

    if (!name || !/^[+\d][\d\s()-]{6,}$/.test(phone)) {
      return toast('Enter business name and a valid phone');
    }

    S.biz = {
      id: 'biz',
      name,
      addr: $('#ba').value.trim(),
      phone,
      owner: $('#bo').value.trim(),
      logo
    };

    await dbPut('meta', S.biz);
    await syncAll();

    toast('Profile saved');

    const next = S.after;
    S.after = null;
    go(next || '#/home');
  };
}

/* =========================================================
   Invoice editor
   ========================================================= */

async function editor(id) {
  if (id && id.startsWith('new')) {
    const draft = await dbGet('meta', 'draft');

    S.inv = draft?.inv && confirm('Recover your unsaved draft?')
      ? draft.inv
      : newInv(Number(id.slice(3)) || 0);
  } else {
    S.inv = await dbGet('invoices', id);
  }

  if (!S.inv) return go('#/home');
  if (!S.biz) {
    S.after = '#/edit/' + id;
    return go('#/biz');
  }

  const invoice = S.inv;

  page(`
    ${backBtn('#/home')}
    <h2>${invoice.saved ? 'Edit' : 'New'} Invoice</h2>

    <div class="card">
      <label>Template</label>
      <select onchange="U('tpl',+this.value)">
        ${TPL.map((template, index) => `
          <option value="${index}" ${index === invoice.tpl ? 'selected' : ''}>${esc(template.n)}</option>
        `).join('')}
      </select>

      <label>Customer name *</label>
      <input value="${esc(invoice.cust.name)}" oninput="U('cust.name',this.value)">

      <label>Customer phone</label>
      <input type="tel" value="${esc(invoice.cust.phone)}" oninput="U('cust.phone',this.value)">

      <label>Customer address</label>
      <input value="${esc(invoice.cust.addr)}" oninput="U('cust.addr',this.value)">

      <div class="row s">
        <div>
          <label>Invoice no.</label>
          <input value="${esc(invoice.no)}" readonly>
        </div>
        <div>
          <label>Date</label>
          <input type="date" value="${esc(invoice.date)}" onchange="U('date',this.value)">
        </div>
      </div>

      <label>Due date (optional)</label>
      <input type="date" value="${esc(invoice.due)}" onchange="U('due',this.value)">
    </div>

    <div class="card">
      <b>Items</b>
      <div id="its"></div>
      <button class="btn o" onclick="S.inv.items.push({n:'',q:1,p:0});items();U()">+ Add item</button>
    </div>

    <div class="card">
      <div class="row s">
        <div>
          <label>Discount (₹)</label>
          <input type="number" min="0" step="any" value="${invoice.disc}"
            oninput="U('disc',Math.max(0,+this.value||0))">
        </div>
        <div>
          <label>Amount paid (₹)</label>
          <input type="number" min="0" step="any" value="${invoice.paid}"
            oninput="U('paid',Math.max(0,+this.value||0))">
        </div>
      </div>
      <p id="sm"></p>
    </div>

    <div class="card">
      <button class="btn" onclick="saveInv()">Save Invoice</button>
      <button class="btn o" onclick="dlCur()">Download PDF</button>
      <button class="btn o" onclick="shCur()">Share Invoice</button>
      <button class="btn g" onclick="waShare()">Share on WhatsApp</button>
      <button class="btn o" onclick="modal(prevHTML(S.inv,S.biz))">Preview Full Invoice</button>
      ${invoice.published ? '<button class="btn r" onclick="revoke()">Revoke public link</button>' : ''}
    </div>

    <div id="pv"></div>
  `);

  items();
  U();
}

function items() {
  const container = $('#its');
  if (!container || !S.inv) return;

  container.innerHTML = S.inv.items.map((item, index) => `
    <div class="row">
      <div>
        <label>Item</label>
        <input value="${esc(item.n)}" oninput="UI(${index},'n',this.value)">
      </div>
      <div>
        <label>Qty</label>
        <input type="number" min="0.01" step="any" value="${item.q}"
          oninput="UI(${index},'q',this.value)">
      </div>
      <div>
        <label>Price ₹</label>
        <input type="number" min="0" step="any" value="${item.p}"
          oninput="UI(${index},'p',this.value)">
      </div>
      <button class="btn r" onclick="
        S.inv.items.length>1
          ? (S.inv.items.splice(${index},1),items(),U())
          : toast('At least one item is needed')">✕</button>
    </div>
  `).join('');
}

function UI(index, key, value) {
  const item = S.inv?.items[index];
  if (!item) return;

  item[key] = key === 'n'
    ? value
    : Math.max(key === 'q' ? 0.01 : 0, Number(value) || 0);

  U();
}

function U(path, value) {
  const invoice = S.inv;
  if (!invoice) return;

  if (path) {
    const parts = path.split('.');
    let target = invoice;

    while (parts.length > 1) target = target[parts.shift()];
    target[parts[0]] = value;
  }

  const totals = calc(invoice);
  const summary = $('#sm');
  const preview = $('#pv');

  if (summary) {
    summary.innerHTML = `
      Subtotal <b class="money">${inr(totals.sub)}</b> ·
      Total due <b class="money">${inr(totals.tot)}</b> ·
      Balance <b class="money">${inr(totals.bal)}</b> ·
      <span class="badge ${esc(totals.status)}">${esc(totals.status)}</span>
    `;
  }

  if (preview) preview.innerHTML = prevHTML(invoice, S.biz || {});

  if (!invoice.saved) {
    dbPut('meta', { id: 'draft', inv: invoice }).catch(console.error);
  }
}

/* =========================================================
   Save and share invoices
   ========================================================= */

async function saveInv(quiet = false) {
  const invoice = S.inv;

  if (!invoice.cust.name.trim() ||
      invoice.items.some(item => !item.n.trim() || item.q <= 0)) {
    toast('Customer name and all item names are required');
    return false;
  }

  if (!invoice.saved && !S.user &&
      (await dbAll('invoices')).filter(item => item.saved).length >= FREE) {
    toast(`Free guest limit (${FREE}) used. Please sign up. Your invoice stays on this device.`);
    go('#/account');
    return false;
  }

  invoice.saved = true;
  invoice.synced = false;
  invoice.updatedAt = new Date().toISOString();

  await dbPut('invoices', invoice);
  await dbDel('meta', 'draft');

  const synced = await push(invoice);

  if (!quiet) {
    toast(synced
      ? 'Saved and synced to cloud'
      : S.user
        ? 'Saved locally. Sync when online.'
        : 'Saved on this device');
  }

  return true;
}

async function dlCur() {
  if (await saveInv(true)) await pdfInv(S.inv.id);
}

async function shCur() {
  if (await saveInv(true)) await pdfInv(S.inv.id, 1);
}

async function waShare() {
  if (!await saveInv(true)) return;

  const invoice = S.inv;
  const totals = calc(invoice);
  let link = '';

  if (sb && S.user) {
    if (!invoice.token) invoice.token = token();
    invoice.published = true;

    if (await push(invoice)) {
      link = `${location.origin}${location.pathname}#/invoice/view/${invoice.token}`;
    } else {
      invoice.published = false;
      toast('Could not publish the link. Check your connection.');
    }
  } else {
    toast('Log in to include a public invoice link');
  }

  const message =
    `Hello ${invoice.cust.name}, your invoice from ${S.biz.name} is ready. ` +
    `Invoice No: ${invoice.no}. Amount Due: ₹${num(totals.bal)}.` +
    `${link ? ` View and download your invoice here: ${link}.` : ''} Thank you!`;

  const phone = (invoice.cust.phone || '').replace(/\D/g, '');
  const number = phone.length === 10 ? '91' + phone : phone;
  const url = number
    ? `https://wa.me/${number}?text=${encodeURIComponent(message)}`
    : `https://wa.me/?text=${encodeURIComponent(message)}`;

  window.open(url, '_blank', 'noopener,noreferrer');
  toast('WhatsApp opened. Press Send yourself.');
}

async function revoke() {
  if (!confirm('Customers will no longer be able to open the link. Continue?')) return;

  S.inv.published = false;
  S.inv.token = '';

  await push(S.inv);
  await dbPut('invoices', S.inv);

  toast('Public link revoked');
  editor(S.inv.id);
}

/* =========================================================
   Public customer invoice
   ========================================================= */

async function pub(publicToken) {
  document.body.style.paddingBottom = '0';

  if (!sb) {
    return page('<div class="card">Service not configured.</div>');
  }

  page('<div class="card">Loading invoice…</div>');

  const { data, error } = await sb.rpc('get_public_invoice', {
    p_token: publicToken
  });

  if (error || !data?.invoice || !data?.business) {
    return page('<div class="card">This invoice link is invalid or has been revoked.</div>');
  }

  const record = data.invoice;

  const invoice = {
    no: record.invoice_no,
    date: record.invoice_date,
    due: record.due_date || '',
    tpl: Number(record.template) || 0,
    cust: {
      name: record.cust_name || '',
      phone: record.cust_phone || '',
      addr: record.cust_address || ''
    },
    items: (data.items || []).map(item => ({
      n: item.name,
      q: Number(item.qty) || 0,
      p: Number(item.unit_price) || 0
    })),
    disc: Number(record.discount) || 0,
    paid: Number(record.amount_paid) || 0
  };

  const business = {
    name: data.business.name,
    addr: data.business.address,
    phone: data.business.phone,
    owner: data.business.owner_name,
    logo: data.business.logo_data
  };

  page(`
    ${prevHTML(invoice, business)}
    <p><button class="btn big" id="pd">Download PDF</button></p>
  `);

  $('#pd').onclick = async () => {
    try {
      dl((await makePdf(invoice, business)).output('blob'), invoice.no + '.pdf');
    } catch (error) {
      toast(error.message || 'Could not generate PDF');
    }
  };
}

/* =========================================================
   Image to PDF
   ========================================================= */

let IM = [];

async function img2pdf() {
  IM = [];
  const history = await dbAll('conv');

  page(`
    ${backBtn('#/home')}
    <h2>Image to PDF</h2>

    <div class="card">
      <p style="font-size:13px">Images are processed on your device only. They are not uploaded.</p>
      <input type="file" id="fi" multiple accept="image/jpeg,image/png,image/webp">
      <div class="thumbs" id="th"></div>

      <div class="row s">
        <div>
          <label>Page size</label>
          <select id="ps">
            <option>A4</option><option>Letter</option><option>Original</option>
          </select>
        </div>
        <div>
          <label>Orientation</label>
          <select id="po">
            <option value="p">Portrait</option><option value="l">Landscape</option>
          </select>
        </div>
        <div>
          <label>Margin (mm)</label>
          <input id="pm" type="number" min="0" max="40" value="10">
        </div>
        <div>
          <label>Fit</label>
          <select id="pf">
            <option value="fit">Fit to page</option>
            <option value="fill">Fill page</option>
          </select>
        </div>
      </div>

      <button class="btn" onclick="mkImgPdf()">Generate &amp; Preview</button>
    </div>

    <div id="pr"></div>
    <h3>History (this device)</h3>

    ${history.sort((a, b) => b.date.localeCompare(a.date)).map(item => `
      <div class="card">
        <b>${esc(item.name)}</b><br>
        ${esc(item.date.slice(0, 16).replace('T', ' '))} · ${item.pages} page(s)<br>
        <button class="btn o" onclick="cvAct('${item.id}','d')">Download</button>
        <button class="btn o" onclick="cvAct('${item.id}','s')">Share</button>
        <button class="btn r" onclick="cvAct('${item.id}','x')">Delete</button>
      </div>
    `).join('') || '<div class="card">No conversions yet.</div>'}
  `);

  $('#fi').onchange = async event => {
    for (const file of event.target.files || []) {
      try {
        IM.push({
          ...(await imgToData(file, 2000, 'image/jpeg', 0.85)),
          n: file.name
        });
      } catch (error) {
        toast(file.name + ': unsupported image');
      }
    }

    thumbs();
  };
}

function thumbs() {
  const container = $('#th');
  if (!container) return;

  container.innerHTML = IM.map((image, index) => `
    <div>
      <img src="${image.d}" alt="${esc(image.n)}">
      ${index + 1}.
      <button onclick="mv(${index},-1)">◀</button>
      <button onclick="mv(${index},1)">▶</button>
      <button onclick="IM.splice(${index},1);thumbs()">✕</button>
    </div>
  `).join('');
}

function mv(index, direction) {
  const next = index + direction;
  if (next < 0 || next >= IM.length) return;

  [IM[index], IM[next]] = [IM[next], IM[index]];
  thumbs();
}

async function mkImgPdf() {
  if (!IM.length) return toast('Select at least one image');

  if (!window.jspdf?.jsPDF) {
    return toast('jsPDF library is missing');
  }

  const { jsPDF } = window.jspdf;
  const size = $('#ps').value;
  const orientation = $('#po').value;
  const margin = Math.min(40, Math.max(0, Number($('#pm').value) || 0));
  const fill = $('#pf').value === 'fill';
  let pdf;

  try {
    IM.forEach((image, index) => {
      const pageOrientation = size === 'Original'
        ? (image.w > image.h ? 'l' : 'p')
        : orientation;

      const format = size === 'Original'
        ? [image.w * 0.2646, image.h * 0.2646]
        : size.toLowerCase();

      if (index === 0) {
        pdf = new jsPDF({
          unit: 'mm',
          format,
          orientation: pageOrientation
        });
      } else {
        pdf.addPage(format, pageOrientation);
      }

      const width = pdf.internal.pageSize.getWidth();
      const height = pdf.internal.pageSize.getHeight();
      const availableWidth = Math.max(1, width - 2 * margin);
      const availableHeight = Math.max(1, height - 2 * margin);

      const ratio = (fill ? Math.max : Math.min)(
        availableWidth / image.w,
        availableHeight / image.h
      );

      const imageWidth = Math.min(image.w * ratio, availableWidth);
      const imageHeight = Math.min(image.h * ratio, availableHeight);

      pdf.addImage(
        image.d,
        'JPEG',
        (width - imageWidth) / 2,
        (height - imageHeight) / 2,
        imageWidth,
        imageHeight
      );

      pdf.setFontSize(8);
      pdf.setTextColor(170);
      pdf.text('EasyDoc', width / 2, height - 3, { align: 'center' });
    });

    const blob = pdf.output('blob');
    const name = 'images-' + Date.now() + '.pdf';
    const id = crypto.randomUUID();

    await dbPut('conv', {
      id,
      name,
      date: new Date().toISOString(),
      pages: IM.length,
      blob
    });

    const url = URL.createObjectURL(blob);
    const preview = $('#pr');

    if (preview) {
      preview.innerHTML = `
        <iframe src="${url}" title="PDF preview"
          style="width:100%;height:420px;border:0;border-radius:12px"></iframe>
        <button class="btn" onclick="route()">Done</button>
        <button class="btn o" onclick="dlStored('${id}')">Download again</button>
      `;
    }

    dl(blob, name);
    toast('PDF created and saved to history');
  } catch (error) {
    console.error(error);
    toast(error.message || 'Could not generate PDF');
  }
}

async function dlStored(id) {
  const item = await dbGet('conv', id);
  if (item) dl(item.blob, item.name);
}

async function cvAct(id, action) {
  const item = await dbGet('conv', id);
  if (!item) return toast('PDF not found');

  if (action === 'd') dl(item.blob, item.name);
  if (action === 's') await shareBlob(item.blob, item.name);

  if (action === 'x' && confirm('Delete this PDF from history?')) {
    await dbDel('conv', id);
    img2pdf();
  }
}

/* =========================================================
   Account and authentication
   ========================================================= */

async function account() {
  if (!sb) {
    return page(`
      <h2>Account</h2>
      <div class="card">
        Add your Supabase URL and anon key in <code>js/config.js</code>
        to enable login. You can still create ${FREE} free invoice(s) as a guest.
      </div>
      ${priv()}
    `);
  }

  if (S.user) {
    return page(`
      <h2>Account</h2>
      <div class="card">
        <b>${esc(S.user.user_metadata?.full_name || '')}</b><br>
        ${esc(S.user.email)}<br>
        <button class="btn" onclick="syncAll().then(()=>toast('Sync finished'))">Sync now</button>
        <button class="btn r" onclick="logout()">Logout</button>
      </div>
      ${priv()}
    `);
  }

  page(`
    <h2>Account</h2>

    <div class="card">
      <h3>Login</h3>
      <label for="le">Email</label><input id="le" type="email" autocomplete="email">
      <label for="lp">Password</label><input id="lp" type="password" autocomplete="current-password">
      <button class="btn" onclick="login()">Login</button>
      <button class="btn o" onclick="forgot()">Forgot password</button>
    </div>

    <div class="card">
      <h3>Create account</h3>
      <label for="sn">Full name</label><input id="sn" autocomplete="name">
      <label for="sp">Phone</label><input id="sp" type="tel" autocomplete="tel">
      <label for="se">Email</label><input id="se" type="email" autocomplete="email">
      <label for="s1">Password (8+, upper, lower, number)</label><input id="s1" type="password" autocomplete="new-password">
      <label for="s2">Confirm password</label><input id="s2" type="password" autocomplete="new-password">

      <label>
        <input type="checkbox" id="st" style="width:auto">
        I accept the <a href="#/terms">Terms</a> &amp; <a href="#/privacy">Privacy</a>
      </label>

      <button class="btn" onclick="signup()">Create Account</button>
    </div>

    ${priv()}
  `);
}

const priv = () => `
  <div class="card">
    <label>
      <input type="checkbox" style="width:auto"
        ${localStorage.priv ? 'checked' : ''}
        onchange="localStorage.priv=this.checked?'1':'';document.body.classList.toggle('priv',this.checked)">
      Privacy mode (blur amounts)
    </label>
    <small>Best-effort only: this cannot block screenshots or screen recording.</small>
  </div>
`;

async function login() {
  if (!sb) return toast('Supabase is not configured');

  const { data, error } = await sb.auth.signInWithPassword({
    email: $('#le').value.trim(),
    password: $('#lp').value
  });

  if (error) return toast(error.message);

  S.user = data.user;
  await syncAll();
  toast('Logged in');
  go('#/home');
}

async function logout() {
  if (!sb) return;

  const { error } = await sb.auth.signOut();
  if (error) return toast(error.message);

  S.user = null;
  S.biz = (await dbGet('meta', 'biz')) || null;
  toast('Logged out');
  go('#/account');
}

async function forgot() {
  if (!sb) return toast('Supabase is not configured');

  const email = $('#le').value.trim();
  if (!email) return toast('Enter your email first');

  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: location.href
  });

  toast(error ? error.message : 'If the email exists, a reset link was sent');
}

async function signup() {
  if (!sb) return toast('Supabase is not configured');

  const email = $('#se').value.trim();
  const password = $('#s1').value;
  const phone = $('#sp').value.trim();
  const name = $('#sn').value.trim();

  if (!name) return toast('Enter full name');
  if (!/^[+\d][\d\s()-]{9,14}$/.test(phone)) return toast('Enter a valid phone number');
  if (!/^\S+@\S+\.\S+$/.test(email)) return toast('Enter a valid email');

  if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}/.test(password)) {
    return toast('Weak password: 8+ chars with upper, lower and a number');
  }

  if (password !== $('#s2').value) return toast('Passwords do not match');
  if (!$('#st').checked) return toast('Please accept the Terms');

  const { data, error } = await sb.auth.signUp({
    email,
    password,
    options: { data: { full_name: name, phone } }
  });

  if (error) return toast(error.message);

  if (data.session) {
    S.user = data.user;
    await syncAll();
    toast('Account created');
    go('#/home');
  } else {
    toast('Check your email to confirm your account, then log in');
  }
}

/* =========================================================
   Terms, privacy and help
   ========================================================= */

function legal(key) {
  const content = {
    terms: `
      <h2>Terms &amp; Conditions</h2>
      <p>EasyDoc helps you create invoices and PDFs. You are responsible for the accuracy of invoice content and for tax and legal compliance. EasyDoc does not guarantee payment collection and is not a payment processor. The service is provided as-is; keep your own backups.</p>
    `,

    privacy: `
      <h2>Privacy Policy</h2>
      <p><b>Local:</b> invoice history, drafts and generated PDFs are stored in your browser using IndexedDB. Image-to-PDF files are processed on your device.</p>
      <p><b>Cloud:</b> if you log in, business profile and invoices are stored in Supabase, subject to your database access policies.</p>
      <p><b>Public links:</b> anyone with a shared invoice link may view it until you revoke it.</p>
      <p><b>Analytics:</b> the app may record anonymous session events when configured.</p>
    `,

    help: `
      <h2>Help &amp; Support</h2>
      <div class="card">
        <a href="tel:+917051932522">📞 +91 70519 32522</a><br>
        <a href="https://wa.me/917051932522" target="_blank" rel="noopener noreferrer">💬 WhatsApp support</a>
      </div>

      ${[
        ['Creating invoices', 'Home → Create Invoice → choose a template → fill customer and items → Save.'],
        ['Editing business details', 'Home → business card → Edit.'],
        ['Converting images to PDF', 'Home → Image to PDF → choose images and options → Generate.'],
        ['Downloading and sharing PDFs', 'Use Download PDF or Share.'],
        ['Recovering drafts', 'Open Create Invoice again to recover an unsaved draft.'],
        ['Syncing data', 'Log in and press Sync now in Account.'],
        ['Account and privacy', 'See the Privacy Policy and use Privacy mode in Account.']
      ].map(([title, description]) => `
        <details class="card">
          <summary><b>${title}</b></summary>
          <p>${description}</p>
        </details>
      `).join('')}
    `
  };

  page(`${backBtn('#/home')}${content[key] || content.help}`);
}

/* =========================================================
   Boot and splash screen
   ========================================================= */

(async () => {
  try {
    S.biz = (await dbGet('meta', 'biz')) || null;

    if (sb) {
      const { data, error } = await sb.auth.getSession();

      if (error) console.error('Session error:', error);

      S.user = data.session?.user || null;

      sb.auth.onAuthStateChange((event, session) => {
        S.user = session?.user || null;
      });

      if (S.user) await syncAll();
    }

    if (!sessionStorage.sv) {
      sessionStorage.sv = '1';

      const visits = await dbGet('meta', 'visits');

      await dbPut('meta', {
        id: 'visits',
        n: (visits?.n || 0) + 1
      });

      if (sb) {
        sb.from('app_events')
          .insert({ event: 'session_start' })
          .then(({ error }) => {
            if (error) console.warn('Analytics:', error);
          });
      }
    }

    window.addEventListener('online', () => {
      if (S.user) syncAll();
    });

    await route();
  } catch (error) {
    console.error('EasyDoc startup error:', error);

    if ($('#app')) {
      page(`
        <div class="card">
          <h2>EasyDoc could not start</h2>
          <p>${esc(error.message || 'Please reload the app.')}</p>
          <button class="btn" onclick="location.reload()">Reload</button>
        </div>
      `);
    }
  } finally {
    setTimeout(() => {
      const splash = $('#splash-screen');

      if (splash) {
        splash.classList.add('hide');
        setTimeout(() => splash.remove(), 500);
      }
    }, 300);
  }
})();
