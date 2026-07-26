from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
import os

# Obtener la ruta del directorio actual (donde está database.py)
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
# Subir un nivel (de backend/ a la raíz del proyecto) y entrar a data/
DATA_DIR = os.path.join(os.path.dirname(CURRENT_DIR), "data")

# Crear la carpeta data si no existe
os.makedirs(DATA_DIR, exist_ok=True)

# Ruta completa a la base de datos
DB_PATH = os.path.join(DATA_DIR, "inventario.db")
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DB_PATH}"

print(f"📁 Base de datos: {DB_PATH}")

engine = create_engine(
    SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()