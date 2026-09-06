#!/usr/bin/env python3
"""
GENERADOR DE ASSETS DE MARCA — favicons, iconos del manifiesto, logo y og-image.

Por qué existe
--------------
`frontend/public/index.html` y `manifest.json` referenciaban siete ficheros PNG
que NO existían en el repositorio: cada visita pedía `/favicon-32x32.png`,
`/apple-touch-icon.png`, `/icon-192x192.png`, `/icon-512x512.png`,
`/og-image.png` y `/logo.png` y recibía un 404. En Open Graph eso significa
previsualización vacía en LinkedIn, WhatsApp y Slack; en el manifiesto, un icono
roto al instalar la aplicación.

Este script NO inventa una identidad visual: dibuja EXACTAMENTE el escudo de
`frontend/public/favicon.svg` (las mismas coordenadas, los mismos dos colores
#0080FF y #FF4458) y compone con él los tamaños que faltan. La tipografía es la
del sistema, no una tipografía de marca.

Los assets generados son TÉCNICOS: correctos, coherentes y suficientes para que
nada devuelva 404. Están pensados para ser sustituidos por los definitivos
cuando exista diseño gráfico — sobre todo `og-image.png` y `logo.png`, que son
las piezas donde un diseñador aporta de verdad. Ver docs/SEO_ASSETS.md.

Este script NO forma parte de `npm run build`: se ejecuta a mano cuando cambia el
escudo, y su salida se versiona.

    python3 scripts/generate-brand-assets.py

Requiere Pillow (`pip install Pillow`). No es una dependencia del proyecto.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public"

BLUE = (0, 128, 255, 255)
RED = (255, 68, 88, 255)
INK = (232, 236, 241, 255)
MUTED = (139, 151, 168, 255)
BG_DARK = (10, 12, 16, 255)

SS = 8  # supersampling: se dibuja en grande y se reduce, que es el antialiasing

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]
FONT_REGULAR_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
]


def load_font(candidates, size):
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def cubic(p0, p1, p2, p3, steps=64):
    """Puntos de una Bézier cúbica. El escudo del SVG usa una por lado."""
    points = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u**2 * t * p1[0] + 3 * u * t**2 * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u**2 * t * p1[1] + 3 * u * t**2 * p2[1] + t**3 * p3[1]
        points.append((x, y))
    return points


# Las dos mitades del escudo, en el sistema de coordenadas 24x24 del viewBox
# original. Traducción literal de los dos <path> de favicon.svg:
#
#   izquierda: M12 2 L3 5 V11 C3 16.55 6.84 21.74 12 23
#   derecha:   M12 2 L21 5 V11 C21 16.55 17.16 21.74 12 23
LEFT_HALF = [(12, 2), (3, 5), (3, 11)] + cubic((3, 11), (3, 16.55), (6.84, 21.74), (12, 23))
RIGHT_HALF = [(12, 2), (21, 5), (21, 11)] + cubic(
    (21, 11), (21, 16.55), (17.16, 21.74), (12, 23)
)


def draw_shield(size, stroke_ratio=2 / 24, padding_ratio=0.06):
    """El escudo sobre lienzo transparente, centrado y con margen."""
    canvas = size * SS
    image = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    pad = canvas * padding_ratio
    scale = (canvas - 2 * pad) / 24.0
    width = max(1, int(round(stroke_ratio * 24 * scale)))

    def to_px(points):
        return [(pad + x * scale, pad + y * scale) for x, y in points]

    for points, color in ((LEFT_HALF, BLUE), (RIGHT_HALF, RED)):
        pixels = to_px(points)
        draw.line(pixels, fill=color, width=width, joint="curve")
        # Extremos redondeados, como el stroke-linecap="round" del SVG.
        radius = width / 2
        for x, y in (pixels[0], pixels[-1]):
            draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)

    return image.resize((size, size), Image.LANCZOS)


def write(image, name):
    path = OUT / name
    image.save(path, "PNG", optimize=True)
    print(f"  {name:24s} {image.size[0]}x{image.size[1]}  {path.stat().st_size:>6} B")


def favicon(size):
    return draw_shield(size, padding_ratio=0.04 if size <= 32 else 0.08)


def apple_touch_icon(size=180):
    """Fondo opaco: iOS no respeta la transparencia y la pinta de negro."""
    base = Image.new("RGBA", (size, size), BG_DARK)
    base.alpha_composite(draw_shield(size, padding_ratio=0.16))
    return base


def maskable_icon(size):
    """
    Icono del manifiesto declarado `maskable`: Android recorta hasta un 20% por
    lado, así que el escudo va dentro de la zona segura central.
    """
    base = Image.new("RGBA", (size, size), BG_DARK)
    base.alpha_composite(draw_shield(size, padding_ratio=0.26))
    return base


def logo(size=512):
    """
    Logo para el JSON-LD de Organization: marca + nombre, fondo opaco.
    ASSET TÉCNICO — sustituir por el logotipo definitivo cuando exista.
    """
    base = Image.new("RGBA", (size, size), BG_DARK)
    mark = draw_shield(int(size * 0.52), padding_ratio=0.0)
    base.alpha_composite(mark, (int((size - mark.width) / 2), int(size * 0.16)))

    draw = ImageDraw.Draw(base)
    font = load_font(FONT_CANDIDATES, int(size * 0.115))
    text = "VulnFocus"
    box = draw.textbbox((0, 0), text, font=font)
    draw.text(
        ((size - (box[2] - box[0])) / 2 - box[0], size * 0.74),
        text,
        font=font,
        fill=INK,
    )
    return base


def og_image(width=1200, height=630):
    """
    Tarjeta de Open Graph / Twitter.

    Solo texto que YA está en el sitio: el nombre de la marca y la descripción de
    la actividad. Ni clientes, ni certificaciones, ni cifras, ni premios.
    ASSET TÉCNICO — sustituir por la pieza de diseño cuando exista.
    """
    base = Image.new("RGBA", (width, height), BG_DARK)
    draw = ImageDraw.Draw(base)

    # Filete superior con los dos colores de la marca.
    draw.rectangle((0, 0, width // 2, 8), fill=BLUE)
    draw.rectangle((width // 2, 0, width, 8), fill=RED)

    mark = draw_shield(200, padding_ratio=0.0)
    base.alpha_composite(mark, (88, 118))

    title_font = load_font(FONT_CANDIDATES, 88)
    sub_font = load_font(FONT_REGULAR_CANDIDATES, 40)
    small_font = load_font(FONT_REGULAR_CANDIDATES, 30)

    draw.text((300, 150), "VulnFocus", font=title_font, fill=INK)
    draw.text(
        (300, 262),
        "Pentesting manual y seguridad ofensiva",
        font=sub_font,
        fill=BLUE,
    )
    draw.text(
        (88, 420),
        "Evaluaciones manuales de aplicaciones, APIs, infraestructura,",
        font=small_font,
        fill=MUTED,
    )
    draw.text(
        (88, 462),
        "Active Directory, cloud y ejercicios Red Team.",
        font=small_font,
        fill=MUTED,
    )
    draw.text((88, 540), "vulnfocus.com", font=small_font, fill=INK)

    draw.rectangle((0, height - 6, width, height), fill=(35, 43, 54, 255))
    return base


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    print(f"[brand-assets] escribiendo en {OUT}")
    write(favicon(16), "favicon-16x16.png")
    write(favicon(32), "favicon-32x32.png")
    write(apple_touch_icon(180), "apple-touch-icon.png")
    write(maskable_icon(192), "icon-192x192.png")
    write(maskable_icon(512), "icon-512x512.png")
    write(logo(512), "logo.png")
    write(og_image(), "og-image.png")
    print("[brand-assets] listo. Assets TÉCNICOS: ver docs/SEO_ASSETS.md")


if __name__ == "__main__":
    main()
