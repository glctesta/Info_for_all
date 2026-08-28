"""
Info For All — Server principale.
Avvia il server Flask su 0.0.0.0:porta, accessibile da tutta la rete.
Nessun browser locale — i client si collegano via rete.
"""
import json
import logging
import os
import signal
import sys
import time
from logging.handlers import RotatingFileHandler


def _app_dir():
    """Restituisce la cartella dell'applicazione."""
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
    """Carica la configurazione da info_config.json."""
    if not os.path.exists(CONFIG_FILE):
        log.warning("File di configurazione non trovato: %s", CONFIG_FILE)
        return {}
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        log.error("Errore nel caricamento della configurazione: %s", e)
        return {}


def main():
    _setup_logging()
    log.info("=" * 60)
    log.info("Info For All — Server")
    log.info("PID: %d | App Dir: %s | Python: %s", os.getpid(), APP_DIR, sys.version)
    log.info("=" * 60)

    config = load_config()
    server_config = config.get("server", {})
    host = server_config.get("host", "0.0.0.0")
    port = server_config.get("port", 5100)

    # Importa e avvia Flask
    from web_server import app
    log.info("Avvio server Flask su http://%s:%s", host, port)
    log.info("I client possono collegarsi a http://<IP_SERVER>:%s/?monitor=NOME_MONITOR", port)

    # Elenca i monitor configurati
    monitors = config.get("monitors", {})
    if isinstance(monitors, dict):
        log.info("Monitor configurati: %s", ", ".join(monitors.keys()) or "(nessuno)")
    log.info("-" * 60)

    try:
        app.run(host=host, port=port, debug=False, use_reloader=False, threaded=True)
    except KeyboardInterrupt:
        log.info("Interruzione da tastiera. Arresto del server.")
    except Exception as e:
        log.error("Errore fatale del server: %s", e)
    finally:
        log.info("Server terminato.")


if __name__ == '__main__':
    main()
