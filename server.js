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
// 👑 ENDPOINTS DE ADMINISTRACIÓN Y OTROS
// ==========================================
// (Tus endpoints de /api/admin, /api/alumno, etc., permanecen igual...)
// ... (Aquí irían tus otros endpoints que ya tenías) ...

// Encendido global del servidor
app.listen(port, () => {
    console.log(`🚀 Servidor corriendo correctamente en el puerto ${port}`); 
});