import * as express from 'express';
import * as usageController from '../controllers/usageController';
import { withAuth } from '../types';

export const router: express.Router = express.Router();

router.get('/usage', withAuth(usageController.getUsage));
