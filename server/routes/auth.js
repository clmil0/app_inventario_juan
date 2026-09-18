const express = require('express');
const router = express.Router();
const db = require('../db');

// Login de usuario local
router.post('/login', (req, res) => {
    const { email, password } = req.body;
    
    // El frontend manda 'email' pero usamos 'username' en la BD local
    const stmt = db.prepare('SELECT * FROM profiles WHERE username = ? AND password = ?');
    const user = stmt.get(email, password);

    if (user) {
        if (!user.is_active) {
            return res.status(401).json({ error: 'Usuario inactivo' });
        }
        
        // Simular el formato de sesión de Supabase para que el frontend requiera menos cambios
        const session = {
            user: { id: user.id },
            profile: {
                id: user.id,
                username: user.username,
                role: user.role
            },
            access_token: 'local-token-' + user.id // Token dummy
        };
        
        res.json({ session });
    } else {
        res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }
});

// Endpoint para obtener sesión actual (dummy ya que validamos en el cliente para local)
router.get('/session', (req, res) => {
    res.json({ session: null }); 
});

module.exports = router;
