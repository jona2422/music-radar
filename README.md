# MUSIC RADAR

Radar personal de lanzamientos musicales. Estatico, gratis, sin servidor y sin API keys:
un robot de GitHub Actions corre una vez al dia, escribe JSON en `data/` y GitHub Pages
sirve el sitio.

**En vivo:** https://jona2422.github.io/music-radar/

## Las cuatro vistas

| Vista | Que muestra |
|---|---|
| **Salió** | Álbumes, EPs y sencillos de las últimas 3 semanas |
| **Viene** | Lo ya anunciado con fecha, en línea de tiempo |
| **Descubre** | Qué escriben NPR, Bandcamp Daily, The Quietus, Pitchfork, Billboard, Consequence |
| **Mi música** | Tus artistas marcados con ★, consultados **en vivo** desde el navegador |
| **Memoria** | Quién publica más, formatos, actividad en el tiempo |

## Cómo se llena sin que hagas nada

Mientras `scripts/artists.json` esté vacío, el pool sale de los charts de Apple de
Panamá, Estados Unidos, España y Reino Unido — así el sitio nunca está vacío.

Cuando marcas un artista con **★**, se guarda en tu navegador y sus discos se consultan
al momento contra la API de iTunes (permite CORS, así que no hay que esperar al robot).
Si quieres que el robot también los vigile a diario, usa **Exportar mi lista** y pega el
resultado en `scripts/artists.json`.

## Fuentes

- **Apple RSS** (`rss.marketingtools.apple.com`) — charts por país
- **iTunes Search / Lookup API** — discos, carátulas, fechas, pre-orders
- **MusicBrainz** — calendario de lanzamientos anunciados
- Feeds de prensa musical para la vista de descubrimiento

Ninguna necesita clave. Si una falla, se omite y la corrida continúa.

## Correr en local

```sh
python3 scripts/fetch_music.py     # baja datos a data/
python3 -m http.server 8899        # abrir http://localhost:8899
```

## Atajos

- `☆` sobre una carátula — seguir a ese artista
- `Alt + clic` sobre una carátula — marcarla como escuchada
- `#salio`, `#viene`, `#descubre`, `#mine`, `#stats` en la URL — ir directo a una vista
