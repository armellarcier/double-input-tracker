"""Test de fumée de bout en bout, sans connexion Google.

Sert le site en local, crée un clavier, note des incidents, inverse deux switchs
et vérifie le rendu (mobile puis bureau). Les captures vont dans tests/out/.

    pip install playwright && python3 -m playwright install chromium
    python3 tests/smoke_test.py
"""
import pathlib
import subprocess
import sys
import time

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'tests' / 'out'
PORT = 8765


def run(page, name, size):
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    # Pas d'accès réseau à Google pendant les tests.
    page.route('https://accounts.google.com/**', lambda r: r.abort())
    page.goto(f'http://localhost:{PORT}/')

    page.click('text=Créer un clavier')
    page.fill('input[name=name]', 'Test')
    page.select_option('select[name=size]', size)
    page.click('#newKb button[value=ok]')

    def incident(key, kind):
        page.click(f'.key[data-key={key}]')
        page.click(f'[data-act=incident][data-v={kind}]')

    incident('KeyQ', 'double')
    incident('KeyQ', 'double')
    incident('Space', 'skip')

    # Inversion Q <-> E, puis un double input sur E doit être attribué au switch d'origine de Q.
    page.click('.key[data-key=KeyQ]')
    page.click('[data-act=swap]')
    page.click('.key[data-key=KeyE]')
    incident('KeyE', 'double')

    page.wait_for_timeout(200)
    assert '3' in page.inner_text('.stats .stat:first-child'), 'total des doubles inputs'
    assert 'suit le switch' in page.inner_text('#content'), "l'analyse doit détecter que le problème suit le switch"

    page.click('[data-act=kind][data-v=skip]')
    page.wait_for_timeout(200)
    assert '1' in page.inner_text('.stats .stat:first-child'), 'total des appuis manqués'

    page.screenshot(path=str(OUT / f'{name}.png'), full_page=True)
    assert not errors, errors
    print(f'{name}: ok')


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(PORT), '-d', str(ROOT)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    time.sleep(1)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            run(browser.new_page(viewport={'width': 390, 'height': 844}), 'mobile', '65')
            run(browser.new_page(viewport={'width': 1280, 'height': 900}), 'desktop', 'full')
            browser.close()
    finally:
        server.kill()


if __name__ == '__main__':
    main()
