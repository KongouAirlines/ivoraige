"""Original PDF regression fixture for formula capture and frozen replay (no model)."""
import sys
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit

out = Path(sys.argv[1])
out.parent.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(out), pagesize=(595, 842))
c.setTitle("Original formula and replay regression 0.1.0")

def paragraph(text, x, y, width=475, font="Times-Roman", size=12):
    c.setFont(font, size)
    for line in simpleSplit(text, font, size, width):
        c.drawString(x, y, line)
        y -= 18
    return y - 24

paragraph("Formula and punctuation controls", 55, 777, font="Helvetica-Bold", size=19)
paragraph("The applied field changes the magnetization direction.", 55, 720)
paragraph("The applied field changes the magnetization direction.", 55, 655)
paragraph("E = - m H", 55, 570, font="Times-Italic", size=15)
paragraph("The inline relation E = - m H preserves its symbols during replay.", 55, 510, font="Times-Italic", size=15)
paragraph("A punctuation control follows: .................... End of control.", 55, 430)
paragraph("A short paragraph accepts a deliberately longer revision.", 55, 335)
c.showPage()
paragraph("Two columns and repeated formulas", 55, 777, font="Helvetica-Bold", size=19)
for x in (55, 315):
    y = paragraph("The applied field changes the magnetization direction.", x, 710, width=220)
    y = paragraph("E = - m H", x, y, width=220, font="Times-Italic", size=15)
    paragraph("The symbols describe a controlled example. They are not experimental measurements.", x, y, width=220)
c.save()
print(out)
