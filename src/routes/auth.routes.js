const express = require('express');
const AuthController = require('../controllers/AuthController');
const { validateBody } = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../validation/auth.validation');

const router = express.Router();

router.post('/register', validateBody(registerSchema), AuthController.register);
router.post('/login', validateBody(loginSchema), AuthController.login);

module.exports = router;
