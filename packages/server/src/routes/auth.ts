import { Router, type IRouter } from 'express';
import { handleLogin, handleAuthStatus, handleVerify, handleWsTicket } from '../auth.js';

export function createAuthRouter(): IRouter {
  const router = Router();
  router.post('/login', handleLogin);
  router.get('/status', handleAuthStatus);
  router.get('/verify', handleVerify);
  router.post('/ws-ticket', handleWsTicket);
  return router;
}
