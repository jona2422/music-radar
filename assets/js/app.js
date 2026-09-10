/* Orquesta: carga los JSON del robot, cablea las vistas y consulta iTunes en
   vivo para los artistas que sigues (su API permite CORS, asi que el navegador
   puede preguntar directo sin esperar a la corrida de manana). */
(() => {
  const $ = s => document.querySelector(s);
  const D = { releases: [], upcoming: [], editorial: [], meta: null, history: [] };
  const VISTAS = ['releases', 'upcoming', 'editorial', 'mine', 'stats'];
  const deHash = () => {
    const h = location.hash.replace('#', '');
    return VISTAS.includes(h) ? h : 'releases';
  };
  let vista = deHash(), filtro = '';
  const cacheMios = new Map();

  const json = async n => {
    try {
      const r = await fetch(`data/${n}.json?v=${Date.now()}`);
      return r.ok ? await r.json() : null;
    } catch { return null; }
  };

  // -------------------------------------------------- reloj y saludo
  function reloj() {
    const ahora = new Date();
    const hora = new Intl.DateTimeFormat('es-PA', {
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Panama', hour12: false,
    }).format(ahora);
    $('#clock').textContent = `${hora} PTY`;
    const h = +hora.slice(0, 2);
    $('#greet').textContent = h < 12 ? 'buenos días' : h < 19 ? 'buenas tardes' : 'buenas noches';
  }

  // -------------------------------------------------- filtro de texto
  const pasa = it => !filtro ||
    `${it.artist} ${it.title}`.toLowerCase().includes(filtro) ||
    `${it.source || ''} ${it.title}`.toLowerCase().includes(filtro);

  // -------------------------------------------------- pintar
  function pintar() {
    document.body.dataset.view = vista;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.go === vista));
    VISTAS.forEach(v => $(`#v-${v}`).classList.toggle('hide', v !== vista));

    if (vista === 'releases') {
      // Lo tuyo primero: para eso marcas artistas.
      const items = D.releases.filter(pasa)
        .sort((a, b) => (Store.follows(b.artistId) - Store.follows(a.artistId))
                     || b.date.localeCompare(a.date));
      R.grid($('#grid-releases'), items,
        filtro ? 'Nada con esa búsqueda.' : 'Todavía no hay lanzamientos.');
    }
    if (vista === 'upcoming') R.timeline($('#timeline'), D.upcoming.filter(pasa));
    if (vista === 'editorial') R.reads($('#reads'), D.editorial.filter(pasa));
    if (vista === 'mine') pintarMios();
    if (vista === 'stats') pintarStats();
  }

  // -------------------------------------------------- mi musica
  async function itunes(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }

  async function discosDe(ids) {
    const faltan = ids.filter(id => !cacheMios.has(id));
    for (let i = 0; i < faltan.length; i += 10) {
      const lote = faltan.slice(i, i + 10);
      try {
        const d = await itunes(`https://itunes.apple.com/lookup?id=${lote.join(',')}&entity=album&limit=25&sort=recent`);
        const por = new Map(lote.map(id => [id, []]));
        (d.results || []).forEach(r => {
          if (r.wrapperType !== 'collection') return;
          const aid = String(r.artistId || '');
          if (!por.has(aid)) return;
          por.get(aid).push({
            artist: r.artistName, artistId: aid, title: r.collectionName,
            date: (r.releaseDate || '').slice(0, 10),
            kind: /- (Single|EP)$/i.test(r.collectionName || '')
              ? (/EP$/i.test(r.collectionName) ? 'ep' : 'single')
              : (r.trackCount <= 3 ? 'single' : r.trackCount <= 6 ? 'ep' : 'album'),
            tracks: r.trackCount || 0,
            art: (r.artworkUrl100 || '').replace(/\/\d+x\d+bb/, '/600x600bb'),
            url: r.collectionViewUrl || '',
          });
        });
        por.forEach((v, k) => cacheMios.set(k, v));
      } catch {
        lote.forEach(id => cacheMios.set(id, []));
      }
    }
    return ids.flatMap(id => cacheMios.get(id) || []);
  }

  async function pintarMios() {
    R.chips($('#artists'), Store.artists());
    const ids = Store.ids();
    const cuerpo = $('#mine-body');
    if (!ids.length) {
      cuerpo.innerHTML = `<div class="hint">
        <b>Todavía no sigues a nadie</b>
        Dale a la ☆ sobre cualquier carátula, o usa <code>＋ Buscar artista</code>.
        Sus discos se consultan al momento — no tienes que esperar al robot.
      </div>`;
      return;
    }
    cuerpo.innerHTML = '<div class="empty">Consultando…</div>';
    const items = R.dedup((await discosDe(ids)).filter(pasa)
      .sort((a, b) => b.date.localeCompare(a.date)));
    cuerpo.innerHTML = '<div class="grid" id="grid-mine"></div>';
    R.grid($('#grid-mine'), items.slice(0, 120), 'Sin discos para estos artistas.');
    $('#n-mine').textContent = ids.length;
  }

  // -------------------------------------------------- memoria
  function pintarStats() {
    const porArtista = {};
    D.releases.forEach(i => { porArtista[i.artist] = (porArtista[i.artist] || 0) + 1; });
    const activos = Object.entries(porArtista).sort((a, b) => b[1] - a[1]).slice(0, 8);

    const porTipo = { album: 0, ep: 0, single: 0 };
    D.releases.forEach(i => { porTipo[i.kind] = (porTipo[i.kind] || 0) + 1; });

    const serie = D.history.slice(-60).map(h => h.recientes || 0);
    const c = D.meta ? D.meta.conteo : {};

    $('#stats').innerHTML = `
      <div class="panel"><h3>De un vistazo</h3>
        <div class="kpis">
          <div class="kpi"><b>${c.recientes || 0}</b><span>salieron</span></div>
          <div class="kpi"><b>${c.proximos || 0}</b><span>anunciados</span></div>
          <div class="kpi"><b>${Store.count()}</b><span>artistas tuyos</span></div>
          <div class="kpi"><b>${Store.heardCount()}</b><span>escuchados</span></div>
        </div>
        ${R.spark(serie, '#ff4d6d')}
        <div style="color:var(--tx3);font:500 10.5px/1 var(--mono);margin-top:4px">
          lanzamientos por corrida · ${serie.length} puntos</div>
      </div>
      ${R.barras('Quién está publicando', activos, 'var(--acc)')}
      ${R.barras('Formato', Object.entries(porTipo).filter(f => f[1]), 'var(--acc2)')}`;
  }

  // -------------------------------------------------- eventos
  document.addEventListener('click', async e => {
    const tab = e.target.closest('[data-go]');
    if (tab) { location.hash = tab.dataset.go; return; }

    const star = e.target.closest('[data-star]');
    if (star) {
      e.preventDefault();
      Store.follow(star.dataset.star, star.dataset.name);
      pintar();
      if (vista !== 'mine') $('#n-mine').textContent = Store.count();
      return;
    }

    const drop = e.target.closest('[data-drop]');
    if (drop) { Store.unfollow(drop.dataset.drop); pintarMios(); return; }

    // Doble uso de la caratula: clic abre, clic con Alt marca como escuchado.
    const disc = e.target.closest('.disc');
    if (disc && e.altKey) {
      e.preventDefault();
      disc.classList.toggle('heard', Store.toggleHeard(disc.dataset.k));
    }
  });

  window.addEventListener('hashchange', () => { vista = deHash(); pintar(); });

  $('#q').addEventListener('input', e => {
    filtro = e.target.value.trim().toLowerCase();
    pintar();
  });

  $('#add').addEventListener('click', async () => {
    const nombre = prompt('¿A quién quieres seguir?');
    if (!nombre) return;
    const caja = $('#results');
    caja.classList.remove('hide');
    caja.innerHTML = '<div class="empty">Buscando…</div>';
    try {
      const d = await itunes(
        `https://itunes.apple.com/search?term=${encodeURIComponent(nombre)}&entity=musicArtist&limit=8`);
      const res = (d.results || []).filter(a => a.artistId);
      if (res.length) R.results(caja, res);
      else caja.innerHTML = '<div class="empty">Nadie con ese nombre.</div>';
    } catch {
      caja.innerHTML = '<div class="empty">No se pudo consultar iTunes.</div>';
    }
  });

  $('#export').addEventListener('click', async () => {
    const texto = Store.exportJSON();
    try { await navigator.clipboard.writeText(texto); } catch {}
    alert('Tu lista está copiada al portapapeles.\n\n' +
          'Pégala en scripts/artists.json del repo para que el robot también los vigile.\n\n' + texto);
  });

  $('#clear-heard').addEventListener('click', () => {
    if (confirm('¿Olvidar todo lo que marcaste como escuchado?')) { Store.clearHeard(); pintar(); }
  });

  // -------------------------------------------------- arranque
  (async () => {
    reloj(); setInterval(reloj, 30000);

    const [rel, up, ed, meta, hist] = await Promise.all(
      ['releases', 'upcoming', 'editorial', 'meta', 'history'].map(json));

    D.releases = (rel && rel.items) || [];
    D.upcoming = (up && up.items) || [];
    D.editorial = (ed && ed.items) || [];
    D.meta = meta;
    D.history = Array.isArray(hist) ? hist : [];

    $('#n-releases').textContent = D.releases.length;
    $('#n-upcoming').textContent = D.upcoming.length;
    $('#n-editorial').textContent = D.editorial.length;
    $('#n-mine').textContent = Store.count();

    if (meta) {
      const act = new Intl.DateTimeFormat('es-PA', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        timeZone: 'America/Panama', hour12: false,
      }).format(new Date(meta.updated));
      $('#foot').innerHTML = `Actualizado <b>${act}</b> · fuentes
        <b>${meta.fuentes_ok}/${meta.fuentes_total}</b> ·
        ${meta.conteo.pool} artistas vigilados ·
        datos de Apple Music, MusicBrainz y prensa musical.<br>
        Alt + clic sobre una carátula la marca como escuchada.`;
    }

    Store.markSeen();
    pintar();
  })();
})();
