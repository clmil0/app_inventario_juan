cambios de esta versión:
✅ Limpiar carrito luego de venta: Corregido. Se ocultan los costos y ganancias estimadas al terminar la venta o vaciar el carrito.
✅ Admin vista "Ver más info": Solucionado. En escritorio ya no aparece y, en celular, muestra solo la información crítica arriba (marca, stock) y el resto se expande.
✅ Editar producto en Admin: Hecho. Se añadió un modal para cambiar Nombre, Marca/Modelo y Stock Mínimo.
✅ Obligar a 9 dígitos frontales: Añadido en los campos de teléfono (creación y edición de reparaciones) para que solo permita números y hasta 9 dígitos.
✅ Título "Precio Reparación Total": Cambiado en la interfaz de nueva reparación.
✅ Bug y nueva lógica de ganancias + KPIs: Actualizado en dashboard.js. Ahora la ganancia solo suma cuando el equipo está "Terminado" (solo el adelanto) o "Entregado" (el total del equipo). También se crearon dos nuevas tarjetas KPI para "Adelantos Retenidos" y "Potencial por Cobrar".
✅ Insumos desbordados en vista móvil: Ajustado con reglas CSS (minmax(280px) y overflow-x: auto) para que el grid se ponga vertical en móviles y no se salga de la pantalla.
✅ Precio costo a precio de venta en Insumos: Actualizado para que el descuento al sistema se haga basándose en el precio de venta (sale_price) en lugar del precio costo.
✅ Estado Devolución: Añadido a los filtros, al dropdown de cambio de estado y a la lógica de finanzas para que contabilice el costo de insumos perdidos como pérdida en ese periodo.
✅ Editar reparaciones (Admin): Añadido. El botón de edición solo aparece si el usuario activo tiene privilegios de administrador.
✅ Botón insumos a la reparación nueva: Se añadió el botón con la opción "Registrar y Añadir Insumos" que guarda la reparación e inmediatamente abre la pantalla de gestión de piezas.