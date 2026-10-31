"""Recette de bout en bout de la PWA dans Chrome, contre l'API réelle sur une base jetable.

Prérequis hors du projet : `pip install playwright` et Google Chrome installé.
Lancement depuis la racine du dépôt : `python tests/frontend/e2e_pwa.py`.
Le GPS est simulé par Chrome : ces essais ne remplacent pas un téléphone réel.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import Browser, Page, expect, sync_playwright

ROOT = Path(__file__).resolve().parents[2]
PORT = 8011
BASE = f"http://127.0.0.1:{PORT}"
NEAR = {"latitude": -11.6642, "longitude": 27.4794, "accuracy": 20}
PNG = (ROOT / "frontend" / "icons" / "icon-192.png").read_bytes()
AXE_URL = "https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js"
WIDTHS = [320, 360, 390, 430, 768, 1280]
ROUTES = ["#/", "#/carte", "#/liste", "#/signaler", "#/attente", "#/signalement/2"]

results: list[tuple[bool, str]] = []


def created(response) -> bool:
    return response.url.endswith("/api/reports") and response.request.method == "POST"


def check(name: str, condition: bool, detail: object = "") -> None:
    results.append((bool(condition), name))
    print(f"{'OK  ' if condition else 'ÉCHEC'} {name}{f' → {detail}' if detail and not condition else ''}")


def scenario(name: str):
    def wrap(function):
        def run(*args):
            print(f"\n— {name}")
            try:
                function(*args)
            except Exception as error:  # Un scénario cassé ne doit pas masquer les suivants.
                check(f"{name} : déroulé complet", False, repr(error)[:400])
        return run
    return wrap


def api(path: str):
    with urllib.request.urlopen(f"{BASE}{path}") as response:
        return json.load(response)


def refuse_posts(status: int, body: dict):
    def handler(route):
        if route.request.method == "POST":
            route.fulfill(status=status, json=body)
        else:
            route.continue_()
    return handler


@contextmanager
def app(browser: Browser, *, geolocation: bool = True, width: int = 390, height: int = 844, base: str = BASE):
    options = {"viewport": {"width": width, "height": height}, "locale": "fr-FR", "service_workers": "allow"}
    if geolocation:
        options |= {"geolocation": NEAR, "permissions": ["geolocation"]}
    context = browser.new_context(**options)
    page = context.new_page()
    page.errors = []
    page.on("pageerror", lambda error: page.errors.append(str(error)))
    page.goto(f"{base}/")
    try:
        yield page
    finally:
        context.close()


def wait_for_worker(page: Page) -> None:
    page.evaluate("navigator.serviceWorker.ready.then(() => true)")
    page.wait_for_function("navigator.serviceWorker.controller !== null")


def queue_size(page: Page) -> int:
    return page.evaluate(
        """() => new Promise((resolve, reject) => {
            const open = indexedDB.open('snart-offline-queue', 1);
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
              const all = open.result.transaction('reports').objectStore('reports').getAll();
              all.onsuccess = () => { open.result.close(); resolve(all.result.length); };
            };
        })"""
    )


def fill_report(page: Page, text: str) -> None:
    page.goto(f"{BASE}/#/signaler")
    page.fill("#description", text)


@scenario("Accueil et données réelles")
def test_home(browser: Browser) -> None:
    with app(browser) as page:
        expect(page.locator("#homeLive .home-total")).to_be_visible()
        total = len(api("/api/reports"))
        check("le compteur vient de l’API", str(total) in page.inner_text("#homeLive .home-total"))
        check("la promesse est affichée", "Tu signales" in page.inner_text("h1:visible"))
        page.click("text=Signaler un problème")
        check("le bouton principal ouvre le formulaire", page.locator("#reportForm").is_visible())
        page.goto(f"{BASE}/#/nimporte-quoi")
        expect(page.get_by_role("heading", name="Page introuvable")).to_be_visible()
        check("une route inconnue a sa page", True)
        check("aucune erreur JavaScript", not page.errors, page.errors)


@scenario("Liste et filtres")
def test_filters(browser: Browser) -> None:
    with app(browser) as page:
        seen: list[str] = []
        page.on("request", lambda request: seen.append(request.url) if "/api/reports?" in request.url else None)
        page.goto(f"{BASE}/#/liste")
        expect(page.locator("#listResults .report-card").first).to_be_visible()
        total = page.locator("#listResults .report-card").count()
        page.click("#listFilters [data-filter='embouteillage']")
        expect(page.locator("#listCount")).to_contain_text("2 signalements")
        check("le filtre passe par l’API", any("category=embouteillage" in url for url in seen), seen)
        cards = page.locator("#listResults .category-tag").all_inner_texts()
        check("seule la catégorie filtrée reste", cards and all("Embouteillage" in card for card in cards), cards)
        check("aria-pressed suit le filtre", page.get_attribute("#listFilters [data-filter='embouteillage']", "aria-pressed") == "true")
        page.click("#listFilters [data-filter='indetermine']")
        expect(page.locator("#listResults .report-card")).to_have_count(1)
        page.click("#listFilters [data-filter='all']")
        expect(page.locator("#listResults .report-card")).to_have_count(total)
        check("« Toutes » n’envoie aucun code invalide", all("category=all" not in url for url in seen), seen)

        page.route("**/api/reports?category=dechets", lambda route: (time.sleep(.5), route.continue_())[1])
        page.click("#listFilters [data-filter='dechets']")
        page.click("#listFilters [data-filter='caniveau_bouche']")
        expect(page.locator("#listCount")).to_contain_text("1 signalement")
        page.wait_for_timeout(800)
        tags = page.locator("#listResults .category-tag").all_inner_texts()
        check("une réponse lente n’écrase pas le filtre récent", tags and all("Caniveau" in tag for tag in tags), tags)

        page.goto(f"{BASE}/#/carte")
        expect(page.locator("#map .marker-dot").first).to_be_visible(timeout=20000)
        check("le filtre s’applique aussi à la carte", page.locator("#map .marker-dot").count() == 1)


@scenario("Création complète avec GPS et photo")
def test_create(browser: Browser) -> None:
    with app(browser) as page:
        fill_report(page, "Un gros tas de dechets bloque le trottoir")
        page.click("#locateButton")
        expect(page.locator("#locationLabel")).to_contain_text("Position obtenue")
        page.set_input_files("#photoFile", {"name": "tas.png", "mimeType": "image/png", "buffer": PNG})
        expect(page.locator("#photoPreview img")).to_be_visible()
        with page.expect_response(created) as reply:
            page.click("#submitButton")
        report = reply.value.json()
        check("création acceptée par l’API", reply.value.status == 201, reply.value.status)
        expect(page.get_by_role("heading", name="Signalement publié")).to_be_visible()
        check("le résultat vient du serveur", report["summary"] in page.inner_text("#reportResult"))
        check("l’heure et la précision sont transmises", report["location_accuracy_m"] == 20, report)
        check("la catégorie automatique est appliquée", report["category"] == "dechets", report["category"])
        page.click("text=Voir la fiche")
        expect(page.locator(".detail-title")).to_be_visible()
        page.click("text=Afficher la photo")
        expect(page.locator(".detail-photo img")).to_be_visible()
        check("la photo se charge depuis l’API", page.evaluate("document.querySelector('.detail-photo img').naturalWidth") > 0)
        check("aucune URL de fichier local", f"/api/reports/{report['id']}/photo" in page.get_attribute(".detail-photo img", "src"))
        check("le mode règles ne prétend pas à l’IA", "sans modèle d’IA" in page.inner_text("#detailContent"))
        check("aucune erreur JavaScript", not page.errors, page.errors)
        page.goto(f"{BASE}/#/liste")
        page.goto(f"{BASE}/#/signaler")
        check("revenir sur Signaler rouvre le formulaire", page.locator("#reportForm").is_visible())


@scenario("Validation et messages d’erreur")
def test_validation(browser: Browser) -> None:
    with app(browser) as page:
        posted: list[str] = []
        page.on("request", lambda request: posted.append(request.url) if request.method == "POST" else None)
        fill_report(page, "court")
        page.click("#submitButton")
        expect(page.locator("#descriptionError")).to_be_visible()
        check("description trop courte bloquée sans appel réseau", not posted, posted)
        check("le champ reçoit le focus et aria-invalid", page.evaluate("document.activeElement.id") == "description"
              and page.get_attribute("#description", "aria-invalid") == "true")
        page.fill("#description", "Une description assez longue pour passer")
        page.click("details summary")
        page.fill("#observedAt", "2099-01-01T10:00")
        page.click("#submitButton")
        expect(page.locator("#observed_atError")).to_be_visible()
        check("heure dans le futur refusée", not posted, posted)
        page.fill("#observedAt", "")

        for status, body, expected in [
            (422, {"detail": [{"msg": "String should have"}]}, "Certaines informations"),
            (413, {"detail": "trop"}, "trop volumineuse"),
            (415, {"detail": "non"}, "format d’image"),
        ]:
            page.route("**/api/reports", refuse_posts(status, body))
            page.click("#submitButton")
            expect(page.locator("#formMessage")).to_contain_text(expected)
            text = page.inner_text("#formMessage")
            check(f"erreur {status} expliquée", "object Object" not in text, text)
            check(f"erreur {status} : formulaire conservé", page.input_value("#description") != "")
            page.unroute("**/api/reports")


@scenario("Photos refusées avant envoi")
def test_photo_rules(browser: Browser) -> None:
    with app(browser) as page:
        page.goto(f"{BASE}/#/signaler")
        page.set_input_files("#photoFile", {"name": "lourde.png", "mimeType": "image/png", "buffer": b"0" * (8 * 1024 * 1024 + 1)})
        expect(page.locator("#photoError")).to_contain_text("8 Mo")
        check("une image de plus de 8 Mo est écartée", page.locator("#photoPreview").is_hidden())
        page.set_input_files("#photoFile", {"name": "photo.heic", "mimeType": "image/heic", "buffer": PNG})
        expect(page.locator("#photoError")).to_contain_text("format")
        check("le message propose d’envoyer sans photo", "sans photo" in page.inner_text("#photoError"))
        page.set_input_files("#photoFile", {"name": "ok.png", "mimeType": "image/png", "buffer": PNG})
        expect(page.locator("#photoPreview img")).to_be_visible()
        check("une erreur précédente disparaît", page.locator("#photoError").is_hidden())
        page.click("text=Retirer la photo")
        check("la photo se retire", page.locator("#photoPreview").is_hidden() and page.input_value("#photoFile") == "")
        check("galerie et appareil photo sont deux choix distincts",
              page.get_attribute("#photoFile", "capture") is None and page.get_attribute("#photoCamera", "capture") == "environment")


@scenario("GPS refusé, épingle manuelle")
def test_pin(browser: Browser) -> None:
    with app(browser, geolocation=False) as page:
        fill_report(page, "Le caniveau deborde devant la pharmacie")
        page.click("#locateButton")
        expect(page.locator("#locationError")).to_contain_text("refusé")
        check("le refus propose la solution manuelle", "épingle" in page.inner_text("#locationError"))
        page.click("#pickerButton")
        expect(page.locator("#pickerMap .leaflet-tile-pane")).to_be_attached(timeout=20000)
        page.click("#pickerCenter")
        expect(page.locator("#locationLabel")).to_contain_text("Épingle placée")
        label_a = page.inner_text("#locationLabel")
        box = page.locator("#pickerMap").bounding_box()
        page.mouse.click(box["x"] + box["width"] * .7, box["y"] + box["height"] * .3)
        expect(page.locator("#pickerMap .marker-pin")).to_be_visible()
        page.wait_for_function("t => document.querySelector('#locationLabel').textContent !== t", arg=label_a)
        shown = re.findall(r"-?\d+\.\d+", page.inner_text("#locationLabel"))
        with page.expect_request(lambda request: request.url.endswith("/api/reports") and request.method == "POST") as sent, \
                page.expect_response(created) as reply:
            page.click("#submitButton")
        body = sent.value.post_data_buffer.decode("utf8", "replace")
        report = reply.value.json()
        check("la position envoyée est celle affichée", f"{report['latitude']:.5f}" == shown[0] and f"{report['longitude']:.5f}" == shown[1], (shown, report))
        check("aucune précision inventée pour l’épingle", "location_accuracy_m" not in body and report["location_accuracy_m"] is None)
        check("la catégorie du texte est respectée", report["category"] == "caniveau_bouche", report["category"])

        page.click("text=Faire un autre signalement")
        page.fill("#description", "Un signalement sans position du tout")
        with page.expect_response(created) as reply:
            page.click("#submitButton")
        check("l’envoi sans position fonctionne", reply.value.status == 201 and reply.value.json()["latitude"] is None)


@scenario("Votes : confirmation, résolution, auteur")
def test_votes(browser: Browser) -> None:
    target = next(item for item in api("/api/reports") if "marché" in item["description"])
    before = target["confidence_factors"]
    with app(browser) as page:
        page.goto(f"{BASE}/#/signalement/{target['id']}")
        with page.expect_request("**/confirm") as sent:
            page.click("text=Toujours présent")
        payload = sent.value.post_data_json
        check("le vote respecte le contrat", payload["vote"] == "still_present" and "accuracy_m" in payload and "source" not in payload, payload)
        expect(page.locator(".vote-block .form-message")).to_contain_text("enregistrée")
        check("aucune mention de présence vérifiée", "vérifié" not in page.inner_text("#detailContent").replace("à vérifier", ""))
        after = api(f"/api/reports/{target['id']}")["confidence_factors"]
        check("une confirmation proche est comptée par le serveur", after["nearby_confirmations"] == before["nearby_confirmations"] + 1, after)
        shown = page.inner_text(".index-score strong")
        check("l’indice affiché est celui du serveur", int(shown) == api(f"/api/reports/{target['id']}")["confidence_percent"])

        page.click("text=Proposer la résolution")
        expect(page.locator(".vote-block .form-message")).to_contain_text("résolution est enregistrée")
        check("un seul clic ne résout pas le signalement", api(f"/api/reports/{target['id']}")["status"] != "resolved")
        check("le vote précédent est mis à jour, pas doublé",
              api(f"/api/reports/{target['id']}")["confidence_factors"]["nearby_confirmations"] == before["nearby_confirmations"])

        fill_report(page, "Un tas de dechets que je viens de signaler")
        with page.expect_response(created) as reply:
            page.click("#submitButton")
        own = reply.value.json()["id"]
        page.goto(f"{BASE}/#/signalement/{own}")
        page.click("text=Toujours présent")
        expect(page.locator(".vote-block .form-message")).to_contain_text("une autre personne")
        check("l’auteur ne peut pas confirmer : erreur expliquée", True)

    with app(browser, geolocation=False) as page:
        before = api(f"/api/reports/{target['id']}")["confidence_factors"]
        page.goto(f"{BASE}/#/signalement/{target['id']}")
        page.click("text=Toujours présent")
        expect(page.locator(".vote-block .form-message")).to_contain_text("refusé")
        with page.expect_request("**/confirm") as sent:
            page.click("text=Envoyer sans position")
        check("sans GPS, aucune coordonnée n’est envoyée", "latitude" not in sent.value.post_data_json, sent.value.post_data_json)
        expect(page.locator(".vote-block .form-message")).to_contain_text("à distance")
        after = api(f"/api/reports/{target['id']}")["confidence_factors"]
        check("le vote sans GPS compte à distance", after["remote_confirmations"] == before["remote_confirmations"] + 1, after)


@scenario("États d’une fiche")
def test_detail_states(browser: Browser) -> None:
    reports = api("/api/reports")
    stale = next(item for item in reports if item["status"] == "stale")
    resolved = next(item for item in reports if item["status"] == "resolved")
    review = next(item for item in reports if item["needs_review"] and item["description"].startswith("[DÉMO]"))
    with app(browser) as page:
        page.goto(f"{BASE}/#/signalement/{stale['id']}")
        expect(page.locator("#detailContent .status-pill.is-stale")).to_contain_text("À actualiser")
        check("un signalement ancien reste consultable avec son avertissement", "ancienne" in page.inner_text("#detailContent"))
        check("il garde l’action de confirmation", page.locator("text=Toujours présent").is_visible())
        page.goto(f"{BASE}/#/signalement/{resolved['id']}")
        expect(page.locator("#detailContent .status-pill.is-resolved")).to_contain_text("Résolu")
        check("une résolution n’est pas présentée comme officielle", "pas une confirmation officielle" in page.inner_text("#detailContent"))
        page.goto(f"{BASE}/#/signalement/{review['id']}")
        expect(page.locator("#detailContent")).to_contain_text("Catégorie à vérifier")
        check("sans coordonnées : position annoncée absente", "sans position" in page.inner_text("#detailContent"))
        check("sans photo : pas de bouton photo", page.locator("text=Afficher la photo").count() == 0)
        check("donnée de démonstration signalée", "Donnée de démonstration" in page.inner_text("#detailContent"))
        page.goto(f"{BASE}/#/signalement/999999")
        expect(page.locator("#detailContent")).to_contain_text("introuvable")
        check("un identifiant inexistant affiche un message", True)
        page.route("**/api/reports/1", lambda route: route.fulfill(status=500, json={"detail": "sqlite3 traceback"}))
        page.goto(f"{BASE}/#/signalement/1")
        expect(page.locator("#detailContent [role=alert]")).to_contain_text("problème")
        check("une erreur 500 ne montre pas le détail interne", "sqlite3" not in page.inner_text("#detailContent"))


@scenario("Texte hostile rendu comme texte")
def test_xss(browser: Browser) -> None:
    hostile = '<img src=x onerror="window.piege=1"><script>window.piege=1</script> déchets'
    with app(browser) as page:
        fill_report(page, hostile)
        page.click("#locateButton")
        expect(page.locator("#locationLabel")).to_contain_text("Position obtenue")
        with page.expect_response(created) as reply:
            page.click("#submitButton")
        report = reply.value.json()
        for route in ("#/liste", f"#/signalement/{report['id']}", f"#/carte/{report['id']}"):
            page.goto(f"{BASE}/{route}")
            page.wait_for_timeout(600)
        expect(page.locator("#map .map-popup").first).to_be_visible(timeout=20000)
        check("aucun script ni image injectés", page.evaluate("window.piege") is None
              and page.locator("#map .map-popup img, #listResults img").count() == 0)


@scenario("Hors ligne : shell, file, Blob, synchronisation")
def test_offline(browser: Browser) -> None:
    with app(browser) as page:
        wait_for_worker(page)
        context = page.context
        keys = page.evaluate("caches.keys()")
        check("un seul cache, versionné", len(keys) == 1 and keys[0].startswith("snart-shell-"), keys)
        cached = page.evaluate("caches.open(navigator.serviceWorker && %r).then(c => c.keys()).then(r => r.map(x => x.url))" % keys[0])
        check("le cache ne contient ni API ni photo", cached and not any("/api/" in url for url in cached))

        count_before = len(api("/api/reports?limit=500"))
        context.set_offline(True)
        page.reload()
        expect(page.locator("#networkState")).to_have_text("Hors ligne")
        check("l’interface s’ouvre hors ligne", page.locator("h1:visible").is_visible())
        expect(page.locator("#homeLive [role=alert]")).to_be_visible()
        check("l’absence de données propose un réessai", page.locator("#homeLive button").is_visible())

        page.goto(f"{BASE}/#/carte")
        expect(page.locator("#mapFallback")).to_be_visible(timeout=20000)
        check("sans Leaflet, un message remplace la carte", page.locator("#map").is_hidden())

        page.goto(f"{BASE}/#/signaler")
        expect(page.locator("#formOfflineHint")).to_be_visible()
        page.fill("#description", "Embouteillage garde hors ligne avec une photo")
        page.check("input[value='embouteillage']", force=True)
        page.set_input_files("#photoFile", {"name": "hors-ligne.png", "mimeType": "image/png", "buffer": PNG})
        page.click("#submitButton")
        expect(page.locator("#queueBannerText")).to_contain_text("pas encore publié")
        expect(page.locator(".pending-state").first).to_contain_text("pas encore publié")
        check("rien n’est présenté comme publié", "publié" in page.inner_text(".pending-state") and "Signalement publié" not in page.inner_text("main"))
        check("avertissement embouteillage visible", "reconfirmé" in page.inner_text("#pendingContent"))
        check("le serveur n’a rien reçu", len(api("/api/reports?limit=500")) == count_before)

        page.reload()
        expect(page.locator(".pending-card")).to_have_count(1)
        check("la file survit au rechargement, photo comprise", "photo jointe" in page.inner_text(".pending-card"))
        blob = page.evaluate(
            """() => new Promise((resolve) => {
                const open = indexedDB.open('snart-offline-queue', 1);
                open.onsuccess = () => {
                  const all = open.result.transaction('reports').objectStore('reports').getAll();
                  all.onsuccess = () => { open.result.close(); resolve([all.result[0].photo instanceof Blob, all.result[0].photo.size]); };
                };
            })"""
        )
        check("le Blob de la photo est conservé", blob == [True, len(PNG)], blob)

        with page.expect_response(created) as reply:
            context.set_offline(False)
        check("la synchronisation part au retour du réseau", reply.value.status == 201, reply.value.status)
        report = reply.value.json()
        check("la photo arrive au serveur", report["has_photo"] is True, report)
        expect(page.locator("#queueBanner")).to_be_hidden()
        check("l’élément quitte la file après succès", queue_size(page) == 0)
        page.wait_for_timeout(500)
        check("aucun doublon envoyé", len(api("/api/reports?limit=500")) == count_before + 1)


@scenario("File : pannes serveur et refus")
def test_queue_failures(browser: Browser) -> None:
    with app(browser) as page:
        wait_for_worker(page)
        page.route("**/api/reports", refuse_posts(503, {"detail": "panne"}))
        fill_report(page, "Signalement envoye pendant une panne serveur")
        page.click("#submitButton")
        expect(page.locator("#queueBannerText")).to_contain_text("pas encore publié")
        check("un 503 garde le signalement au lieu de le perdre", queue_size(page) == 1)

        fill_report(page, "Second signalement en attente sur ce telephone")
        page.click("#submitButton")
        expect(page.locator(".pending-card")).to_have_count(2)
        page.unroute("**/api/reports")

        answers = iter([(422, {"detail": "Catégorie inconnue"})])

        def first_refused(route):
            if route.request.method != "POST":
                return route.continue_()
            answer = next(answers, None)
            return route.fulfill(status=answer[0], json=answer[1]) if answer else route.continue_()

        page.route("**/api/reports", first_refused)
        page.click("text=Envoyer maintenant")
        expect(page.locator(".pending-card.is-rejected")).to_have_count(1)
        expect(page.locator(".pending-card")).to_have_count(1)
        check("un refus n’empêche pas l’envoi du suivant", True)
        check("le refus est expliqué", "Catégorie inconnue" in page.inner_text(".pending-card"))
        page.unroute("**/api/reports")

        page.get_by_role("button", name="Corriger").click()
        expect(page.locator("#formMessage")).to_contain_text("À corriger")
        check("l’élément revient dans le formulaire", "panne serveur" in page.input_value("#description"))
        with page.expect_response(created) as reply:
            page.click("#submitButton")
        check("il repart après correction", reply.value.status == 201)
        expect(page.locator("#queueBanner")).to_be_hidden()
        check("il quitte la file une fois publié", queue_size(page) == 0)


@scenario("Largeurs, zoom et accessibilité (axe-core)")
def test_layout_and_a11y(browser: Browser) -> None:
    for width in WIDTHS:
        with app(browser, width=width) as page:
            overflow = []
            for route in ROUTES:
                page.goto(f"{BASE}/{route}")
                page.wait_for_timeout(350)
                if page.evaluate("document.documentElement.scrollWidth > window.innerWidth"):
                    overflow.append(route)
            check(f"pas de défilement horizontal à {width} px", not overflow, overflow)

    with app(browser, width=844, height=390) as page:
        page.goto(f"{BASE}/#/signaler")
        page.wait_for_timeout(300)
        check("le formulaire reste utilisable en paysage", page.locator("#submitButton").count() == 1
              and not page.evaluate("document.documentElement.scrollWidth > window.innerWidth"))

    with app(browser, width=360) as page:
        page.add_style_tag(content="html { font-size: 200%; }")
        for route in ROUTES:
            page.goto(f"{BASE}/{route}")
            page.wait_for_timeout(300)
            page.add_style_tag(content="html { font-size: 200%; }")
        check("le texte agrandi à 200 % n’est pas coupé", page.locator("h1:visible").first.is_visible())

    with app(browser, width=390) as page:
        for route in ROUTES:
            page.goto(f"{BASE}/{route}")
            page.wait_for_timeout(1200)
            page.add_script_tag(url=AXE_URL)
            violations = page.evaluate(
                """async () => {
                  const r = await axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] });
                  return r.violations.map(v => `${v.id} (${v.impact}) : ${v.nodes.slice(0, 3).map(n => n.target.join(' ')).join(', ')}`);
                }"""
            )
            check(f"axe sans violation sur {route}", not violations, violations)

        page.goto(f"{BASE}/#/signaler")
        page.wait_for_timeout(300)
        sizes = page.evaluate(
            """() => [...document.querySelectorAll('main button, main a, nav a, .choice, .file-button')]
                .filter(n => n.offsetParent).map(n => [n.textContent.trim().slice(0, 24), Math.round(n.getBoundingClientRect().height)])
                .filter(([, h]) => h < 44)"""
        )
        check("cibles tactiles d’au moins 44 px", not sizes, sizes)
        page.goto(f"{BASE}/#/")
        page.reload()
        page.keyboard.press("Tab")
        check("le premier Tab atteint le lien d’évitement", page.evaluate("document.activeElement.id") == "skipLink")
        page.keyboard.press("Tab")
        outline = page.evaluate("getComputedStyle(document.activeElement).outlineStyle")
        check("le focus clavier est visible", outline == "solid", outline)


def main() -> int:
    data = Path(tempfile.mkdtemp(prefix="snart-e2e-"))
    environment = os.environ | {
        "SNART_DATABASE": str(data / "e2e.sqlite3"),
        "SNART_MODEL_PROVIDER": "demo_rules",
    }
    python = ROOT / ".venv" / "Scripts" / "python.exe"
    server = subprocess.Popen(
        [str(python), "-m", "uvicorn", "snart_api.main:app", "--app-dir", "backend", "--host", "127.0.0.1", "--port", str(PORT), "--log-level", "warning"],
        cwd=ROOT, env=environment,
    )
    try:
        for _ in range(60):
            try:
                api("/api/health")
                break
            except OSError:
                time.sleep(.25)
        subprocess.run(["node", "tests/frontend/seed-demo.mjs", BASE], cwd=ROOT, check=True)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome")
            test_home(browser)
            test_filters(browser)
            test_create(browser)
            test_validation(browser)
            test_photo_rules(browser)
            test_pin(browser)
            test_votes(browser)
            test_detail_states(browser)
            test_xss(browser)
            test_offline(browser)
            test_queue_failures(browser)
            test_layout_and_a11y(browser)
            try:
                browser.close()
            except Exception:
                pass
    finally:
        server.terminate()
        server.wait(timeout=10)
        shutil.rmtree(data, ignore_errors=True)
    failures = [name for passed, name in results if not passed]
    print(f"\n{len(results) - len(failures)}/{len(results)} vérifications réussies")
    for name in failures:
        print(f"  ÉCHEC : {name}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
