// 1. Cargar las variables de entorno del archivo .env
require('dotenv').config();

const express = require('express');
const { Client } = require('pg');
const { MercadoPagoConfig, Preference } = require('mercadopago');
const cors = require('cors');
const path = require('path'); // Importante para manejar rutas de archivos

const app = express();

const port = process.env.PORT || 3000;

// Middleware global para habilitar CORS y lectura de JSON
app.use(cors()); 
app.use(express.json()); 

// Configuración para servir archivos estáticos (HTML, CSS, JS) desde la raíz
app.use(express.static(path.join(__dirname)));

// Configuración de Mercado Pago
const clientMP = new MercadoPagoConfig({ 
    accessToken: process.env.MP_ACCESS_TOKEN 
});

// ==========================================
// CONEXIÓN A LA BASE DE DATOS (SUPABASE POOLER)
// ==========================================
const client = new Client({
    user: "postgres.bveaqyypmnqxcicpghhp", 
    password: "SISTEMCOBRO", 
    host: "aws-1-us-west-2.pooler.supabase.com", 
    port: 6543, 
    database: "postgres",
    ssl: { rejectUnauthorized: false }
});

client.connect()
    .then(() => console.log("✅ Base de Datos Conectada Exitosamente"))
    .catch(err => console.error("❌ Error DB:", err.message));

// URL de producción (Actualiza esto si es necesario)
const URL_BASE = "https://sistema-cobros-2026.onrender.com";

// ==========================================
// 🔑 ENDPOINT DE LOGIN RESTAURADO
// ==========================================
app.post('/api/login', async (req, res) => {
    const { correo, contrasena } = req.body;

    if (!correo || !contrasena) {
        return res.status(400).json({ success: false, error: "Por favor, completa todos los campos." });
    }

    try {
        const query = `
            SELECT id, nombre, correo, contraseña, activo, rol_id
            FROM usuarios
            WHERE LOWER(correo) = LOWER($1)
            LIMIT 1
        `;
        const resultado = await client.query(query, [correo.trim()]);

        if (resultado.rows.length === 0) {
            return res.status(401).json({ success: false, error: "El correo electrónico no está registrado." });
        }

        const usuario = resultado.rows[0];

        if (!usuario.activo) {
            return res.status(403).json({ success: false, error: "Esta cuenta se encuentra desactivada." });
        }

        if (usuario.contraseña !== contrasena) {
            return res.status(401).json({ success: false, error: "La contraseña es incorrecta." });
        }

        const rolTexto = usuario.rol_id === 1 ? 'Administrador' : 'Personal';
        res.json({
            success: true,
            mensaje: "Autenticación exitosa",
            usuario: { id: usuario.id, nombre: usuario.nombre, rol: rolTexto }
        });

    } catch (err) {
        res.status(500).json({ success: false, error: "Error interno del servidor al autenticar." });
    }
});


// ==========================================
// 👑 ENDPOINTS RECONSTRUIDOS DEL SÚPER ADMIN
// ==========================================

// 1. Cargar Estadísticas en Tiempo Real
app.get('/api/admin/estadisticas', async (req, res) => {
    try {
        const resAlumnos = await client.query('SELECT COUNT(*) FROM estudiantes');
        const resPagosDia = await client.query("SELECT COUNT(*) FROM pagos WHERE estatus_pago LIKE 'Aprobado%'");
        const resRecaudacion = await client.query("SELECT SUM(monto_pagado) FROM pagos WHERE estatus_pago LIKE 'Aprobado%'");
        
        const resAux = await client.query("SELECT COUNT(*) FROM usuarios WHERE rol_id = 2 AND activo = true");
        const totalAuxiliares = parseInt(resAux.rows[0].count) || 0;

        res.json({
            success: true,
            recaudacion: parseFloat(resRecaudacion.rows[0].sum) || 0.00,
            alumnos: parseInt(resAlumnos.rows[0].count) || 0,
            auxiliares: totalAuxiliares,
            pagosDia: parseInt(resPagosDia.rows[0].count) || 0
        });
    } catch (err) {
        console.error("❌ Error en estadisticas Admin:", err.message);
        res.status(500).json({ success: false, error: "Error al cargar KPIs del dashboard." });
    }
});

// 2. Modificar el paquete completo de Tarifas
app.put('/api/admin/tarifas', async (req, res) => {
    const { tarifas } = req.body;
    try {
        await client.query('BEGIN');
        const queryUpdate = 'UPDATE conceptos_cobro SET monto = $1 WHERE id = $2';
        for (let tarifa of tarifas) {
            await client.query(queryUpdate, [parseFloat(tarifa.monto), parseInt(tarifa.id)]);
        }
        await client.query('COMMIT');
        res.json({ success: true, message: "Tarifas sincronizadas." });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Obtener lista de auxiliares (Ventanillas)
app.get('/api/usuarios/auxiliares', async (req, res) => {
    try {
        const query = 'SELECT id, nombre, correo, activo FROM usuarios WHERE rol_id = 2 ORDER BY id DESC';
        const resultado = await client.query(query);
        res.json(resultado.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. Registrar Nuevo Auxiliar
app.post('/api/usuarios/auxiliar', async (req, res) => {
    const { nombre, correo, contrasena } = req.body;
    try {
        const query = `
            INSERT INTO usuarios (nombre, correo, contraseña, rol_id, activo) 
            VALUES ($1, $2, $3, 2, true) 
            RETURNING id, nombre, correo, activo
        `;
        const resultado = await client.query(query, [nombre, correo, contrasena]);
        res.json({ success: true, usuario: resultado.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ==========================================
// 📱 ENDPOINTS DEL PORTAL DEL ALUMNO (MERCADO PAGO)
// ==========================================

// Login Alumno
app.post('/api/alumno/login', async (req, res) => {
    const { matricula, nombre } = req.body;
    try {
        const query = `
            SELECT id, matricula, nombre, carrera, cuatrimestre, modalidad 
            FROM estudiantes 
            WHERE LOWER(matricula) = LOWER($1) AND LOWER(nombre) LIKE LOWER($2)
            LIMIT 1
        `;
        const resultado = await client.query(query, [matricula.trim(), `%${nombre.trim()}%`]);

        if (resultado.rows.length === 0) {
            return res.status(404).json({ success: false, error: "Matrícula o nombre incorrectos." });
        }
        res.json({ success: true, estudiante: resultado.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Obtener conceptos de cobro dinámicos
app.get('/api/conceptos', async (req, res) => {
    try {
        const query = 'SELECT id, concepto AS nombre_concepto, monto FROM conceptos_cobro ORDER BY id ASC';
        const resultado = await client.query(query);
        res.json({ success: true, conceptos: resultado.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Historial del alumno específico
app.get('/api/alumno/historial/:estudianteId', async (req, res) => {
    try {
        const query = `
            SELECT p.id, p.monto_pagado, p.fecha_pago, p.estatus_pago, p.referencia_pago, c.concepto
            FROM pagos p
            JOIN conceptos_cobro c ON p.concepto_id = c.id
            WHERE p.estudiante_id = $1
            ORDER BY p.id DESC
        `;
        const resultado = await client.query(query, [parseInt(req.params.estudianteId)]);
        res.json({ success: true, historial: resultado.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Crear Preferencia Segura de Mercado Pago
app.post('/api/pagos/crear_preferencia', async (req, res) => {
    const { estudiante_id, tramites, total } = req.body;
    try {
        await client.query('BEGIN');
        const referenciaUnica = `REF-${Date.now()}-${estudiante_id}`;
        const idsConceptos = tramites.map(t => t.id).join(',');
        const titulosConceptos = tramites.map(t => t.concepto).join(' + ');

        const queryInsert = `
            INSERT INTO pagos (estudiante_id, concepto_id, monto_pagado, estatus_pago, referencia_pago)
            VALUES ($1, $2, $3, 'Pendiente', $4)
            RETURNING id
        `;
        const primerConceptoId = parseInt(tramites[0].id);
        const resPago = await client.query(queryInsert, [estudiante_id, primerConceptoId, parseFloat(total), referenciaUnica]);
        const pagoIdDB = resPago.rows[0].id;

        const preference = new Preference(clientMP);
        const responseMP = await preference.create({
            body: {
                items: [
                    {
                        id: idsConceptos,
                        title: `Pago Digital Alumno: ${titulosConceptos}`,
                        quantity: 1,
                        unit_price: parseFloat(total),
                        currency_id: 'MXN'
                    }
                ],
                back_urls: {
                    success: `${URL_BASE}/alumno.html?estatus=success&pago_id=${pagoIdDB}`,
                    pending: `${URL_BASE}/alumno.html?estatus=pending`,
                    failure: `${URL_BASE}/alumno.html?estatus=failure`
                },
                auto_return: 'approved',
                external_reference: referenciaUnica
            }
        });

        await client.query('COMMIT');
        res.json({ success: true, init_point: responseMP.init_point });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Webhook de Mercado Pago
app.post("/webhook", async (req, res) => {
    const { query } = req;
    const paymentId = query['data.id'] || query.id;

    if (paymentId) {
        try {
            const responseMP = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer ${clientMP.accessToken}` }
            });
            const data = await responseMP.json();

            if (data.status === "approved") {
                const referenciaBuscada = data.external_reference;
                if (referenciaBuscada) {
                    const montoReal = data.transaction_amount;
                    const queryUpdate = `
                        UPDATE pagos 
                        SET estatus_pago = 'Aprobado (MercadoPago)', 
                            monto_pagado = $1, 
                            fecha_pago = CURRENT_TIMESTAMP 
                        WHERE referencia_pago = $2
                    `;
                    await client.query(queryUpdate, [montoReal, referenciaBuscada]);
                }
            }
        } catch (e) { console.error(e.message); }
    }
    res.status(200).send("OK");
});

// Cargar ticket final por ID
app.get('/api/pagos/ticket/:id', async (req, res) => {
    try {
        const query = `
            SELECT p.id, p.monto_pagado, p.fecha_pago, p.estatus_pago, p.referencia_pago, c.concepto, e.nombre, e.matricula
            FROM pagos p
            JOIN conceptos_cobro c ON p.concepto_id = c.id
            JOIN estudiantes e ON p.estudiante_id = e.id
            WHERE p.id = $1 LIMIT 1
        `;
        const resultado = await client.query(query, [parseInt(req.params.id)]);
        res.json({ success: true, pago: resultado.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});


// ==========================================
// 🏢 RUTAS DE RESPALDO (VENTANILLA FÍSICA)
// ==========================================
app.post('/api/registrar_estudiante', async (req, res) => {
    const { matricula, nombre, carrera, cuatrimestre, modalidad } = req.body; 
    try {
        await client.query('BEGIN');
        const queryEstudiante = `INSERT INTO estudiantes (matricula, nombre, carrera, cuatrimestre, modalidad) VALUES ($1, $2, $3, $4, $5) RETURNING id`;
        const resEstudiante = await client.query(queryEstudiante, [matricula, nombre, carrera, cuatrimestre, modalidad]);
        const estudianteId = resEstudiante.rows[0].id;
        await client.query(`INSERT INTO pagos (estudiante_id, concepto_id, monto_pagado, estatus_pago) VALUES ($1, 1, 0.00, 'Pendiente')`, [estudianteId]);
        await client.query('COMMIT');
        res.json({ success: true, id: estudianteId });
    } catch (err) {
        await client.query('ROLLBACK');
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pagos/cobrar', async (req, res) => {
    const { matricula, concepto_id, monto_pagado, forma_pago } = req.body;
    try {
        const buscarEstudiante = `SELECT id FROM estudiantes WHERE LOWER(matricula) = LOWER($1) LIMIT 1`;
        const resEstudiante = await client.query(buscarEstudiante, [matricula.trim()]);
        if (resEstudiante.rows.length === 0) return res.status(404).json({ success: false, error: "Matrícula no encontrada." });
        const estudiante_id_real = resEstudiante.rows[0].id;
        
        const queryInsertPago = `INSERT INTO pagos (estudiante_id, concepto_id, monto_pagado, estatus_pago, fecha_pago) VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) RETURNING id, fecha_pago`;
        const resultado = await client.query(queryInsertPago, [estudiante_id_real, parseInt(concepto_id), parseFloat(monto_pagado), `Aprobado (${forma_pago})`]);
        res.json({ success: true, pago_id: resultado.rows[0].id, fecha: resultado.rows[0].fecha_pago });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Encendido global del servidor
app.listen(port, () => {
    console.log(`🚀 Servidor corriendo correctamente en el puerto ${port}`); 
});