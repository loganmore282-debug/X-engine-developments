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
        ("The two stages", [
            "The light-dependent stage happens in the grana of the chloroplast. Light energy splits water "
            "into hydrogen and oxygen; the oxygen is released as a waste product.",
            "The light-independent stage happens in the stroma. The hydrogen is combined with carbon "
            "dioxide to build glucose, using energy captured in the first stage.",
        ]),
        ("What the plant does with glucose", [
            "* Releases energy from it in respiration.",
            "* Stores it as starch in leaves, roots and seeds.",
            "* Builds cellulose for cell walls.",
            "* Combines it with nitrates from the soil to make proteins.",
            "* Converts it to oils, which are stored in seeds.",
        ]),
        ("Why photosynthesis matters", [
            "Photosynthesis is the start of almost every food chain: plants are producers, and all "
            "consumers depend on them directly or indirectly. It also keeps the balance of gases in the "
            "air, removing carbon dioxide and releasing the oxygen that living things need for respiration.",
        ]),
        ("Testing a leaf for starch", [
            "1. Boil the leaf in water to kill it and soften the cell walls.",
            "2. Boil it in ethanol, using a water bath, to remove the chlorophyll.",
            "3. Rinse it in warm water to soften it again.",
            "4. Add iodine solution. A blue-black colour shows that starch is present.",
        ]),
        ("Showing that light is needed", [
            "1. Keep a potted plant in the dark for 48 hours so that it uses up its starch.",
            "2. Cover part of one leaf on both sides with a strip of black paper.",
            "3. Leave the plant in bright light for about six hours.",
            "4. Test the leaf for starch. Only the uncovered parts turn blue-black, which shows that "
            "light is needed for photosynthesis.",
        ]),
        ("Revision questions", [
            "1. Write the word equation for photosynthesis.",
            "2. Name the pigment that absorbs light, and say where it is found.",
            "3. Explain why a leaf is boiled in ethanol during the starch test.",
            "4. A farmer grows tomatoes in a greenhouse. Suggest two ways of raising the rate of photosynthesis.",
            "5. Describe an experiment to show that carbon dioxide is needed for photosynthesis.",
        ]),
    ]),
    "fractions.pdf": ("Fractions and Decimals", "Primary 7 Mathematics notes", [
        ("What a fraction is", [
            "A fraction shows part of a whole. In 3/4, the bottom number (the denominator) tells how many "
            "equal parts the whole is cut into, and the top number (the numerator) tells how many parts are taken.",
        ]),
        ("Adding and subtracting", [
            "Fractions can only be added or subtracted when their denominators are the same.",
            "Example: 2/5 + 1/5 = 3/5.",
            "Example: 1/2 + 1/3. Change both to sixths: 3/6 + 2/6 = 5/6.",
        ]),
        ("Changing a fraction to a decimal", [
            "Divide the numerator by the denominator. 3/4 means 3 divided by 4, which is 0.75.",
        ]),
        ("Practice questions", [
            "1. Work out 3/8 + 2/8.",
            "2. Work out 5/6 - 1/3.",
            "3. Change 7/10 to a decimal.",
            "4. Which is larger, 0.6 or 5/8? Show your working.",
        ]),
    ]),
    "revision-tips.pdf": ("How to Revise for Exams", "Study tips for every class", [
        ("Plan your time", [
            "Make a timetable that gives every subject some time each week. Study the subjects you find "
            "hardest when you are most awake, and keep sessions to about 45 minutes with a short break between them.",
        ]),
        ("Revise actively", [
            "* Close the book and write down everything you remember, then check what you missed.",
            "* Work through past papers against the clock.",
            "* Explain a topic out loud to a friend.",
            "* Make short summary cards for formulas and definitions.",
        ]),
        ("In the exam", [
            "1. Read the whole paper first and note the marks for each question.",
            "2. Start with the questions you are sure about.",
            "3. Show your working: marks are given for method as well as for the answer.",
            "4. Leave time at the end to read through what you wrote.",
        ]),
    ]),
    "plants-animals.pdf": ("Plants and Animals", "Primary 7 Science notes", [
        ("Living things", [
            "Living things move, feed, grow, reproduce, respire, excrete and respond to what is around them. "
            "Plants and animals are the two main groups of living things we study.",
        ]),
        ("How plants make food", [
            "Green plants make their own food in their leaves. They use sunlight, water from the soil and "
            "carbon dioxide from the air. This process is called photosynthesis.",
            "* Roots take in water and hold the plant in the soil.",
            "* The stem carries water and food around the plant.",
            "* Leaves make food using sunlight.",
        ]),
        ("Revision questions", [
            "1. Name four things that all living things do.",
            "2. State two jobs of the roots of a plant.",
            "3. Why are leaves green?",
        ]),
    ]),
    "our-districts.pdf": ("Our District and Our Region", "Primary 7 Social Studies notes", [
        ("Where we live", [
            "Uganda is divided into regions, and each region has many districts. A district is led by a "
            "Local Council V Chairperson, and a Chief Administrative Officer runs the district offices.",
        ]),
        ("Using a map", [
            "* A map is a drawing of a place as seen from above.",
            "* The key explains the signs and colours used on the map.",
            "* The scale shows how a distance on the map matches a real distance.",
            "* The compass shows the four main directions: north, south, east and west.",
        ]),
        ("Practice questions", [
            "1. Name the district where your school is found.",
            "2. What does the key of a map show?",
            "3. Name the four main points of the compass.",
        ]),
    ]),
    "comprehension.pdf": ("Reading Comprehension", "Primary 7 English practice", [
        ("The passage", [
            "Amina walks two kilometres to school every morning. On the way she greets the old man who sells "
            "mangoes by the road. She likes to arrive early so that she can read in the school library before "
            "lessons begin. Last term she borrowed twelve books and finished every one of them.",
        ]),
        ("Questions", [
            "1. How far does Amina walk to school?",
            "2. Who does Amina greet on the way?",
            "3. Why does Amina like to arrive early?",
            "4. How many books did Amina borrow last term?",
            "5. Find a word in the passage that means 'a place where books are kept'.",
        ]),
    ]),
    "essay-writing.pdf": ("Essay Writing", "Senior 2 English notes", [
        ("Planning an essay", [
            "A good essay has an introduction, a body and a conclusion. Before you write, spend five minutes "
            "listing your main points and putting them in order.",
        ]),
        ("The three parts", [
            "* Introduction: say what the essay is about in two or three sentences.",
            "* Body: one paragraph for each main point, with an example.",
            "* Conclusion: sum up your argument and leave the reader with a final thought.",
        ]),
        ("Practice titles", [
            "1. Why every village needs a library.",
            "2. A day I will never forget.",
            "3. Should students use phones at school?",
        ]),
    ]),
    "linear-equations.pdf": ("Linear Equations", "Senior 2 Mathematics worked examples", [
        ("Solving an equation", [
            "To solve an equation, do the same thing to both sides until the unknown is alone.",
            "Example: solve 3x + 5 = 20. Subtract 5 from both sides: 3x = 15. Divide both sides by 3: x = 5.",
        ]),
        ("Equations with the unknown on both sides", [
            "Example: solve 5x - 4 = 2x + 8. Subtract 2x from both sides: 3x - 4 = 8. "
            "Add 4: 3x = 12. Divide by 3: x = 4.",
        ]),
        ("Practice questions", [
            "1. Solve 2x + 7 = 19.",
            "2. Solve 4x - 3 = x + 9.",
            "3. The sum of three consecutive numbers is 42. Find the numbers.",
        ]),
    ]),
    "map-reading.pdf": ("Map Reading", "Senior 2 Geography notes", [
        ("Parts of a map", [
            "Every topographic map has a title, a scale, a key and a north arrow. The scale lets us measure "
            "real distances: on a 1:50,000 map, 1 cm stands for 500 m on the ground.",
        ]),
        ("Grid references", [
            "A four-figure grid reference names a square on the map. Read the eastings (the numbers along the "
            "bottom) first, then the northings (the numbers up the side).",
            "Remember: along the corridor, then up the stairs.",
        ]),
        ("Practice questions", [
            "1. A road measures 6 cm on a 1:50,000 map. How long is it on the ground?",
            "2. Give the four-figure grid reference of the square whose bottom left corner is at 43 easting and 27 northing.",
        ]),
    ]),
    "uganda-history.pdf": ("Uganda Before Colonial Rule", "Senior 2 History and Political Education notes", [
        ("Early kingdoms", [
            "Before colonial rule, the area now called Uganda had several kingdoms, among them Buganda, "
            "Bunyoro, Ankole and Toro, as well as societies without kings such as the Acholi and Lango.",
        ]),
        ("Trade", [
            "* Long-distance trade linked the interior with the coast.",
            "* Salt from Kibiro and iron tools from Bunyoro were widely traded.",
            "* Traders from the coast brought cloth, beads and guns.",
        ]),
        ("Revision questions", [
            "1. Name three pre-colonial kingdoms in Uganda.",
            "2. Give two items that were traded.",
        ]),
    ]),
    "demand-supply.pdf": ("Demand and Supply", "Senior 5 Economics notes", [
        ("Demand", [
            "Demand is the quantity of a good that buyers are willing and able to buy at a given price. "
            "When the price of a good falls, the quantity demanded usually rises. This is the law of demand.",
        ]),
        ("Supply", [
            "Supply is the quantity of a good that sellers are willing to offer at a given price. "
            "When the price rises, the quantity supplied usually rises too.",
        ]),
        ("Equilibrium", [
            "The market is in equilibrium where demand equals supply. At that price there is neither a "
            "shortage nor a surplus.",
        ]),
    ]),
    "gp-essay.pdf": ("Planning a General Paper Essay", "Senior 5 General Paper notes", [
        ("Read the question carefully", [
            "Underline the key words in the question and decide what you are being asked to do: discuss, "
            "explain, assess or give your opinion.",
        ]),
        ("A simple structure", [
            "* An introduction that defines the main term and states your view.",
            "* Three or four paragraphs, each making one point with an example from Uganda or East Africa.",
            "* A conclusion that answers the question directly.",
        ]),
    ]),
    "acids.pdf": ("Acids, Bases and Salts", "Senior 2 Chemistry notes", [
        ("Acids", [
            "An acid is a substance that releases hydrogen ions when it dissolves in water. Acids taste "
            "sour, turn blue litmus paper red and have a pH below 7.",
            "Common examples are hydrochloric acid, sulphuric acid and nitric acid.",
        ]),
        ("Bases and alkalis", [
            "A base is a substance that neutralises an acid. A base that dissolves in water is called an "
            "alkali. Alkalis turn red litmus paper blue and have a pH above 7.",
            "Common examples are sodium hydroxide, potassium hydroxide and calcium hydroxide.",
        ]),
        ("Neutralisation", [
            "When an acid reacts with a base, a salt and water are formed. This is called neutralisation.",
            "Example: hydrochloric acid + sodium hydroxide gives sodium chloride + water.",
        ]),
        ("The pH scale", [
            "The pH scale runs from 0 to 14. A pH of 7 is neutral. The lower the number below 7, the "
            "stronger the acid; the higher the number above 7, the stronger the alkali.",
        ]),
    ]),
    "energy.pdf": ("Work, Energy and Power", "Senior 2 Physics notes", [
        ("Work", [
            "Work is done when a force moves an object in the direction of the force. Work done = force "
            "multiplied by distance moved. It is measured in joules.",
            "Example: a force of 50 N moving a box 4 m does 200 J of work.",
        ]),
        ("Energy", [
            "Energy is the ability to do work. Kinetic energy is the energy of a moving object. Potential "
            "energy is stored energy, for example in an object raised above the ground.",
            "Energy cannot be created or destroyed. It can only change from one form to another.",
        ]),
        ("Power", [
            "Power is the rate of doing work. Power = work done divided by time taken. It is measured in watts.",
            "Example: 600 J of work done in 20 s is a power of 30 W.",
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
    for name in ("BodyText", "Italic"):
        styles[name].fontSize = 12
        styles[name].leading = 17
    styles["Heading2"].fontSize = 15
    styles["Heading2"].spaceBefore = 14
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
