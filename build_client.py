"""
Script per compilare il client in un EXE con PyInstaller.
Uso:  python build_client.py
"""
import os
import shutil
import subprocess
import sys


def main():
    app_dir = os.path.dirname(os.path.abspath(__file__))
    client_script = os.path.join(app_dir, 'info_client.py')
    dist_dir = os.path.join(app_dir, 'client_dist')
    build_dir = os.path.join(app_dir, 'build')
    spec_file = os.path.join(app_dir, 'InfoForAll_Client.spec')
    exe_name = 'InfoForAll_Client'

    print("=" * 50)
    print("Build Info For All Client EXE")
    print("=" * 50)

    # Verifica PyInstaller
    try:
        import PyInstaller
        print(f"PyInstaller versione: {PyInstaller.__version__}")
    except ImportError:
        print("ERRORE: PyInstaller non trovato. Installalo con:")
        print("  pip install pyinstaller")
        sys.exit(1)

    # Build con PyInstaller usando il file .spec
    spec_file = os.path.join(app_dir, 'InfoForAll_Client.spec')

    if not os.path.exists(spec_file):
        print(f"ERRORE: File spec non trovato: {spec_file}")
        sys.exit(1)

    cmd = [
        sys.executable, '-m', 'PyInstaller',
        '--distpath', dist_dir,
        '--workpath', build_dir,
        '--clean',
        spec_file
    ]

    print(f"\nComando: {' '.join(cmd)}")
    print("-" * 50)

    result = subprocess.run(cmd, cwd=app_dir)

    if result.returncode != 0:
        print(f"\nERRORE: Build fallita con codice {result.returncode}")
        sys.exit(1)

    # Copia il template della config client nella cartella dist
    config_template = os.path.join(app_dir, 'client_config.json')
    if os.path.exists(config_template):
        shutil.copy2(config_template, os.path.join(dist_dir, 'client_config.json'))
        print(f"\nCopiato client_config.json in {dist_dir}")

    exe_path = os.path.join(dist_dir, f'{exe_name}.exe')
    if os.path.exists(exe_path):
        size_mb = os.path.getsize(exe_path) / (1024 * 1024)
        print(f"\n{'=' * 50}")
        print(f"BUILD COMPLETATA!")
        print(f"EXE: {exe_path}")
        print(f"Dimensione: {size_mb:.1f} MB")
        print(f"{'=' * 50}")
        print(f"\nPer distribuire il client:")
        print(f"  1. Copia '{dist_dir}' sul PC client")
        print(f"  2. Modifica 'client_config.json' con server_url e monitor_name corretti")
        print(f"  3. Avvia '{exe_name}.exe'")
    else:
        print("\nERRORE: EXE non trovato dopo la build.")

    # Pulizia (solo cartella build, non lo spec)
    if os.path.exists(build_dir):
        shutil.rmtree(build_dir, ignore_errors=True)


if __name__ == '__main__':
    main()
