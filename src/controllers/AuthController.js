const authService = require('../services/auth.service');
const twoFactorService = require('../services/two-factor.service');

async function register(req, res, next) {
  try {
    const result = await authService.register(req.body);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const result = await authService.login(req.body);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function requestPasswordReset(req, res, next) {
  try {
    await authService.requestPasswordReset(req.body.email);
    // Same response whether or not the email is registered.
    res.status(200).json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    next(err);
  }
}

async function resetPassword(req, res, next) {
  try {
    const result = await authService.resetPassword(req.body.token, req.body.password);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

async function twoFactorSetup(req, res, next) {
  try {
    res.status(200).json(await twoFactorService.startSetup(req.body));
  } catch (err) {
    next(err);
  }
}

async function twoFactorEnable(req, res, next) {
  try {
    res.status(200).json(await twoFactorService.enable(req.body));
  } catch (err) {
    next(err);
  }
}

async function twoFactorVerify(req, res, next) {
  try {
    res.status(200).json(await twoFactorService.verifyLogin(req.body));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  twoFactorSetup,
  twoFactorEnable,
  twoFactorVerify,
  register,
  login,
  requestPasswordReset,
  resetPassword,
};
