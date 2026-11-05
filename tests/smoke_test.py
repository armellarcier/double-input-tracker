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

    # Nettoyage du switch de E (switch d'origine de Q) et événement libre : repères et comparaison avant/après.
    page.click('.key[data-key=KeyE]')
    page.click('[data-act=clean]')
    page.once('dialog', lambda d: d.accept('Firmware : debounce 8 ms'))
    page.click('[data-act=note]')
    page.wait_for_timeout(200)
    assert page.locator('#content .chart .mark').count() == 2, 'repères nettoyage + événement'
    assert 'Firmware' in page.inner_text('.compare'), 'comparaison avant/après'
    assert page.locator('#content .chart path.k-double').count() == 1, 'courbe des doubles inputs'
    assert page.locator('#content .chart path.k-skip').count() == 1, 'courbe des appuis manqués'
    page.click('.key[data-key=KeyE]')
    assert page.locator('#sheet .chart .mark').count() == 2, 'repères du switch : inversion + nettoyage'
    page.screenshot(path=str(OUT / f'{name}-sheet.png'))
    page.click('[data-act=close-sheet]')

    # Test de frappe ciblé sur E : un caractère doublé et un caractère sauté doivent être proposés.
    page.click('.key[data-key=KeyE]')
    page.click('#sheet [data-act=test]')
    text = page.inner_text('#ttText')
    assert text.count('e') >= 40, 'le texte doit contenir souvent la touche ciblée'
    page.focus('#ttInput')
    page.keyboard.type(text[:20])
    page.keyboard.press('Backspace')
    assert page.input_value('#ttInput') == text[:20], 'la correction doit être bloquée'
    page.keyboard.type(text[19] + text[20:40] + text[41:])
    page.wait_for_selector('.tt-sugg', timeout=3000)
    sugg = page.inner_text('.tt-sugg')
    assert 'Double input' in sugg and 'Appui manqué' in sugg, sugg
    page.screenshot(path=str(OUT / f'{name}-test.png'))
    page.click('[data-act=test-save]')
    page.wait_for_timeout(200)
    assert 'Test de frappe' in page.inner_text('.events'), "le test doit apparaître dans l'historique"

    # Test d'appuis sur Shift gauche (pas de caractère) : alterne avec Espace, détection par code de touche.
    page.click('.key[data-key=ShiftLeft]')
    page.click('#sheet [data-act=test]')
    seq = page.locator('#ttText kbd').all_inner_texts()
    codes = {'Shift gauche': 'ShiftLeft', 'Espace': 'Space'}
    assert seq.count('Shift gauche') == 40 and set(seq) == set(codes), seq[:6]
    assert all(a != b for a, b in zip(seq, seq[1:])), 'jamais deux fois la même touche de suite'
    for i, n in enumerate(seq):
        if i == 30:
            continue  # appui manqué
        page.wait_for_timeout(100)  # rythme humain : seul un appui répété très vite est un double input
        page.keyboard.press(codes[n])
        if i == 10:
            page.keyboard.press(codes[n])  # double input
    page.wait_for_selector('.tt-sugg', timeout=3000)
    sugg = page.inner_text('.tt-sugg')
    assert 'Double input sur Shift gauche' in sugg and 'Appui manqué sur Shift gauche' in sugg, sugg
    assert page.locator('.tt-sugg input:checked').count() == 2, 'les deux incidents sont cochés'
    page.screenshot(path=str(OUT / f'{name}-test-keys.png'))
    page.click('[data-act=test-save]')
    page.wait_for_timeout(200)
    assert 'appuis' in page.inner_text('.events'), "le test d'appuis doit apparaître dans l'historique"

    # F5 et Échap sont interceptés pendant le test d'appuis.
    if page.locator('.key[data-key=F5]').count():
        page.click('.key[data-key=F5]')
        page.click('#sheet [data-act=test]')
        page.keyboard.press('F5')
        page.keyboard.press('Escape')
        page.wait_for_timeout(300)
        assert page.locator('#testDlg[open]').count() == 1, 'F5 / Échap ne doivent ni recharger ni fermer'
        assert page.inner_text('#ttLive').startswith('2 /'), 'F5 puis Échap comptés comme appuis'
        page.screenshot(path=str(OUT / f'{name}-test-f5.png'))
        page.click('[data-act=close-test]')

    page.click('[data-act=kind][data-v=skip]')
    page.wait_for_timeout(200)
    assert '3' in page.inner_text('.stats .stat:first-child'), 'total des appuis manqués (dont ceux des deux tests)'

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
