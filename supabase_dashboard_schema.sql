-- Este esquema es exclusivamente para Supabase y servirá para mantener
-- la data resumida que mostrará tu dashboard online.

-- Tabla para almacenar métricas globales (solo habrá 1 fila con id = 1)
CREATE TABLE public.dashboard_global_kpis (
    id INTEGER PRIMARY KEY DEFAULT 1,
    total_capital NUMERIC DEFAULT 0,
    total_receivables NUMERIC DEFAULT 0,
    low_stock_count INTEGER DEFAULT 0,
    month_sales_amount NUMERIC DEFAULT 0,
    month_repairs_count INTEGER DEFAULT 0,
    average_ticket NUMERIC DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla para almacenar métricas de ventas y reparaciones por día 
-- (útil para el gráfico de 30 días y el KPI "ventas de hoy")
CREATE TABLE public.dashboard_daily_stats (
    stat_date DATE PRIMARY KEY,
    daily_sales_amount NUMERIC DEFAULT 0,
    daily_profit NUMERIC DEFAULT 0,
    daily_repairs_completed INTEGER DEFAULT 0,
    daily_new_repairs INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla para el gráfico de los top 5 productos
CREATE TABLE public.dashboard_top_products (
    id SERIAL PRIMARY KEY,
    product_id INTEGER,
    product_name TEXT NOT NULL,
    quantity_sold INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tabla para el gráfico de estado de reparaciones (ej: "EN_PROCESO", "TERMINADO")
CREATE TABLE public.dashboard_repair_status (
    status TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habilitar RLS (Row Level Security) para que solo usuarios autenticados o un token específico puedan insertar/leer
ALTER TABLE public.dashboard_global_kpis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_daily_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_top_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_repair_status ENABLE ROW LEVEL SECURITY;

-- Crear políticas base (ajustar de acuerdo a tus necesidades de seguridad)
CREATE POLICY "Permitir lectura publica" ON public.dashboard_global_kpis FOR SELECT USING (true);
CREATE POLICY "Permitir lectura publica" ON public.dashboard_daily_stats FOR SELECT USING (true);
CREATE POLICY "Permitir lectura publica" ON public.dashboard_top_products FOR SELECT USING (true);
CREATE POLICY "Permitir lectura publica" ON public.dashboard_repair_status FOR SELECT USING (true);
