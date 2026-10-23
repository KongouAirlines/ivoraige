"""Regenerate two original native PDFs; optional developer dependency: reportlab.
No network, source corpus, or translation engine is used. Stable bytes via invariant=1.
"""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit

ROOT = Path(__file__).resolve().parents[1] / 'evaluation/catalog-0.1.x/inputs'
ROOT.mkdir(parents=True, exist_ok=True)
for name in ('P01', 'P02'):
    c = canvas.Canvas(str(ROOT / f'{name}.pdf'), pagesize=(595, 842), invariant=1)
    c.setTitle(f'{name} original synthetic regression input')
    c.setAuthor('ivoraige synthetic fixtures (AI assisted)')
    c.setFont('Helvetica-Bold', 17)
    c.drawString(48, 785, 'Adjacent equations' if name == 'P01' else 'Two-column comparison')
    c.setFont('Helvetica', 9)
    c.drawString(48, 760, 'Original synthetic input. No measured data. Translation quality requires human review.')
    def paragraph(text, x, y, width):
        c.setFont('Times-Roman', 12)
        for line in simpleSplit(text, 'Times-Roman', 12, width):
            c.drawString(x, y, line)
            y -= 17
        return y - 20
    if name == 'P01':
        y = paragraph('The film is 12 nm thick at 300 K. The repeated relation below is intentional.',48,720,490)
        c.setFont('Times-Italic',18)
        c.drawString(70,y,'r = A / B     B != 0')
        c.drawString(70,y-35,'q = r * r')
        paragraph('Neither expression establishes a causal relationship. Preserve both equations and their order.',48,y-85,490)
    else:
        text='The signal was measured twice. The field was held at 2.5 mT during the comparison.'
        paragraph(text,48,720,225)
        paragraph(text,320,720,225)
        paragraph('Left column: decreasing the grid interval does not prove every assumption.',48,610,225)
        paragraph('Right column: a short source sentence may require a longer Chinese rendering. Inspect overflow independently of translation accuracy.',320,610,225)
    c.setFont('Helvetica',9)
    c.drawString(48,40,f'{name} | native text | page 1 of 1')
    c.save()
