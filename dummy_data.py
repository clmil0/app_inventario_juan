from database import engine, SessionLocal, Base
from models import (
    User, Product, Sale, SaleItem, RepairService, RepairPayment,
    RepairStatusHistory, StockAudit, PriceHistory
)
import datetime

def init_db():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    if db.query(User).first():
        print("Database already populated.")
        db.close()
        return

    print("Generating dummy data...")

    # ── Usuarios ──────────────────────────────────────────────────────────────
    juan   = User(username="juan",   password_hash="1234",      role="admin")
    junior = User(username="junior", password_hash="junior123", role="operator")
    db.add_all([juan, junior])
    db.commit()

    # ── Productos ─────────────────────────────────────────────────────────────
    products = [
        Product(name="Teclado Mecánico K55",    brand="Corsair",  category="Periféricos",      cost_price=100.0, sale_price=180.0, stock=12, min_stock=3),
        Product(name="Mouse Inalámbrico M185",  brand="Logitech", category="Periféricos",      cost_price=40.0,  sale_price=75.0,  stock=20, min_stock=5),
        Product(name="Cuchilla de Licuadora",   brand="Oster",    category="Repuestos",        cost_price=15.0,  sale_price=35.0,  stock=45, min_stock=10),
        Product(name="Control Remoto Universal",brand="Chunghop", category="Controles",        cost_price=10.0,  sale_price=25.0,  stock=80, min_stock=15),
        Product(name="Licuadora Clásica 450W",  brand="Oster",    category="Electrodomésticos",cost_price=120.0, sale_price=195.0, stock=6,  min_stock=2),
        Product(name="Ventilador de Mesa 16\"", brand="Imaco",    category="Electrodomésticos",cost_price=85.0,  sale_price=140.0, stock=8,  min_stock=2),
        Product(name="Cable HDMI 1.8m",         brand="Genérico", category="Cables",           cost_price=8.0,   sale_price=18.0,  stock=60, min_stock=10),
        Product(name="Audífonos Bluetooth",     brand="JBL",      category="Audio",            cost_price=90.0,  sale_price=160.0, stock=10, min_stock=3),
    ]
    db.add_all(products)
    db.commit()

    # ── Histórico de precios (simular 1 cambio por producto) ──────────────────
    price_records = [
        PriceHistory(
            product_id=products[0].id, product_name=products[0].name,
            old_cost_price=90.0, new_cost_price=100.0,
            old_sale_price=165.0, new_sale_price=180.0,
            changed_by="juan",
            changed_at=datetime.datetime(2026, 6, 15, 10, 0),
            notes="Ajuste por alza de proveedor"
        ),
        PriceHistory(
            product_id=products[2].id, product_name=products[2].name,
            old_cost_price=12.0, new_cost_price=15.0,
            old_sale_price=28.0, new_sale_price=35.0,
            changed_by="juan",
            changed_at=datetime.datetime(2026, 7, 1, 9, 30),
            notes="Actualización de lista de precios julio"
        ),
    ]
    db.add_all(price_records)

    # ── Auditoría de stock (simular 2 recargas) ───────────────────────────────
    stock_records = [
        StockAudit(
            product_id=products[2].id, product_name=products[2].name,
            quantity_added=20, previous_stock=25, new_stock=45,
            operator_name="juan",
            created_at=datetime.datetime(2026, 7, 10, 11, 0),
            notes="Compra a proveedor Oster"
        ),
        StockAudit(
            product_id=products[3].id, product_name=products[3].name,
            quantity_added=30, previous_stock=50, new_stock=80,
            operator_name="juan",
            created_at=datetime.datetime(2026, 7, 18, 14, 0),
            notes="Ingreso mensual de controles"
        ),
    ]
    db.add_all(stock_records)
    db.commit()

    # ── Ventas ────────────────────────────────────────────────────────────────
    # Venta 1 – Junior
    sale1 = Sale(
        ticket_code="V-20260710-001", operator_name="junior",
        customer_name="Carlos Mendoza", total_amount=255.0,
        created_at=datetime.datetime(2026, 7, 10, 10, 30)
    )
    db.add(sale1); db.commit()
    db.add_all([
        SaleItem(sale_id=sale1.id, product_id=products[0].id, product_name=products[0].name, unit_price=180.0, quantity=1, subtotal=180.0),
        SaleItem(sale_id=sale1.id, product_id=products[6].id, product_name=products[6].name, unit_price=18.0,  quantity=2, subtotal=36.0),
        SaleItem(sale_id=sale1.id, product_id=products[3].id, product_name=products[3].name, unit_price=25.0,  quantity=1, subtotal=25.0),
    ])

    # Venta 2 – Juan
    sale2 = Sale(
        ticket_code="V-20260715-001", operator_name="juan",
        customer_name="Luisa Quispe", total_amount=195.0,
        created_at=datetime.datetime(2026, 7, 15, 15, 0)
    )
    db.add(sale2); db.commit()
    db.add_all([
        SaleItem(sale_id=sale2.id, product_id=products[4].id, product_name=products[4].name, unit_price=195.0, quantity=1, subtotal=195.0),
    ])

    # Venta 3 – Junior
    sale3 = Sale(
        ticket_code="V-20260720-001", operator_name="junior",
        customer_name="Cliente Anónimo", total_amount=75.0,
        created_at=datetime.datetime(2026, 7, 20, 12, 0)
    )
    db.add(sale3); db.commit()
    db.add_all([
        SaleItem(sale_id=sale3.id, product_id=products[1].id, product_name=products[1].name, unit_price=75.0, quantity=1, subtotal=75.0),
    ])

    # Venta 4 – Junior (ayer)
    sale4 = Sale(
        ticket_code="V-20260722-001", operator_name="junior",
        customer_name="Pedro Torres", total_amount=160.0,
        created_at=datetime.datetime(2026, 7, 22, 9, 45)
    )
    db.add(sale4); db.commit()
    db.add_all([
        SaleItem(sale_id=sale4.id, product_id=products[7].id, product_name=products[7].name, unit_price=160.0, quantity=1, subtotal=160.0),
    ])
    db.commit()

    # ── Reparaciones ──────────────────────────────────────────────────────────
    # Reparación 1 – ENTREGADO
    rep1 = RepairService(
        ticket_code="REP-20260705-001",
        customer_name="Sofía Paredes", customer_phone="987654321",
        equipment_type="Licuadora", brand_model="Oster 450W",
        fault_description="No enciende, fusible quemado",
        operator_name="juan",
        total_amount=60.0, advance_payment=30.0, remaining_balance=0.0,
        status="ENTREGADO",
        created_at=datetime.datetime(2026, 7, 5, 9, 0),
        updated_at=datetime.datetime(2026, 7, 8, 16, 0),
    )
    db.add(rep1); db.commit()
    db.add_all([
        RepairPayment(repair_id=rep1.id, amount=30.0, operator_name="junior", created_at=datetime.datetime(2026, 7, 5, 9, 0)),
        RepairPayment(repair_id=rep1.id, amount=30.0, operator_name="junior", created_at=datetime.datetime(2026, 7, 8, 16, 0)),
        RepairStatusHistory(repair_id=rep1.id, previous_status=None,              new_status="PENDIENTE",      changed_by="juan",   changed_at=datetime.datetime(2026, 7, 5, 9, 0)),
        RepairStatusHistory(repair_id=rep1.id, previous_status="PENDIENTE",       new_status="EN_DIAGNOSTICO", changed_by="juan",   changed_at=datetime.datetime(2026, 7, 5, 11, 0)),
        RepairStatusHistory(repair_id=rep1.id, previous_status="EN_DIAGNOSTICO",  new_status="EN_PROCESO",     changed_by="junior", changed_at=datetime.datetime(2026, 7, 6, 10, 0)),
        RepairStatusHistory(repair_id=rep1.id, previous_status="EN_PROCESO",      new_status="TERMINADO",      changed_by="junior", changed_at=datetime.datetime(2026, 7, 8, 14, 0)),
        RepairStatusHistory(repair_id=rep1.id, previous_status="TERMINADO",       new_status="ENTREGADO",      changed_by="juan",   changed_at=datetime.datetime(2026, 7, 8, 16, 0)),
    ])

    # Reparación 2 – EN_PROCESO
    rep2 = RepairService(
        ticket_code="REP-20260718-001",
        customer_name="Marco Ríos", customer_phone="912345678",
        equipment_type="Televisor", brand_model="LG 32\"",
        fault_description="Pantalla con líneas horizontales",
        operator_name="junior",
        total_amount=150.0, advance_payment=50.0, remaining_balance=100.0,
        status="EN_PROCESO",
        created_at=datetime.datetime(2026, 7, 18, 10, 0),
        updated_at=datetime.datetime(2026, 7, 19, 11, 0),
    )
    db.add(rep2); db.commit()
    db.add_all([
        RepairPayment(repair_id=rep2.id, amount=50.0, operator_name="junior", created_at=datetime.datetime(2026, 7, 18, 10, 0)),
        RepairStatusHistory(repair_id=rep2.id, previous_status=None,              new_status="PENDIENTE",      changed_by="junior", changed_at=datetime.datetime(2026, 7, 18, 10, 0)),
        RepairStatusHistory(repair_id=rep2.id, previous_status="PENDIENTE",       new_status="EN_DIAGNOSTICO", changed_by="juan",   changed_at=datetime.datetime(2026, 7, 18, 14, 0)),
        RepairStatusHistory(repair_id=rep2.id, previous_status="EN_DIAGNOSTICO",  new_status="EN_PROCESO",     changed_by="junior", changed_at=datetime.datetime(2026, 7, 19, 11, 0)),
    ])

    # Reparación 3 – PENDIENTE (recién ingresada hoy)
    rep3 = RepairService(
        ticket_code="REP-20260723-001",
        customer_name="Ana Flores", customer_phone="998877665",
        equipment_type="Laptop", brand_model="HP 14-dq2",
        fault_description="No carga la batería",
        operator_name="junior",
        total_amount=0.0, advance_payment=0.0, remaining_balance=0.0,
        status="PENDIENTE",
        created_at=datetime.datetime(2026, 7, 23, 8, 30),
        updated_at=datetime.datetime(2026, 7, 23, 8, 30),
    )
    db.add(rep3); db.commit()
    db.add_all([
        RepairStatusHistory(repair_id=rep3.id, previous_status=None, new_status="PENDIENTE", changed_by="junior", changed_at=datetime.datetime(2026, 7, 23, 8, 30)),
    ])

    # Reparación 4 – TERMINADO (lista para entregar)
    rep4 = RepairService(
        ticket_code="REP-20260721-001",
        customer_name="Luis Castillo", customer_phone="955443322",
        equipment_type="Computadora", brand_model="Ensamblada custom",
        fault_description="No enciende, fuente de poder dañada",
        operator_name="juan",
        total_amount=120.0, advance_payment=60.0, remaining_balance=60.0,
        status="TERMINADO",
        created_at=datetime.datetime(2026, 7, 21, 9, 0),
        updated_at=datetime.datetime(2026, 7, 23, 10, 0),
    )
    db.add(rep4); db.commit()
    db.add_all([
        RepairPayment(repair_id=rep4.id, amount=60.0, operator_name="juan", created_at=datetime.datetime(2026, 7, 21, 9, 0)),
        RepairStatusHistory(repair_id=rep4.id, previous_status=None,              new_status="PENDIENTE",      changed_by="juan",   changed_at=datetime.datetime(2026, 7, 21, 9, 0)),
        RepairStatusHistory(repair_id=rep4.id, previous_status="PENDIENTE",       new_status="EN_DIAGNOSTICO", changed_by="juan",   changed_at=datetime.datetime(2026, 7, 21, 10, 30)),
        RepairStatusHistory(repair_id=rep4.id, previous_status="EN_DIAGNOSTICO",  new_status="EN_PROCESO",     changed_by="junior", changed_at=datetime.datetime(2026, 7, 22, 9, 0)),
        RepairStatusHistory(repair_id=rep4.id, previous_status="EN_PROCESO",      new_status="TERMINADO",      changed_by="junior", changed_at=datetime.datetime(2026, 7, 23, 10, 0)),
    ])

    db.commit()
    db.close()
    print("Dummy data generated successfully.")

if __name__ == "__main__":
    init_db()
