from fastapi import FastAPI, Depends, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, List
import io, os, datetime, uuid

from PIL import Image, ImageDraw, ImageFont

from database import engine, get_db, Base
from models import (
    User, Product, Sale, SaleItem, RepairService, RepairPayment,
    RepairStatusHistory, StockAudit, PriceHistory
)

app = FastAPI(title="InventarioPro API")
frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    # Crear tablas si no existen
    Base.metadata.create_all(bind=engine)
    

# =============================================================================
# ID GENERATION  (formato: r-3a7f-b2c1  /  v-8d3a-1f5e)
# =============================================================================
def generate_short_id(prefix: str) -> str:
    uid = uuid.uuid4().hex
    return f"{prefix}-{uid[:4]}-{uid[4:8]}"

# =============================================================================
# AUTH HELPERS
# =============================================================================
def decode_token(token: str) -> dict:
    try:
        parts = token.split("|")
        return {"username": parts[0], "role": parts[1]}
    except Exception:
        raise HTTPException(status_code=401, detail="Token invalido")

def get_current_user(x_token: str = Header(None)):
    if not x_token:
        raise HTTPException(status_code=401, detail="No autenticado")
    return decode_token(x_token)

def require_admin(current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Solo el administrador puede hacer esto")
    return current_user

# =============================================================================
# RECEIPT GENERATION — alta calidad
# =============================================================================
RECEIPT_W = 600

C_BG        = (250, 251, 255)
C_HEADER_BG = (13, 17, 38)
C_ACCENT    = (59, 130, 246)
C_GREEN     = (16, 185, 129)
C_YELLOW    = (245, 158, 11)
C_RED       = (239, 68, 68)
C_WHITE     = (255, 255, 255)
C_DARK      = (16, 22, 48)
C_MED       = (90, 100, 135)
C_LIGHT     = (160, 170, 200)
C_SEPARATOR = (222, 228, 242)
C_FOOTER_BG = (240, 244, 254)

_BOLD_FONTS = [
    "C:/Windows/Fonts/calibrib.ttf",
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/segoeuib.ttf",
    "C:/Windows/Fonts/verdanab.ttf",
]
_REG_FONTS = [
    "C:/Windows/Fonts/calibri.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/verdana.ttf",
]

def _font(size: int, bold: bool = False):
    for path in (_BOLD_FONTS if bold else _REG_FONTS):
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            pass
    try:
        return ImageFont.load_default(size=size)
    except Exception:
        return ImageFont.load_default()

def _tw(d, text: str, font) -> int:
    try:
        bb = d.textbbox((0, 0), str(text), font=font)
        return bb[2] - bb[0]
    except Exception:
        return len(str(text)) * 8

def _draw_receipt(
    doc_type: str,
    ticket_id: str,
    date_str: str,
    sections: list,
    footer: str = "Gracias por su preferencia",
    accent: tuple = C_ACCENT,
) -> bytes:
    """
    sections: list of {"title": str, "rows": list[(label, value, color_hint)]}
    color_hint: None | "green" | "yellow" | "red" | "accent"
    """
    W = RECEIPT_W
    PAD = 36
    HEADER_H = 175
    SEC_TITLE_H = 42
    ROW_H = 36
    SEC_GAP = 20
    FOOTER_H = 72
    BODY_TOP = 20

    body_h = BODY_TOP
    for sec in sections:
        body_h += SEC_TITLE_H + len(sec["rows"]) * ROW_H + SEC_GAP
    body_h += 12

    H = HEADER_H + body_h + FOOTER_H
    img = Image.new("RGB", (W, H), C_BG)
    d = ImageDraw.Draw(img)

    # Fonts
    fCompany = _font(23, bold=True)
    fDoctype = _font(13)
    fId      = _font(18, bold=True)
    fDate    = _font(12)
    fSection = _font(11, bold=True)
    fLabel   = _font(13)
    fValue   = _font(13, bold=True)
    fFooter  = _font(12)
    fLogo    = _font(15, bold=True)

    # ── HEADER ───────────────────────────────────────────────────────────────
    d.rectangle([0, 0, W, HEADER_H], fill=C_HEADER_BG)
    d.rectangle([0, 0, W, 5], fill=accent)

    # Logo circle
    cx, cy, cr = W - PAD - 28, 42, 28
    d.ellipse([cx - cr, cy - cr, cx + cr, cy + cr], fill=accent)
    lw = _tw(d, "IP", fLogo)
    d.text((cx - lw // 2, cy - 10), "IP", fill=C_WHITE, font=fLogo)

    # Company name
    d.text((PAD, 22), "InventarioPro", fill=C_WHITE, font=fCompany)
    d.text((PAD, 54), doc_type.upper(), fill=C_LIGHT, font=fDoctype)

    # Ticket ID badge
    bx, by = PAD, 80
    bw = _tw(d, ticket_id, fId) + 28
    bh = 32
    d.rectangle([bx, by, bx + bw, by + bh], fill=accent)
    d.text((bx + 14, by + 8), ticket_id, fill=C_WHITE, font=fId)

    d.text((PAD, 124), f"Emitido: {date_str}", fill=C_LIGHT, font=fDate)

    # Wavy accent at bottom of header
    d.rectangle([0, HEADER_H - 5, W, HEADER_H], fill=accent)

    # ── BODY ─────────────────────────────────────────────────────────────────
    y = HEADER_H + BODY_TOP
    for sec in sections:
        d.text((PAD, y + 10), sec["title"].upper(), fill=accent, font=fSection)
        d.line([PAD, y + SEC_TITLE_H - 6, W - PAD, y + SEC_TITLE_H - 6], fill=C_SEPARATOR, width=1)
        y += SEC_TITLE_H

        for label, value, hint in sec["rows"]:
            col = C_DARK
            if hint == "green":  col = C_GREEN
            elif hint == "yellow": col = C_YELLOW
            elif hint == "red":   col = C_RED
            elif hint == "accent": col = accent

            d.text((PAD, y + 9), str(label), fill=C_MED, font=fLabel)
            vw = _tw(d, str(value), fValue)
            d.text((W - PAD - vw, y + 9), str(value), fill=col, font=fValue)
            d.line([PAD, y + ROW_H - 1, W - PAD, y + ROW_H - 1], fill=(235, 240, 252), width=1)
            y += ROW_H

        y += SEC_GAP

    # ── FOOTER ───────────────────────────────────────────────────────────────
    d.rectangle([0, H - FOOTER_H, W, H], fill=C_FOOTER_BG)
    d.rectangle([0, H - FOOTER_H, W, H - FOOTER_H + 3], fill=accent)
    fw = _tw(d, footer, fFooter)
    d.text(((W - fw) // 2, H - FOOTER_H + 16), footer, fill=C_MED, font=fFooter)
    pw = _tw(d, "InventarioPro v2.0", fDate)
    d.text(((W - pw) // 2, H - FOOTER_H + 42), "InventarioPro v2.0", fill=C_LIGHT, font=fDate)

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# =============================================================================
# AUTH ENDPOINTS
# =============================================================================
class LoginPayload(BaseModel):
    username: str
    password: str

@app.post("/api/auth/login")
def login(payload: LoginPayload, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or user.password_hash != payload.password:
        raise HTTPException(status_code=401, detail="Usuario o contrasena incorrectos")
    return {"username": user.username, "role": user.role, "token": f"{user.username}|{user.role}"}

class ChangePasswordPayload(BaseModel):
    new_password: str

@app.put("/api/admin/change-password")
def change_password(
    payload: ChangePasswordPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    user = db.query(User).filter(User.username == current_user["username"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.password_hash = payload.new_password
    db.commit()
    return {"message": "Contrasena actualizada"}

# =============================================================================
# DASHBOARD
# =============================================================================
@app.get("/api/dashboard/kpis")
def get_kpis(db: Session = Depends(get_db)):
    sales   = db.query(Sale).all()
    repairs = db.query(RepairService).all()
    products = db.query(Product).all()

    total_sales_revenue = sum(s.total_amount for s in sales)

    total_cost = 0
    for item in db.query(SaleItem).all():
        p = db.query(Product).filter(Product.id == item.product_id).first()
        if p:
            total_cost += p.cost_price * item.quantity

    ganancia_ventas   = total_sales_revenue - total_cost
    total_repairs_rev = sum(r.total_amount for r in repairs)
    ganancia_total    = ganancia_ventas + total_repairs_rev
    capital           = sum(p.cost_price * p.stock for p in products)

    reps_activas      = [r for r in repairs if r.status != "ENTREGADO"]
    cuentas_cobrar    = sum(r.remaining_balance for r in reps_activas)
    low_stock         = [p for p in products if p.stock <= p.min_stock]

    today = datetime.date.today()
    ventas_hoy = sum(s.total_amount for s in sales if s.created_at.date() == today)
    ticket_prom = (total_sales_revenue / len(sales)) if sales else 0

    return {
        "ganancia_total": ganancia_total,
        "capital_invertido": capital,
        "cuentas_por_cobrar": cuentas_cobrar,
        "ventas_totales": total_sales_revenue,
        "reparaciones_totales": total_repairs_rev,
        "ventas_hoy": ventas_hoy,
        "ticket_promedio": ticket_prom,
        "reparaciones_activas": len(reps_activas),
        "productos_stock_bajo": len(low_stock),
        "total_ventas_count": len(sales),
    }

@app.get("/api/dashboard/sales-chart")
def get_sales_chart(db: Session = Depends(get_db)):
    today = datetime.date.today()
    result = []
    for i in range(29, -1, -1):
        day = today - datetime.timedelta(days=i)
        s = datetime.datetime.combine(day, datetime.time.min)
        e = datetime.datetime.combine(day, datetime.time.max)
        day_sales = db.query(Sale).filter(Sale.created_at >= s, Sale.created_at <= e).all()
        result.append({"date": day.strftime("%d/%m"), "total": sum(x.total_amount for x in day_sales), "count": len(day_sales)})
    return result

@app.get("/api/dashboard/top-products")
def get_top_products(db: Session = Depends(get_db)):
    counts = {}
    for item in db.query(SaleItem).all():
        counts[item.product_name] = counts.get(item.product_name, 0) + item.quantity
    top = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:5]
    return [{"product": k, "quantity": v} for k, v in top]

@app.get("/api/dashboard/repairs-by-status")
def get_repairs_by_status(db: Session = Depends(get_db)):
    statuses = ["PENDIENTE", "EN_DIAGNOSTICO", "EN_PROCESO", "TERMINADO", "ENTREGADO"]
    return [{"status": s, "count": db.query(RepairService).filter(RepairService.status == s).count()} for s in statuses]

# =============================================================================
# PRODUCTS
# =============================================================================
@app.get("/api/products")
def get_products(db: Session = Depends(get_db)):
    return db.query(Product).all()

class CreateProductPayload(BaseModel):
    name: str
    brand: str
    category: str
    cost_price: float
    sale_price: float
    stock: int = 0
    min_stock: int = 5
    is_favorite: bool = False

@app.post("/api/admin/products")
def create_product(
    payload: CreateProductPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    product = Product(
        name=payload.name,
        brand=payload.brand,
        category=payload.category,
        cost_price=payload.cost_price,
        sale_price=payload.sale_price,
        stock=payload.stock,
        min_stock=payload.min_stock,
        is_favorite=payload.is_favorite,
    )
    db.add(product)
    db.commit()
    db.refresh(product)
    return {"message": "Producto creado", "id": product.id, "name": product.name}

@app.put("/api/products/{product_id}/toggle-favorite")
def toggle_favorite(product_id: int, db: Session = Depends(get_db)):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    
    if not product.is_favorite:
        # Trying to make it favorite, check limit
        count = db.query(Product).filter(Product.is_favorite == True).count()
        if count >= 6:
            raise HTTPException(status_code=400, detail="Ya tienes 6 productos favoritos. Desmarca uno primero.")
    
    product.is_favorite = not product.is_favorite
    db.commit()
    db.refresh(product)
    return {"message": "Favorito actualizado", "is_favorite": product.is_favorite}

# =============================================================================
# ADMIN — STOCK
# =============================================================================
class AddStockPayload(BaseModel):
    product_id: int
    quantity: int
    notes: Optional[str] = ""

@app.post("/api/admin/stock/add")
def add_stock(
    payload: AddStockPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    product = db.query(Product).filter(Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="La cantidad debe ser mayor a 0")
    prev = product.stock
    product.stock += payload.quantity
    db.add(StockAudit(
        product_id=product.id, product_name=product.name,
        quantity_added=payload.quantity, previous_stock=prev,
        new_stock=product.stock, operator_name=current_user["username"],
        notes=payload.notes or ""
    ))
    db.commit()
    db.refresh(product)
    return {"message": "Stock actualizado", "new_stock": product.stock}

@app.get("/api/admin/stock/audit")
def get_stock_audit(db: Session = Depends(get_db), current_user: dict = Depends(require_admin)):
    audits = db.query(StockAudit).order_by(StockAudit.created_at.desc()).all()
    return [
        {
            "id": a.id, "product_name": a.product_name,
            "quantity_added": a.quantity_added, "previous_stock": a.previous_stock,
            "new_stock": a.new_stock, "operator_name": a.operator_name,
            "created_at": a.created_at.strftime("%d/%m/%Y %H:%M"),
            "notes": a.notes,
        }
        for a in audits
    ]

# =============================================================================
# ADMIN — PRECIOS
# =============================================================================
class UpdatePricePayload(BaseModel):
    new_cost_price: float
    new_sale_price: float
    notes: Optional[str] = ""

@app.put("/api/admin/products/{product_id}/price")
def update_price(
    product_id: int,
    payload: UpdatePricePayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    db.add(PriceHistory(
        product_id=product.id, product_name=product.name,
        old_cost_price=product.cost_price, new_cost_price=payload.new_cost_price,
        old_sale_price=product.sale_price, new_sale_price=payload.new_sale_price,
        changed_by=current_user["username"], notes=payload.notes or ""
    ))
    product.cost_price = payload.new_cost_price
    product.sale_price = payload.new_sale_price
    db.commit()
    return {"message": "Precio actualizado"}

@app.get("/api/admin/products/{product_id}/price-history")
def get_price_history(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: dict = Depends(require_admin)
):
    records = db.query(PriceHistory).filter(PriceHistory.product_id == product_id).order_by(PriceHistory.changed_at.desc()).all()
    return [
        {
            "id": r.id, "old_cost_price": r.old_cost_price, "new_cost_price": r.new_cost_price,
            "old_sale_price": r.old_sale_price, "new_sale_price": r.new_sale_price,
            "changed_by": r.changed_by, "changed_at": r.changed_at.strftime("%d/%m/%Y %H:%M"),
            "notes": r.notes,
        }
        for r in records
    ]

# =============================================================================
# SALES
# =============================================================================
class SaleItemPayload(BaseModel):
    product_id: int
    quantity: int

class CreateSalePayload(BaseModel):
    customer_name: Optional[str] = "Cliente Anonimo"
    items: List[SaleItemPayload]

@app.post("/api/sales")
def create_sale(
    payload: CreateSalePayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    if not payload.items:
        raise HTTPException(status_code=400, detail="La venta debe tener al menos un producto")

    # Validate stock
    for item_data in payload.items:
        product = db.query(Product).filter(Product.id == item_data.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Producto ID {item_data.product_id} no encontrado")
        if product.stock < item_data.quantity:
            raise HTTPException(status_code=400, detail=f"Stock insuficiente para '{product.name}'. Disponible: {product.stock}")

    now = datetime.datetime.now()
    ticket_code = generate_short_id("v")

    sale = Sale(
        ticket_code=ticket_code,
        operator_name=current_user["username"],
        customer_name=payload.customer_name or "Cliente Anonimo",
        total_amount=0.0,
        created_at=now,
    )
    db.add(sale)
    db.commit()

    total = 0.0
    sale_items = []
    for item_data in payload.items:
        product = db.query(Product).filter(Product.id == item_data.product_id).first()
        subtotal = product.sale_price * item_data.quantity
        total += subtotal
        sale_items.append(SaleItem(
            sale_id=sale.id, product_id=product.id,
            product_name=product.name, unit_price=product.sale_price,
            quantity=item_data.quantity, subtotal=subtotal,
        ))
        product.stock -= item_data.quantity

    db.add_all(sale_items)
    sale.total_amount = total
    db.commit()
    db.refresh(sale)

    return {
        "id": sale.id, "ticket_code": sale.ticket_code,
        "operator_name": sale.operator_name, "customer_name": sale.customer_name,
        "total_amount": sale.total_amount,
        "created_at": sale.created_at.strftime("%d/%m/%Y %H:%M"),
        "items": [
            {"product_name": si.product_name, "unit_price": si.unit_price, "quantity": si.quantity, "subtotal": si.subtotal}
            for si in sale_items
        ]
    }

@app.get("/api/sales")
def get_sales(db: Session = Depends(get_db)):
    sales = db.query(Sale).order_by(Sale.created_at.desc()).all()
    result = []
    for sale in sales:
        items = db.query(SaleItem).filter(SaleItem.sale_id == sale.id).all()
        result.append({
            "id": sale.id, "ticket_code": sale.ticket_code,
            "operator_name": sale.operator_name, "customer_name": sale.customer_name,
            "total_amount": sale.total_amount,
            "created_at": sale.created_at.strftime("%d/%m/%Y %H:%M"),
            "items": [{"product_name": i.product_name, "unit_price": i.unit_price, "quantity": i.quantity, "subtotal": i.subtotal} for i in items]
        })
    return result

# =============================================================================
# REPAIRS
# =============================================================================
VALID_STATUSES = ["PENDIENTE", "EN_DIAGNOSTICO", "EN_PROCESO", "TERMINADO", "ENTREGADO"]

class CreateRepairPayload(BaseModel):
    customer_name: str
    customer_phone: Optional[str] = ""
    equipment_type: str
    brand_model: str
    fault_description: str
    total_amount: Optional[float] = 0.0
    advance_payment: Optional[float] = 0.0

class UpdateStatusPayload(BaseModel):
    new_status: str
    notes: Optional[str] = ""

@app.post("/api/repairs")
def create_repair(
    payload: CreateRepairPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    now = datetime.datetime.now()
    ticket_code = generate_short_id("r")
    remaining = max(0.0, (payload.total_amount or 0) - (payload.advance_payment or 0))

    repair = RepairService(
        ticket_code=ticket_code,
        customer_name=payload.customer_name,
        customer_phone=payload.customer_phone or "",
        equipment_type=payload.equipment_type,
        brand_model=payload.brand_model,
        fault_description=payload.fault_description,
        operator_name=current_user["username"],
        total_amount=payload.total_amount or 0.0,
        advance_payment=payload.advance_payment or 0.0,
        remaining_balance=remaining,
        status="PENDIENTE",
        created_at=now, updated_at=now,
    )
    db.add(repair)
    db.commit()

    if payload.advance_payment and payload.advance_payment > 0:
        db.add(RepairPayment(repair_id=repair.id, amount=payload.advance_payment, operator_name=current_user["username"], created_at=now))

    db.add(RepairStatusHistory(repair_id=repair.id, previous_status=None, new_status="PENDIENTE", changed_by=current_user["username"], changed_at=now))
    db.commit()
    db.refresh(repair)

    return {
        "id": repair.id, "ticket_code": repair.ticket_code,
        "customer_name": repair.customer_name, "customer_phone": repair.customer_phone,
        "equipment_type": repair.equipment_type, "brand_model": repair.brand_model,
        "fault_description": repair.fault_description, "operator_name": repair.operator_name,
        "total_amount": repair.total_amount, "advance_payment": repair.advance_payment,
        "remaining_balance": repair.remaining_balance, "status": repair.status,
        "created_at": repair.created_at.strftime("%d/%m/%Y %H:%M"),
    }

@app.get("/api/repairs")
def get_repairs(db: Session = Depends(get_db)):
    repairs = db.query(RepairService).order_by(RepairService.created_at.desc()).all()
    result = []
    for r in repairs:
        history = db.query(RepairStatusHistory).filter(RepairStatusHistory.repair_id == r.id).order_by(RepairStatusHistory.changed_at.asc()).all()
        result.append({
            "id": r.id, "ticket_code": r.ticket_code,
            "customer_name": r.customer_name, "customer_phone": r.customer_phone,
            "equipment_type": r.equipment_type, "brand_model": r.brand_model,
            "fault_description": r.fault_description, "operator_name": r.operator_name,
            "total_amount": r.total_amount, "advance_payment": r.advance_payment,
            "remaining_balance": r.remaining_balance, "status": r.status,
            "created_at": r.created_at.strftime("%d/%m/%Y %H:%M"),
            "updated_at": r.updated_at.strftime("%d/%m/%Y %H:%M"),
            "status_history": [
                {
                    "previous_status": h.previous_status, "new_status": h.new_status,
                    "changed_by": h.changed_by, "changed_at": h.changed_at.strftime("%d/%m/%Y %H:%M"),
                    "notes": h.notes,
                }
                for h in history
            ]
        })
    return result

@app.put("/api/repairs/{repair_id}/status")
def update_repair_status(
    repair_id: int,
    payload: UpdateStatusPayload,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user)
):
    repair = db.query(RepairService).filter(RepairService.id == repair_id).first()
    if not repair:
        raise HTTPException(status_code=404, detail="Reparacion no encontrada")
    if payload.new_status not in VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Estado invalido. Validos: {VALID_STATUSES}")

    now = datetime.datetime.now()
    db.add(RepairStatusHistory(
        repair_id=repair.id, previous_status=repair.status,
        new_status=payload.new_status, changed_by=current_user["username"],
        changed_at=now, notes=payload.notes or ""
    ))
    repair.status = payload.new_status
    repair.updated_at = now
    db.commit()
    return {"message": f"Estado actualizado a {payload.new_status}"}

@app.get("/api/repairs/{repair_id}/history")
def get_repair_history(repair_id: int, db: Session = Depends(get_db)):
    history = db.query(RepairStatusHistory).filter(RepairStatusHistory.repair_id == repair_id).order_by(RepairStatusHistory.changed_at.asc()).all()
    return [
        {"previous_status": h.previous_status, "new_status": h.new_status,
         "changed_by": h.changed_by, "changed_at": h.changed_at.strftime("%d/%m/%Y %H:%M"), "notes": h.notes}
        for h in history
    ]

# =============================================================================
# RECEIPTS — alta calidad
# =============================================================================
@app.get("/api/receipts/repair/{repair_id}/png")
def get_repair_receipt(repair_id: int, db: Session = Depends(get_db)):
    repair = db.query(RepairService).filter(RepairService.id == repair_id).first()
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")

    sections = [
        {"title": "Cliente", "rows": [
            ("Nombre", repair.customer_name, None),
            ("Telefono", repair.customer_phone or "—", None),
        ]},
        {"title": "Equipo", "rows": [
            ("Tipo", repair.equipment_type, None),
            ("Marca / Modelo", repair.brand_model, None),
            ("Descripcion de falla", repair.fault_description, None),
        ]},
        {"title": "Pagos", "rows": [
            ("Monto Total", f"S/ {repair.total_amount:.2f}", None),
            ("Adelanto", f"S/ {repair.advance_payment:.2f}", "green"),
            ("Saldo Pendiente", f"S/ {repair.remaining_balance:.2f}", "yellow" if repair.remaining_balance > 0 else "green"),
        ]},
        {"title": "Informacion", "rows": [
            ("Estado", repair.status.replace("_", " "), "accent"),
            ("Tecnico", repair.operator_name, None),
            ("Fecha ingreso", repair.created_at.strftime("%d/%m/%Y %H:%M"), None),
        ]},
    ]
    data = _draw_receipt(doc_type="Recibo de Ingreso", ticket_id=repair.ticket_code, date_str=repair.created_at.strftime("%d/%m/%Y %H:%M"), sections=sections)
    return Response(content=data, media_type="image/png")

@app.get("/api/receipts/repair/{repair_id}/boleta-final/png")
def get_repair_boleta_final(repair_id: int, db: Session = Depends(get_db)):
    repair = db.query(RepairService).filter(RepairService.id == repair_id).first()
    if not repair:
        raise HTTPException(status_code=404, detail="Repair not found")
    if repair.status not in ("TERMINADO", "ENTREGADO"):
        raise HTTPException(status_code=400, detail="La reparacion aun no esta terminada")

    payments = db.query(RepairPayment).filter(RepairPayment.repair_id == repair_id).all()
    history  = db.query(RepairStatusHistory).filter(RepairStatusHistory.repair_id == repair_id).order_by(RepairStatusHistory.changed_at.asc()).all()
    term_entry = next((h for h in history if h.new_status == "TERMINADO"), None)
    total_paid = sum(p.amount for p in payments)

    pay_rows = [(f"Pago {i}", f"S/ {p.amount:.2f}", "green") for i, p in enumerate(payments, 1)]
    sections = [
        {"title": "Cliente", "rows": [
            ("Nombre", repair.customer_name, None),
            ("Telefono", repair.customer_phone or "—", None),
        ]},
        {"title": "Servicio", "rows": [
            ("Equipo", f"{repair.equipment_type} — {repair.brand_model}", None),
            ("Falla", repair.fault_description, None),
            ("Ingresado", repair.created_at.strftime("%d/%m/%Y %H:%M"), None),
            ("Terminado", term_entry.changed_at.strftime("%d/%m/%Y %H:%M") if term_entry else "—", None),
            ("Tecnico", repair.operator_name, None),
        ]},
        {"title": "Detalle de Pagos", "rows": pay_rows + [
            ("TOTAL", f"S/ {repair.total_amount:.2f}", "accent"),
            ("Total pagado", f"S/ {total_paid:.2f}", "green"),
            ("Saldo", f"S/ {repair.remaining_balance:.2f}", "yellow" if repair.remaining_balance > 0 else "green"),
        ]},
    ]
    data = _draw_receipt(
        doc_type="Boleta Final de Servicio",
        ticket_id=repair.ticket_code,
        date_str=datetime.datetime.now().strftime("%d/%m/%Y %H:%M"),
        sections=sections,
        footer="Gracias por confiar en nosotros",
        accent=(16, 185, 129),  # green accent for final receipt
    )
    return Response(content=data, media_type="image/png")

@app.get("/api/receipts/sale/{sale_id}/png")
def get_sale_receipt(sale_id: int, db: Session = Depends(get_db)):
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    items = db.query(SaleItem).filter(SaleItem.sale_id == sale_id).all()

    item_rows = [(item.product_name, f"{item.quantity} x S/{item.unit_price:.2f} = S/{item.subtotal:.2f}", None) for item in items]
    sections = [
        {"title": "Cliente", "rows": [
            ("Nombre", sale.customer_name, None),
            ("Vendedor", sale.operator_name, None),
            ("Fecha", sale.created_at.strftime("%d/%m/%Y %H:%M"), None),
        ]},
        {"title": "Productos", "rows": item_rows},
        {"title": "Total", "rows": [
            ("TOTAL A PAGAR", f"S/ {sale.total_amount:.2f}", "accent"),
        ]},
    ]
    data = _draw_receipt(
        doc_type="Boleta de Venta",
        ticket_id=sale.ticket_code,
        date_str=sale.created_at.strftime("%d/%m/%Y %H:%M"),
        sections=sections,
        footer="Gracias por su compra",
        accent=(59, 130, 246),
    )
    return Response(content=data, media_type="image/png")

# =============================================================================
# SERVE FRONTEND (debe ir al final)
# =============================================================================
if os.path.exists(frontend_path):
    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        idx   = os.path.join(frontend_path, "index.html")
        fpath = os.path.join(frontend_path, full_path)
        if os.path.exists(fpath) and os.path.isfile(fpath):
            return FileResponse(fpath)
        return FileResponse(idx)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)