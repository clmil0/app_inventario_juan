from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Float, DateTime, Text
from sqlalchemy.orm import relationship
import datetime
from database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password_hash = Column(String)
    role = Column(String, default="operator")  # "admin" o "operator"
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    brand = Column(String, index=True)
    category = Column(String, index=True)
    cost_price = Column(Float)
    sale_price = Column(Float)
    stock = Column(Integer)
    min_stock = Column(Integer, default=5)
    is_favorite = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    price_history = relationship("PriceHistory", back_populates="product")
    stock_audits = relationship("StockAudit", back_populates="product")


class PriceHistory(Base):
    """Historial de cambios de precio por producto."""
    __tablename__ = "price_history"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    product_name = Column(String)
    old_cost_price = Column(Float)
    new_cost_price = Column(Float)
    old_sale_price = Column(Float)
    new_sale_price = Column(Float)
    changed_by = Column(String)
    changed_at = Column(DateTime, default=datetime.datetime.utcnow)
    notes = Column(Text, default="")

    product = relationship("Product", back_populates="price_history")


class StockAudit(Base):
    """Auditoría de aumentos de stock (solo admin puede aumentar)."""
    __tablename__ = "stock_audits"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id"))
    product_name = Column(String)
    quantity_added = Column(Integer)
    previous_stock = Column(Integer)
    new_stock = Column(Integer)
    operator_name = Column(String)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    notes = Column(Text, default="")

    product = relationship("Product", back_populates="stock_audits")


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    ticket_code = Column(String, unique=True, index=True)
    operator_name = Column(String)
    customer_name = Column(String, default="Cliente Anónimo")
    total_amount = Column(Float)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    items = relationship("SaleItem", back_populates="sale")


class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id"))
    product_id = Column(Integer, ForeignKey("products.id"))
    product_name = Column(String)
    unit_price = Column(Float)
    quantity = Column(Integer)
    subtotal = Column(Float)

    sale = relationship("Sale", back_populates="items")
    product = relationship("Product")


class RepairService(Base):
    __tablename__ = "repair_services"

    id = Column(Integer, primary_key=True, index=True)
    ticket_code = Column(String, unique=True, index=True)
    customer_name = Column(String)
    customer_phone = Column(String)
    equipment_type = Column(String)
    brand_model = Column(String)
    fault_description = Column(String)
    operator_name = Column(String)   # quien creó la reparación
    total_amount = Column(Float, default=0.0)
    advance_payment = Column(Float, default=0.0)
    remaining_balance = Column(Float, default=0.0)
    status = Column(String, default="PENDIENTE")
    # Estados: PENDIENTE → EN_DIAGNOSTICO → EN_PROCESO → TERMINADO → ENTREGADO
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    payments = relationship("RepairPayment", back_populates="repair")
    status_history = relationship("RepairStatusHistory", back_populates="repair", order_by="RepairStatusHistory.changed_at")


class RepairPayment(Base):
    __tablename__ = "repair_payments"

    id = Column(Integer, primary_key=True, index=True)
    repair_id = Column(Integer, ForeignKey("repair_services.id"))
    amount = Column(Float)
    operator_name = Column(String)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    repair = relationship("RepairService", back_populates="payments")


class RepairStatusHistory(Base):
    """Historial de cambios de estado en reparaciones."""
    __tablename__ = "repair_status_history"

    id = Column(Integer, primary_key=True, index=True)
    repair_id = Column(Integer, ForeignKey("repair_services.id"))
    previous_status = Column(String, nullable=True)
    new_status = Column(String)
    changed_by = Column(String)
    changed_at = Column(DateTime, default=datetime.datetime.utcnow)
    notes = Column(Text, default="")

    repair = relationship("RepairService", back_populates="status_history")
