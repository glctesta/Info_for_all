import json
import os
import logging
from datetime import datetime, time as dtime
from flask import Flask, render_template, jsonify, Response, send_from_directory

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
    """Normalizza la voce del monitor in una stringa URL."""
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        ip = entry.get('ip')
        port = entry.get('port')
        scheme = entry.get('scheme', 'http')
        if ip and port:
            return f"{scheme}://{ip}:{port}/"
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
    return jsonify({
        "rotation": config.get("rotation", {}),
        "breaks": config.get("breaks", {}),
        "display": config.get("display", {})
    })

@app.route('/api/monitors')
def get_monitors():
    config = load_app_config()
    monitors_config = config.get("monitors", [])
    
    urls = []
    if monitors_config:
        for entry in monitors_config:
            url = _normalize_monitor_entry(entry)
            if url:
                urls.append(url)
    
    if urls:
        return jsonify(urls)
        
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
    id_cdc = breaks_config.get("id_cdc")
    id_sub_cdc = breaks_config.get("id_sub_cdc")
    
    if not shift:
        return jsonify([])
        
    db = _get_db_connection()
    if not db:
        return jsonify([])
        
    try:
        query = """
        SELECT WorkBreakId, IsForChangeShift, Shift,
               CONVERT(VARCHAR(8), FromTime, 108) as FromTimeStr,
               CONVERT(VARCHAR(8), ToTime, 108) as ToTimeStr,
               TextToshow,
               CASE WHEN Sound IS NOT NULL AND DATALENGTH(Sound) > 0 THEN 1 ELSE 0 END as has_sound
        FROM [Employee].[dbo].[WorkBreaks]
        WHERE Shift = ?
          AND (DateOut IS NULL OR DateOut >= CAST(GETDATE() AS DATE))
          AND (DateIn IS NULL OR DateIn <= CAST(GETDATE() AS DATE))
        """
        params = [shift]
        
        if id_cdc is not None:
            query += " AND IdCdc = ?"
            params.append(id_cdc)
            
        if id_sub_cdc is not None:
            query += " AND IdSubCdc = ?"
            params.append(id_sub_cdc)
            
        query += " ORDER BY FromTime"
        
        cursor = db.connection.cursor()
        cursor.execute(query, tuple(params))
        rows = cursor.fetchall()
        
        breaks = []
        for row in rows:
            breaks.append({
                "id": row[0],
                "is_for_change_shift": row[1],
                "shift": row[2],
                "from_time": row[3],
                "to_time": row[4],
                "text_to_show": row[5],
                "has_sound": bool(row[6])
            })
            
        return jsonify(breaks)
    except Exception as e:
        log.error("Errore nel recupero delle pause dal DB: %s", e)
        return jsonify([])
    finally:
        db.disconnect()

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
        # Recupera tutte le pause per il turno corrente (senza filtrare per cdc/subcdc
        # perché vogliamo mostrare TUTTI i reparti coinvolti)
        query = """
        SELECT WorkBreakId, IsForChangeShift, Shift,
               CONVERT(VARCHAR(8), FromTime, 108) as FromTimeStr,
               CONVERT(VARCHAR(8), ToTime, 108) as ToTimeStr,
               CASE WHEN TextToshow IS NOT NULL AND DATALENGTH(TextToshow) > 0 THEN 1 ELSE 0 END as has_document,
               CASE WHEN Sound IS NOT NULL AND DATALENGTH(Sound) > 0 THEN 1 ELSE 0 END as has_sound,
               IdCdc, IdSubCdc, functionId
        FROM [Employee].[dbo].[WorkBreaks]
        WHERE Shift = ?
          AND (DateOut IS NULL OR DateOut >= CAST(GETDATE() AS DATE))
          AND (DateIn IS NULL OR DateIn <= CAST(GETDATE() AS DATE))
        ORDER BY FromTime
        """
        cursor = db.connection.cursor()
        cursor.execute(query, (shift,))
        rows = cursor.fetchall()

        now = datetime.now()
        now_secs = now.hour * 3600 + now.minute * 60 + now.second

        # Raggruppa le pause per fascia oraria (FromTime/ToTime)
        slots = {}
        for row in rows:
            key = (row[3], row[4])  # (FromTimeStr, ToTimeStr)
            if key not in slots:
                slots[key] = {
                    "id": row[0],
                    "is_for_change_shift": row[1],
                    "from_time": row[3],
                    "to_time": row[4],
                    "has_document": bool(row[5]),
                    "has_sound": bool(row[6]),
                    "departments": []
                }
            slots[key]["departments"].append({
                "id_cdc": row[7],
                "id_sub_cdc": row[8],
                "function_id": row[9]
            })

        def _time_str_to_secs(t):
            p = t.split(':')
            return int(p[0]) * 3600 + int(p[1]) * 60 + int(p[2])

        # Cerca la fascia oraria attiva (include i 30s prima e 30s dopo)
        for (ft, tt), brk in slots.items():
            from_secs = _time_str_to_secs(ft)
            to_secs = _time_str_to_secs(tt)
            break_duration = to_secs - from_secs

            # Timeline fasi:
            # pre_start:      FromTime - pre_announce  →  FromTime
            # announce_start: FromTime                 →  FromTime + announce_dur
            # document:       FromTime + announce_dur  →  ToTime - pre_announce
            # pre_end:        ToTime - pre_announce    →  ToTime
            # announce_end:   ToTime                   →  ToTime + announce_dur

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
                # Pausa troppo corta per la fase document: mostra pre_end
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


@app.route('/api/breaks/<int:break_id>/document')
def get_break_document(break_id):
    """Serve il documento (TextToshow varbinary) per una pausa specifica."""
    db = _get_db_connection()
    if not db:
        return "Errore di connessione al DB", 500

    try:
        query = "SELECT TextToshow FROM [Employee].[dbo].[WorkBreaks] WHERE WorkBreakId = ?"
        cursor = db.connection.cursor()
        cursor.execute(query, (break_id,))
        row = cursor.fetchone()

        if row and row[0] and len(row[0]) > 0:
            content = row[0]
            mime_type = detect_mime_type(content)
            return Response(content, mimetype=mime_type)

        return "Documento non trovato", 404
    except Exception as e:
        log.error("Errore nel recupero del documento per la pausa %s: %s", break_id, e)
        return "Errore interno", 500
    finally:
        db.disconnect()


@app.route('/api/breaks/<int:break_id>/sound')
def get_break_sound(break_id):
    db = _get_db_connection()
    if not db:
        return "Errore di connessione al DB", 500

    try:
        query = "SELECT Sound FROM [Employee].[dbo].[WorkBreaks] WHERE WorkBreakId = ?"
        cursor = db.connection.cursor()
        cursor.execute(query, (break_id,))
        row = cursor.fetchone()

        if row and row[0]:
            content = row[0]
            if len(content) > 0:
                mime_type = detect_mime_type(content)
                return Response(content, mimetype=mime_type)

        return "Audio non trovato o non presente", 404
    except Exception as e:
        log.error("Errore nel recupero dell'audio per la pausa %s: %s", break_id, e)
        return "Errore interno", 500
    finally:
        db.disconnect()

def create_app():
    return app

def run_server(host, port):
    app.run(host=host, port=port, debug=False, use_reloader=False)

if __name__ == '__main__':
    run_server('0.0.0.0', 5100)
