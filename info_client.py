"""
Info For All — Client.
Apre il browser in modalità kiosk puntando al server centralizzato.
Supporta auto-aggiornamento dal server.
"""
import json
import logging
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error
from logging.handlers import RotatingFileHandler

from screeninfo import get_monitors
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.edge.options import Options as EdgeOptions


def _app_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


APP_DIR = _app_dir()
CONFIG_FILE = os.path.join(APP_DIR, 'client_config.json')
LOG_FILE = os.path.join(APP_DIR, 'info_client.log')


def _setup_logging():
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')

    fh = RotatingFileHandler(LOG_FILE, maxBytes=2*1024*1024, backupCount=3, encoding='utf-8')
    fh.setFormatter(formatter)
    logger.addHandler(fh)

    ch = logging.StreamHandler(sys.stdout)
    ch.setFormatter(formatter)
    logger.addHandler(ch)

    def handle_exc(t, v, tb):
        if issubclass(t, KeyboardInterrupt):
            sys.__excepthook__(t, v, tb)
            return
        logger.error("Eccezione non gestita", exc_info=(t, v, tb))
    sys.excepthook = handle_exc


log = logging.getLogger(__name__)


# ===================================================================
#  Config
# ===================================================================

def load_config():
    """Carica client_config.json. Se non esiste, lo crea con valori di default."""
    if not os.path.exists(CONFIG_FILE):
        defaults = {
            "server_url": "http://192.168.10.100:5100",
            "monitor_name": "MONITOR_PRODUZIONE_1",
            "browser": "chrome",
            "monitor_index": 0,
            "check_update_interval_minutes": 5,
            "client_version": "1.0.0"
        }
        with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
            json.dump(defaults, f, indent=4)
        log.info("Creato file di configurazione di default: %s", CONFIG_FILE)
        return defaults

    with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
        return json.load(f)


def save_config(cfg):
    with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=4)


# ===================================================================
#  Auto-Update
# ===================================================================

def check_for_update(server_url, local_version):
    """Controlla se c'è un aggiornamento disponibile sul server.
    Restituisce True se è stato scaricato un nuovo EXE (richiede riavvio).
    """
    try:
        version_url = f"{server_url}/api/client/version"
        req = urllib.request.Request(version_url, headers={'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            server_version = data.get("version", "0.0.0")

        if server_version == local_version:
            return False

        log.info("Nuova versione disponibile: %s (attuale: %s). Scaricamento in corso...",
                 server_version, local_version)

        # Scarica il nuovo EXE
        download_url = f"{server_url}/api/client/download"
        exe_path = os.path.abspath(sys.argv[0])
        temp_path = exe_path + ".update"

        urllib.request.urlretrieve(download_url, temp_path)

        # Verifica che il file scaricato sia valido (almeno 100KB)
        if os.path.getsize(temp_path) < 100_000:
            log.warning("File scaricato troppo piccolo, aggiornamento annullato.")
            os.remove(temp_path)
            return False

        # Su Windows: rinomina il vecchio, metti il nuovo
        backup_path = exe_path + ".old"
        if os.path.exists(backup_path):
            os.remove(backup_path)
        if os.path.exists(exe_path) and getattr(sys, 'frozen', False):
            os.rename(exe_path, backup_path)
            os.rename(temp_path, exe_path)
        else:
            os.remove(temp_path)

        # Aggiorna la versione nella config locale
        cfg = load_config()
        cfg["client_version"] = server_version
        save_config(cfg)

        log.info("Aggiornamento completato alla versione %s. Riavvio...", server_version)
        return True

    except urllib.error.URLError as e:
        log.warning("Impossibile contattare il server per l'aggiornamento: %s", e)
    except Exception as e:
        log.error("Errore durante il controllo aggiornamenti: %s", e)
    return False


def restart_self():
    """Riavvia l'applicazione."""
    log.info("Riavvio in corso...")
    exe = os.path.abspath(sys.argv[0])
    if getattr(sys, 'frozen', False):
        subprocess.Popen([exe])
    else:
        subprocess.Popen([sys.executable, exe])
    sys.exit(0)


# ===================================================================
#  Monitor & Browser
# ===================================================================

def list_monitors():
    try:
        return get_monitors()
    except Exception as e:
        log.error("Errore nel recupero monitor: %s", e)
        return []


def pick_target_monitor(monitor_index):
    monitors = list_monitors()
    if not monitors:
        return None
    for i, m in enumerate(monitors):
        log.info("  [%d] %s (%dx%d in %d,%d) %s",
                 i, m.name, m.width, m.height, m.x, m.y,
                 "Principale" if m.is_primary else "")
    if 0 <= monitor_index < len(monitors):
        return monitors[monitor_index]
    for m in monitors:
        if m.is_primary:
            return m
    return monitors[0]


def create_kiosk_browser(target_monitor, browser='chrome'):
    user_data_dir = tempfile.mkdtemp(prefix='kiosk_ifa_')
    try:
        if browser.lower() == 'chrome':
            options = ChromeOptions()
            options.add_argument(f'--user-data-dir={user_data_dir}')
            options.add_argument('--kiosk')
            options.add_argument('--disable-infobars')
            options.add_argument('--disable-extensions')
            options.add_argument('--disable-translate')
            options.add_argument('--no-first-run')
            options.add_argument('--autoplay-policy=no-user-gesture-required')
            if target_monitor:
                options.add_argument(f'--window-position={target_monitor.x},{target_monitor.y}')
            return webdriver.Chrome(options=options)
        else:
            options = EdgeOptions()
            options.add_argument(f'--user-data-dir={user_data_dir}')
            options.add_argument('--kiosk')
            options.add_argument('--disable-infobars')
            options.add_argument('--disable-extensions')
            options.add_argument('--no-first-run')
            options.add_argument('--autoplay-policy=no-user-gesture-required')
            if target_monitor:
                options.add_argument(f'--window-position={target_monitor.x},{target_monitor.y}')
            return webdriver.Edge(options=options)
    except Exception as e:
        log.error("Errore nell'avvio del browser: %s", e)
        return None


# ===================================================================
#  Main
# ===================================================================

def main():
    _setup_logging()
    config = load_config()

    server_url = config.get("server_url", "http://127.0.0.1:5100")
    monitor_name = config.get("monitor_name", "DEFAULT")
    browser_type = config.get("browser", "chrome")
    monitor_index = config.get("monitor_index", 0)
    update_interval = config.get("check_update_interval_minutes", 5) * 60
    local_version = config.get("client_version", "1.0.0")

    log.info("=" * 60)
    log.info("Info For All — Client v%s", local_version)
    log.info("Server: %s | Monitor: %s | Browser: %s",
             server_url, monitor_name, browser_type)
    log.info("=" * 60)

    # Controlla aggiornamenti prima di avviare
    if check_for_update(server_url, local_version):
        restart_self()
        return

    # Attendi che il server sia raggiungibile
    log.info("Attendo connessione al server...")
    for attempt in range(60):
        try:
            urllib.request.urlopen(f"{server_url}/api/client/version", timeout=5)
            log.info("Server raggiungibile.")
            break
        except Exception:
            if attempt % 10 == 0:
                log.info("  Server non raggiungibile, ritento... (tentativo %d)", attempt + 1)
            time.sleep(5)
    else:
        log.error("Server non raggiungibile dopo 5 minuti. Avvio comunque il browser.")

    # Avvia browser in kiosk
    target = pick_target_monitor(monitor_index)
    driver = create_kiosk_browser(target, browser_type)
    if not driver:
        log.error("Impossibile avviare il browser. Uscita.")
        return

    # Naviga alla pagina del server con il nome monitor
    page_url = f"{server_url}/?monitor={monitor_name}"
    try:
        driver.get(page_url)
        log.info("Browser aperto su: %s", page_url)
    except Exception as e:
        log.error("Errore di navigazione: %s", e)

    # Loop principale: heartbeat + controllo aggiornamenti
    running = True
    def sig_handler(sig, frame):
        nonlocal running
        running = False
    signal.signal(signal.SIGINT, sig_handler)
    signal.signal(signal.SIGTERM, sig_handler)

    last_update_check = time.time()

    try:
        while running:
            time.sleep(5)

            # Verifica browser ancora attivo
            try:
                _ = driver.title
            except Exception:
                log.warning("Browser chiuso. Uscita.")
                break

            # Controllo aggiornamenti periodico
            if time.time() - last_update_check >= update_interval:
                last_update_check = time.time()
                current_version = load_config().get("client_version", local_version)
                if check_for_update(server_url, current_version):
                    try:
                        driver.quit()
                    except Exception:
                        pass
                    restart_self()
                    return

    except KeyboardInterrupt:
        log.info("Interruzione da tastiera.")
    finally:
        try:
            driver.quit()
            log.info("Browser chiuso.")
        except Exception:
            pass
        log.info("Client terminato.")


if __name__ == '__main__':
    main()
