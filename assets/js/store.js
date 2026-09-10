/* Estado local: artistas seguidos y discos ya escuchados. Todo en el navegador. */
const Store = (() => {
  const K_ART = 'mr.artists', K_HEARD = 'mr.heard', K_SEEN = 'mr.lastSeen';

  const read = (k, def) => {
    try { return JSON.parse(localStorage.getItem(k)) ?? def; }
    catch { return def; }
  };
  const write = (k, v) => {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
  };

  // { id: nombre }
  let artists = read(K_ART, {});
  let heard = new Set(read(K_HEARD, []));

  return {
    artists: () => artists,
    ids: () => Object.keys(artists),
    count: () => Object.keys(artists).length,
    follows: id => Object.prototype.hasOwnProperty.call(artists, String(id)),

    follow(id, name) {
      id = String(id);
      if (!id) return false;
      if (artists[id]) delete artists[id]; else artists[id] = name || id;
      write(K_ART, artists);
      return !!artists[id];
    },
    unfollow(id) { delete artists[String(id)]; write(K_ART, artists); },

    heard: key => heard.has(key),
    toggleHeard(key) {
      heard.has(key) ? heard.delete(key) : heard.add(key);
      write(K_HEARD, [...heard]);
      return heard.has(key);
    },
    heardCount: () => heard.size,
    clearHeard() { heard = new Set(); write(K_HEARD, []); },

    lastSeen() { return read(K_SEEN, 0); },
    markSeen() { write(K_SEEN, Date.now()); },

    // Lo que se pega en scripts/artists.json para que el robot los vigile.
    exportJSON() {
      return JSON.stringify({
        artists: Object.entries(artists).map(([id, name]) => ({ id, name }))
      }, null, 2);
    },
  };
})();
