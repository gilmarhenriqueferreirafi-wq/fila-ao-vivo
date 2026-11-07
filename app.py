import json
import os
import re
import socket
import threading
import argparse
import subprocess
import base64
import random
import time
from datetime import datetime, timezone
from io import BytesIO
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).parent
STATIC = ROOT / "static"
GENRES_PATH = ROOT / "genres.json"
CONFIG_HISTORY_PATH = ROOT / "config_history.json"
PORT = int(os.environ.get("PORT", "8080"))

with GENRES_PATH.open(encoding="utf-8") as genres_file:
    GENRES = json.load(genres_file)

def load_saved_settings():
    try:
        history = json.loads(CONFIG_HISTORY_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}
    saved = {}
    for entry in history:
        if entry.get("category") in ("genres", "queue") and isinstance(entry.get("values"), dict):
            saved.update(entry["values"])
    if isinstance(saved.get("selected_genres"), list):
        saved["selected_genres"] = [name for name in saved["selected_genres"] if name in GENRES] or list(GENRES)
    return saved

saved_settings = load_saved_settings()
state = {
    "queue": [],
    "current": -1,
    "settings": {"repeat": False, "shuffle": False, "auto_play": True, "random_on_empty": False,
                 "selected_genres": list(GENRES), "mini_show_video": False},
    "playback": {"track_id": None, "current": 0, "duration": 0, "playing": False, "updated_at": 0},
}
state["settings"].update(saved_settings)
lock = threading.Lock()
runtime = {"remote_url": "", "remote_qr": "", "wifi_qr": ""}


def append_config_history(category, values):
    try:
        history = json.loads(CONFIG_HISTORY_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        history = []
    history.append({"timestamp": datetime.now(timezone.utc).isoformat(), "category": category, "values": values})
    CONFIG_HISTORY_PATH.write_text(json.dumps(history[-200:], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def youtube_id(value):
    value = value.strip()
    match = re.search(r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})", value)
    if match:
        return match.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{11}", value):
        return value
    return None


def search_youtube(query, offset=0, limit=10):
    try:
        import yt_dlp
    except ImportError:
        raise RuntimeError("Pesquisa indisponível. Instale as dependências com: pip install -r requirements.txt")
    options = {"quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True}
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(f"ytsearch{offset + limit}:" + query, download=False)
    results = []
    for item in info.get("entries", [])[offset:offset + limit]:
        if not item or not item.get("id"):
            continue
        video_id = item["id"]
        results.append({
            "id": video_id,
            "title": item.get("title") or "Vídeo sem título",
            "channel": item.get("channel") or item.get("uploader") or "YouTube",
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
        })
    return results


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.end_headers()
        self.wfile.write(raw)

    def read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(length) or b"{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            with lock:
                payload = snapshot()
            return self.send_json(payload)
        if parsed.path == "/api/now-playing":
            with lock:
                return self.send_json(snapshot()["playback"])
        if parsed.path == "/api/genres":
            return self.send_json({"genres": GENRES})
        if parsed.path == "/api/history":
            try:
                history = json.loads(CONFIG_HISTORY_PATH.read_text(encoding="utf-8"))
            except (FileNotFoundError, json.JSONDecodeError):
                history = []
            return self.send_json({"history": history})
        if parsed.path == "/api/search":
            query = parse_qs(parsed.query).get("q", [""])[0].strip()
            try:
                offset = max(0, int(parse_qs(parsed.query).get("offset", [0])[0]))
                limit = min(10, max(1, int(parse_qs(parsed.query).get("limit", [10])[0])))
            except ValueError:
                return self.send_json({"error": "Paginação inválida"}, 400)
            if len(query) < 2:
                return self.send_json({"results": []})
            try:
                return self.send_json({"results": search_youtube(query, offset, limit), "offset": offset, "limit": limit})
            except Exception as exc:
                return self.send_json({"error": str(exc)}, 500)
        file_name = "remote.html" if parsed.path == "/remote" else "painel.html" if parsed.path == "/painel" else "index.html" if parsed.path in ("/", "/panel") else None
        if file_name:
            if file_name == "index.html":
                refresh_remote_address()
            return self.serve_file(STATIC / file_name, "text/html; charset=utf-8", html_context=True)
        if parsed.path.startswith("/static/"):
            path = STATIC / parsed.path.removeprefix("/static/")
            if path.is_file() and path.resolve().parent == STATIC.resolve():
                content_type = {
                    ".css": "text/css; charset=utf-8",
                    ".js": "text/javascript; charset=utf-8",
                    ".png": "image/png",
                    ".svg": "image/svg+xml",
                }.get(path.suffix.lower(), "application/octet-stream")
                return self.serve_file(path, content_type)
        self.send_json({"error": "Não encontrado"}, 404)

    def serve_file(self, path, content_type, html_context=False):
        raw = path.read_bytes()
        if html_context:
            raw = raw.decode("utf-8").replace("__REMOTE_URL__", runtime["remote_url"])
            raw = raw.replace("__REMOTE_QR__", runtime["remote_qr"])
            raw = raw.replace("__WIFI_QR__", runtime["wifi_qr"]).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.end_headers()
        self.wfile.write(raw)

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            data = self.read_json()
            if parsed.path == "/api/queue":
                return self.add_item(data)
            if parsed.path == "/api/next":
                with lock:
                    should_fill = advance_queue() and state["settings"]["random_on_empty"]
                    payload = snapshot()
                if should_fill:
                    return self.start_random_track()
                return self.send_json(payload)
            if parsed.path == "/api/previous":
                with lock:
                    if state["queue"] and state["current"] > 0:
                        state["current"] -= 1
                    payload = snapshot()
                return self.send_json(payload)
            if parsed.path == "/api/select":
                index = int(data.get("index", -1))
                with lock:
                    if not 0 <= index < len(state["queue"]):
                        return self.send_json({"error": "Música inválida"}, 400)
                    state["current"] = index
                    payload = snapshot()
                return self.send_json(payload)
            if parsed.path == "/api/progress":
                with lock:
                    state["playback"] = {
                        "track_id": str(data.get("track_id") or ""),
                        "current": max(0, float(data.get("current", 0))),
                        "duration": max(0, float(data.get("duration", 0))),
                        "playing": bool(data.get("playing")),
                        "updated_at": time.time(),
                    }
                    payload = snapshot()
                return self.send_json(payload)
            if parsed.path == "/api/move":
                return self.move_item(data)
            if parsed.path == "/api/history":
                category = str(data.get("category") or "")
                if category not in ("video", "genres", "queue"):
                    return self.send_json({"error": "Categoria inválida"}, 400)
                append_config_history(category, data.get("values") or {})
                return self.send_json({"ok": True})
            if parsed.path == "/api/ended":
                with lock:
                    if state["settings"]["auto_play"]:
                        should_fill = advance_queue() and state["settings"]["random_on_empty"]
                    elif (state["settings"]["random_on_empty"] and state["queue"]
                          and state["current"] == len(state["queue"]) - 1):
                        state["current"] = -1
                        should_fill = True
                    else:
                        should_fill = False
                    payload = snapshot()
                if should_fill:
                    return self.start_random_track()
                return self.send_json(payload)
            if parsed.path == "/api/settings":
                with lock:
                    for key in ("repeat", "shuffle", "auto_play", "random_on_empty", "mini_show_video"):
                        if key in data:
                            state["settings"][key] = bool(data[key])
                    if "selected_genres" in data:
                        selected = data["selected_genres"]
                        if not isinstance(selected, list):
                            return self.send_json({"error": "Seleção de gêneros inválida"}, 400)
                        selected = [name for name in selected if name in GENRES]
                        if not selected:
                            return self.send_json({"error": "Marque pelo menos um gênero"}, 400)
                        state["settings"]["selected_genres"] = selected
                    append_config_history("genres", {"selected_genres": list(state["settings"]["selected_genres"])})
                    append_config_history("queue", {key: state["settings"][key] for key in ("repeat", "shuffle", "auto_play", "random_on_empty", "mini_show_video")})
                    payload = snapshot()
                return self.send_json(payload)
            if parsed.path == "/api/clear":
                with lock:
                    state["queue"].clear()
                    state["current"] = -1
                return self.send_json(snapshot())
            if parsed.path == "/api/remove":
                index = int(data.get("index", -1))
                with lock:
                    if not 0 <= index < len(state["queue"]):
                        return self.send_json({"error": "Música inválida"}, 400)
                    state["queue"].pop(index)
                    if not state["queue"]:
                        state["current"] = -1
                    elif index < state["current"]:
                        state["current"] -= 1
                    elif index == state["current"]:
                        state["current"] = min(state["current"], len(state["queue"]) - 1)
                return self.send_json(snapshot())
            self.send_json({"error": "Não encontrado"}, 404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, 400)

    def move_item(self, data):
        index = int(data.get("index", -1))
        direction = int(data.get("direction", 0))
        if direction not in (-1, 1):
            return self.send_json({"error": "Direção inválida"}, 400)
        with lock:
            target = index + direction
            if not 0 <= index < len(state["queue"]) or not 0 <= target < len(state["queue"]):
                return self.send_json(snapshot())
            state["queue"][index], state["queue"][target] = state["queue"][target], state["queue"][index]
            if state["current"] == index:
                state["current"] = target
            elif state["current"] == target:
                state["current"] = index
            payload = snapshot()
        return self.send_json(payload)

    def add_item(self, data):
        video_id = youtube_id(str(data.get("url") or data.get("id") or ""))
        if not video_id:
            return self.send_json({"error": "Cole um link válido do YouTube."}, 400)
        item = {
            "id": video_id,
            "title": data.get("title") or "Vídeo do YouTube",
            "channel": data.get("channel") or "YouTube",
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
            "added_by": str(data.get("added_by") or "Convidado")[:30],
        }
        with lock:
            was_empty = not state["queue"]
            state["queue"].append(item)
            if was_empty or state["current"] < 0:
                state["current"] = 0 if was_empty else len(state["queue"]) - 1
            payload = snapshot()
        return self.send_json(payload, 201)

    def start_random_track(self):
        try:
            item = random_youtube_music()
        except Exception as exc:
            return self.send_json({"error": f"NÃ£o consegui buscar uma mÃºsica surpresa: {exc}"}, 502)
        with lock:
            if state["current"] < 0 and state["settings"]["random_on_empty"]:
                state["queue"].append(item)
                state["current"] = len(state["queue"]) - 1
            payload = snapshot()
        return self.send_json(payload)


def snapshot():
    playback = dict(state["playback"])
    track = None
    if playback.get("track_id"):
        current_item = state["queue"][state["current"]] if 0 <= state["current"] < len(state["queue"]) else None
        if current_item and current_item.get("id") == playback["track_id"]:
            track = current_item
        else:
            track = next((item for item in state["queue"] if item.get("id") == playback["track_id"]), None)
    if track:
        video_id = track["id"]
        playback["track"] = {
            "id": video_id,
            "title": track.get("title") or "Vídeo do YouTube",
            "channel": track.get("channel") or "YouTube",
            "thumbnail": track.get("thumbnail") or f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
            "youtube_url": f"https://www.youtube.com/watch?v={video_id}",
            "embed_url": f"https://www.youtube.com/embed/{video_id}",
        }
    else:
        playback["track"] = None
    return {
        "queue": list(state["queue"]),
        "current": state["current"],
        "settings": dict(state["settings"]),
        "playback": playback,
    }


def advance_queue():
    count = len(state["queue"])
    if not count:
        state["current"] = -1
    elif state["settings"]["shuffle"] and count > 1:
        options = [index for index in range(count) if index != state["current"]]
        state["current"] = random.choice(options)
    elif state["current"] < 0:
        state["current"] = 0
    elif state["current"] + 1 < count:
        state["current"] += 1
    elif state["settings"]["repeat"]:
        state["current"] = 0
    else:
        state["current"] = -1
        return True
    return False


def random_youtube_music():
    try:
        import yt_dlp
    except ImportError as exc:
        raise RuntimeError("instale yt-dlp com: python -m pip install -r requirements.txt") from exc
    with lock:
        selected = list(state["settings"].get("selected_genres") or GENRES)
    selected = [name for name in selected if name in GENRES] or list(GENRES)
    genre = random.choice(selected)
    artist = random.choice(GENRES[genre]["artistas"])
    query = f"{artist} {GENRES[genre]['label']} música brasileira"
    options = {"quiet": True, "no_warnings": True, "extract_flat": True, "skip_download": True}
    with yt_dlp.YoutubeDL(options) as ydl:
        info = ydl.extract_info(f"ytsearch20:{query}", download=False)
    entries = [entry for entry in info.get("entries", []) if entry and entry.get("id")]
    if not entries:
        raise RuntimeError("a pesquisa não retornou músicas")
    selected = random.choice(entries)
    video_id = selected["id"]
    return {
        "id": video_id,
        "title": selected.get("title") or "Música surpresa",
        "channel": selected.get("channel") or selected.get("uploader") or "YouTube",
        "thumbnail": f"https://i.ytimg.com/vi/{video_id}/mqdefault.jpg",
        "added_by": "Música surpresa",
    }


def local_ip():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        sock.close()


def refresh_remote_address():
    ip = local_ip()
    runtime["remote_url"] = f"http://{ip}:{PORT}/remote"
    try:
        runtime["remote_qr"] = qr_data_uri(runtime["remote_url"])
    except ImportError:
        runtime["remote_qr"] = ""


def connected_wifi_name():
    if os.name != "nt":
        return None
    try:
        result = subprocess.run(
            ["netsh", "wlan", "show", "interfaces"], capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=5, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    for line in result.stdout.splitlines():
        match = re.match(r"\s*SSID\s*:\s*(.*?)\s*$", line, re.IGNORECASE)
        if match and match.group(1) and "bssid" not in line.casefold():
            return match.group(1)
    return None


def wifi_escape(value):
    return re.sub(r"([\\;,:\"])", r"\\\1", value)


def qr_data_uri(value):
    import qrcode
    image = qrcode.make(value)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def saved_wifi_password(ssid):
    if os.name != "nt" or not ssid:
        return None
    try:
        result = subprocess.run(
            ["netsh", "wlan", "show", "profile", f"name={ssid}", "key=clear"],
            capture_output=True, text=True, encoding="utf-8", errors="replace",
            timeout=5, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    for line in result.stdout.splitlines():
        match = re.match(r"\s*(?:Key Content|Conte[uú]do da Chave)\s*:\s*(.*?)\s*$", line, re.IGNORECASE)
        if match and match.group(1):
            return match.group(1)
    return None


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fila compartilhada do YouTube")
    parser.add_argument("--wifi-name", help="Nome (SSID), detectado automaticamente se omitido")
    parser.add_argument("--wifi-password", default=os.environ.get("FILA_WIFI_PASSWORD"), help="Senha da rede Wi-Fi para gerar o QR")
    parser.add_argument("--wifi-security", default="WPA", choices=["WPA", "WEP", "nopass"])
    args = parser.parse_args()
    wifi_name = args.wifi_name or connected_wifi_name()
    wifi_password = args.wifi_password or saved_wifi_password(wifi_name)
    if wifi_name and not wifi_password and args.wifi_security != "nopass":
        try:
            wifi_password = input(f"Senha da rede {wifi_name} (necessária para criar o QR Wi-Fi): ").strip()
        except EOFError:
            wifi_password = None
    ip = local_ip()
    runtime["remote_url"] = f"http://{ip}:{PORT}/remote"
    if wifi_name and (wifi_password or args.wifi_security == "nopass"):
        try:
            import qrcode
            payload = f"WIFI:T:{args.wifi_security};S:{wifi_escape(wifi_name)};P:{wifi_escape(wifi_password or '')};;"
            runtime["wifi_qr"] = qr_data_uri(payload)
        except ImportError:
            print("Aviso: instale qrcode com: py -m pip install -r requirements.txt")
    try:
        import qrcode
        runtime["remote_qr"] = qr_data_uri(runtime["remote_url"])
    except ImportError:
        pass
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Painel: http://localhost:{PORT}/")
    print(f"Celulares: {runtime['remote_url']}")
    if wifi_name:
        print(f"Rede Wi-Fi detectada: {wifi_name}")
    print("QR do Wi-Fi: ativo" if runtime["wifi_qr"] else "QR do Wi-Fi: indisponível (sem senha salva ou informada)")
    print("Pressione Ctrl+C para encerrar.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor encerrado.")
        server.shutdown()
