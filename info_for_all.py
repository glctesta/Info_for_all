import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from logging.handlers import RotatingFileHandler

from screeninfo import get_monitors
from selenium import webdriver
from selenium.webdriver.chrome.options import Options as ChromeOptions
from selenium.webdriver.chrome.service import Service as ChromeService
from selenium.webdriver.edge.options import Options as EdgeOptions
from selenium.webdriver.edge.service import Service as EdgeService

def _app_dir():
    """Restituisce la cartella dell'applicazione, gestendo anche il caso dell'eseguibile compilato."""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))

APP_DIR = _app_dir()
CONFIG_FILE = os.path.join(APP_DIR, 'info_config.json')
LOG_FILE = os.path.join(APP_DIR, 'info_for_all.log')

def _setup_logging():
    """Configura il logging su file (con rotazione) e su console."""
    logger = logging.getLogger()
    logger.setLevel(logging.INFO)
    
    formatter = logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    file_handler = RotatingFileHandler(LOG_FILE, maxBytes=2*1024*1024, backupCount=5, encoding='utf-8')
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
    
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)
    
    def handle_exception(exc_type, exc_value, exc_traceback):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc_value, exc_traceback)
            return
        logger.error("Eccezione non gestita", exc_info=(exc_type, exc_value, exc_traceback))
        
    sys.excepthook = handle_exception
    return logger

log = logging.getLogger(__name__)

def load_config():
    """Carica la configurazione da info_config.json, creandolo con default se non esiste."""
    if not os.path.exists(CONFIG_FILE):
        default_config = {
            "rotation": {"interval_seconds": 30},
            "breaks": {"shift": 1},
            "display": {"monitor_index": 0},
            "server": {"host": "0.0.0.0", "port": 5000}
        }
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump(default_config, f, indent=4)
            log.info("Creato file di configurazione di default: %s", CONFIG_FILE)
            return default_config
        except Exception as e:
            log.error("Errore nella creazione del file di configurazione: %s", e)
            return {}
            
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        log.error("Errore nel caricamento del file di configurazione: %s", e)
        return {}

def list_monitors():
    """Restituisce la lista dei monitor di sistema."""
    try:
        return get_monitors()
    except Exception as e:
        log.error("Errore nel recupero della lista monitor: %s", e)
        return []

def print_available_monitors(monitors):
    """Stampa a log i monitor disponibili."""
    if not monitors:
        log.warning("Nessun monitor rilevato.")
        return
        
    log.info("Monitor rilevati:")
    for i, m in enumerate(monitors):
        log.info("  [%d] %s (%dx%d in %d,%d) %s", 
                 i, m.name, m.width, m.height, m.x, m.y, 
                 "Principale" if m.is_primary else "")

def pick_target_monitor(monitor_index):
    """Seleziona il monitor target in base all'indice configurato."""
    monitors = list_monitors()
    print_available_monitors(monitors)
    
    if not monitors:
        return None
        
    if 0 <= monitor_index < len(monitors):
        log.info("Selezionato monitor %d come target.", monitor_index)
        return monitors[monitor_index]
        
    log.warning("Indice monitor %d non valido, utilizzo il monitor principale.", monitor_index)
    for m in monitors:
        if m.is_primary:
            return m
            
    return monitors[0]

def create_kiosk_browser(target_monitor, browser='edge'):
    """Crea un'istanza del browser configurata in modalità kiosk sul monitor target."""
    driver = None
    user_data_dir = tempfile.mkdtemp(prefix='kiosk_')
    
    try:
        if browser.lower() == 'chrome':
            options = ChromeOptions()
            options.add_argument(f'--user-data-dir={user_data_dir}')
            options.add_argument('--kiosk')
            options.add_argument('--disable-infobars')
            if target_monitor:
                options.add_argument(f'--window-position={target_monitor.x},{target_monitor.y}')
            driver = webdriver.Chrome(options=options)
        else:
            options = EdgeOptions()
            options.add_argument(f'--user-data-dir={user_data_dir}')
            options.add_argument('--kiosk')
            options.add_argument('--disable-infobars')
            if target_monitor:
                options.add_argument(f'--window-position={target_monitor.x},{target_monitor.y}')
            driver = webdriver.Edge(options=options)
            
        log.info("Browser %s avviato in modalità kiosk.", browser)
        return driver
    except Exception as e:
        log.error("Errore nell'avvio del browser: %s", e)
        return None

def start_flask_server(host, port):
    """Avvia il server Flask in un thread demone."""
    from web_server import app
    server_thread = threading.Thread(
        target=lambda: app.run(host=host, port=port, debug=False, use_reloader=False),
        daemon=True
    )
    server_thread.start()
    log.info('Flask server avviato su http://%s:%s', host, port)
    
    import urllib.request
    for _ in range(30):
        try:
            urllib.request.urlopen(f'http://{host}:{port}/')
            break
        except Exception:
            time.sleep(0.5)
            
    return server_thread

def main():
    _setup_logging()
    log.info("Avvio di Info_for_all. PID: %d, App Dir: %s, Py: %s", os.getpid(), APP_DIR, sys.version)
    
    config = load_config()
    server_config = config.get("server", {})
    host = server_config.get("host", "127.0.0.1")
    port = server_config.get("port", 5000)
    
    start_flask_server(host, port)
    
    browser_config = config.get("browser", {})
    monitor_index = int(browser_config.get("monitor_index", 0))
    browser_type = browser_config.get("type", "chrome")
    
    target_monitor = pick_target_monitor(monitor_index)
    driver = create_kiosk_browser(target_monitor, browser=browser_type)
    
    if not driver:
        log.error("Impossibile creare il browser. Uscita.")
        return
        
    url = f"http://localhost:{port}/"
    try:
        driver.get(url)
        log.info("Navigazione verso %s effettuata.", url)
    except Exception as e:
        log.error("Errore durante la navigazione: %s", e)
        
    running = True
    def signal_handler(sig, frame):
        nonlocal running
        log.info("Segnale di terminazione ricevuto. Chiusura in corso...")
        running = False
        
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    try:
        while running:
            time.sleep(5)
            try:
                _ = driver.title
            except Exception:
                log.warning("Browser chiuso o non più raggiungibile. Uscita.")
                break
    except KeyboardInterrupt:
        log.info("Interruzione da tastiera.")
    finally:
        if driver:
            try:
                driver.quit()
                log.info("Browser chiuso correttamente.")
            except Exception:
                pass
        log.info("Applicazione terminata.")

if __name__ == '__main__':
    main()
