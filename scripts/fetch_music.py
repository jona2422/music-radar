#!/usr/bin/env python3
"""Baja lanzamientos musicales y genera los JSON que consume el sitio.

Solo biblioteca estandar, sin dependencias y sin API keys. Fuentes:
  - Apple RSS (rss.marketingtools.apple.com)  -> que suena ahora, y de ahi sale
    el pool inicial de artistas cuando todavia no has marcado ninguno.
  - iTunes Search/Lookup API                  -> discos por artista, caratula,
    fecha y enlace. Tambien expone pre-orders (fecha futura).
  - MusicBrainz                               -> calendario de lo ya anunciado.
  - Feeds editoriales (NPR, Bandcamp, etc.)   -> descubrimiento.

Si una fuente falla se omite y el resto continua: la corrida nunca se rompe.
"""
import json
import os
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "data")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")
# MusicBrainz exige identificarse con contacto y como maximo 1 peticion/segundo.
UA_MB = "MusicRadar/1.0 ( https://github.com/jona2422/music-radar )"

TIMEOUT = 30
DIAS_RECIENTE = 21        # que cuenta como "salio hace poco"
LOTE_ITUNES = 10          # ids por peticion de lookup
MAX_POOL = 120            # tope de artistas a consultar por corrida
PAISES_CHART = [("pa", "Panama"), ("us", "Estados Unidos"),
                ("es", "Espana"), ("gb", "Reino Unido")]
TOP_CHART = 50            # albumes por chart

salud = []                # [{fuente, ok, detalle}]


def anota(fuente, ok, detalle=""):
    salud.append({"fuente": fuente, "ok": ok, "detalle": str(detalle)[:160]})
    print("  [%s] %s %s" % ("ok " if ok else "FALLA", fuente, detalle if not ok else ""))


class _Redirect(urllib.request.HTTPRedirectHandler):
    http_error_308 = urllib.request.HTTPRedirectHandler.http_error_301


_OPENER = urllib.request.build_opener(_Redirect)


def fetch(url, ua=UA, accept="*/*", intentos=3):
    """GET con reintentos y espera creciente. Devuelve bytes o lanza excepcion."""
    ultimo = None
    for i in range(intentos):
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": ua,
                "Accept": accept,
                "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
            })
            with _OPENER.open(req, timeout=TIMEOUT) as r:
                return r.read()
        except Exception as e:
            ultimo = e
            time.sleep(2 + 3 * i)
    raise ultimo


def fetch_json(url, ua=UA, intentos=3):
    return json.loads(fetch(url, ua, "application/json", intentos).decode("utf-8", "replace"))


def hoy():
    return datetime.now(timezone.utc).date()


# --------------------------------------------------------------------------- #
# Parser de feeds (mismo enfoque que el NEWSDESK: ignora namespaces).

def localname(tag):
    return tag.rsplit("}", 1)[-1].lower()


def child_text(el, names):
    for ch in el:
        if localname(ch.tag) in names:
            t = (ch.text or "").strip()
            if t:
                return t
    return ""


def item_link(item):
    fallback = ""
    for ch in item:
        if localname(ch.tag) != "link":
            continue
        href = ch.get("href")
        if href:
            if ch.get("rel", "alternate") in ("alternate", ""):
                return href
            fallback = fallback or href
        elif (ch.text or "").strip():
            return ch.text.strip()
    return fallback


IMG_RE = re.compile(r'<img[^>]+src=["\']([^"\']+)["\']', re.I)
IMG_EXT = re.compile(r'\.(jpe?g|png|webp|gif)(\?|$)', re.I)


def item_image(item):
    for ch in item.iter():
        ln = localname(ch.tag)
        if ln in ("thumbnail", "content"):
            url = ch.get("url")
            if url and (ln == "thumbnail" or ch.get("medium") == "image"
                        or ch.get("type", "").startswith("image") or IMG_EXT.search(url)):
                return url
        elif ln == "enclosure":
            url = ch.get("url")
            if url and (ch.get("type", "").startswith("image") or IMG_EXT.search(url)):
                return url
    for ch in item.iter():
        if localname(ch.tag) in ("description", "encoded", "summary", "content"):
            m = IMG_RE.search(ch.text or "")
            if m:
                return m.group(1)
    return ""


def parse_date(s):
    if not s:
        return None
    s = s.strip()
    try:
        dt = parsedate_to_datetime(s)
        return (dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt).astimezone(timezone.utc)
    except Exception:
        pass
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return (dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt).astimezone(timezone.utc)
    except Exception:
        return None


DATE_TAGS = {"pubdate", "published", "updated", "date"}


def parse_feed(raw):
    items, source = [], ""
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        return source, items
    for el in root.iter():
        if localname(el.tag) in ("channel", "feed"):
            for ch in el:
                if localname(ch.tag) == "title" and (ch.text or "").strip():
                    source = ch.text.strip()
                    break
        if source:
            break
    if not source:
        source = child_text(root, {"title"})
    for el in root.iter():
        if localname(el.tag) not in ("item", "entry"):
            continue
        title, link = child_text(el, {"title"}), item_link(el)
        if title and link:
            items.append({"title": title, "link": link,
                          "dt": parse_date(child_text(el, DATE_TAGS)),
                          "image": item_image(el)})
    return source, items


# --------------------------------------------------------------------------- #
# Apple / iTunes

def art(url, size="600x600"):
    """Sube la resolucion de la caratula: Apple sirve cualquier tamano por URL."""
    return re.sub(r"/\d+x\d+bb", "/" + size + "bb", url or "")


def apple_chart(pais):
    d = fetch_json("https://rss.marketingtools.apple.com/api/v2/%s/music/"
                   "most-played/%d/albums.json" % (pais, TOP_CHART))
    filas = []
    for r in d.get("feed", {}).get("results", []):
        if es_ruido({"title": r.get("name", ""), "artist": r.get("artistName", "")}):
            continue
        filas.append({
            "artist": r.get("artistName", ""),
            "artistId": str(r.get("artistId") or ""),
            "title": r.get("name", ""),
            "art": art(r.get("artworkUrl100", "")),
            "url": r.get("url", ""),
            "genre": (r.get("genres") or [{}])[0].get("name", ""),
        })
    return filas


# Los charts se llenan de audio funcional (ruido blanco, frecuencias, ASMR) que
# no es un lanzamiento en ningun sentido util. Fuera.
RUIDO = re.compile(
    r"\b(\d{2,4}\s*hz|white noise|brown noise|pink noise|sleep sounds?|"
    r"rain sounds?|asmr|binaural|solfeggio|meditation music|study music|"
    r"lullab(y|ies)|nature sounds?|healing frequenc)", re.I)


def es_ruido(item):
    return bool(RUIDO.search(item.get("title", "")) or RUIDO.search(item.get("artist", "")))


TIPOS = (("single", re.compile(r"\s-\s(single|sencillo)$", re.I)),
         ("ep", re.compile(r"\s-\s(ep)$", re.I)))


def tipo_de(nombre, pistas):
    for etiqueta, patron in TIPOS:
        if patron.search(nombre or ""):
            return etiqueta
    if pistas and pistas <= 3:
        return "single"
    if pistas and pistas <= 6:
        return "ep"
    return "album"


def itunes_discos(ids):
    """Discos recientes de una tanda de artistas. Lotes para no abusar de la API."""
    salida = []
    for i in range(0, len(ids), LOTE_ITUNES):
        lote = ",".join(ids[i:i + LOTE_ITUNES])
        try:
            d = fetch_json("https://itunes.apple.com/lookup?id=%s&entity=album"
                           "&limit=25&sort=recent" % lote)
        except Exception as e:
            anota("itunes lote %d" % (i // LOTE_ITUNES + 1), False, e)
            continue
        for r in d.get("results", []):
            if r.get("wrapperType") != "collection":
                continue
            fecha = (r.get("releaseDate") or "")[:10]
            if not fecha:
                continue
            nombre = r.get("collectionName", "")
            if es_ruido({"title": nombre, "artist": r.get("artistName", "")}):
                continue
            salida.append({
                "artist": r.get("artistName", ""),
                "artistId": str(r.get("artistId") or ""),
                "title": nombre,
                "date": fecha,
                "kind": tipo_de(nombre, r.get("trackCount")),
                "tracks": r.get("trackCount") or 0,
                "art": art(r.get("artworkUrl100", "")),
                "url": r.get("collectionViewUrl", ""),
                "genre": r.get("primaryGenreName", ""),
                "source": "itunes",
            })
        time.sleep(1)
    return salida


# --------------------------------------------------------------------------- #
# MusicBrainz: lo que ya esta anunciado con fecha futura.

def normaliza(nombre):
    return re.sub(r"[^a-z0-9]+", "", (nombre or "").lower())


def musicbrainz_proximos(dias=120, relevantes=None):
    desde, hasta = hoy(), hoy() + timedelta(days=dias)
    q = ('date:[%s TO %s] AND status:official AND '
         '(primarytype:album OR primarytype:ep)' % (desde, hasta))
    url = ("https://musicbrainz.org/ws/2/release/?query=%s&fmt=json&limit=100"
           % urllib.parse.quote(q))
    d = fetch_json(url, ua=UA_MB, intentos=4)
    salida = []
    for r in d.get("releases", []):
        fecha = r.get("date") or ""
        if len(fecha) != 10 or fecha <= str(desde):
            continue
        artista = (r.get("artist-credit") or [{}])[0].get("name", "")
        if not artista:
            continue
        # Sin este filtro el calendario se llena de nombres que no le dicen nada
        # a nadie: MusicBrainz indexa cada lanzamiento del planeta.
        if relevantes is not None and normaliza(artista) not in relevantes:
            continue
        salida.append({
            "artist": artista, "artistId": "", "title": r.get("title", ""),
            "date": fecha, "kind": (r.get("primary-type") or "album").lower(),
            "tracks": 0, "art": "", "url": "https://musicbrainz.org/release/" + r.get("id", ""),
            "genre": "", "source": "musicbrainz", "score": r.get("score", 0),
        })
    return salida


# --------------------------------------------------------------------------- #

def cargar(path, default):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def guardar(nombre, obj):
    with open(os.path.join(DATA, nombre), "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


def clave(item):
    return (item["artist"].lower().strip(), re.sub(r"\s*[-(].*$", "", item["title"].lower()).strip())


def main():
    os.makedirs(DATA, exist_ok=True)
    ahora = datetime.now(timezone.utc)

    # 1. Charts: contexto local y semilla de artistas cuando no hay lista propia.
    charts = {}
    for pais, etiqueta in PAISES_CHART:
        try:
            charts[pais] = {"pais": etiqueta, "items": apple_chart(pais)}
            anota("chart " + pais, True)
        except Exception as e:
            charts[pais] = {"pais": etiqueta, "items": []}
            anota("chart " + pais, False, e)

    # 2. Pool de artistas: los tuyos primero, luego los de los charts.
    tuyos = cargar(os.path.join(HERE, "artists.json"), {}).get("artists", [])
    pool, vistos = [], set()
    for a in tuyos:
        aid = str(a.get("id") or "")
        if aid and aid not in vistos:
            vistos.add(aid)
            pool.append({"id": aid, "name": a.get("name", ""), "mine": True})
    for pais, _ in PAISES_CHART:
        for fila in charts.get(pais, {}).get("items", []):
            aid = fila["artistId"]
            if aid and aid not in vistos:
                vistos.add(aid)
                pool.append({"id": aid, "name": fila["artist"], "mine": False})
    pool = pool[:MAX_POOL]
    print("pool: %d artistas (%d tuyos)" % (len(pool), sum(1 for a in pool if a["mine"])))

    # 3. Discos del pool, partidos en "salio" y "viene".
    discos = itunes_discos([a["id"] for a in pool])
    mios = {a["id"] for a in pool if a["mine"]}
    corte = str(hoy() - timedelta(days=DIAS_RECIENTE))
    ahora_str = str(hoy())

    recientes, proximos, unicos = [], [], set()
    for d in discos:
        k = clave(d)
        if k in unicos:
            continue
        unicos.add(k)
        d["mine"] = d["artistId"] in mios
        if d["date"] > ahora_str:
            proximos.append(d)
        elif d["date"] >= corte:
            recientes.append(d)
    recientes.sort(key=lambda x: (x["date"], x["mine"]), reverse=True)
    anota("itunes discos", True, "")
    print("  recientes: %d · pre-orders: %d" % (len(recientes), len(proximos)))

    # 4. Calendario: pre-orders de Apple + lo anunciado en MusicBrainz.
    try:
        relevantes = {normaliza(a["name"]) for a in pool if a["name"]}
        mb = musicbrainz_proximos(relevantes=relevantes)
        for d in mb:
            k = clave(d)
            if k not in unicos:
                unicos.add(k)
                d["mine"] = False
                proximos.append(d)
        anota("musicbrainz", True)
    except Exception as e:
        anota("musicbrainz", False, e)
    proximos.sort(key=lambda x: x["date"])

    # 5. Descubrimiento editorial.
    NOMBRES = {"pitchfork.com": "Pitchfork", "www.npr.org": "NPR Music",
               "daily.bandcamp.com": "Bandcamp Daily", "thequietus.com": "The Quietus",
               "www.billboard.com": "Billboard", "consequence.net": "Consequence"}
    fuentes = cargar(os.path.join(HERE, "sources.json"), {}).get("feeds", [])
    editorial = []
    for url in fuentes:
        try:
            nombre, items = parse_feed(fetch(url, accept="application/rss+xml, application/xml, */*"))
            if not items:
                raise ValueError("sin items")
            for it in items[:12]:
                editorial.append({
                    "title": it["title"], "link": it["link"],
                    "source": NOMBRES.get(urllib.parse.urlparse(url).hostname,
                                          nombre or urllib.parse.urlparse(url).hostname),
                    "date": it["dt"].isoformat() if it["dt"] else "",
                    "image": it["image"],
                })
            anota(urllib.parse.urlparse(url).hostname, True)
        except Exception as e:
            anota(urllib.parse.urlparse(url).hostname, False, e)
    editorial.sort(key=lambda x: x["date"], reverse=True)

    # 6. Memoria: un punto por corrida, para ver actividad en el tiempo.
    hist = cargar(os.path.join(DATA, "history.json"), [])
    hist.append({"t": ahora.isoformat(), "recientes": len(recientes),
                 "proximos": len(proximos), "pool": len(pool),
                 "editorial": len(editorial)})
    hist = hist[-2000:]

    guardar("releases.json", {"updated": ahora.isoformat(), "items": recientes})
    guardar("upcoming.json", {"updated": ahora.isoformat(), "items": proximos[:120]})
    guardar("editorial.json", {"updated": ahora.isoformat(), "items": editorial[:80]})
    guardar("charts.json", {"updated": ahora.isoformat(), "paises": charts})
    guardar("pool.json", {"updated": ahora.isoformat(), "artists": pool})
    guardar("history.json", hist)
    guardar("meta.json", {
        "updated": ahora.isoformat(),
        "fuentes_ok": sum(1 for s in salud if s["ok"]),
        "fuentes_total": len(salud),
        "salud": salud,
        "conteo": {"recientes": len(recientes), "proximos": len(proximos),
                   "editorial": len(editorial), "pool": len(pool),
                   "tuyos": len(mios)},
        "dias_reciente": DIAS_RECIENTE,
    })
    ok = sum(1 for s in salud if s["ok"])
    print("\nlisto: %d recientes · %d proximos · %d editorial · fuentes %d/%d"
          % (len(recientes), len(proximos), len(editorial), ok, len(salud)))

    # El workflow abre un issue si esto sale en 1: mas fiable que parsear el log.
    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as f:
            f.write("alerta=%d\n" % (1 if salud and ok < len(salud) * 0.6 else 0))
            f.write("salud=%d/%d\n" % (ok, len(salud)))


if __name__ == "__main__":
    main()
