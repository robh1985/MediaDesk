# MediaDesk

One web portal for **Radarr, Sonarr, NZBGet and Jellyfin**, laid out like a desktop OS: draggable and resizable windows, a dock, a menu bar with live status, desktop widgets, notifications and a universal search launcher.

## Features

- **Desktop shell**: windows that snap to screen edges (drag to the left/right edge, or the top to maximise), minimise to the dock, and remember their positions. Includes a light/dark theme, wallpapers, accent colours, and a mobile layout.
- **Launcher**: press `Ctrl+Space`, `Ctrl+K` or `/` to search apps, your Radarr/Sonarr libraries and Jellyfin in one place, run commands ("pause", "scan", "missing"), or type `add <title>` to add a movie or show.
- **Overview**: library counts, download speed, active streams, health warnings, what's airing this week, the download queue and recently added items.
- **Radarr / Sonarr**: browse and filter the library, see movie or series details (including seasons and episodes), search, monitor or unmonitor, refresh, delete, add new titles, manage the queue, and view the calendar, health and disk space.
- **NZBGet**: a live speed graph, pause and resume (everything or one download), a speed limit, move to top, delete, history (including retrying failed downloads), adding an NZB by URL or file upload, the message log, and server stats.
- **Jellyfin**: continue watching, next up, recently added, library browsing and search, item details (mark watched, favourite, refresh metadata), now playing (pause, stop or message a viewer), library scans, scheduled tasks, the activity log, and restart.
- **Notifications** when downloads finish or fail, and when Radarr or Sonarr report health errors.
- **Web UI windows**: open any service's own interface inside a window for anything MediaDesk doesn't cover.

Your API keys stay on the MediaDesk server. The browser only talks to MediaDesk, which adds the credentials when it forwards each request. This also avoids CORS problems.

## Quick start

### Try the demo first (no servers needed)

```bash
npm run demo        # or: node server.js --mock
# open http://localhost:8080
```

### Docker Compose

```bash
docker compose up -d --build
# open http://<your-server>:8080, then go to Settings → Connections
```

Edit `PORTAL_PASSWORD` in `docker-compose.yml` first. Settings you save in the UI are stored in `./config/config.json`.

If your media apps run in the same Compose project or Docker network, use their container names as URLs (for example `http://radarr:7878`).

### Plain Node.js (18+)

```bash
PORTAL_PASSWORD=change-me node server.js
```

There are no dependencies and nothing to `npm install`.

## Configuration

You can configure MediaDesk in three ways. Environment variables override the config file.

1. **Settings app** (easiest): open *Settings → Connections*, fill in the fields, then click *Test connections* and *Save*.
2. **`config/config.json`**: see `config/config.example.json`.
3. **Environment variables**:

| Variable | Purpose |
| --- | --- |
| `PORTAL_PASSWORD` | Turns on the lock screen. **Set this** if anyone else can reach the portal. |
| `RADARR_URL`, `RADARR_API_KEY` | Radarr → *Settings → General → API Key* |
| `SONARR_URL`, `SONARR_API_KEY` | Sonarr → *Settings → General → API Key* |
| `NZBGET_URL`, `NZBGET_USERNAME`, `NZBGET_PASSWORD` | NZBGet → *Settings → Security* (`ControlUsername` / `ControlPassword`) |
| `JELLYFIN_URL`, `JELLYFIN_API_KEY` | Jellyfin → *Dashboard → API Keys → +* |
| `JELLYFIN_USER_ID` | Optional. Which user's view to browse (defaults to the first admin) |
| `*_PUBLIC_URL` | Optional. The browser-facing URL used for "Open in…" links and Web UI windows, if it differs from the server-side URL |
| `PORT`, `HOST`, `CONFIG_PATH` | Server settings (defaults: `8080`, `0.0.0.0`, `./config/config.json`) |

**Server URL compared with public URL:** the *server URL* is how the MediaDesk server reaches a service (for example `http://radarr:7878` inside Docker). The *public URL* is what your browser uses (for example `https://radarr.example.com`) and only matters for links and embedded web UIs.

## Security notes

- Logging in to MediaDesk gives full API access to every connected service. Treat the portal password like an admin password.
- For access from outside your network, put MediaDesk behind a reverse proxy with HTTPS (Caddy, Traefik, nginx, or SWAG). If the proxy sends `X-Forwarded-Proto: https`, the session cookie is marked `Secure`.
- Login attempts are rate-limited, and sessions last 30 days. Changing the password signs everyone out.
- The config file is written with `0600` permissions.

## Compatibility

- Radarr v3+ and Sonarr v3/v4 (API v3)
- NZBGet v18+ and nzbget-ng
- Jellyfin 10.8+

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `Ctrl+Space`, `Ctrl+K`, `/` | Open the launcher / search |
| `Alt+W` | Close the focused window |
| `Esc` | Close the launcher, dialog or menu |
| Double-click a title bar | Maximise or restore |

## Troubleshooting

- **"Could not reach radarr: ECONNREFUSED"**: the URL is wrong *from the MediaDesk server's point of view*. Inside Docker, `localhost` means the MediaDesk container itself, so use the host's LAN IP or the container name instead.
- **A Web UI window is blank**: the service may block being embedded in a frame, or your browser can't reach the public URL. Use "Open in new tab".
- **Jellyfin shows the wrong user's watch state**: set `JELLYFIN_USER_ID` (or the field in Settings) to your own user ID.
