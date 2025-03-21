import * as express from 'express';
import authMiddleware from '@server/middleware/authMiddleware';
import * as usageRoutes from '@server/routes/usageRoutes';

export const router: express.Router = express.Router();

router.use(authMiddleware, usageRoutes.router);
