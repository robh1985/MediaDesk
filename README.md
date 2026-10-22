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

### Windows

1. Install **Node.js LTS** from <https://nodejs.org> (the default options are fine).
2. Download MediaDesk: either `git clone https://github.com/robh1985/MediaDesk.git`, or on GitHub click *Code → Download ZIP* and extract it. A permanent spot like `C:\MediaDesk` works best.
3. Pick how you want to run it:

| | How | Good for |
| --- | --- | --- |
| **Try it** | Double-click `start-windows.cmd`. To use sample data instead, run `start-windows.cmd --mock` from a command prompt. | Testing. It stops when you close the window. |
| **Run all the time** | Double-click `install-windows.cmd` and approve the admin prompt. | Everyday use. It starts with Windows (even before anyone logs in) and restarts if it crashes. |

`install-windows.cmd` does the following:
- asks for a portal password
- registers a startup task called **MediaDesk**
- opens the port in Windows Firewall for Private networks
- starts the portal and opens it in your browser
- prints the address other devices on your network can use

To use a different port, run it from a command prompt as `install-windows.cmd -Port 8081`. Run it again at any time to change the password or port.

Notes for Windows:
- **Service URLs:** if Radarr, Sonarr, NZBGet or Jellyfin run on the same PC, use `http://localhost:7878` and so on in *Settings → Connections*.
- **Other devices can't connect:** check that the network is set to *Private* in Windows Settings → Network. The firewall rule doesn't apply to *Public* networks.
- **Logs:** the background version writes to `logs\mediadesk.log`.
- **Manage it:** stop or start it from *Task Scheduler → MediaDesk*. To remove it, double-click `uninstall-windows.cmd`; your settings are kept.
- **Update:** run `git pull` (or extract the new ZIP over the old folder), then restart the **MediaDesk** task or reboot.
- **Docker Desktop** also works with `docker compose up -d --build`. In that case, services running on the Windows host are reached at `http://host.docker.internal:7878`, not `localhost`.

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
| `PORT`, `HOST`, `CONFIG_PATH` | Server settings (defaults: `8080`, `0.0.0.0`, `./config/config.json`). The port can also be set as `"port"` in the config file. |

**Server URL compared with public URL:** the *server URL* is how the MediaDesk server reaches a service (for example `http://radarr:7878` inside Docker). The *public URL* is what your browser uses (for example `https://radarr.example.com`) and only matters for links and embedded web UIs.

## Security notes

- Logging in to MediaDesk gives full API access to every connected service. Treat the portal password like an admin password.
- For access from outside your network, put MediaDesk behind a reverse proxy with HTTPS (Caddy, Traefik, nginx, or SWAG). If the proxy sends `X-Forwarded-Proto: https`, the session cookie is marked `Secure`.
- To sign out, click the MediaDesk logo at the top left and choose **Log out**. Login attempts are rate-limited, and sessions last 30 days. Changing the password signs everyone out.
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
