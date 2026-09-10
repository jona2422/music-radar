/* Dibujado. Nada de plantillas externas: strings y innerHTML. */
const R = (() => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
                 'agosto','septiembre','octubre','noviembre','diciembre'];

  // Las fechas vienen como YYYY-MM-DD; partirlas a mano evita que el navegador
  // las lea como UTC y muestre el dia anterior.
  const partes = iso => {
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return { y, m, d };
  };

  const fechaCorta = iso => {
    const { y, m, d } = partes(iso);
    if (!y) return '';
    const hoy = new Date();
    const dias = Math.round((new Date(y, m - 1, d) - new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())) / 864e5);
    if (dias === 0) return 'hoy';
    if (dias === -1) return 'ayer';
    if (dias === 1) return 'mañana';
    if (dias < 0 && dias > -7) return `hace ${-dias} días`;
    // Sin el ano, un disco de 2019 y uno de este mes se leen igual.
    const corto = `${d} ${MESES[m - 1].slice(0, 3)}`;
    return y === hoy.getFullYear() ? corto : `${corto} ${y}`;
  };

  const desde = iso => {
    const t = Date.parse(iso);
    if (!t) return '';
    const h = Math.round((Date.now() - t) / 36e5);
    if (h < 1) return 'ahora';
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    return d === 1 ? 'ayer' : `hace ${d} días`;
  };

  const clave = it => `${it.artist}|${it.title}`.toLowerCase();

  // Un mismo disco vuelve como deluxe, remix pack y varios singles con el mismo
  // nombre base. Colapsarlos: es la misma regla que aplica fetch_music.py.
  const base = it =>
    `${it.artist}|${it.title}`.toLowerCase().replace(/\s*[-(].*$/, '').trim();

  const dedup = items => {
    const vistos = new Set();
    return items.filter(it => {
      const k = base(it);
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
  };

  function disco(it) {
    const k = clave(it);
    const sigue = Store.follows(it.artistId);
    const oido = Store.heard(k);
    const cover = it.art
      ? `<img src="${esc(it.art)}" alt="" loading="lazy">`
      : '<div class="cover none">♪</div>';
    return `
      <article class="disc${oido ? ' heard' : ''}" data-k="${esc(k)}">
        <a class="cover" href="${esc(it.url || '#')}" target="_blank" rel="noopener">
          ${cover}
          <span class="badge ${esc(it.kind)}">${esc(it.kind)}</span>
        </a>
        ${it.artistId ? `<button class="star${sigue ? ' on' : ''}" data-star="${esc(it.artistId)}"
            data-name="${esc(it.artist)}" title="Seguir a ${esc(it.artist)}">${sigue ? '★' : '☆'}</button>` : ''}
        <div class="meta">
          <div class="a">${sigue ? '<i class="mio"></i>' : ''}${esc(it.artist)}</div>
          <div class="t">${esc(it.title)}</div>
          <div class="d">${esc(fechaCorta(it.date))}${it.tracks ? ` · ${it.tracks} pista${it.tracks > 1 ? 's' : ''}` : ''}</div>
        </div>
      </article>`;
  }

  return {
    esc, clave, desde, partes, dedup,

    grid(el, items, vacio) {
      el.innerHTML = items.length
        ? items.map(disco).join('')
        : `<div class="empty" style="grid-column:1/-1">${vacio}</div>`;
    },

    timeline(el, items) {
      if (!items.length) {
        el.innerHTML = `<div class="empty">Nada anunciado todavía.<br>
          Marca artistas con ★ y sus próximos discos aparecerán aquí.</div>`;
        return;
      }
      const grupos = new Map();
      items.forEach(it => {
        const { y, m } = partes(it.date);
        const k = `${y}-${String(m).padStart(2, '0')}`;
        if (!grupos.has(k)) grupos.set(k, { etiqueta: `${MESES[m - 1]} ${y}`, items: [] });
        grupos.get(k).items.push(it);
      });
      el.innerHTML = [...grupos.values()].map(g => `
        <div class="month">
          <h3>${esc(g.etiqueta)}</h3>
          ${g.items.map(it => {
            const { d, m } = partes(it.date);
            return `<a class="row" href="${esc(it.url || '#')}" target="_blank" rel="noopener">
              <div class="day">${d}<s>${MESES[m - 1].slice(0, 3)}</s></div>
              <div class="info">
                <b>${Store.follows(it.artistId) ? '<i class="mio"></i>' : ''}${esc(it.artist)}</b>
                <span>${esc(it.title)}</span>
              </div>
              <div class="tag">${esc(it.kind)}</div>
            </a>`;
          }).join('')}
        </div>`).join('');
    },

    reads(el, items) {
      el.innerHTML = items.length ? items.map(it => `
        <a class="read" href="${esc(it.link)}" target="_blank" rel="noopener">
          ${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy">` : ''}
          <div class="b">
            <div class="s">${esc(it.source)}</div>
            <h4>${esc(it.title)}</h4>
            <time>${esc(desde(it.date))}</time>
          </div>
        </a>`).join('') : '<div class="empty">Sin lecturas por ahora.</div>';
    },

    chips(el, artistas) {
      const ent = Object.entries(artistas);
      el.innerHTML = ent.map(([id, n]) =>
        `<span class="chip">${esc(n)}<button data-drop="${esc(id)}" title="Dejar de seguir">×</button></span>`).join('');
    },

    results(el, items) {
      el.innerHTML = items.map(a => `
        <div class="res">
          <div class="n">${esc(a.artistName)}</div>
          <div class="g">${esc(a.primaryGenreName || '')}</div>
          <button class="btn${Store.follows(a.artistId) ? '' : ' p'}" data-star="${a.artistId}"
                  data-name="${esc(a.artistName)}">${Store.follows(a.artistId) ? 'siguiendo' : 'seguir'}</button>
        </div>`).join('');
    },

    barras(titulo, filas, color) {
      const max = Math.max(1, ...filas.map(f => f[1]));
      return `<div class="panel"><h3>${esc(titulo)}</h3>
        ${filas.length ? filas.map(([l, v]) => `
          <div class="bar"><div class="l">${esc(l)}</div>
            <div class="t"><i style="width:${(v / max * 100).toFixed(1)}%;background:${color}"></i></div>
            <div class="v">${v}</div></div>`).join('')
          : '<div style="color:var(--tx3);font-size:13px">Sin datos todavía.</div>'}
      </div>`;
    },

    spark(valores, color) {
      if (valores.length < 2) return '';
      const max = Math.max(...valores), min = Math.min(...valores);
      const span = Math.max(1, max - min);
      const pts = valores.map((v, i) =>
        `${(i / (valores.length - 1) * 100).toFixed(2)},${(46 - (v - min) / span * 40).toFixed(2)}`).join(' ');
      return `<svg class="spark" viewBox="0 0 100 52" preserveAspectRatio="none">
        <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6"
                  stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
    },
  };
})();
