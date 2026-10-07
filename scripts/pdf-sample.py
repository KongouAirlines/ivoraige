"""Original two-page PDF acceptance fixture; reportlab is a dev-only dependency."""
import sys
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit

out = Path(sys.argv[1])
out.parent.mkdir(parents=True, exist_ok=True)
c = canvas.Canvas(str(out), pagesize=(595, 842))
c.setTitle('Original PDF translation acceptance sample')

def paragraph(text, x, y, width=475):
    c.setFont('Times-Roman', 12)
    for line in simpleSplit(text, 'Times-Roman', 12, width):
        c.drawString(x, y, line)
        y -= 17
    return y - 20

c.setFont('Helvetica-Bold', 19)
c.drawString(60, 776, 'A controlled measurement')
y = paragraph('The normalized signal increased from 0.12 to 0.18 when the applied magnetic field changed from 10 mT to 20 mT. These observations do not establish a causal relationship.', 60, 735)
y = paragraph('The reference sample remained stable during the measurement.', 60, y)
y = paragraph('The relation between energy and mass is written below. Symbols and numerical values must remain unchanged during translation.', 60, y)
c.setFont('Times-Italic', 18)
c.drawString(225, y - 8, 'E = m c')
c.setFont('Times-Roman', 11)
c.drawString(283, y, '2')
c.setStrokeColorRGB(0.12, 0.35, 0.65)
c.setLineWidth(2)
c.rect(100, 330, 390, 125)
c.line(120, 350, 220, 375)
c.line(220, 375, 330, 399)
c.line(330, 399, 460, 430)
paragraph('Figure 1. A schematic signal trace; the blue line illustrates the trend and is not experimental data.', 100, 307, 390)
c.showPage()
c.setFont('Helvetica-Bold', 19)
c.drawString(60, 776, 'Two-column comparison')
left = 60
right = 315
width = 220
y = paragraph('The reference sample remained stable during the measurement.', left, 725, width)
y = paragraph('For the first comparison, we used the same boundary conditions in both simulations. The grid spacing was reduced from 4 nm to 2 nm.', left, y, width)
paragraph('The change in resonance frequency was below one percent. This supports convergence of this observable, not validity of every model assumption.', left, y, width)
y = paragraph('For the second comparison, we varied the duration while holding the field constant. The uncertainty denotes one standard deviation.', right, 725, width)
y = paragraph('A longer observation window improves frequency resolution. It does not remove systematic errors introduced by the boundary model.', right, y, width)
paragraph('The repeated sentence on these two pages is intentionally identical. Its position must remain distinct when revisions are edited.', right, y, width)
c.save()
print(out)
