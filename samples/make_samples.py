"""Generate the demo receipts in samples/ (all values fictional).

Usage: python3 samples/make_samples.py [out_dir]   (macOS, needs Pillow)
chat.png is hand-made and not generated here.
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
W, H = 750, 1334
HELV = "/System/Library/Fonts/Helvetica.ttc"  # has U+20B9; Arial Unicode does not
UNI, BOLD = 0, 1  # face indexes in the collection
f = lambda i, s: ImageFont.truetype(HELV, s, index=i)
RED, GREEN, DARK, GREY, LINE = (192, 57, 43), (33, 160, 90), (26, 26, 26), (110, 110, 110), (225, 225, 225)


def statement():
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 120], fill=(0, 76, 143))
    d.text((40, 42), "Axis Bank  •  Statement", font=f(BOLD, 32), fill="white")
    d.text((40, 146), "Savings ••4021   |   September 2026", font=f(UNI, 24), fill=GREY)
    rows = [
        ("12 Sep", "BIGBASKET RETAIL", "-", "2,340.00"),
        ("12 Sep", "NETFLIX SUBSCRIPTION", "-", "649.00"),
        ("13 Sep", "INDIAN OIL PETROL PUMP", "-", "3,000.00"),
        ("14 Sep", "UPI CREDIT RAHUL S", "+", "1,200.00"),
        ("14 Sep", "APOLLO PHARMACY", "-", "872.50"),
    ]
    y = 196
    for date, desc, sign, amt in rows:
        d.line([40, y, 710, y], fill=LINE, width=1)
        d.text((40, y + 12), date, font=f(UNI, 22), fill=GREY)
        d.text((150, y + 12), desc, font=f(UNI, 24), fill=DARK)
        txt = f"{sign} ₹{amt}"
        font = f(UNI, 24)
        w = d.textlength(txt, font=font)
        d.text((710 - w, y + 18), txt, font=font, fill=GREEN if sign == "+" else RED)
        y += 78
    im.save(f"{OUT}/statement.png", optimize=True)


def refund():
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W, 110], fill=(95, 37, 159))
    d.text((40, 36), "PhonePe", font=f(BOLD, 36), fill="white")
    d.text((40, 196), "Refund received", font=f(BOLD, 38), fill=DARK)
    d.text((40, 292), "₹1,499.00", font=f(UNI, 58), fill=GREEN)
    d.text((40, 386), "From Myntra Designs", font=f(UNI, 26), fill=GREY)
    d.text((40, 436), "16 Sep 2026, 11:15 AM", font=f(UNI, 24), fill=GREY)
    d.text((40, 516), "Credited to Axis Bank ••4021", font=f(UNI, 24), fill=GREY)
    im.save(f"{OUT}/refund.png", optimize=True)


statement()
refund()


def header(d, color, title, h=120, size=34, text_fill="white"):
    d.rectangle([0, 0, W, h], fill=color)
    d.text((40, h // 2 - size // 2 - 4), title, font=f(BOLD, size), fill=text_fill)


def right(d, x, y, txt, font, fill):
    d.text((x - d.textlength(txt, font=font), y), txt, font=font, fill=fill)


def gpay():
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    header(d, (26, 115, 232), "Google Pay")
    cx = W // 2
    d.ellipse([cx - 60, 200, cx + 60, 320], fill=(230, 244, 234))
    d.line([(cx - 26, 262), (cx - 6, 284), (cx + 30, 240)], fill=(30, 142, 62), width=9, joint="curve")
    for y, txt, font, fill in [
        (370, "Payment successful", f(BOLD, 34), DARK),
        (430, "₹1,248.00", f(BOLD, 58), DARK),
        (530, "To Blue Tokai Coffee Roasters", f(UNI, 28), GREY),
        (578, "27 Aug 2026, 4:02 PM", f(UNI, 24), GREY),
    ]:
        d.text((cx - d.textlength(txt, font=font) / 2, y), txt, font=font, fill=fill)
    d.line([40, 650, 710, 650], fill=LINE, width=2)
    d.text((40, 690), "UPI transaction ID", font=f(UNI, 24), fill=GREY)
    d.text((40, 730), "600123450987", font=f(UNI, 26), fill=DARK)
    d.text((40, 800), "From", font=f(UNI, 24), fill=GREY)
    d.text((40, 840), "Axis Bank ••4021", font=f(UNI, 26), fill=DARK)
    im.save(f"{OUT}/gpay.png", optimize=True)


def swiggy():
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    header(d, (252, 128, 25), "Swiggy", h=110)
    d.text((40, 150), "Order delivered", font=f(BOLD, 38), fill=DARK)
    d.text((40, 212), "Sunday, 23 August 2026 at 8:41 PM", font=f(UNI, 24), fill=GREY)
    d.line([40, 268, 710, 268], fill=LINE, width=2)
    d.text((40, 290), "Burger King", font=f(BOLD, 32), fill=DARK)
    d.text((40, 336), "Indiranagar, Bengaluru", font=f(UNI, 24), fill=GREY)
    y = 400
    for label, amt in [("Item Total", "549.00"), ("Delivery Fee", "35.00"), ("Taxes & Charges", "64.00")]:
        d.text((40, y), label, font=f(UNI, 26), fill=GREY)
        right(d, 700, y, f"₹{amt}", f(UNI, 26), DARK)
        y += 52
    d.line([40, y + 12, 710, y + 12], fill=LINE, width=2)
    d.text((40, y + 36), "Grand Total", font=f(BOLD, 30), fill=DARK)
    right(d, 700, y + 36, "₹648.00", f(BOLD, 30), DARK)
    d.text((40, y + 120), "Paid using UPI", font=f(UNI, 24), fill=GREY)
    im.save(f"{OUT}/swiggy.png", optimize=True)


def uber():
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    header(d, (0, 0, 0), "Uber", h=110)
    d.text((40, 165), "Thanks for riding, Alex", font=f(BOLD, 34), fill=DARK)
    d.text((40, 222), "25 August 2026", font=f(UNI, 26), fill=GREY)
    d.text((40, 300), "Total", font=f(UNI, 28), fill=GREY)
    d.text((40, 350), "₹287.50", font=f(UNI, 60), fill=DARK)
    d.line([40, 440, 710, 440], fill=LINE, width=2)
    y = 470
    for label, amt in [("Trip fare", "262.50"), ("Booking fee", "25.00")]:
        d.text((40, y), label, font=f(UNI, 24), fill=GREY)
        right(d, 700, y, f"₹{amt}", f(UNI, 24), DARK)
        y += 46
    d.line([40, y + 14, 710, y + 14], fill=LINE, width=2)
    d.text((40, y + 40), "Payment", font=f(BOLD, 26), fill=DARK)
    d.text((40, y + 86), "Axis Credit Card •••• 9034", font=f(UNI, 24), fill=GREY)
    right(d, 700, y + 86, "₹287.50", f(UNI, 24), DARK)
    d.text((40, y + 166), "Koramangala to MG Road", font=f(UNI, 24), fill=GREY)
    im.save(f"{OUT}/uber.png", optimize=True)


def amazon():
    im = Image.new("RGB", (W, H), "white")
    d = ImageDraw.Draw(im)
    header(d, (35, 47, 62), "amazon", h=110)
    d.text((40, 165), "Order Confirmed", font=f(BOLD, 38), fill=(0, 118, 80))
    d.text((40, 230), "Order #114-5550123-0001234", font=f(UNI, 24), fill=GREY)
    d.text((40, 278), "Placed on August 21, 2026", font=f(UNI, 24), fill=GREY)
    d.line([40, 340, 710, 340], fill=LINE, width=2)
    d.text((40, 375), "Anker 737 Power Bank 24,000mAh", font=f(UNI, 28), fill=DARK)
    d.text((40, 422), "Sold by Anker Direct", font=f(UNI, 22), fill=GREY)
    d.text((40, 500), "Order Total:", font=f(BOLD, 30), fill=DARK)
    d.text((330, 500), "$129.99", font=f(UNI, 30), fill=(204, 12, 57))
    d.text((40, 580), "Payment method: Visa ending in 0000", font=f(UNI, 24), fill=GREY)
    im.save(f"{OUT}/amazon.png", optimize=True)


gpay()
swiggy()
uber()
amazon()
