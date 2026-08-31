import json
import os
import logging
from datetime import datetime, time as dtime
from flask import Flask, render_template, jsonify, Response, send_from_directory, request

log = logging.getLogger(__name__)

def _app_dir():
    import sys
    if getattr(sys, 'frozen', False):
        return os.path.dirname(os.path.abspath(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))

APP_DIR = _app_dir()
CONFIG_FILE = os.path.join(APP_DIR, 'info_config.json')

# Create Flask app with template and static folders
app = Flask(__name__,
            template_folder=os.path.join(APP_DIR, 'templates'),
            static_folder=os.path.join(APP_DIR, 'static'))

def load_app_config():
    """Carica e restituisce info_config.json come dizionario."""
    try:
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        log.error("Errore nel caricamento del file di configurazione: %s", e)
        return {}

def detect_mime_type(data: bytes) -> str:
    """Rileva il tipo MIME dai magic bytes binari."""
    if not data:
        return 'application/octet-stream'
    
    if data.startswith(b'%PDF'):
        return 'application/pdf'
    if data.startswith(b'\x89PNG'):
        return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data.startswith(b'GIF8'):
        return 'image/gif'
    if data.startswith(b'BM'):
        return 'image/bmp'
    if data.startswith(b'ID3'):
        return 'audio/mpeg'
    if data.startswith(b'\xff\xfb') or data.startswith(b'\xff\xf3'):
        return 'audio/mpeg'
    if data.startswith(b'RIFF'):
        return 'audio/wav'
        
    return 'application/octet-stream'

def _normalize_monitor_entry(entry) -> str | None:
    """Normalizza la voce del monitor in una stringa URL.
    Supporta: stringa URL, oppure dict con ip, port e opzionalmente path, scheme.
    Esempi:
        "http://192.168.10.72:8071/dashboard"
        {"ip": "192.168.10.72", "port": 8071}
        {"ip": "192.168.10.72", "port": 8071, "path": "/dashboard/view"}
    """
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        ip = entry.get('ip')
        port = entry.get('port')
        scheme = entry.get('scheme', 'http')
        path = entry.get('path', '').strip()
        if ip and port:
            # Assicura che il path inizi con /
            if path and not path.startswith('/'):
                path = '/' + path
            return f"{scheme}://{ip}:{port}{path or '/'}"
    return None

def _get_db_connection():
    """Crea e restituisce una connessione al DB usando i moduli esistenti."""
    try:
        from config_manager import ConfigManager
        from db_connection import DatabaseConnection

        config_mgr = ConfigManager()
        db_conn = DatabaseConnection(config_mgr)
        db_conn.connect()
        return db_conn
    except ImportError:
        log.error("Impossibile importare ConfigManager o DatabaseConnection")
    except Exception as e:
        log.error("Errore nella connessione al database: %s", e)
    return None

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/img/<filename>')
def serve_image(filename):
    if filename in ['Logo.png', 'gtmcLogo.jpg']:
        return send_from_directory(APP_DIR, filename)
    return "Immagine non trovata", 404

@app.route('/api/config')
def get_config():
    config = load_app_config()
    monitor_name = request.args.get('monitor', '')

    # Configurazione rotazione specifica per il monitor
    monitors = config.get("monitors", {})
    rotation = {}
    if isinstance(monitors, dict) and monitor_name and monitor_name in monitors:
        rotation = monitors[monitor_name].get("rotation", {})
    elif isinstance(monitors, dict) and monitors:
        # Fallback: primo monitor disponibile
        first = next(iter(monitors.values()))
        rotation = first.get("rotation", {})

    return jsonify({
        "rotation": rotation,
        "breaks": config.get("breaks", {}),
        "display": config.get("display", {})
    })

@app.route('/api/monitors')
def get_monitors():
    config = load_app_config()
    monitor_name = request.args.get('monitor', '')
    monitors = config.get("monitors", {})

    urls = []

    if isinstance(monitors, dict):
        # Nuova struttura: dizionario {NomeMonitor: {urls: [...]}}
        monitor_def = None
        if monitor_name and monitor_name in monitors:
            monitor_def = monitors[monitor_name]
        elif monitors:
            # Fallback: primo monitor
            monitor_def = next(iter(monitors.values()))

        if monitor_def:
            for entry in monitor_def.get("urls", []):
                url = _normalize_monitor_entry(entry)
                if url:
                    urls.append(url)
    elif isinstance(monitors, list):
        # Retrocompatibilità: vecchia struttura array
        for entry in monitors:
            url = _normalize_monitor_entry(entry)
            if url:
                urls.append(url)

    if urls:
        return jsonify(urls)

    # Fallback al DB
    db = _get_db_connection()
    if not db:
        return jsonify([])

    try:
        query = "SELECT [ExternalIP], [Port] FROM [Employee].[dbo].[ExternalIps] WHERE Dateout IS NULL AND ShowOnProductionMonitors = 1"
        cursor = db.connection.cursor()
        cursor.execute(query)
        rows = cursor.fetchall()
        for row in rows:
            ip, port = row
            if ip and port:
                urls.append(f"http://{ip}:{port}/")
    except Exception as e:
        log.error("Errore nel recupero dei monitor dal DB: %s", e)
    finally:
        db.disconnect()

    return jsonify(urls)


@app.route('/api/monitors/list')
def get_monitors_list():
    """Restituisce l'elenco dei nomi monitor configurati."""
    config = load_app_config()
    monitors = config.get("monitors", {})
    if isinstance(monitors, dict):
        return jsonify(list(monitors.keys()))
    return jsonify([])

@app.route('/api/documents')
def get_documents():
    config = load_app_config()
    doc_config = config.get("documents", {})
    
    table_name = doc_config.get("table_name")
    id_field = doc_config.get("id_field")
    title_field = doc_config.get("title_field")
    filter_clause = doc_config.get("filter", "1=1")
    order_by = doc_config.get("order_by", id_field)
    
    if not table_name or not id_field:
        return jsonify([])
        
    db = _get_db_connection()
    if not db:
        return jsonify([])
        
    documents = []
    try:
        select_fields = f"{id_field}"
        if title_field:
            select_fields += f", {title_field}"
            
        query = f"SELECT {select_fields} FROM {table_name} WHERE {filter_clause} ORDER BY {order_by}"
        cursor = db.connection.cursor()
        cursor.execute(query)
        rows = cursor.fetchall()
        
        for row in rows:
            doc_id = row[0]
            title = row[1] if title_field and len(row) > 1 else str(doc_id)
            documents.append({"id": doc_id, "title": title})
            
    except Exception as e:
        log.error("Errore nel recupero dei documenti dal DB: %s", e)
    finally:
        db.disconnect()
        
    return jsonify(documents)

@app.route('/api/documents/<int:doc_id>/content')
def get_document_content(doc_id):
    config = load_app_config()
    doc_config = config.get("documents", {})
    
    table_name = doc_config.get("table_name")
    id_field = doc_config.get("id_field")
    content_field = doc_config.get("content_field")
    
    if not table_name or not id_field or not content_field:
        return "Configurazione documenti incompleta", 500
        
    db = _get_db_connection()
    if not db:
        return "Errore di connessione al DB", 500
        
    try:
        query = f"SELECT {content_field} FROM {table_name} WHERE {id_field} = ?"
        cursor = db.connection.cursor()
        cursor.execute(query, (doc_id,))
        row = cursor.fetchone()
        
        if row and row[0]:
            content = row[0]
            mime_type = detect_mime_type(content)
            return Response(content, mimetype=mime_type)
            
        return "Contenuto non trovato", 404
    except Exception as e:
        log.error("Errore nel recupero del contenuto del documento %s: %s", doc_id, e)
        return "Errore interno", 500
    finally:
        db.disconnect()

@app.route('/api/breaks')
def get_breaks():
    config = load_app_config()
    breaks_config = config.get("breaks", {})
    shift = breaks_config.get("shift")

    if not shift:
        return jsonify([])

    db = _get_db_connection()
    if not db:
        return jsonify([])

    try:
        query = _break_query()
        cursor = db.connection.cursor()
        cursor.execute(query, (shift,))
        rows = cursor.fetchall()

        breaks = []
        for row in rows:
            breaks.append({
                "is_for_change_shift": row[1],
                "shift": row[2],
                "from_time": row[3],
                "to_time": row[4],
                "has_sound": bool(row[5]),
                "has_document": bool(row[6]),
                "reason": row[7],
                "cdc": row[8],
                "sub_cdc": row[9]
            })

        return jsonify(breaks)
    except Exception as e:
        log.error("Errore nel recupero delle pause dal DB: %s", e)
        return jsonify([])
    finally:
        db.disconnect()


def _break_query():
    """Query principale pause con JOIN per reparti e motivo."""
    return """
    SELECT DISTINCT
           wb.WorkBreakId,
           wb.IsForChangeShift,
           wb.Shift,
           CONVERT(VARCHAR(8), wb.FromTime, 108) AS FromTimeStr,
           CONVERT(VARCHAR(8), wb.ToTime, 108)   AS ToTimeStr,
           CASE WHEN wb.Sound IS NOT NULL AND DATALENGTH(wb.Sound) > 0 THEN 1 ELSE 0 END AS HasSound,
           CASE WHEN wb.TextToshow IS NOT NULL AND DATALENGTH(wb.TextToshow) > 0 THEN 1 ELSE 0 END AS HasDocument,
           ISNULL(wbr.ReasonDescription, 'Schimb de tura') AS ReasonDescription,
           c.CdcDescription,
           cs.SubCdcDescription
    FROM Employee.dbo.WorkBreaks wb
    LEFT JOIN Employee.dbo.Employeers er ON er.EmployeerId = wb.EmployeerId
    LEFT JOIN Employee.dbo.WorkBreakReasons wbr ON wbr.WorkBreakReasonId = wb.WorkBreakReasonId
    LEFT JOIN Employee.dbo.WorkBreakData wbd ON wbd.WorkBreakId = wb.WorkBreakId AND wbd.DateOut IS NULL
    LEFT JOIN Employee.dbo.CostCenters c ON wbd.CdcId = c.CdcId
    LEFT JOIN Employee.dbo.CdcSub cs ON cs.CdcId = c.CdcId
    WHERE wb.DateOut IS NULL
      AND wb.Shift = ?
    ORDER BY FromTimeStr, ToTimeStr, c.CdcDescription, cs.SubCdcDescription
    """


@app.route('/api/breaks/current')
def get_current_break():
    config = load_app_config()
    breaks_config = config.get("breaks", {})
    shift = breaks_config.get("shift")
    pre_announce = breaks_config.get("pre_announce_seconds", 30)
    announce_dur = breaks_config.get("announce_duration_seconds", 30)

    if not shift:
        return jsonify({"active": False})

    db = _get_db_connection()
    if not db:
        return jsonify({"active": False})

    try:
        query = _break_query()
        cursor = db.connection.cursor()
        cursor.execute(query, (shift,))
        rows = cursor.fetchall()

        # Debug: log colonne restituiti
        if rows:
            col_names = [desc[0] for desc in cursor.description] if cursor.description else []
            log.info("Query pause: %d righe, %d colonne: %s", len(rows), len(col_names), col_names)

        now = datetime.now()
        now_secs = now.hour * 3600 + now.minute * 60 + now.second

        # Raggruppa per fascia oraria (FromTime/ToTime)
        slots = {}
        for row in rows:
            ncols = len(row)
            if ncols < 8:
                log.warning("Riga pausa con solo %d colonne (attese 10): %s", ncols, list(row))
                continue

            from_t = row[3]
            to_t = row[4]
            key = (from_t, to_t)
            if key not in slots:
                slots[key] = {
                    "from_time": from_t,
                    "to_time": to_t,
                    "is_for_change_shift": row[1],
                    "shift": row[2],
                    "has_sound": False,
                    "has_document": False,
                    "reason": row[7] if ncols > 7 else None,
                    "departments": []
                }
            # OR tra tutte le righe dello stesso slot
            if row[5]:
                slots[key]["has_sound"] = True
            if row[6]:
                slots[key]["has_document"] = True

            # Aggiungi reparto (evita duplicati)
            cdc = row[8] if ncols > 8 else None
            sub_cdc = row[9] if ncols > 9 else None
            if cdc or sub_cdc:
                dept = {"cdc": cdc, "sub_cdc": sub_cdc}
                if dept not in slots[key]["departments"]:
                    slots[key]["departments"].append(dept)

        # Parametri cambio turno
        shift_pre_secs = breaks_config.get("shift_change_pre_seconds", 300)
        shift_music_adv = breaks_config.get("shift_change_music_advance_seconds", 15)
        shift_music_dur = breaks_config.get("shift_change_music_duration_seconds", 60)

        def _time_str_to_secs(t):
            p = t.split(':')
            h = int(p[0]) if len(p) > 0 else 0
            m = int(p[1]) if len(p) > 1 else 0
            s = int(p[2]) if len(p) > 2 else 0
            return h * 3600 + m * 60 + s

        # Cerca la fascia oraria attiva
        for (ft, tt), brk in slots.items():
            from_secs = _time_str_to_secs(ft)
            to_secs = _time_str_to_secs(tt)

            if brk["is_for_change_shift"] == 1:
                # ── CAMBIO TURNO: usa solo FromTime ──
                p_start = from_secs - shift_pre_secs
                p_announce_end = from_secs + (shift_music_dur - shift_music_adv)

                phase = None
                countdown = 0

                if p_start <= now_secs < from_secs:
                    phase = "shift_pre"
                    countdown = from_secs - now_secs
                elif from_secs <= now_secs < p_announce_end:
                    phase = "shift_announce"
                    countdown = p_announce_end - now_secs

                if phase:
                    return jsonify({
                        "active": True,
                        "phase": phase,
                        "countdown": countdown,
                        "break": brk,
                        "shift_music_advance": shift_music_adv,
                        "shift_music_duration": shift_music_dur
                    })
            else:
                # ── PAUSA NORMALE: 5 fasi ──
                break_duration = to_secs - from_secs

                p1_start = from_secs - pre_announce
                p2_start = from_secs
                p3_start = from_secs + announce_dur
                p4_start = to_secs - pre_announce
                p5_start = to_secs
                p5_end   = to_secs + announce_dur

                phase = None
                countdown = 0

                if p1_start <= now_secs < p2_start:
                    phase = "pre_start"
                    countdown = p2_start - now_secs
                elif p2_start <= now_secs < p3_start:
                    phase = "announce_start"
                    countdown = p3_start - now_secs
                elif break_duration > (pre_announce + announce_dur) and p3_start <= now_secs < p4_start:
                    phase = "document"
                    countdown = p4_start - now_secs
                elif p4_start <= now_secs < p5_start and break_duration > (pre_announce + announce_dur):
                    phase = "pre_end"
                    countdown = p5_start - now_secs
                elif (p3_start <= now_secs < p5_start) and break_duration <= (pre_announce + announce_dur):
                    phase = "pre_end"
                    countdown = p5_start - now_secs
                elif p5_start <= now_secs < p5_end:
                    phase = "announce_end"
                    countdown = p5_end - now_secs

                if phase:
                    return jsonify({
                        "active": True,
                        "phase": phase,
                        "countdown": countdown,
                        "break": brk
                    })

        return jsonify({"active": False})
    except Exception as e:
        log.error("Errore nel controllo della pausa corrente: %s", e)
        return jsonify({"active": False})
    finally:
        db.disconnect()


@app.route('/api/breaks/document')
def get_break_document():
    """Serve il documento (TextToshow varbinary) filtrato per FromTime/ToTime/Shift."""
    from_time = request.args.get('from')
    to_time = request.args.get('to')
    shift_param = request.args.get('shift')

    if not from_time or not to_time or not shift_param:
        return "Parametri mancanti (from, to, shift)", 400

    db = _get_db_connection()
    if not db:
        return "Errore di connessione al DB", 500

    try:
        query = """
        SELECT TOP 1 TextToshow
        FROM Employee.dbo.WorkBreaks
        WHERE CONVERT(VARCHAR(8), FromTime, 108) = ?
          AND CONVERT(VARCHAR(8), ToTime, 108) = ?
          AND Shift = ?
          AND DateOut IS NULL
          AND TextToshow IS NOT NULL
          AND DATALENGTH(TextToshow) > 0
        """
        cursor = db.connection.cursor()
        cursor.execute(query, (from_time, to_time, int(shift_param)))
        row = cursor.fetchone()

        if row and row[0]:
            content = row[0]
            mime_type = detect_mime_type(content)
            return Response(content, mimetype=mime_type)

        return "Documento non trovato", 404
    except Exception as e:
        log.error("Errore nel recupero del documento: %s", e)
        return "Errore interno", 500
    finally:
        db.disconnect()


@app.route('/api/breaks/sound')
def get_break_sound():
    """Serve il file audio (Sound varbinary) filtrato per FromTime/ToTime/Shift."""
    from_time = request.args.get('from')
    to_time = request.args.get('to')
    shift_param = request.args.get('shift')

    if not from_time or not to_time or not shift_param:
        return "Parametri mancanti (from, to, shift)", 400

    db = _get_db_connection()
    if not db:
        return "Errore di connessione al DB", 500

    try:
        query = """
        SELECT TOP 1 Sound
        FROM Employee.dbo.WorkBreaks
        WHERE CONVERT(VARCHAR(8), FromTime, 108) = ?
          AND CONVERT(VARCHAR(8), ToTime, 108) = ?
          AND Shift = ?
          AND DateOut IS NULL
          AND Sound IS NOT NULL
          AND DATALENGTH(Sound) > 0
        """
        cursor = db.connection.cursor()
        cursor.execute(query, (from_time, to_time, int(shift_param)))
        row = cursor.fetchone()

        if row and row[0]:
            content = row[0]
            mime_type = detect_mime_type(content)
            return Response(content, mimetype=mime_type)

        return "Audio non trovato", 404
    except Exception as e:
        log.error("Errore nel recupero dell'audio: %s", e)
        return "Errore interno", 500
    finally:
        db.disconnect()

# ===================================================================
#  Endpoint per aggiornamento client EXE
# ===================================================================

@app.route('/api/client/version')
def get_client_version():
    """Restituisce la versione corrente del client configurata sul server."""
    config = load_app_config()
    return jsonify({
        "version": config.get("client_version", "1.0.0")
    })


@app.route('/api/client/download')
def download_client():
    """Serve l'EXE del client dalla cartella client_dist/."""
    dist_dir = os.path.join(APP_DIR, 'client_dist')
    exe_name = 'InfoForAll_Client.exe'
    exe_path = os.path.join(dist_dir, exe_name)

    if os.path.exists(exe_path):
        return send_from_directory(dist_dir, exe_name, as_attachment=True)

    return "Client EXE non trovato. Eseguire build_client.py per generarlo.", 404


def create_app():
    return app


def run_server(host, port):
    app.run(host=host, port=port, debug=False, use_reloader=False, threaded=True)


if __name__ == '__main__':
    run_server('0.0.0.0', 5100)
