# SPDX-License-Identifier: MIT
# Original synthetic PDFs for optional local MinerU validation.
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.lib.utils import ImageReader
from PIL import ImageDraw, ImageFont
from pathlib import Path
from pypdfium2 import PdfDocument
from pypdf import PdfReader
import os, sys
if len(sys.argv) != 2:
    raise SystemExit('usage: mineru-live-samples.py OUTPUT_DIR')
root=Path(sys.argv[1]);root.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
W,H=A4
c=canvas.Canvas(str(root/'mixed.pdf'),pagesize=A4)
c.setTitle('Synthetic MinerU validation')
c.setFont('Helvetica-Bold',16);c.drawString(50,H-50,'Synthetic Research Note: Water-Saving Crops')
c.setFont('STSong-Light',11);c.drawString(50,H-74,'原创合成测试文档：节水作物')
c.setFont('Helvetica-Bold',11);c.drawString(50,H-110,'Abstract')
c.setFont('Helvetica',10)
for i,line in enumerate(['This fictional trial compares three invented plots.', 'The goal is layout parsing, not scientific inference.', 'All figures here are synthetic and non-sensitive.']):c.drawString(50,H-130-16*i,line)
c.setStrokeColorRGB(.6,.6,.6);c.line(50,H-187,W-50,H-187)
left=['1 Introduction','Crop trials often mix prose, tables, and','equations. This page tests reading order in','two columns. Plot A uses less water.','The data below are illustrative.']
right=['2 Method','We measured an invented index on','three synthetic plots over one week.','The result should remain on this page.','No outside source was used.']
for x,lines in [(50,left),(305,right)]:
 for i,line in enumerate(lines):
  c.setFont('Helvetica-Bold' if i==0 else 'Helvetica',11 if i==0 else 10);c.drawString(x,H-220-18*i,line)
c.setFont('Helvetica-Bold',11);c.drawString(50,H-340,'Table 1. Fictional observations')
rows=[['Plot','Water (L)','Index'],['A','12','0.71'],['B','18','0.64'],['C','25','0.58']]
for i,row in enumerate(rows):
 y=H-370-23*i
 for x,s in zip([58,210,360],row):c.setFont('Helvetica-Bold' if i==0 else 'Helvetica',10);c.drawString(x,y,s)
 c.line(50,y-8,500,y-8)
c.setFont('Helvetica-Bold',11);c.drawString(50,H-485,'Equation 1. Synthetic efficiency score')
c.setFont('Helvetica',13);c.drawString(70,H-510,'E = (Y / W) x 100')
c.setFont('STSong-Light',11);c.drawString(50,H-550,'结论：样本 A 的虚构效率最高。')
c.save()
# Rasterize the same original page then wrap as one full-page image: no PDF text objects.
doc=PdfDocument(str(root/'mixed.pdf'));img=doc[0].render(scale=2).to_pil()
# Keep a separate image-only scan with distinct printed content.
d=ImageDraw.Draw(img);font=ImageFont.truetype(os.environ.get('SYNTHETIC_CJK_FONT','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'),26)
d.text((120,1400),'SCAN ONLY: OCR should read this line. 扫描测试',font=font,fill=(0,0,0))
img.save(root/'scan.png')
c=canvas.Canvas(str(root/'scan.pdf'),pagesize=A4);c.setTitle('Synthetic image-only scan')
c.drawImage(ImageReader(img),0,0,width=W,height=H);c.save()
for name in ('mixed.pdf','scan.pdf'):
 p=root/name; f=PdfReader(str(p))
 print(name,p.stat().st_size,'bytes, extractable text length:',sum(len(page.extract_text() or '') for page in f.pages))
