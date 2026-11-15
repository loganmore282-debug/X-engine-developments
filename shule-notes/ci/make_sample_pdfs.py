"""Writes a few sample study documents as PDFs, used only to fill the app
with realistic content when CI photographs its screens."""
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import cm
from reportlab.platypus import ListFlowable, ListItem, Paragraph, SimpleDocTemplate, Spacer

DOCS = {
    "photosynthesis.pdf": ("Photosynthesis", "Senior 2 Biology notes", [
        ("What photosynthesis is", [
            "Photosynthesis is the process by which green plants make their own food. "
            "They use light energy from the sun to combine carbon dioxide from the air "
            "with water from the soil, producing glucose and releasing oxygen.",
            "Word equation: carbon dioxide + water = glucose + oxygen "
            "(in the presence of sunlight and chlorophyll).",
            "Chemical equation: 6CO<sub>2</sub> + 6H<sub>2</sub>O = C<sub>6</sub>H<sub>12</sub>O<sub>6</sub> + 6O<sub>2</sub>",
        ]),
        ("Where it happens", [
            "Photosynthesis takes place in the chloroplasts, which are found mainly in the "
            "palisade cells of the leaf. Chloroplasts contain chlorophyll, the green pigment "
            "that absorbs light energy.",
        ]),
        ("Conditions needed", ["* Light", "* Carbon dioxide", "* Water", "* Chlorophyll", "* A suitable temperature"]),
        ("How the leaf is adapted", [
            "* A broad, flat surface absorbs as much light as possible.",
            "* A thin shape lets carbon dioxide reach the cells quickly.",
            "* Stomata on the lower surface let gases in and out.",
            "* Veins bring water and carry the glucose away.",
        ]),
        ("Factors that limit the rate", [
            "The rate of photosynthesis is limited by whichever factor is in shortest supply: "
            "light intensity, carbon dioxide concentration or temperature. Raising a limiting "
            "factor increases the rate until another factor becomes limiting.",
        ]),
        ("Testing a leaf for starch", [
            "1. Boil the leaf in water to kill it and soften the cell walls.",
            "2. Boil it in ethanol, using a water bath, to remove the chlorophyll.",
            "3. Rinse it in warm water to soften it again.",
            "4. Add iodine solution. A blue-black colour shows that starch is present.",
        ]),
    ]),
    "quadratics.pdf": ("Quadratic Equations", "Senior 3 Mathematics worked examples", [
        ("The general form", [
            "A quadratic equation can be written as ax<super>2</super> + bx + c = 0, where a is not zero.",
        ]),
        ("Solving by factorising", [
            "Example: solve x<super>2</super> + 5x + 6 = 0.",
            "Find two numbers that multiply to 6 and add to 5. These are 2 and 3.",
            "So (x + 2)(x + 3) = 0, which gives x = -2 or x = -3.",
        ]),
        ("Solving with the formula", [
            "x = (-b ± square root of (b<super>2</super> - 4ac)) / 2a",
            "Example: solve 2x<super>2</super> - 3x - 2 = 0. Here a = 2, b = -3 and c = -2.",
            "b<super>2</super> - 4ac = 9 + 16 = 25, so x = (3 ± 5) / 4, giving x = 2 or x = -0.5.",
        ]),
        ("Practice questions", [
            "1. Solve x<super>2</super> - 7x + 12 = 0.",
            "2. Solve x<super>2</super> - 9 = 0.",
            "3. Solve 3x<super>2</super> + 2x - 1 = 0.",
        ]),
    ]),
    "newton.pdf": ("Newton's Laws of Motion", "Senior 3 Physics revision", [
        ("First law", [
            "A body stays at rest, or keeps moving in a straight line at constant speed, "
            "unless a resultant force acts on it. This property is called inertia.",
        ]),
        ("Second law", [
            "The resultant force on a body equals its mass multiplied by its acceleration: F = ma.",
            "Example: a 1,200 kg car accelerating at 2 m/s<super>2</super> needs a resultant force of 2,400 N.",
        ]),
        ("Third law", [
            "When body A pushes on body B, body B pushes back on body A with a force that is "
            "equal in size and opposite in direction.",
        ]),
    ]),
    "cells.pdf": ("Cell Structure", "Senior 1 Biology practice questions", [
        ("Section A", [
            "1. Name three structures found in plant cells but not in animal cells.",
            "2. State the function of the nucleus.",
            "3. What is the role of the cell membrane?",
        ]),
        ("Section B", [
            "4. Describe how you would prepare a slide of onion epidermis.",
            "5. Explain why a red blood cell has no nucleus.",
        ]),
    ]),
}


def build(path, title, subtitle, sections):
    styles = getSampleStyleSheet()
    story = [Paragraph(title, styles["Title"]), Paragraph(subtitle, styles["Italic"]), Spacer(1, 0.6 * cm)]
    for heading, lines in sections:
        story.append(Paragraph(heading, styles["Heading2"]))
        bullets = [l[2:] for l in lines if l.startswith("* ")]
        if bullets:
            story.append(ListFlowable([ListItem(Paragraph(b, styles["BodyText"])) for b in bullets], bulletType="bullet"))
        for line in (l for l in lines if not l.startswith("* ")):
            story.append(Paragraph(line, styles["BodyText"]))
            story.append(Spacer(1, 0.2 * cm))
    SimpleDocTemplate(str(path), pagesize=A4, title=title, leftMargin=2 * cm, rightMargin=2 * cm).build(story)


out = Path(sys.argv[1])
out.mkdir(parents=True, exist_ok=True)
for name, (title, subtitle, sections) in DOCS.items():
    build(out / name, title, subtitle, sections)
    print("wrote", out / name)
