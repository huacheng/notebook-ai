import { Router, type IRouter } from 'express';
import { handleLogin, handleTokenLogin, handleRegister, handleAuthStatus, handleVerify, handleWsTicket, handleLogout } from '../auth.js';

export function createAuthRouter(): IRouter {
  const router = Router();
  router.post('/login', handleLogin);
  router.post('/login-token', handleTokenLogin);
  router.post('/register', handleRegister);
  router.post('/logout', handleLogout);
  router.get('/status', handleAuthStatus);
  router.get('/verify', handleVerify);
  router.post('/ws-ticket', handleWsTicket);
  return router;
}
